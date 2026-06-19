const crypto = require("crypto");
const logger = require("../utils/logger");

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    logger.error("JWT_SECRET environment variable is required in production. Aborting startup.");
    process.exit(1);
  }
  logger.warn(
    "JWT_SECRET environment variable is not set. Using a random fallback. Set JWT_SECRET in production.",
  );
}

const JWT_SECRET =
  process.env.JWT_SECRET || "change-me-in-production-" + crypto.randomBytes(16).toString("hex");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

module.exports = { JWT_SECRET, JWT_EXPIRES_IN };
