const fs = require("fs");
const path = require("path");

class BackupMonitor {
  constructor(options = {}) {
    this.history = [];
    this.maxHistorySize = options.maxHistorySize || 1000;
    this.storage = options.storage || path.join(process.cwd(), "backups", "logs", "backup-history.json");
  }

  recordBackup(backupResult) {
    const entry = {
      backupId: backupResult.backupId,
      timestamp: backupResult.timestamp || new Date().toISOString(),
      backupType: backupResult.backupType || "manual",
      status: backupResult.status || "unknown",
      duration: backupResult.duration || 0,
      totalSize: backupResult.totalSize || 0,
      fileCount: backupResult.fileCount || 0,
      totalTables: backupResult.totalTables || 0,
      verificationStatus: backupResult.verificationStatus || "pending",
      uploadStatus: backupResult.uploadStatus || "pending",
      storageProvider: backupResult.storageProvider || "local",
      storageFileId: backupResult.storageFileId || null,
      errors: backupResult.errors || [],
      outputPath: backupResult.outputPath || null,
    };

    this.history.unshift(entry);

    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }

    this._persist();

    return entry;
  }

  getLatestBackup() {
    return this.history.find((b) => b.status === "completed") || null;
  }

  getLatestFailedBackup() {
    return this.history.find((b) => b.status === "failed") || null;
  }

  getBackupById(backupId) {
    return this.history.find((b) => b.backupId === backupId) || null;
  }

  getBackupHistory(options = {}) {
    let results = [...this.history];

    if (options.status) {
      results = results.filter((b) => b.status === options.status);
    }
    if (options.backupType) {
      results = results.filter((b) => b.backupType === options.backupType);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getHealth() {
    const latest = this.getLatestBackup();
    const latestFailed = this.getLatestFailedBackup();

    const last24h = this.history.filter((b) => {
      const age = Date.now() - new Date(b.timestamp).getTime();
      return age < 24 * 60 * 60 * 1000;
    });

    const successful24h = last24h.filter((b) => b.status === "completed").length;
    const failed24h = last24h.filter((b) => b.status === "failed").length;

    const healthScore = this._calculateHealthScore(latest, latestFailed, successful24h, failed24h);

    return {
      status: healthScore >= 80 ? "healthy" : healthScore >= 50 ? "degraded" : "unhealthy",
      healthScore,
      latestBackup: latest ? {
        backupId: latest.backupId,
        timestamp: latest.timestamp,
        type: latest.backupType,
        duration: latest.duration,
        size: latest.totalSize,
        verificationStatus: latest.verificationStatus,
      } : null,
      latestFailedBackup: latestFailed ? {
        backupId: latestFailed.backupId,
        timestamp: latestFailed.timestamp,
        errors: latestFailed.errors,
      } : null,
      stats: {
        totalBackups: this.history.length,
        successfulLast24h: successful24h,
        failedLast24h: failed24h,
        totalLast24h: last24h.length,
        storageProvider: latest ? latest.storageProvider : "none",
      },
      timestamp: new Date().toISOString(),
    };
  }

  _calculateHealthScore(latest, latestFailed, successful24h, failed24h) {
    let score = 100;

    if (!latest) score -= 30;
    else if (latest.status !== "completed") score -= 20;
    else {
      const age = Date.now() - new Date(latest.timestamp).getTime();
      if (age > 48 * 60 * 60 * 1000) score -= 15;
      else if (age > 24 * 60 * 60 * 1000) score -= 5;
    }

    if (latestFailed) {
      const failedAge = Date.now() - new Date(latestFailed.timestamp).getTime();
      if (failedAge < 24 * 60 * 60 * 1000) score -= 10;
    }

    const total24h = successful24h + failed24h;
    if (total24h > 0) {
      const failureRate = failed24h / total24h;
      score -= failureRate * 30;
    }

    return Math.max(0, Math.min(100, score));
  }

  _persist() {
    try {
      const dir = path.dirname(this.storage);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const toSave = this.history.slice(0, 100);
      fs.writeFileSync(this.storage, JSON.stringify(toSave, null, 2));
    } catch {
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.storage)) {
        const data = JSON.parse(fs.readFileSync(this.storage, "utf8"));
        if (Array.isArray(data)) {
          this.history = data;
        }
      }
    } catch {
      this.history = [];
    }
  }
}

module.exports = { BackupMonitor };
