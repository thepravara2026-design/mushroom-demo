const { getBackupLogger } = require("./BackupLogger");

let emailService = null;
try {
  emailService = require("../../services/emailService");
} catch {
}

const NOTIFICATION_CHANNELS = {
  EMAIL: "email",
  CONSOLE: "console",
};

let config = {
  channels: [NOTIFICATION_CHANNELS.CONSOLE],
  emailRecipients: [],
  onSuccess: true,
  onFailure: true,
  onVerificationFailed: true,
  onUploadFailed: true,
  onRetentionCleanup: false,
};

function configure(options) {
  if (options.channels) config.channels = options.channels;
  if (options.emailRecipients) config.emailRecipients = options.emailRecipients;
  if (options.onSuccess !== undefined) config.onSuccess = options.onSuccess;
  if (options.onFailure !== undefined) config.onFailure = options.onFailure;
  if (options.onVerificationFailed !== undefined) config.onVerificationFailed = options.onVerificationFailed;
  if (options.onUploadFailed !== undefined) config.onUploadFailed = options.onUploadFailed;
  if (options.onRetentionCleanup !== undefined) config.onRetentionCleanup = options.onRetentionCleanup;
}

async function sendNotification(type, payload) {
  const logger = getBackupLogger();

  if (!shouldNotify(type)) return;

  for (const channel of config.channels) {
    try {
      switch (channel) {
        case NOTIFICATION_CHANNELS.EMAIL:
          await sendEmail(type, payload);
          break;
        case NOTIFICATION_CHANNELS.CONSOLE:
        default:
          logger.info(`[Notification] ${type}: ${payload.message || JSON.stringify(payload)}`);
          break;
      }
    } catch (err) {
      logger.error(`[Notification] Failed to send via ${channel}: ${err.message}`);
    }
  }
}

function shouldNotify(type) {
  switch (type) {
    case "backup.success": return config.onSuccess;
    case "backup.failure": return config.onFailure;
    case "verification.failed": return config.onVerificationFailed;
    case "upload.failed": return config.onUploadFailed;
    case "retention.cleanup": return config.onRetentionCleanup;
    default: return true;
  }
}

async function sendEmail(type, payload) {
  if (!config.emailRecipients.length || !emailService) return;

  const subject = `[Backup] ${type} — ${payload.backupId || ""}`;
  const text = formatNotificationText(type, payload);

  for (const recipient of config.emailRecipients) {
    try {
      await emailService.sendEmail(recipient, subject, text);
    } catch (err) {
      getBackupLogger().error(`[Notification] Email send failed to ${recipient}: ${err.message}`);
    }
  }
}

function formatNotificationText(type, payload) {
  const lines = [`Backup Notification: ${type}`, `Timestamp: ${new Date().toISOString()}`, ""];
  if (payload.backupId) lines.push(`Backup ID: ${payload.backupId}`);
  if (payload.backupType) lines.push(`Type: ${payload.backupType}`);
  if (payload.message) lines.push(`Message: ${payload.message}`);
  if (payload.duration) lines.push(`Duration: ${payload.duration}ms`);
  if (payload.totalSize) lines.push(`Size: ${payload.totalSize} bytes`);
  if (payload.fileCount) lines.push(`Files: ${payload.fileCount}`);
  if (payload.error) lines.push(`Error: ${payload.error}`);
  return lines.join("\n");
}

module.exports = {
  NOTIFICATION_CHANNELS,
  configure,
  sendNotification,
};
