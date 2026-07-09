const ProviderInterface = require("../../interfaces/ProviderInterface");
const OtpService = require("../../services/OtpService");
const TemplateService = require("../../services/TemplateService");
const LogService = require("../../services/LogService");
const config = require("../../config");
const commLogger = require("../../logs");

class MockProvider extends ProviderInterface {
  constructor() {
    super();
    this.name = "mock";
  }

  async sendSms({ recipient, message, template, templateVars } = {}) {
    await MockProvider._simulateDelay();

    if (MockProvider._shouldFail()) {
      const logId = LogService.createLog({
        recipient, channel: "sms", type: template || "custom", provider: this.name, template,
      });
      LogService.markFailed(logId, "Simulated SMS failure");
      commLogger.warn(`[MockProvider:SMS] Simulated failure to ${LogService.maskRecipient(recipient)}`);
      return { success: false, error: "Simulated SMS failure", mock: true, logId };
    }

    let finalMessage = message;
    if (template && !message) {
      const rendered = TemplateService.render("sms", template, templateVars);
      if (rendered) finalMessage = rendered.message;
    }

    const logId = LogService.createLog({
      recipient, channel: "sms", type: template || "custom", provider: this.name, template,
    });

    commLogger.info(`[MockProvider:SMS] To: ${LogService.maskRecipient(recipient)}`, {
      message: finalMessage ? finalMessage.substring(0, 100) : "(empty)",
    });

    if (process.stdout.isTTY) {
      console.log(`\n[MOCK SMS] To: ${LogService.maskRecipient(recipient)}`);
      if (template) console.log(`   Template: ${template}`);
      console.log();
    }

    LogService.markSent(logId);
    setTimeout(() => LogService.markDelivered(logId), 500);

    return {
      success: true,
      mock: true,
      logId,
      messageId: logId,
      provider: this.name,
    };
  }

  async sendOtp({ recipient, channel = "sms" } = {}) {
    await MockProvider._simulateDelay();

    const otp = await OtpService.generateOtp(recipient);

    const logId = LogService.createLog({
      recipient, channel: "otp", type: "otp_" + channel, provider: this.name,
    });

    commLogger.info(`[MockProvider:OTP] Sent to ${OtpService.maskIdentifier(recipient)} via ${channel}`);

    if (process.stdout.isTTY) {
      const masked = otp[0] + "***" + otp[otp.length - 1];
      console.log(`\n[MOCK OTP] To: ${LogService.maskRecipient(recipient)} (via ${channel})`);
      console.log(`   OTP: ${masked}`);
      console.log(`   Valid for ${config.otp.expiryMinutes} minutes`);
      console.log();
    }

    LogService.markSent(logId);

    return {
      success: true,
      mock: true,
      logId,
      messageId: logId,
      provider: this.name,
    };
  }

  async verifyOtp({ recipient, otp } = {}) {
    await MockProvider._simulateDelay();
    return OtpService.verifyOtp(recipient, otp);
  }

  async sendWhatsApp({ recipient, message, template, templateVars } = {}) {
    await MockProvider._simulateDelay();

    if (MockProvider._shouldFail()) {
      const logId = LogService.createLog({
        recipient, channel: "whatsapp", type: template || "custom", provider: this.name, template,
      });
      LogService.markFailed(logId, "Simulated WhatsApp failure");
      commLogger.warn(`[MockProvider:WhatsApp] Simulated failure to ${LogService.maskRecipient(recipient)}`);
      return { success: false, error: "Simulated WhatsApp failure", mock: true, logId };
    }

    let finalMessage = message;
    if (template && !message) {
      const rendered = TemplateService.render("whatsapp", template, templateVars);
      if (rendered) finalMessage = rendered.message;
    }

    const logId = LogService.createLog({
      recipient, channel: "whatsapp", type: template || "custom", provider: this.name, template,
    });

    commLogger.info(`[MockProvider:WhatsApp] To: ${LogService.maskRecipient(recipient)}`, {
      message: finalMessage ? finalMessage.substring(0, 100) : "(empty)",
    });

    if (process.stdout.isTTY) {
      LogService.maskRecipient(recipient);
    }

    LogService.markSent(logId);
    setTimeout(() => LogService.markDelivered(logId), 500);

    return {
      success: true,
      mock: true,
      logId,
      messageId: logId,
      provider: this.name,
    };
  }

  async sendEmail({ recipient, subject, body, html, template, templateVars } = {}) {
    await MockProvider._simulateDelay();

    if (MockProvider._shouldFail()) {
      const logId = LogService.createLog({
        recipient, channel: "email", type: template || "custom", provider: this.name, template,
      });
      LogService.markFailed(logId, "Simulated email failure");
      commLogger.warn(`[MockProvider:Email] Simulated failure to ${LogService.maskRecipient(recipient)}`);
      return { success: false, error: "Simulated email failure", mock: true, logId };
    }

    let finalSubject = subject;
    let finalBody = body || html;
    if (template && !subject && !body && !html) {
      const rendered = TemplateService.render("email", template, templateVars);
      if (rendered) {
        finalSubject = rendered.subject;
        finalBody = rendered.body;
      }
    }

    const logId = LogService.createLog({
      recipient, channel: "email", type: template || "custom", provider: this.name, template,
    });

    commLogger.info(`[MockProvider:Email] To: ${LogService.maskRecipient(recipient)}`, {
      subject: finalSubject,
    });

    if (process.stdout.isTTY) {
      console.log(`\n[MOCK EMAIL] To: ${LogService.maskRecipient(recipient)}`);
      console.log(`   Subject: ${finalSubject}`);
      if (template) console.log(`   Template: ${template}`);
      console.log();
    }

    LogService.markSent(logId);
    setTimeout(() => LogService.markDelivered(logId), 500);

    return {
      success: true,
      mock: true,
      logId,
      messageId: logId,
      provider: this.name,
    };
  }

  async getDeliveryStatus({ messageId } = {}) {
    const log = LogService.getLog(messageId);
    if (!log) {
      return { status: "unknown", error: "Message not found" };
    }
    return {
      status: log.status,
      sentAt: log.sentAt,
      deliveredAt: log.deliveredAt,
      error: log.error,
      retryCount: log.retryCount,
    };
  }

  async healthCheck() {
    return {
      status: "healthy",
      provider: this.name,
      mode: "mock",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  static _shouldFail() {
    if (!config.mock.simulateFailures) return false;
    return Math.random() < config.mock.failureRate;
  }

  static async _simulateDelay() {
    if (config.mock.simulateDelay) {
      const jitter = Math.random() * config.mock.delayMs;
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }
}

module.exports = MockProvider;
