const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { getBackupLogger, createBackupLogger } = require("./services/BackupLogger");
const { generateBackupId, createManifest, manifestToJson } = require("./services/ManifestService");
const { getEncryptionKey, validateEncryptionKey, encryptStream, encryptFile } = require("./encryption/EncryptionService");
const { computeFileChecksum, verifyChecksum } = require("./verification/VerifyService");
const { SqlExporter } = require("./exporters/SqlExporter");
const { JsonExporter } = require("./exporters/JsonExporter");
const { ExcelExporter } = require("./exporters/ExcelExporter");
const { StorageBackup } = require("./exporters/StorageBackup");
const { LocalUploader } = require("./upload/providers/LocalUploader");
const { RetentionManager } = require("./retention/RetentionManager");
const { BackupMonitor } = require("./monitoring/BackupMonitor");
const { sendNotification } = require("./services/NotificationService");

class BackupService {
  constructor(options = {}) {
    this.isMock = options.isMock !== false;
    this.db = options.db || null;
    this.mockStore = options.mockStore || null;
    this.supabase = options.supabase || null;
    this.logger = getBackupLogger();
    this.monitor = new BackupMonitor();
    this.retentionManager = new RetentionManager();
    this._currentBackup = null;
    this._uploader = null;
    this._backupDir = null;
    this._initialized = false;

    this.config = {
      storagePath: process.env.BACKUP_STORAGE_PATH || path.join(process.cwd(), "backups"),
      cleanupTempFiles: process.env.BACKUP_CLEANUP_TEMP !== "false",
      maxConcurrentBackups: 1,
      encrypt: process.env.BACKUP_DISABLE_ENCRYPTION !== "true",
    };
  }

  async initialize() {
    if (this._initialized) return;

    if (!validateEncryptionKey()) {
      this.logger.warn("[BackupService] BACKUP_ENCRYPTION_KEY not set or invalid. Set this env var for production backups.");
    }

    this._backupDir = path.resolve(this.config.storagePath);

    const normalized = path.normalize(this._backupDir);
    if (normalized !== this._backupDir) {
      throw new Error("Path traversal detected in BACKUP_STORAGE_PATH");
    }

    if (!fs.existsSync(this._backupDir)) {
      fs.mkdirSync(this._backupDir, { recursive: true });
      try {
        fs.chmodSync(this._backupDir, 0o700);
      } catch {
      }
    }

    this._uploader = await this._createUploader();
    await this._uploader.initialize();
    this.logger.info(`[BackupService] Using storage provider: ${this._uploader.getProviderName()}`);

    this._initialized = true;
    this.logger.info("[BackupService] Initialized successfully");
  }

  async startBackup(backupType = "daily") {
    if (!this._initialized) {
      await this.initialize();
    }

    if (this._currentBackup) {
      throw new Error("A backup is already in progress");
    }

    const backupId = generateBackupId();
    const timestamp = new Date().toISOString();
    const date = new Date();
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hhmm = String(date.getHours()).padStart(2, "0") + String(date.getMinutes()).padStart(2, "0");
    const relativePath = path.join(yyyy, mm, dd, hhmm);
    const outputDir = path.join(this._backupDir, relativePath);
    const tempDir = path.join(this._backupDir, ".tmp", backupId);

    const ctx = { backupId, backupType, timestamp, outputDir, tempDir };
    const log = createBackupLogger(ctx);

    const backupResult = {
      backupId,
      timestamp,
      backupType,
      status: "running",
      outputPath: outputDir,
      relativePath,
      files: [],
      errors: [],
      warnings: [],
      startTime: Date.now(),
    };

    this._currentBackup = backupResult;

    try {
      log.info(`Starting ${backupType} backup`);

      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const checksums = {};
      const allFiles = [];

      const mockStore = this.isMock && this.mockStore ? this.mockStore : await this._getProdStoreTables();

      // Step 1: SQL Export
      log.info("Exporting SQL...");
      try {
        const sqlExporter = new SqlExporter({ isMock: this.isMock, db: this.db });
        const sqlCtx = { ...ctx, mockStore };
        const sqlResult = await sqlExporter.exportAll(tempDir, mockStore, checksums, sqlCtx);
        allFiles.push(...(sqlResult.files || []));
        log.info(`SQL export complete: ${(sqlResult.files || []).length} files`);
      } catch (err) {
        log.error(`SQL export failed: ${err.message}`);
        backupResult.errors.push(`SQL export: ${err.message}`);
      }

      // Step 2: JSON Export
      log.info("Exporting JSON...");
      try {
        const jsonExporter = new JsonExporter();
        const jsonFiles = await jsonExporter.exportAll(mockStore, tempDir, checksums, ctx);
        allFiles.push(...jsonFiles);
        log.info(`JSON export complete: ${jsonFiles.length} files`);
      } catch (err) {
        log.error(`JSON export failed: ${err.message}`);
        backupResult.errors.push(`JSON export: ${err.message}`);
      }

      // Step 3: Excel Export
      log.info("Exporting Excel...");
      try {
        const excelExporter = new ExcelExporter();
        const excelFiles = await excelExporter.exportAll(mockStore, tempDir, checksums, ctx);
        allFiles.push(...excelFiles);
        log.info(`Excel export complete: ${excelFiles.length} files`);
      } catch (err) {
        log.error(`Excel export failed: ${err.message}`);
        backupResult.errors.push(`Excel export: ${err.message}`);
      }

      // Step 4: Storage Backup
      log.info("Backing up storage...");
      try {
        const storageBackup = new StorageBackup({
          supabase: this.supabase,
          isMock: this.isMock,
        });
        const storageFiles = await storageBackup.exportAll(mockStore, tempDir, checksums, ctx);
        allFiles.push(...storageFiles);
        log.info(`Storage backup complete: ${storageFiles.length} files`);
      } catch (err) {
        log.error(`Storage backup failed: ${err.message}`);
        backupResult.errors.push(`Storage backup: ${err.message}`);
      }

      // Step 5: Generate Manifest
      log.info("Generating manifest...");
      const totalTables = Object.keys(mockStore).filter((k) => Array.isArray(mockStore[k])).length;
      const totalSize = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);

      const manifest = createManifest({
        backupId,
        backupType,
        timestamp,
        totalTables,
        files: allFiles.map((f) => ({
          filename: f.filename,
          path: f.path,
          size: f.size,
          sha256: f.sha256,
          rowCount: f.rowCount,
          tableName: f.tableName,
          format: f.format,
          category: f.category,
        })),
        totalSize,
      });

      const manifestContent = manifestToJson(manifest);
      const manifestPath = path.join(tempDir, "manifest.json");
      fs.writeFileSync(manifestPath, manifestContent);
      checksums["manifest.json"] = crypto.createHash("sha256").update(manifestContent).digest("hex");

      allFiles.push({
        filename: "manifest.json",
        path: "manifest.json",
        absolutePath: manifestPath,
        size: Buffer.byteLength(manifestContent),
        sha256: checksums["manifest.json"],
      });

      // Step 6: Verify all files
      log.info("Verifying files...");
      let allVerified = true;
      for (const file of allFiles) {
        const actualChecksum = await computeFileChecksum(file.absolutePath);
        if (actualChecksum !== file.sha256) {
          log.error(`Checksum mismatch: ${file.filename}`);
          allVerified = false;
          backupResult.errors.push(`Checksum mismatch: ${file.filename}`);
        }
      }

      manifest.verification.status = allVerified ? "passed" : "failed";
      manifest.verification.verifiedAt = new Date().toISOString();

      if (!allVerified) {
        log.error("Verification failed — aborting backup");
        backupResult.status = "failed";
        this._currentBackup = null;
        await sendNotification("verification.failed", { backupId, error: "Checksum verification failed" });
        return this.monitor.recordBackup(backupResult);
      }

      log.info("All files verified successfully");

      // Step 7: Encrypt files
      if (this.config.encrypt && validateEncryptionKey()) {
        log.info("Encrypting files...");
        const encDir = path.join(tempDir, "encrypted");
        if (!fs.existsSync(encDir)) {
          fs.mkdirSync(encDir, { recursive: true });
        }

        for (const file of allFiles) {
          if (file.filename === "manifest.json") {
            const manifestEncPath = path.join(encDir, "manifest.json.enc");
            await encryptFile(file.absolutePath, manifestEncPath);
            file.encryptedPath = manifestEncPath;
            continue;
          }

          const encPath = path.join(encDir, `${file.filename}.enc`);
          try {
            const encMeta = await encryptFile(file.absolutePath, encPath);
            file.encryptedPath = encPath;
            file.encryptionMeta = encMeta;
          } catch (err) {
            log.error(`Encryption failed for ${file.filename}: ${err.message}`);
            backupResult.errors.push(`Encryption: ${file.filename}: ${err.message}`);
          }
        }

        manifest.encryption.encrypted = true;
        manifest.encryption.keyId = crypto.createHash("sha256").update(getEncryptionKey()).digest("hex").substring(0, 8);

        const updatedManifest = manifestToJson(manifest);
        fs.writeFileSync(manifestPath, updatedManifest);
        const encManifestPath = path.join(encDir, "manifest.json.enc");
        await encryptFile(manifestPath, encManifestPath);

        log.info("Encryption complete");
      } else if (!this.config.encrypt) {
        log.warn("Encryption is disabled via config");
        manifest.encryption.encrypted = false;
        fs.writeFileSync(manifestPath, manifestToJson(manifest));
      } else {
        log.warn("Encryption key not set — files will not be encrypted");
        manifest.encryption.encrypted = false;
        fs.writeFileSync(manifestPath, manifestToJson(manifest));
      }

      // Step 8: Copy to output directory
      log.info("Copying files to output directory...");
      const sourceDir = this.config.encrypt && validateEncryptionKey()
        ? path.join(tempDir, "encrypted")
        : tempDir;

      if (fs.existsSync(sourceDir)) {
        const entries = fs.readdirSync(sourceDir);
        for (const entry of entries) {
          const src = path.join(sourceDir, entry);
          const dst = path.join(outputDir, entry);
          fs.copyFileSync(src, dst);
        }
      }

      // Also copy manifest
      const manifestDest = path.join(outputDir, "manifest.json");
      if (!fs.existsSync(manifestDest)) {
        fs.copyFileSync(manifestPath, manifestDest);
      }

      // Step 9: Upload
      log.info("Uploading backup...");
      try {
        const outputFiles = fs.readdirSync(outputDir);
        const uploadResults = [];

        for (const file of outputFiles) {
          const localPath = path.join(outputDir, file);
          const remotePath = path.join(relativePath, file);
          const result = await this._uploader.uploadFile(localPath, remotePath);
          uploadResults.push(result);

          const uploadedChecksum = result.fileId || remotePath;
          log.info(`Uploaded: ${file} -> ${uploadedChecksum}`);
        }

        manifest.storage.uploadStatus = "completed";
        manifest.storage.provider = this._uploader.getProviderName();
        manifest.storage.fileId = uploadResults[0]?.fileId || null;

        backupResult.uploadStatus = "completed";
        backupResult.storageProvider = this._uploader.getProviderName();
        log.info("Upload complete");
      } catch (err) {
        log.error(`Upload failed: ${err.message}`);
        backupResult.errors.push(`Upload: ${err.message}`);
        manifest.storage.uploadStatus = "failed";
        backupResult.uploadStatus = "failed";

        await sendNotification("upload.failed", {
          backupId,
          error: err.message,
          backupType,
        });
      }

      // Step 10: Update manifest with final status
      manifest.performance.durationMs = Date.now() - backupResult.startTime;
      manifest.performance.totalSizeBytes = totalSize;
      fs.writeFileSync(path.join(outputDir, "manifest.json"), manifestToJson(manifest));

      // Step 11: Cleanup temp files
      if (this.config.cleanupTempFiles) {
        this._cleanupTempDir(tempDir);
      }

      backupResult.status = backupResult.errors.length === 0 ? "completed" : "completed_with_errors";
      backupResult.duration = Date.now() - backupResult.startTime;
      backupResult.totalSize = totalSize;
      backupResult.fileCount = allFiles.length;
      backupResult.totalTables = totalTables;
      backupResult.verificationStatus = "passed";
      backupResult.files = allFiles;

      this.monitor.recordBackup(backupResult);
      log.info(`Backup ${backupId} completed in ${backupResult.duration}ms`);

      await sendNotification("backup.success", {
        backupId,
        backupType,
        duration: backupResult.duration,
        totalSize,
        fileCount: allFiles.length,
        message: `Backup ${backupType} completed successfully`,
      });

      return backupResult;
    } catch (err) {
      log.error(`Backup failed: ${err.message}`);
      backupResult.status = "failed";
      backupResult.errors.push(`Fatal: ${err.message}`);
      backupResult.duration = Date.now() - backupResult.startTime;

      this.monitor.recordBackup(backupResult);

      await sendNotification("backup.failure", {
        backupId,
        backupType,
        error: err.message,
        message: `Backup ${backupType} failed`,
      });

      return backupResult;
    } finally {
      this._currentBackup = null;
    }
  }

  async runRetentionCleanup() {
    if (!this._initialized) {
      await this.initialize();
    }

    const history = this.monitor.getBackupHistory({ limit: 500 });
    const result = await this.retentionManager.runCleanup(history);

    await sendNotification("retention.cleanup", {
      message: `Retention cleanup: ${result.deleted.length} deleted, ${result.errors.length} errors`,
      deleted: result.deleted.length,
      errors: result.errors.length,
    });

    return result;
  }

  async getStatus() {
    if (!this._initialized) {
      return { status: "not_initialized" };
    }

    const health = this.monitor.getHealth();
    return {
      ...health,
      storageProvider: this._uploader?.getProviderName() || "none",
      storagePath: this._backupDir,
      backupInProgress: this._currentBackup !== null,
      initialized: this._initialized,
      encryptionConfigured: validateEncryptionKey(),
      retentionConfig: this.retentionManager.getConfig(),
      timestamp: new Date().toISOString(),
    };
  }

  async getHistory(options = {}) {
    return this.monitor.getBackupHistory(options);
  }

  async getLogs(options = {}) {
    const logDir = process.env.BACKUP_LOG_PATH || path.join(process.cwd(), "backups", "logs");
    const logFile = path.join(logDir, "backup.log");

    if (!fs.existsSync(logFile)) return [];

    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.split("\n").filter(Boolean);

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    return lines.slice(-limit - offset, lines.length - offset || undefined).map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line, line: offset + i + 1 };
      }
    });
  }

  async getBackupDetails(backupId) {
    const entry = this.monitor.getBackupById(backupId);
    if (entry) return entry;

    const history = this.monitor.getBackupHistory({ limit: 1000 });
    return history.find((b) => b.backupId === backupId) || null;
  }

  async downloadBackupFile(backupId, filename) {
    const entry = await this.getBackupDetails(backupId);
    if (!entry) throw new Error(`Backup not found: ${backupId}`);

    const filePath = path.join(entry.outputPath, filename);
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filename}`);

    return filePath;
  }

  async deleteBackup(backupId) {
    const entry = await this.getBackupDetails(backupId);
    if (!entry) throw new Error(`Backup not found: ${backupId}`);

    if (!entry.outputPath || !fs.existsSync(entry.outputPath)) {
      throw new Error(`Backup directory not found: ${entry.outputPath}`);
    }

    fs.rmSync(entry.outputPath, { recursive: true, force: true });

    if (this._uploader && entry.relativePath) {
      try {
        const files = fs.readdirSync(entry.outputPath);
        for (const file of files) {
          const remotePath = path.join(entry.relativePath, file);
          await this._uploader.deleteFile(remotePath);
        }
      } catch (err) {
        this.logger.warn(`[BackupService] Failed to delete from remote: ${err.message}`);
      }
    }

    return true;
  }

  async _createUploader() {
    const provider = (process.env.BACKUP_STORAGE_PROVIDER || "local").toLowerCase();

    switch (provider) {
      case "google_drive":
      case "googledrive":
      case "gdrive": {
        const { GoogleDriveUploader } = require("./upload/providers/GoogleDriveUploader");
        return new GoogleDriveUploader();
      }
      case "local":
      default: {
        return new LocalUploader({ basePath: this._backupDir });
      }
    }
  }

  async _getProdStoreTables() {
    if (!this.db || this.isMock) return {};
    const tables = {};
    try {
      const { data, error } = await this.db
        .from("information_schema.tables")
        .select("table_name")
        .eq("table_schema", "public")
        .eq("table_type", "BASE TABLE");

      if (!error && data) {
        for (const row of data) {
          const { data: rows } = await this.db.from(row.table_name).select("*");
          tables[row.table_name] = rows || [];
        }
      }
    } catch (err) {
      this.logger.warn(`[BackupService] Failed to query production tables: ${err.message}`);
    }
    return tables;
  }

  _cleanupTempDir(tempDir) {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      this.logger.warn(`[BackupService] Temp cleanup failed: ${err.message}`);
    }
  }
}

module.exports = { BackupService };
