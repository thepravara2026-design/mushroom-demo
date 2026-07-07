const { BackupService } = require("./BackupService");
const { BackupScheduler } = require("./scheduler/BackupScheduler");
const { getBackupLogger } = require("./services/BackupLogger");
const { validateEncryptionKey, generateEncryptionKey } = require("./encryption/EncryptionService");

let backupService = null;
let backupScheduler = null;
let initialized = false;

async function initBackupSystem(options = {}) {
  if (initialized) return { backupService, backupScheduler };

  const logger = getBackupLogger();
  logger.info("[Backup] Initializing backup system...");

  const db = options.db || null;
  const supabase = options.supabase || null;

  const isMock = db ? (db.isMock !== false) : true;

  let mockStore = null;
  try {
    const dbModule = require("../config/db");
    if (dbModule._getMockStore) {
      mockStore = dbModule._getMockStore();
    }
  } catch {
  }

  backupService = new BackupService({
    isMock,
    db,
    supabase,
    mockStore,
  });

  try {
    await backupService.initialize();

    backupScheduler = new BackupScheduler({
      backupService,
    });

    backupScheduler.start();

    initialized = true;
    logger.info("[Backup] Backup system initialized successfully");

    if (!validateEncryptionKey()) {
      logger.warn(
        "[Backup] BACKUP_ENCRYPTION_KEY not configured. " +
        "Generate one with: node -e \"require('./src/backup/encryption/EncryptionService').generateEncryptionKey()\""
      );
    }
  } catch (err) {
    logger.error(`[Backup] Failed to initialize backup system: ${err.message}`);
    throw err;
  }

  return { backupService, backupScheduler };
}

function getBackupService() {
  return backupService;
}

function getBackupScheduler() {
  return backupScheduler;
}

function isBackupInitialized() {
  return initialized;
}

module.exports = {
  BackupService,
  BackupScheduler,
  initBackupSystem,
  getBackupService,
  getBackupScheduler,
  isBackupInitialized,
};
