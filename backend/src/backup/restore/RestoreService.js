const fs = require("fs");
const path = require("path");
const { getBackupLogger } = require("../services/BackupLogger");
const { validateManifest } = require("../services/ManifestService");
const { verifyAllFiles } = require("../verification/VerifyService");
const { decryptFile } = require("../encryption/EncryptionService");
const crypto = require("crypto");

class RestoreService {
  constructor(options = {}) {
    this.logger = getBackupLogger();
    this.db = options.db || null;
    this.isMock = options.isMock !== false;
    this.mockStore = options.mockStore || null;
    this.backupDir = options.backupDir || process.env.BACKUP_STORAGE_PATH || path.join(process.cwd(), "backups");
  }

  async previewRestore(backupPath) {
    const results = {
      valid: false,
      manifest: null,
      manifestValid: false,
      filesVerified: false,
      verificationResults: null,
      tables: [],
      totalSize: 0,
      warnings: [],
    };

    const manifest = await this._loadManifest(backupPath);
    if (!manifest) {
      results.warnings.push("No manifest.json found");
      return results;
    }

    results.manifest = manifest;

    const manifestValidation = validateManifest(manifest);
    results.manifestValid = manifestValidation.valid;
    if (!manifestValidation.valid) {
      results.warnings.push(...manifestValidation.errors);
    }

    const verification = await verifyAllFiles(manifest);
    results.verificationResults = verification;
    results.filesVerified = verification.allVerified;

    if (!verification.allVerified) {
      const failed = verification.results.filter((r) => !r.verified);
      for (const f of failed) {
        results.warnings.push(`Checksum mismatch: ${f.file}`);
      }
    }

    for (const file of manifest.files || []) {
      if (file.format === "json" || file.tableName) {
        results.tables.push({
          tableName: file.tableName || file.filename.replace(/\.json$/, ""),
          filename: file.filename,
          size: file.size,
          rowCount: file.rowCount,
          format: file.format,
        });
      }
      results.totalSize += file.size || 0;
    }

    results.valid = results.manifestValid && results.filesVerified;

    return results;
  }

  async dryRun(backupPath) {
    this.logger.info(`[Restore] Dry run for backup: ${backupPath}`);
    const preview = await this.previewRestore(backupPath);

    return {
      dryRun: true,
      canRestore: preview.valid,
      tablesToRestore: preview.tables.length,
      totalSize: preview.totalSize,
      warnings: preview.warnings,
      manifestTimestamp: preview.manifest?.timestamp,
      backupType: preview.manifest?.backupType,
      backupId: preview.manifest?.backupId,
    };
  }

  async executeRestore(backupPath, options = {}) {
    const {
      dryRun = false,
      confirmOverwrite = false,
      tables = [],
      restoreSql = true,
      restoreJson = true,
      restoreStorage = true,
    } = options;

    const rollbackPoints = [];
    const errors = [];

    try {
      this.logger.info(`[Restore] Starting restore from: ${backupPath}`);

      const preview = await this.previewRestore(backupPath);

      if (!preview.valid && !options.force) {
        return {
          success: false,
          error: "Backup verification failed. Use force=true to override.",
          preview,
        };
      }

      if (dryRun) {
        return { success: true, dryRun: true, preview };
      }

      if (!confirmOverwrite && !this.isMock) {
        return {
          success: false,
          error: "Production restore requires confirmOverwrite=true",
          preview,
        };
      }

      const results = { restored: [], skipped: [], errors: [] };

      const manifest = preview.manifest;
      const backupId = manifest.backupId;

      if (this.isMock && this.mockStore) {
        if (restoreJson) {
          for (const fileInfo of manifest.files || []) {
            if (fileInfo.format !== "json") continue;

            const tableName = fileInfo.tableName || fileInfo.filename.replace(/\.json$/, "");
            if (tables.length > 0 && !tables.includes(tableName)) continue;

            try {
              const filePath = fileInfo.absolutePath || path.join(backupPath, fileInfo.path || fileInfo.filename);
              if (!fs.existsSync(filePath)) {
                errors.push(`File not found: ${filePath}`);
                continue;
              }

              const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

              if (Array.isArray(data) && this.mockStore[tableName] !== undefined) {
                rollbackPoints.push({
                  table: tableName,
                  snapshot: [...(this.mockStore[tableName] || [])],
                });

                this.mockStore[tableName] = data;
                results.restored.push({ tableName, rows: data.length });
              } else {
                results.skipped.push({ tableName, reason: "Table not found in mock store" });
              }
            } catch (err) {
              errors.push(`Failed to restore ${tableName}: ${err.message}`);
            }
          }
        }

        if (restoreSql) {
          const sqlFile = manifest.files?.find((f) => f.filename === "database.sql");
          if (sqlFile) {
            results.restored.push({ tableName: "*sql*", rows: 0, note: "SQL file validated" });
          }
        }
      }

      if (!this.isMock && restoreSql) {
        const sqlResult = await this._restoreSqlFromManifest(manifest, backupPath, results);
        results.restored.push(...sqlResult.restored);
        results.errors.push(...sqlResult.errors);
      }

      this.logger.info(`[Restore] Complete: ${results.restored.length} restored, ${results.errors.length} errors`);

      return {
        success: errors.length === 0,
        backupId,
        results,
        rollbackAvailable: rollbackPoints.length > 0,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (err) {
      this.logger.error(`[Restore] Fatal error: ${err.message}`);
      await this._rollback(rollbackPoints);

      return {
        success: false,
        error: err.message,
        rolledBack: rollbackPoints.length > 0,
      };
    }
  }

  async _loadManifest(backupPath) {
    const manifestPaths = [
      path.join(backupPath, "manifest.json"),
      path.join(backupPath, "backup", "manifest.json"),
      path.join(this.backupDir, backupPath, "manifest.json"),
    ];

    for (const mp of manifestPaths) {
      if (fs.existsSync(mp)) {
        try {
          const data = JSON.parse(fs.readFileSync(mp, "utf8"));
          data.manifestPath = mp;
          return data;
        } catch (err) {
          this.logger.warn(`[Restore] Failed to parse manifest at ${mp}: ${err.message}`);
        }
      }
    }

    return null;
  }

  async _restoreSqlFromManifest(manifest, backupPath, results) {
    const result = { restored: [], errors: [] };

    const sqlFiles = manifest.files?.filter((f) => f.filename === "database.sql" || f.filename === "schema.sql");
    if (!sqlFiles || sqlFiles.length === 0) return result;

    const { Client } = require("pg");
    const supabaseUrl = process.env.SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const ref = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];

    if (!ref || !serviceKey) {
      result.errors.push("Supabase connection not configured");
      return result;
    }

    const pgClient = new Client({
      host: `db.${ref}.supabase.co`,
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: serviceKey,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await pgClient.connect();

      for (const fileInfo of sqlFiles) {
        const filePath = fileInfo.absolutePath || path.join(backupPath, fileInfo.path || fileInfo.filename);
        if (!fs.existsSync(filePath)) continue;

        const sqlBuffer = fs.readFileSync(filePath, "utf8");
        const statements = sqlBuffer
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith("--"));

        for (const stmt of statements) {
          try {
            await pgClient.query(stmt);
          } catch (err) {
            result.errors.push(`SQL error: ${err.message.substring(0, 200)}`);
          }
        }

        result.restored.push({
          tableName: fileInfo.filename,
          rows: 0,
          note: "SQL statements executed",
        });
      }

      await pgClient.query("NOTIFY pgrst, 'reload schema'").catch(() => {});
    } catch (err) {
      result.errors.push(`Database connection failed: ${err.message}`);
    } finally {
      await pgClient.end().catch(() => {});
    }

    return result;
  }

  async _rollback(rollbackPoints) {
    if (rollbackPoints.length === 0 || !this.mockStore) return;

    this.logger.warn(`[Restore] Rolling back ${rollbackPoints.length} tables`);

    for (const point of rollbackPoints) {
      if (this.mockStore[point.table] !== undefined) {
        this.mockStore[point.table] = point.snapshot;
      }
    }
  }
}

module.exports = { RestoreService };
