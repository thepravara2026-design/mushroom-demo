const fs = require("fs");
const path = require("path");
const { getBackupLogger } = require("../services/BackupLogger");

const DEFAULT_CONFIG = {
  daily: { keep: 30, enabled: true },
  weekly: { keep: 12, enabled: true },
  monthly: { keep: 12, enabled: true },
  yearly: { keep: 0, enabled: false },
  protectedCount: 1,
  neverDeleteLatest: true,
  skipIfLatestFailed: true,
};

class RetentionManager {
  constructor(options = {}) {
    this.config = {
      daily: {
        keep: parseInt(process.env.BACKUP_RETENTION_DAILY, 10) || options.daily || DEFAULT_CONFIG.daily.keep,
        enabled: true,
      },
      weekly: {
        keep: parseInt(process.env.BACKUP_RETENTION_WEEKLY, 10) || options.weekly || DEFAULT_CONFIG.weekly.keep,
        enabled: true,
      },
      monthly: {
        keep: parseInt(process.env.BACKUP_RETENTION_MONTHLY, 10) || options.monthly || DEFAULT_CONFIG.monthly.keep,
        enabled: true,
      },
      yearly: {
        keep: parseInt(process.env.BACKUP_RETENTION_YEARLY, 10) || options.yearly || DEFAULT_CONFIG.yearly.keep,
        enabled: !!process.env.BACKUP_RETENTION_YEARLY || options.yearlyEnabled || false,
      },
      protectedCount: parseInt(process.env.BACKUP_PROTECTED_COUNT, 10) || DEFAULT_CONFIG.protectedCount,
      neverDeleteLatest: true,
      skipIfLatestFailed: true,
    };
    this.logger = getBackupLogger();
    this.uploader = options.uploader || null;
  }

  async runCleanup(backupHistory) {
    const operations = {
      deleted: [],
      protected: [],
      failed: [],
      errors: [],
    };

    if (!backupHistory || backupHistory.length === 0) {
      this.logger.info("[Retention] No backups found for cleanup");
      return operations;
    }

    const sorted = [...backupHistory].sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    const latestSuccessful = sorted.find((b) => b.status === "completed");

    if (this.config.skipIfLatestFailed && !latestSuccessful) {
      this.logger.warn("[Retention] Skipping cleanup — latest backup failed");
      operations.failed.push("Latest backup failed, cleanup skipped");
      return operations;
    }

    const protectedBackups = sorted.slice(0, this.config.protectedCount);
    const candidates = sorted.slice(this.config.protectedCount);

    const toDelete = [];
    const grouped = this._groupByType(candidates);

    for (const [backupType, backups] of Object.entries(grouped)) {
      const typeConfig = this.config[backupType];
      if (!typeConfig || !typeConfig.enabled) continue;

      const sortedByType = backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const keep = typeConfig.keep;

      for (let i = keep; i < sortedByType.length; i++) {
        const backup = sortedByType[i];

        const isProtected = protectedBackups.some((pb) => pb.backupId === backup.backupId);
        if (isProtected) {
          operations.protected.push(backup.backupId);
          continue;
        }

        if (backup.protected) {
          operations.protected.push(backup.backupId);
          continue;
        }

        toDelete.push(backup);
      }
    }

    const deletedIds = new Set();
    for (const backup of toDelete) {
      if (deletedIds.has(backup.backupId)) continue;
      deletedIds.add(backup.backupId);
      deletedIds.add(backup.id);

      try {
        const dirPath = backup.path || backup.directory;
        if (dirPath) {
          const fullPath = path.resolve(dirPath);
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        }

        if (this.uploader && backup.uploadFileId) {
          try {
            await this.uploader.deleteFile(backup.remotePath || "");
          } catch (uploadErr) {
            this.logger.warn(`[Retention] Failed to delete from cloud: ${backup.backupId}: ${uploadErr.message}`);
          }
        }

        operations.deleted.push({
          backupId: backup.backupId,
          type: backup.backupType,
          timestamp: backup.timestamp,
          reason: `exceeded ${backup.backupType} retention limit`,
          path: dirPath,
        });

        this.logger.info(`[Retention] Deleted backup ${backup.backupId} (${backup.backupType}): exceeded retention limit`);
      } catch (err) {
        operations.errors.push({
          backupId: backup.backupId,
          error: err.message,
        });
        this.logger.error(`[Retention] Failed to delete backup ${backup.backupId}: ${err.message}`);
      }
    }

    this.logger.info(`[Retention] Cleanup complete: ${operations.deleted.length} deleted, ${operations.protected.length} protected, ${operations.errors.length} errors`);

    return operations;
  }

  _groupByType(backups) {
    const grouped = { daily: [], weekly: [], monthly: [], yearly: [] };

    for (const backup of backups) {
      const type = backup.backupType || "daily";
      if (grouped[type]) {
        grouped[type].push(backup);
      } else {
        grouped.daily.push(backup);
      }
    }

    return grouped;
  }

  classifyBackup(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();

    const isYearly =
      date.getMonth() === 0 &&
      date.getDate() === 1 &&
      now.getFullYear() - date.getFullYear() >= 1;

    const isMonthly =
      date.getDate() === 1 && !isYearly;

    const dayOfWeek = date.getDay();
    const isWeekly = dayOfWeek === 1;

    if (isYearly) return "yearly";
    if (isMonthly) return "monthly";
    if (isWeekly) return "weekly";
    return "daily";
  }

  getConfig() {
    return { ...this.config };
  }
}

module.exports = { RetentionManager };
