const express = require("express");
const router = express.Router();
const { getBackupService, isBackupInitialized } = require("../index");
const { getBackupLogger } = require("../services/BackupLogger");

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied. Super Admin role required." });
  }
  next();
}

router.use(requireSuperAdmin);

router.get("/status", async (req, res) => {
  try {
    if (!isBackupInitialized()) {
      return res.json({ status: "not_initialized", initialized: false });
    }
    const service = getBackupService();
    const status = await service.getStatus();
    res.json(status);
  } catch (err) {
    getBackupLogger().error(`[Routes] /status error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post("/run", async (req, res) => {
  try {
    if (!isBackupInitialized()) {
      return res.status(503).json({ error: "Backup system not initialized" });
    }

    const backupType = req.body.type || "daily";
    const validTypes = ["daily", "weekly", "monthly", "manual"];
    if (!validTypes.includes(backupType)) {
      return res.status(400).json({ error: `Invalid backup type. Must be one of: ${validTypes.join(", ")}` });
    }

    const service = getBackupService();
    const result = await service.startBackup(backupType);

    res.json({
      backupId: result.backupId,
      status: result.status,
      errors: result.errors,
      duration: result.duration,
      fileCount: result.fileCount,
      totalSize: result.totalSize,
      timestamp: result.timestamp,
    });
  } catch (err) {
    getBackupLogger().error(`[Routes] /run error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    if (!isBackupInitialized()) {
      return res.json({ history: [] });
    }

    const service = getBackupService();
    const limit = parseInt(req.query.limit, 10) || 50;
    const status = req.query.status || null;
    const backupType = req.query.type || null;

    const history = await service.getHistory({ limit, status, backupType });

    res.json({
      history,
      total: history.length,
      limit,
    });
  } catch (err) {
    getBackupLogger().error(`[Routes] /history error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get("/history/:id", async (req, res) => {
  try {
    if (!isBackupInitialized()) {
      return res.status(404).json({ error: "Backup system not initialized" });
    }

    const service = getBackupService();
    const details = await service.getBackupDetails(req.params.id);

    if (!details) {
      return res.status(404).json({ error: "Backup not found" });
    }

    res.json(details);
  } catch (err) {
    getBackupLogger().error(`[Routes] /history/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get("/download/:id/:filename", async (req, res) => {
  try {
    if (!isBackupInitialized()) {
      return res.status(503).json({ error: "Backup system not initialized" });
    }

    const service = getBackupService();
    const filePath = await service.downloadBackupFile(req.params.id, req.params.filename);

    const allowedExtensions = [".sql", ".json", ".xlsx", ".enc", ".log", ".txt", ".zip", ".gz"];
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return res.status(403).json({ error: "File type not allowed for download" });
    }

    res.download(filePath);
  } catch (err) {
    getBackupLogger().error(`[Routes] /download error: ${err.message}`);
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get("/logs", async (req, res) => {
  try {
    if (!isBackupInitialized()) {
      return res.json({ logs: [] });
    }

    const service = getBackupService();
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const logs = await service.getLogs({ limit, offset });

    res.json({ logs, count: logs.length });
  } catch (err) {
    getBackupLogger().error(`[Routes] /logs error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post("/restore/preview", async (req, res) => {
  try {
    const { RestoreService } = require("../restore/RestoreService");
    const restoreService = new RestoreService({
      isMock: req.app ? true : false,
    });

    const backupPath = req.body.path || req.body.backupId;
    if (!backupPath) {
      return res.status(400).json({ error: "Backup path or ID required" });
    }

    const result = await restoreService.dryRun(backupPath);
    res.json(result);
  } catch (err) {
    getBackupLogger().error(`[Routes] /restore/preview error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post("/restore/run", async (req, res) => {
  try {
    const { RestoreService } = require("../restore/RestoreService");
    const restoreService = new RestoreService({
      isMock: req.app ? true : false,
    });

    const backupPath = req.body.path || req.body.backupId;
    if (!backupPath) {
      return res.status(400).json({ error: "Backup path or ID required" });
    }

    const confirmOverwrite = req.body.confirm === true;
    const tables = req.body.tables || [];
    const dryRun = req.body.dryRun === true;

    if (!confirmOverwrite && !dryRun) {
      return res.status(400).json({
        error: "Production restore requires confirm=true. Use dryRun=true for a preview.",
      });
    }

    const result = await restoreService.executeRestore(backupPath, {
      dryRun,
      confirmOverwrite,
      tables,
      force: req.body.force === true,
    });

    res.json(result);
  } catch (err) {
    getBackupLogger().error(`[Routes] /restore/run error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/history/:id", async (req, res) => {
  try {
    if (!isBackupInitialized()) {
      return res.status(503).json({ error: "Backup system not initialized" });
    }

    const service = getBackupService();
    await service.deleteBackup(req.params.id);

    res.json({ success: true, message: `Backup ${req.params.id} deleted` });
  } catch (err) {
    getBackupLogger().error(`[Routes] DELETE /history/:id error: ${err.message}`);
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/retention/run", async (req, res) => {
  try {
    if (!isBackupInitialized()) {
      return res.status(503).json({ error: "Backup system not initialized" });
    }

    const service = getBackupService();
    const result = await service.runRetentionCleanup();

    res.json({
      success: true,
      deleted: result.deleted.length,
      protected: result.protected.length,
      errors: result.errors.length,
      details: result,
    });
  } catch (err) {
    getBackupLogger().error(`[Routes] /retention/run error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get("/config", async (req, res) => {
  try {
    const { RetentionManager } = require("../retention/RetentionManager");
    const rm = new RetentionManager();
    const retentionConfig = rm.getConfig();

    res.json({
      encryptionConfigured: !!process.env.BACKUP_ENCRYPTION_KEY && process.env.BACKUP_ENCRYPTION_KEY.length >= 64,
      storageProvider: process.env.BACKUP_STORAGE_PROVIDER || "local",
      storagePath: process.env.BACKUP_STORAGE_PATH || "./backups",
      googleDriveConfigured: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      retention: retentionConfig,
      scheduler: {
        daily: {
          enabled: process.env.BACKUP_SCHEDULE_DAILY !== "false",
          time: `${process.env.BACKUP_SCHEDULE_DAILY_HOUR || "02"}:${process.env.BACKUP_SCHEDULE_DAILY_MINUTE || "00"}`,
        },
        weekly: {
          enabled: process.env.BACKUP_SCHEDULE_WEEKLY !== "false",
          day: process.env.BACKUP_SCHEDULE_WEEKLY_DAY || "1 (Monday)",
          time: `${process.env.BACKUP_SCHEDULE_WEEKLY_HOUR || "03"}:${process.env.BACKUP_SCHEDULE_WEEKLY_MINUTE || "00"}`,
        },
        monthly: {
          enabled: process.env.BACKUP_SCHEDULE_MONTHLY !== "false",
          day: process.env.BACKUP_SCHEDULE_MONTHLY_DAY || "1",
          time: `${process.env.BACKUP_SCHEDULE_MONTHLY_HOUR || "04"}:${process.env.BACKUP_SCHEDULE_MONTHLY_MINUTE || "00"}`,
        },
        retention: {
          enabled: process.env.BACKUP_SCHEDULE_RETENTION !== "false",
          time: `${process.env.BACKUP_SCHEDULE_RETENTION_HOUR || "05"}:${process.env.BACKUP_SCHEDULE_RETENTION_MINUTE || "00"}`,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/generate-key", async (req, res) => {
  try {
    const { generateEncryptionKey } = require("../encryption/EncryptionService");
    const key = generateEncryptionKey();
    res.json({
      key,
      message: "Add this to your .env file as BACKUP_ENCRYPTION_KEY. Never share or commit this key.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
