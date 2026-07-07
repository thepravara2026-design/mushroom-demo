const path = require("path");

const config = {
  provider: (process.env.COMMUNICATION_PROVIDER || "mock").toLowerCase(),

  mock: {
    simulateFailures: process.env.MOCK_COMM_SIMULATE_FAILURES === "true",
    failureRate: parseFloat(process.env.MOCK_COMM_FAILURE_RATE || "0"),
    simulateDelay: process.env.MOCK_COMM_SIMULATE_DELAY === "true",
    delayMs: parseInt(process.env.MOCK_COMM_DELAY_MS, 10) || 100,
  },

  msg91: {
    authKey: process.env.MSG91_AUTH_KEY || "",
    senderId: process.env.MSG91_SENDER_ID || "",
    templateId: process.env.MSG91_TEMPLATE_ID || "",
    otpTemplate: process.env.MSG91_OTP_TEMPLATE || "",
    whatsappTemplate: process.env.MSG91_WHATSAPP_TEMPLATE || "",
  },

  otp: {
    length: parseInt(process.env.COMM_OTP_LENGTH, 10) || 6,
    expiryMinutes: parseInt(process.env.COMM_OTP_EXPIRY_MINUTES, 10) || 5,
    maxAttempts: parseInt(process.env.COMM_OTP_MAX_ATTEMPTS, 10) || 5,
  },

  queue: {
    retryMaxAttempts: parseInt(process.env.COMM_QUEUE_RETRY_MAX, 10) || 3,
    retryBaseDelayMs: parseInt(process.env.COMM_QUEUE_RETRY_BASE_DELAY, 10) || 1000,
    pollIntervalMs: parseInt(process.env.COMM_QUEUE_POLL_INTERVAL, 10) || 500,
  },

  logDir: process.env.COMM_LOG_DIR || path.join(process.cwd(), "logs", "communication"),

  isDev: process.env.NODE_ENV === "development" || process.env.FORCE_MOCK === "true",
  isProd: process.env.NODE_ENV === "production",
};

module.exports = config;
