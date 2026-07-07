const CommunicationService = require("./CommunicationService");
const config = require("./config");
const commLogger = require("./logs");
const LogService = require("./services/LogService");
const OtpService = require("./services/OtpService");
const TemplateService = require("./services/TemplateService");
const QueueService = require("./services/QueueService");

let _instance = null;

async function initCommunicationModule() {
  if (_instance) return _instance;

  commLogger.info("==================================================");
  commLogger.info("[CommunicationModule] Initializing...");
  commLogger.info(`[CommunicationModule] Provider: ${config.provider}`);
  commLogger.info(`[CommunicationModule] Mode: ${config.isDev ? "Development" : "Production"}`);
  commLogger.info("==================================================");

  const service = CommunicationService.getInstance();
  await service.initialize();

  setInterval(() => {
    OtpService.cleanupExpired();
  }, 60 * 1000);

  _instance = service;
  return service;
}

function getCommunicationService() {
  if (!_instance) {
    throw new Error("Communication module not initialized. Call initCommunicationModule() first.");
  }
  return _instance;
}

function getCommunicationConfig() {
  return { ...config };
}

module.exports = {
  initCommunicationModule,
  getCommunicationService,
  getCommunicationConfig,
  CommunicationService,
  LogService,
  OtpService,
  TemplateService,
  QueueService,
};
