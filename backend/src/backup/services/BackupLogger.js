const winston = require("winston");
const path = require("path");
const fs = require("fs");

const SENSITIVE_PATTERNS = [
  /encrypt(?:ion)?_?key/i,
  /api[_-]?key/i,
  /secret/i,
  /jwt[_-]?secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /auth[_-]?token/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /service[_-]?account/i,
  /private[_-]?key/i,
  /pii/i,
  /aadhaar/i,
  /pan[_-]?card/i,
  /credit[_-]?card/i,
  /debit[_-]?card/i,
  /cvv/i,
  /otp/i,
  /upi[_-]?pin/i,
  /razorpay[_-]?key/i,
  /stripe[_-]?key/i,
  /supabase[_-]?key/i,
];

function sanitize(obj) {
  if (!obj) return obj;
  if (typeof obj === "string") {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(obj)) {
        return "[REDACTED]";
      }
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }
  if (typeof obj === "object" && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      let isSensitive = false;
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(key)) {
          isSensitive = true;
          break;
        }
      }
      sanitized[key] = isSensitive ? "[REDACTED]" : sanitize(value);
    }
    return sanitized;
  }
  return obj;
}

let backupLogger = null;

function getBackupLogger() {
  if (backupLogger) return backupLogger;

  const logDir = process.env.BACKUP_LOG_PATH || path.join(process.cwd(), "backups", "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  backupLogger = winston.createLogger({
    level: process.env.BACKUP_LOG_LEVEL || "info",
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
      winston.format.errors({ stack: false }),
      winston.format.json()
    ),
    defaultMeta: { service: "backup" },
    transports: [
      new winston.transports.File({
        filename: path.join(logDir, "backup.log"),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
      new winston.transports.File({
        filename: path.join(logDir, "backup-error.log"),
        level: "error",
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
      }),
    ],
  });

  if (process.env.NODE_ENV !== "production") {
    backupLogger.add(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      })
    );
  }

  return backupLogger;
}

function sanitizeLog(level, message, meta) {
  return { level, message, ...sanitize(meta || {}) };
}

const loggerProxy = new Proxy(
  {},
  {
    get(target, level) {
      if (["info", "warn", "error", "debug", "verbose"].includes(level)) {
        return (message, meta) => {
          const logger = getBackupLogger();
          const sanitized = sanitizeLog(level, message, meta);
          logger.log(level, sanitized.message, sanitized);
        };
      }
      return undefined;
    },
  }
);

function createBackupLogger(context) {
  return new Proxy(
    {},
    {
      get(target, level) {
        if (["info", "warn", "error", "debug", "verbose"].includes(level)) {
          return (message, meta) => {
            const logger = getBackupLogger();
            const enriched = { ...(meta || {}), backupId: context.backupId, backupType: context.backupType };
            const sanitized = sanitizeLog(level, `[${context.backupId}] ${message}`, enriched);
            logger.log(level, sanitized.message, sanitized);
          };
        }
        return undefined;
      },
    }
  );
}

module.exports = { getBackupLogger, createBackupLogger, sanitize };
