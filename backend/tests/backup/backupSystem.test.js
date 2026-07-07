const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");

process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.BACKUP_STORAGE_PATH = path.join(os.tmpdir(), "bkp-test-" + Date.now());
process.env.BACKUP_LOG_PATH = path.join(os.tmpdir(), "bkp-logs-" + Date.now());
process.env.BACKUP_CLEANUP_TEMP = "true";

describe("Backup System — Unit Tests", () => {
  let encryptionService;
  let verifyService;
  let manifestService;
  let jsonExporter;
  let excelExporter;
  let sqlExporter;
  let localUploader;
  let retentionManager;
  let backupMonitor;
  let backupService;
  let mockStore;

  beforeAll(async () => {
    encryptionService = require("../../src/backup/encryption/EncryptionService");
    verifyService = require("../../src/backup/verification/VerifyService");
    manifestService = require("../../src/backup/services/ManifestService");
    jsonExporter = require("../../src/backup/exporters/JsonExporter");
    excelExporter = require("../../src/backup/exporters/ExcelExporter");
    sqlExporter = require("../../src/backup/exporters/SqlExporter");
    retentionManager = require("../../src/backup/retention/RetentionManager");
    backupMonitor = require("../../src/backup/monitoring/BackupMonitor");

    const { LocalUploader } = require("../../src/backup/upload/providers/LocalUploader");
    localUploader = new LocalUploader({
      basePath: process.env.BACKUP_STORAGE_PATH,
    });

    mockStore = {
      users: [
        { id: "user-1", email: "test@test.com", role: "buyer", full_name: "Test User", created_at: new Date().toISOString() },
      ],
      products: [
        { id: "prod-1", name: "Test Product", price: 100, stock: 10, category: "test" },
      ],
      categories: [
        { id: "cat-1", name: "Test Category" },
      ],
      orders: [
        { id: "order-1", user_id: "user-1", total: 500, status: "completed", created_at: new Date().toISOString() },
      ],
      empty_table: [],
      settings: [
        { key: "test_key", value: "test_value" },
      ],
    };
  });

  afterAll(() => {
    const testDir = process.env.BACKUP_STORAGE_PATH;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    const logDir = process.env.BACKUP_LOG_PATH;
    if (fs.existsSync(logDir)) {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  // ── EncryptionService Tests ──

  describe("EncryptionService", () => {
    test("getEncryptionKey returns 32-byte key from env", () => {
      const key = encryptionService.getEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    test("generateEncryptionKey returns 64-char hex string", () => {
      const key = encryptionService.generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/i.test(key)).toBe(true);
    });

    test("throws if BACKUP_ENCRYPTION_KEY is missing", () => {
      const saved = process.env.BACKUP_ENCRYPTION_KEY;
      delete process.env.BACKUP_ENCRYPTION_KEY;
      expect(() => encryptionService.getEncryptionKey()).toThrow();
      process.env.BACKUP_ENCRYPTION_KEY = saved;
    });

    test("encryptStream and decryptBuffer round-trips data", async () => {
      const original = Buffer.from("Hello, Backup System! This is test data.");
      const { Readable } = require("stream");
      const inputStream = Readable.from([original]);

      const encrypted = await encryptionService.encryptStream(inputStream);
      expect(encrypted.length).toBeGreaterThan(original.length);

      const decrypted = await encryptionService.decryptBuffer(encrypted);
      expect(decrypted.toString()).toBe(original.toString());
    });

    test("decryptBuffer fails on tampered data", async () => {
      const original = Buffer.from("Test data");
      const { Readable } = require("stream");
      const inputStream = Readable.from([original]);
      const encrypted = await encryptionService.encryptStream(inputStream);

      const newlineIdx = encrypted.indexOf(10);
      const ciphertext = encrypted.slice(newlineIdx + 1);
      const corrupted = Buffer.concat([
        encrypted.slice(0, newlineIdx + 1),
        Buffer.from("XX"),
        ciphertext.slice(2),
      ]);

      await expect(encryptionService.decryptBuffer(corrupted)).rejects.toThrow();
    });

    test("encryptFile and decryptFile round-trips", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "enc-test-"));
      const inputPath = path.join(tmpDir, "input.txt");
      const encPath = path.join(tmpDir, "output.enc");
      const decPath = path.join(tmpDir, "decrypted.txt");

      fs.writeFileSync(inputPath, "File-based encryption test data");

      await encryptionService.encryptFile(inputPath, encPath);
      expect(fs.existsSync(encPath)).toBe(true);

      await encryptionService.decryptFile(encPath, decPath);
      expect(fs.existsSync(decPath)).toBe(true);

      const decrypted = fs.readFileSync(decPath, "utf8");
      expect(decrypted).toBe("File-based encryption test data");

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("validateEncryptionKey returns true when key is set", () => {
      expect(encryptionService.validateEncryptionKey()).toBe(true);
    });

    test("validateEncryptionKey returns false when key is missing", () => {
      const saved = process.env.BACKUP_ENCRYPTION_KEY;
      delete process.env.BACKUP_ENCRYPTION_KEY;
      expect(encryptionService.validateEncryptionKey()).toBe(false);
      process.env.BACKUP_ENCRYPTION_KEY = saved;
    });
  });

  // ── VerifyService Tests ──

  describe("VerifyService", () => {
    test("computeChecksum returns 64-char hex string", () => {
      const checksum = verifyService.computeChecksum("test data");
      expect(checksum).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/i.test(checksum)).toBe(true);
    });

    test("computeFileChecksum matches expected", async () => {
      const tmpFile = path.join(os.tmpdir(), "checksum-test-" + Date.now());
      fs.writeFileSync(tmpFile, "file checksum test");
      const expected = crypto.createHash("sha256").update("file checksum test").digest("hex");
      const actual = await verifyService.computeFileChecksum(tmpFile);
      expect(actual).toBe(expected);
      fs.rmSync(tmpFile, { force: true });
    });

    test("verifyChecksum returns true for matching checksums", async () => {
      const tmpFile = path.join(os.tmpdir(), "verify-test-" + Date.now());
      fs.writeFileSync(tmpFile, "verify this data");
      const checksum = await verifyService.computeFileChecksum(tmpFile);
      const result = await verifyService.verifyChecksum(tmpFile, checksum);
      expect(result).toBe(true);
      fs.rmSync(tmpFile, { force: true });
    });

    test("verifyChecksum returns false for mismatched checksums", async () => {
      const tmpFile = path.join(os.tmpdir(), "verify-fail-" + Date.now());
      fs.writeFileSync(tmpFile, "original data");
      const result = await verifyService.verifyChecksum(tmpFile, "0000000000000000000000000000000000000000000000000000000000000000");
      expect(result).toBe(false);
      fs.rmSync(tmpFile, { force: true });
    });
  });

  // ── ManifestService Tests ──

  describe("ManifestService", () => {
    test("generateBackupId returns unique IDs", () => {
      const id1 = manifestService.generateBackupId();
      const id2 = manifestService.generateBackupId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^bkp-/);
    });

    test("createManifest returns valid manifest structure", () => {
      const manifest = manifestService.createManifest({
        backupId: "test-123",
        backupType: "daily",
        totalTables: 5,
        files: [
          { filename: "test.sql", path: "test.sql", size: 100, sha256: "abc" },
        ],
        totalSize: 100,
        backupDuration: 5000,
      });

      expect(manifest.backupId).toBe("test-123");
      expect(manifest.backupType).toBe("daily");
      expect(manifest.totalTables).toBe(5);
      expect(manifest.files).toHaveLength(1);
      expect(manifest.encryption.algorithm).toBe("AES-256-GCM");
      expect(manifest.encryption.encrypted).toBe(true);
      expect(manifest.verification.status).toBe("pending");
    });

    test("validateManifest returns valid for correct manifest", () => {
      const manifest = manifestService.createManifest({
        backupId: "test-valid",
        backupType: "weekly",
        totalTables: 3,
        files: [
          { filename: "data.json", path: "data.json", size: 50, sha256: "def" },
        ],
        totalSize: 50,
      });
      const result = manifestService.validateManifest(manifest);
      expect(result.valid).toBe(true);
    });

    test("validateManifest returns errors for invalid manifest", () => {
      const result = manifestService.validateManifest({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ── JSON Exporter Tests ──

  describe("JsonExporter", () => {
    test("exportAll creates JSON files for each table", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "json-test-"));
      const checksums = {};
      const exporter = new jsonExporter.JsonExporter();
      const files = await exporter.exportAll(mockStore, tmpDir, checksums, { backupId: "test" });

      expect(files.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(tmpDir, "users.json"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "products.json"))).toBe(true);

      const users = JSON.parse(fs.readFileSync(path.join(tmpDir, "users.json"), "utf8"));
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe("test@test.com");

      expect(checksums["users.json"]).toHaveLength(64);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("empty tables produce valid JSON files", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "json-empty-"));
      const checksums = {};
      const exporter = new jsonExporter.JsonExporter();
      const files = await exporter.exportAll(mockStore, tmpDir, checksums, { backupId: "test" });

      const emptyFile = files.find((f) => f.tableName === "empty_table");
      expect(emptyFile).toBeDefined();
      expect(emptyFile.rowCount).toBe(0);

      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, "empty_table.json"), "utf8"));
      expect(data).toEqual([]);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── Excel Exporter Tests ──

  describe("ExcelExporter", () => {
    test("exportAll creates XLSX files", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xlsx-test-"));
      const checksums = {};
      const exporter = new excelExporter.ExcelExporter();
      const files = await exporter.exportAll(mockStore, tmpDir, checksums, { backupId: "test" });

      expect(files.length).toBeGreaterThan(0);
      const xlsxFiles = files.filter((f) => f.format === "xlsx");
      expect(xlsxFiles.length).toBeGreaterThan(0);

      const productsXlsx = xlsxFiles.find((f) => f.tableName === "products");
      expect(productsXlsx).toBeDefined();
      expect(fs.existsSync(productsXlsx.absolutePath)).toBe(true);

      expect(checksums["products.xlsx"]).toHaveLength(64);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── SQL Exporter Tests ──

  describe("SqlExporter", () => {
    test("exportAll generates SQL files with correct structure", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-test-"));
      const checksums = {};
      const ctx = { backupId: "sql-test" };
      const exporter = new sqlExporter.SqlExporter({ isMock: true });
      const result = await exporter.exportAll(tmpDir, mockStore, checksums, ctx);

      expect(result.schemaFile).toBeDefined();
      expect(result.dataFile).toBeDefined();
      expect(result.files.length).toBeGreaterThan(0);

      const databasePath = path.join(tmpDir, "database.sql");
      const schemaPath = path.join(tmpDir, "schema.sql");
      expect(fs.existsSync(databasePath)).toBe(true);
      expect(fs.existsSync(schemaPath)).toBe(true);

      const schemaContent = fs.readFileSync(schemaPath, "utf8");
      expect(schemaContent).toContain("CREATE TABLE");

      const sqlContent = fs.readFileSync(databasePath, "utf8");
      expect(sqlContent).toContain("INSERT INTO");
      expect(sqlContent).toContain("Backup");
      expect(sqlContent).toContain("COMMIT");

      expect(checksums["database.sql"]).toHaveLength(64);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("SQL contains all table data", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-data-"));
      const checksums = {};
      const ctx = { backupId: "sql-data-test" };
      const exporter = new sqlExporter.SqlExporter({ isMock: true });
      await exporter.exportAll(tmpDir, mockStore, checksums, ctx);

      const sqlContent = fs.readFileSync(path.join(tmpDir, "database.sql"), "utf8");
      expect(sqlContent).toContain("test@test.com");
      expect(sqlContent).toContain("Test Product");
      expect(sqlContent).toContain("Test Category");
      expect(sqlContent).toContain("test_value");
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── LocalUploader Tests ──

  describe("LocalUploader", () => {
    test("uploadFile copies file to destination", async () => {
      const tmpFile = path.join(os.tmpdir(), "upload-src-" + Date.now());
      fs.writeFileSync(tmpFile, "upload test data");

      const result = await localUploader.uploadFile(tmpFile, "test/uploaded.txt");
      expect(result.provider).toBe("local");
      expect(fs.existsSync(result.path)).toBe(true);
      expect(fs.readFileSync(result.path, "utf8")).toBe("upload test data");

      fs.rmSync(tmpFile, { force: true });
    });

    test("verifyUpload returns true for identical files", async () => {
      const tmpFile = path.join(os.tmpdir(), "verify-src-" + Date.now());
      fs.writeFileSync(tmpFile, "verify upload data");

      const result = await localUploader.uploadFile(tmpFile, "verify-test/verify.txt");
      const verified = await localUploader.verifyUpload(tmpFile, "verify-test/verify.txt");
      expect(verified).toBe(true);

      fs.rmSync(tmpFile, { force: true });
    });

    test("deleteFile removes remote file", async () => {
      const tmpFile = path.join(os.tmpdir(), "delete-src-" + Date.now());
      fs.writeFileSync(tmpFile, "delete me");
      await localUploader.uploadFile(tmpFile, "delete-test/delete.txt");
      expect(await localUploader.fileExists("delete-test/delete.txt")).toBe(true);
      await localUploader.deleteFile("delete-test/delete.txt");
      expect(await localUploader.fileExists("delete-test/delete.txt")).toBe(false);
      fs.rmSync(tmpFile, { force: true });
    });

    test("listFiles returns uploaded files", async () => {
      const tmpFile = path.join(os.tmpdir(), "list-src-" + Date.now());
      fs.writeFileSync(tmpFile, "list test");
      await localUploader.uploadFile(tmpFile, "list-test/list.txt");

      const files = await localUploader.listFiles("list-test");
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some((f) => f.name === "list.txt")).toBe(true);

      fs.rmSync(tmpFile, { force: true });
    });
  });

  // ── RetentionManager Tests ──

  describe("RetentionManager", () => {
    test("classifyBackup returns correct types", () => {
      const rm = new retentionManager.RetentionManager();

      const tuesday = new Date("2026-07-07T10:00:00Z");
      expect(rm.classifyBackup(tuesday.toISOString())).toBe("daily");

      const monday = new Date("2026-07-06T10:00:00Z");
      expect(rm.classifyBackup(monday.toISOString())).toBe("weekly");

      const firstOfMonth = new Date("2026-08-01T10:00:00Z");
      expect(rm.classifyBackup(firstOfMonth.toISOString())).toBe("monthly");

      const firstOfYear = new Date("2025-01-01T10:00:00Z");
      expect(rm.classifyBackup(firstOfYear.toISOString())).toBe("yearly");
    });

    test("runCleanup deletes old backups beyond retention", async () => {
      const rm = new retentionManager.RetentionManager();
      const backups = [];
      const now = Date.now();

      for (let i = 0; i < 40; i++) {
        backups.push({
          backupId: `bkp-${i}`,
          timestamp: new Date(now - i * 86400000).toISOString(),
          backupType: "daily",
          status: "completed",
        });
      }

      const result = await rm.runCleanup(backups);
      expect(result.deleted.length).toBeGreaterThan(0);
    });

    test("runCleanup protects the latest backup", async () => {
      const rm = new retentionManager.RetentionManager();
      const backups = [
        { backupId: "bkp-latest", timestamp: new Date().toISOString(), backupType: "daily", status: "completed" },
        { backupId: "bkp-old-1", timestamp: new Date(Date.now() - 100 * 86400000).toISOString(), backupType: "daily", status: "completed" },
        { backupId: "bkp-old-2", timestamp: new Date(Date.now() - 101 * 86400000).toISOString(), backupType: "daily", status: "completed" },
      ];

      const result = await rm.runCleanup(backups);
      const deletedIds = result.deleted.map((d) => d.backupId);
      expect(deletedIds).not.toContain("bkp-latest");
    });

    test("runCleanup skips if latest backup failed", async () => {
      const rm = new retentionManager.RetentionManager();
      const backups = [
        { backupId: "bkp-failed", timestamp: new Date().toISOString(), backupType: "daily", status: "failed" },
      ];

      const result = await rm.runCleanup(backups);
      expect(result.failed.length).toBeGreaterThan(0);
    });
  });

  // ── BackupMonitor Tests ──

  describe("BackupMonitor", () => {
    test("recordBackup stores and retrieves entries", () => {
      const monitor = new backupMonitor.BackupMonitor();
      monitor.recordBackup({
        backupId: "bkp-monitor-1",
        backupType: "daily",
        status: "completed",
        duration: 5000,
        totalSize: 1000,
        fileCount: 5,
      });

      const latest = monitor.getLatestBackup();
      expect(latest).not.toBeNull();
      expect(latest.backupId).toBe("bkp-monitor-1");
    });

    test("getHealth returns health metrics", () => {
      const monitor = new backupMonitor.BackupMonitor();
      const health = monitor.getHealth();
      expect(health).toHaveProperty("status");
      expect(health).toHaveProperty("healthScore");
      expect(health).toHaveProperty("stats");
    });

    test("getBackupHistory returns filtered results", () => {
      const monitor = new backupMonitor.BackupMonitor();
      monitor.recordBackup({
        backupId: "bkp-hist-1",
        backupType: "daily",
        status: "completed",
      });
      monitor.recordBackup({
        backupId: "bkp-hist-2",
        backupType: "weekly",
        status: "failed",
      });

      const completed = monitor.getBackupHistory({ status: "completed" });
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(completed[0].backupId).toBe("bkp-hist-1");
    });
  });

  // ── BackupService Integration Tests ──

  describe("BackupService (Integration)", () => {
    jest.setTimeout(30000);

    test("initialize creates storage directory", async () => {
      const { BackupService } = require("../../src/backup/BackupService");
      const service = new BackupService({
        isMock: true,
        mockStore,
      });

      await service.initialize();
      expect(fs.existsSync(process.env.BACKUP_STORAGE_PATH)).toBe(true);
    });

    test("startBackup completes a full backup cycle", async () => {
      const { BackupService } = require("../../src/backup/BackupService");
      const service = new BackupService({
        isMock: true,
        mockStore,
      });

      await service.initialize();
      const result = await service.startBackup("daily");

      expect(result.backupId).toBeDefined();
      expect(result.status).toBe("completed");
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.totalTables).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);

      const history = await service.getHistory({ limit: 5 });
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].backupId).toBe(result.backupId);

      const status = await service.getStatus();
      expect(status.healthScore).toBeGreaterThanOrEqual(0);
    }, 30000);

    test("startBackup generates encrypted files when key is set", async () => {
      const { BackupService } = require("../../src/backup/BackupService");
      const service = new BackupService({
        isMock: true,
        mockStore,
      });

      await service.initialize();
      const result = await service.startBackup("daily");

      expect(result.status).toBe("completed");
      expect(fs.existsSync(result.outputPath)).toBe(true);

      const files = fs.readdirSync(result.outputPath);
      expect(files.length).toBeGreaterThan(0);
    }, 30000);

    test("startBackup works with empty mockStore", async () => {
      const { BackupService } = require("../../src/backup/BackupService");
      const service = new BackupService({
        isMock: true,
        mockStore: {},
      });

      await service.initialize();
      const result = await service.startBackup("daily");

      expect(result.status).toBe("completed");
      expect(result.totalTables).toBe(0);
    }, 30000);

    test("runRetentionCleanup works end-to-end", async () => {
      const { BackupService } = require("../../src/backup/BackupService");
      const service = new BackupService({
        isMock: true,
        mockStore,
      });

      await service.initialize();
      await service.startBackup("daily");

      const result = await service.runRetentionCleanup();
      expect(result).toBeDefined();
      expect(result.deleted).toBeDefined();
    }, 30000);
  });
});

describe("Backup System — Route Tests", () => {
  let app;

  beforeAll(() => {
    process.env.FORCE_MOCK = "true";
    app = require("../../src/server");
  });

  test("backup routes module loads without error", () => {
    const routes = require("../../src/backup/routes/backupAdminRoutes");
    expect(routes).toBeDefined();
    expect(typeof routes).toBe("function");
  });

  test("backup index module exports correctly", () => {
    const backup = require("../../src/backup/index");
    expect(backup.BackupService).toBeDefined();
    expect(backup.BackupScheduler).toBeDefined();
    expect(backup.initBackupSystem).toBeDefined();
    expect(backup.getBackupService).toBeDefined();
  });
});

describe("Backup System — Edge Cases", () => {
  jest.setTimeout(30000);

  test("empty mockStore is handled gracefully", async () => {
    const { BackupService } = require("../../src/backup/BackupService");
    const service = new BackupService({
      isMock: true,
      mockStore: {},
    });

    await service.initialize();
    const result = await service.startBackup("daily");

    expect(result.status).toBe("completed");
    expect(result.totalTables).toBe(0);
  }, 30000);

  test("multiple sequential backups produce unique IDs", async () => {
    const { BackupService } = require("../../src/backup/BackupService");
    const service = new BackupService({
      isMock: true,
      mockStore: {
        users: [{ id: "u1", name: "Test" }],
        products: [{ id: "p1", name: "Test Product" }],
      },
    });

    await service.initialize();
    const r1 = await service.startBackup("daily");
    const r2 = await service.startBackup("daily");

    expect(r1.backupId).not.toBe(r2.backupId);
  }, 30000);

  test("encryption with empty data produces valid output", async () => {
    const encryptionService = require("../../src/backup/encryption/EncryptionService");
    const { Readable } = require("stream");
    const emptyStream = Readable.from([Buffer.alloc(0)]);

    const encrypted = await encryptionService.encryptStream(emptyStream);
    const decrypted = await encryptionService.decryptBuffer(encrypted);
    expect(decrypted.length).toBe(0);
  });

  test("SHA-256 checksums are deterministic", () => {
    const verifyService = require("../../src/backup/verification/VerifyService");
    const data = "deterministic test data";
    const hash1 = verifyService.computeChecksum(data);
    const hash2 = verifyService.computeChecksum(data);
    expect(hash1).toBe(hash2);
  });

  test("manifest JSON is valid and parseable", () => {
    const manifestService = require("../../src/backup/services/ManifestService");
    const manifest = manifestService.createManifest({
      backupId: "edge-test",
      backupType: "daily",
      totalTables: 2,
      files: [
        { filename: "a.json", path: "a.json", size: 10, sha256: "0".repeat(64) },
      ],
      totalSize: 10,
    });

    const json = manifestService.manifestToJson(manifest);
    const parsed = JSON.parse(json);
    expect(parsed.backupId).toBe("edge-test");
  });
});
