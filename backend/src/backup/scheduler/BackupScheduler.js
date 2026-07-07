const { getBackupLogger } = require("../services/BackupLogger");

class BackupScheduler {
  constructor(options = {}) {
    this.backupService = options.backupService;
    this.logger = getBackupLogger();
    this.intervals = [];
    this.running = false;
    this.config = {
      daily: {
        enabled: process.env.BACKUP_SCHEDULE_DAILY !== "false",
        hour: parseInt(process.env.BACKUP_SCHEDULE_DAILY_HOUR, 10) || 2,
        minute: parseInt(process.env.BACKUP_SCHEDULE_DAILY_MINUTE, 10) || 0,
      },
      weekly: {
        enabled: process.env.BACKUP_SCHEDULE_WEEKLY !== "false",
        dayOfWeek: parseInt(process.env.BACKUP_SCHEDULE_WEEKLY_DAY, 10) || 1,
        hour: parseInt(process.env.BACKUP_SCHEDULE_WEEKLY_HOUR, 10) || 3,
        minute: parseInt(process.env.BACKUP_SCHEDULE_WEEKLY_MINUTE, 10) || 0,
      },
      monthly: {
        enabled: process.env.BACKUP_SCHEDULE_MONTHLY !== "false",
        dayOfMonth: parseInt(process.env.BACKUP_SCHEDULE_MONTHLY_DAY, 10) || 1,
        hour: parseInt(process.env.BACKUP_SCHEDULE_MONTHLY_HOUR, 10) || 4,
        minute: parseInt(process.env.BACKUP_SCHEDULE_MONTHLY_MINUTE, 10) || 0,
      },
      retention: {
        enabled: process.env.BACKUP_SCHEDULE_RETENTION !== "false",
        hour: parseInt(process.env.BACKUP_SCHEDULE_RETENTION_HOUR, 10) || 5,
        minute: parseInt(process.env.BACKUP_SCHEDULE_RETENTION_MINUTE, 10) || 0,
      },
    };
    this.checkIntervalMs = 60000;
    this._lastCheckedDate = null;
    this._lastRetentionRun = null;
  }

  start() {
    if (this.running) return;
    this.running = true;

    this.logger.info("[Scheduler] Starting backup scheduler");

    this._scheduleNextCheck();

    this.logger.info("[Scheduler] Backup scheduler started");
  }

  stop() {
    this.running = false;
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
    this.logger.info("[Scheduler] Backup scheduler stopped");
  }

  _scheduleNextCheck() {
    const interval = setInterval(() => {
      if (!this.running) return;
      this._checkSchedules();
    }, this.checkIntervalMs);

    this.intervals.push(interval);

    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000;
    setTimeout(() => {
      if (this.running) this._checkSchedules();
    }, msUntilNextMinute);
  }

  _checkSchedules() {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    if (this._lastCheckedDate === today) return;

    if (!this.backupService) {
      this.logger.warn("[Scheduler] BackupService not set");
      return;
    }

    const backupTypes = [];

    if (this._shouldRunMonthly(now)) {
      backupTypes.push({ type: "monthly", label: "Monthly" });
    }

    if (this._shouldRunWeekly(now)) {
      backupTypes.push({ type: "weekly", label: "Weekly" });
    }

    if (this._shouldRunDaily(now)) {
      backupTypes.push({ type: "daily", label: "Daily" });
    }

    if (backupTypes.length > 0) {
      for (const bt of backupTypes) {
        this.logger.info(`[Scheduler] Triggering ${bt.label} backup`);
        this.backupService.startBackup(bt.type).catch((err) => {
          this.logger.error(`[Scheduler] ${bt.label} backup failed: ${err.message}`);
        });
      }
    }

    if (this._shouldRunRetention(now)) {
      this.logger.info("[Scheduler] Triggering retention cleanup");
      this.backupService.runRetentionCleanup().catch((err) => {
        this.logger.error(`[Scheduler] Retention cleanup failed: ${err.message}`);
      });
    }

    this._lastCheckedDate = today;
  }

  _shouldRunDaily(now) {
    const cfg = this.config.daily;
    if (!cfg.enabled) return false;
    return now.getHours() === cfg.hour && now.getMinutes() >= cfg.minute && now.getMinutes() < cfg.minute + 5;
  }

  _shouldRunWeekly(now) {
    const cfg = this.config.weekly;
    if (!cfg.enabled) return false;
    if (now.getDay() !== cfg.dayOfWeek) return false;
    return now.getHours() === cfg.hour && now.getMinutes() >= cfg.minute && now.getMinutes() < cfg.minute + 5;
  }

  _shouldRunMonthly(now) {
    const cfg = this.config.monthly;
    if (!cfg.enabled) return false;
    if (now.getDate() !== cfg.dayOfMonth) return false;
    return now.getHours() === cfg.hour && now.getMinutes() >= cfg.minute && now.getMinutes() < cfg.minute + 5;
  }

  _shouldRunRetention(now) {
    const cfg = this.config.retention;
    if (!cfg.enabled) return false;

    const today = now.toISOString().split("T")[0];
    if (this._lastRetentionRun === today) return false;

    if (now.getHours() === cfg.hour && now.getMinutes() >= cfg.minute && now.getMinutes() < cfg.minute + 5) {
      this._lastRetentionRun = today;
      return true;
    }

    return false;
  }

  getConfig() {
    return { ...this.config };
  }

  async runNow(backupType = "daily") {
    if (!this.backupService) {
      throw new Error("BackupService not configured");
    }
    return this.backupService.startBackup(backupType);
  }
}

module.exports = { BackupScheduler };
