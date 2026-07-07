const config = require("./config");
const commLogger = require("./logs");
const MockProvider = require("./providers/mock/MockProvider");
const Msg91Provider = require("./providers/msg91/Msg91Provider");
const LogService = require("./services/LogService");
const OtpService = require("./services/OtpService");
const TemplateService = require("./services/TemplateService");
const QueueService = require("./services/QueueService");

class CommunicationService {
  constructor() {
    this._provider = null;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;

    const providerName = config.provider;
    commLogger.info(`[CommunicationService] Initializing with provider: ${providerName}`);

    switch (providerName) {
      case "msg91":
        this._provider = new Msg91Provider();
        try {
          const health = await this._provider.healthCheck();
          if (health.status === "unconfigured") {
            commLogger.warn(`[CommunicationService] MSG91 not configured (${health.message}). Falling back to Mock provider.`);
            this._provider = new MockProvider();
          }
        } catch (err) {
          commLogger.warn(`[CommunicationService] MSG91 init failed: ${err.message}. Falling back to Mock provider.`);
          this._provider = new MockProvider();
        }
        break;
      default:
        this._provider = new MockProvider();
        break;
    }

    await CommunicationService._registerQueueHandlers();

    this._initialized = true;
    const providerNameActual = this._provider ? this._provider.name || "unknown" : "none";
    commLogger.info(`[CommunicationService] Initialized with provider: ${providerNameActual}`);
  }

  static async _registerQueueHandlers() {
    QueueService.processJob("send_sms", async (job) => {
      const commService = CommunicationService._getInstance();
      await commService._provider.sendSms(job.data);
    });

    QueueService.processJob("send_otp", async (job) => {
      const commService = CommunicationService._getInstance();
      await commService._provider.sendOtp(job.data);
    });

    QueueService.processJob("verify_otp", async (job) => {
      const commService = CommunicationService._getInstance();
      await commService._provider.verifyOtp(job.data);
    });

    QueueService.processJob("send_whatsapp", async (job) => {
      const commService = CommunicationService._getInstance();
      await commService._provider.sendWhatsApp(job.data);
    });

    QueueService.processJob("send_email", async (job) => {
      const commService = CommunicationService._getInstance();
      await commService._provider.sendEmail(job.data);
    });
  }

  static _getInstance() {
    if (!global.__communicationServiceInstance) {
      global.__communicationServiceInstance = new CommunicationService();
    }
    return global.__communicationServiceInstance;
  }

  async _ensureReady() {
    if (!this._initialized) {
      await this.initialize();
    }
  }

  async sendSms({ recipient, message, template, templateVars } = {}, options = {}) {
    await this._ensureReady();
    if (options.async) {
      return QueueService.enqueue("send_sms", { recipient, message, template, templateVars });
    }
    return this._provider.sendSms({ recipient, message, template, templateVars });
  }

  async sendOtp({ recipient, channel } = {}, options = {}) {
    await this._ensureReady();
    if (options.async) {
      return QueueService.enqueue("send_otp", { recipient, channel });
    }
    return this._provider.sendOtp({ recipient, channel });
  }

  async verifyOtp({ recipient, otp } = {}) {
    await this._ensureReady();
    return this._provider.verifyOtp({ recipient, otp });
  }

  async sendWhatsApp({ recipient, message, template, templateVars } = {}, options = {}) {
    await this._ensureReady();
    if (options.async) {
      return QueueService.enqueue("send_whatsapp", { recipient, message, template, templateVars });
    }
    return this._provider.sendWhatsApp({ recipient, message, template, templateVars });
  }

  async sendEmail({ recipient, subject, body, html, template, templateVars } = {}, options = {}) {
    await this._ensureReady();
    if (options.async) {
      return QueueService.enqueue("send_email", { recipient, subject, body, html, template, templateVars });
    }
    return this._provider.sendEmail({ recipient, subject, body, html, template, templateVars });
  }

  async getDeliveryStatus({ messageId } = {}) {
    await this._ensureReady();
    return this._provider.getDeliveryStatus({ messageId });
  }

  async healthCheck() {
    await this._ensureReady();
    const providerHealth = await this._provider.healthCheck();
    const logStats = LogService.getStats();
    const queueStats = QueueService.getStats();
    return {
      service: "communication",
      provider: providerHealth,
      logs: logStats,
      queue: queueStats,
      config: {
        provider: config.provider,
        otpExpiryMinutes: config.otp.expiryMinutes,
        otpMaxAttempts: config.otp.maxAttempts,
      },
      timestamp: new Date().toISOString(),
    };
  }

  getLogs(filters = {}) {
    return LogService.getAllLogs(filters);
  }

  getLog(id) {
    return LogService.getLog(id);
  }

  getLogStats() {
    return LogService.getStats();
  }

  getQueueStatus() {
    return QueueService.getQueueStatus();
  }

  getQueueStats() {
    return QueueService.getStats();
  }

  retryFailedMessages() {
    return QueueService.retryFailedJobs();
  }

  retryMessage(jobId) {
    return QueueService.retryJob(jobId);
  }

  getOtpStatus(identifier) {
    return OtpService.getOtpStatus(identifier);
  }

  invalidateOtp(identifier) {
    return OtpService.invalidateOtp(identifier);
  }

  getTemplates() {
    return TemplateService.getAllTemplates();
  }

  renderTemplate(channel, templateName, vars) {
    return TemplateService.render(channel, templateName, vars);
  }

  getDevOtp(identifier) {
    return OtpService.getDevOtp(identifier);
  }

  cleanupExpiredOtps() {
    return OtpService.cleanupExpired();
  }

  static getInstance() {
    if (!global.__communicationServiceInstance) {
      global.__communicationServiceInstance = new CommunicationService();
    }
    return global.__communicationServiceInstance;
  }
}

module.exports = CommunicationService;
