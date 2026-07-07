const crypto = require("crypto");

const MANIFEST_VERSION = "2.0";
const RESTORE_COMPAT_VERSION = "1.0";
const BACKUP_FORMAT_VERSION = "1.0";

function generateBackupId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString("hex");
  return `bkp-${ts}-${rand}`;
}

function createManifest({
  backupId,
  backupType,
  timestamp,
  appVersion,
  dbVersion,
  files,
  encryptionAlgorithm,
  encryptionKeyId,
  storageProvider,
  storageProviderFileId,
  totalTables,
  backupDuration,
  verificationStatus,
  uploadStatus,
  totalSize,
  compressedSize,
  notes,
}) {
  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    backupId: backupId || generateBackupId(),
    timestamp: timestamp || new Date().toISOString(),
    applicationVersion: appVersion || process.env.npm_package_version || "1.0.0",
    databaseVersion: dbVersion || "unknown",
    backupType: backupType || "daily",
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    restoreCompatibilityVersion: RESTORE_COMPAT_VERSION,
    totalTables: totalTables || 0,
    fileCount: files ? files.length : 0,
    files: files || [],
    encryption: {
      algorithm: encryptionAlgorithm || "AES-256-GCM",
      keyId: encryptionKeyId || null,
      encrypted: true,
    },
    storage: {
      provider: storageProvider || "local",
      fileId: storageProviderFileId || null,
      uploadStatus: uploadStatus || "pending",
    },
    verification: {
      status: verificationStatus || "pending",
      verifiedAt: null,
    },
    performance: {
      durationMs: backupDuration || 0,
      totalSizeBytes: totalSize || 0,
      compressedSizeBytes: compressedSize || 0,
    },
    notes: notes || null,
  };

  if (manifest.verification.status === "passed") {
    manifest.verification.verifiedAt = new Date().toISOString();
  }

  return manifest;
}

function manifestToJson(manifest) {
  return JSON.stringify(manifest, null, 2);
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest.backupId) errors.push("Missing backupId");
  if (!manifest.timestamp) errors.push("Missing timestamp");
  if (!manifest.backupType) errors.push("Missing backupType");
  if (!manifest.files || !Array.isArray(manifest.files)) errors.push("Missing or invalid files array");
  if (!manifest.encryption || !manifest.encryption.algorithm) errors.push("Missing encryption algorithm");
  if (!manifest.verification) errors.push("Missing verification section");
  if (!manifest.storage) errors.push("Missing storage section");
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    errors.push(`Unsupported manifest version: ${manifest.manifestVersion}`);
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  MANIFEST_VERSION,
  RESTORE_COMPAT_VERSION,
  BACKUP_FORMAT_VERSION,
  generateBackupId,
  createManifest,
  manifestToJson,
  validateManifest,
};
