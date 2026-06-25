const winston = require("winston");
require("winston-daily-rotate-file");

const logDir = process.env.LOG_DIR || "logs";

const fileRotateTransport = new winston.transports.DailyRotateFile({
  filename: `${logDir}/app-%DATE%.log`,
  datePattern: "YYYY-MM-DD",
  maxFiles: "7d",
  zippedArchive: false,
  format:
    process.env.NODE_ENV === "production"
      ? winston.format.json()
      : winston.format.combine(
          winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
          winston.format.printf(
            ({ timestamp, level, message, stack, ...meta }) => {
              const metaStr = Object.keys(meta).length
                ? ` ${JSON.stringify(meta)}`
                : "";
              return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}${stack ? `\n${stack}` : ""}`;
            },
          ),
        ),
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === "production"
      ? winston.format.json()
      : winston.format.printf(
          ({ timestamp, level, message, stack, ...meta }) => {
            const metaStr = Object.keys(meta).length
              ? ` ${JSON.stringify(meta)}`
              : "";
            return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}${stack ? `\n${stack}` : ""}`;
          },
        ),
  ),
  transports: [new winston.transports.Console(), fileRotateTransport],
});

module.exports = logger;
