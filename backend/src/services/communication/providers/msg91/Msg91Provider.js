const ProviderInterface = require("../../interfaces/ProviderInterface");
const config = require("../../config");
const commLogger = require("../../logs");

class Msg91Provider extends ProviderInterface {
  constructor() {
    super();
    this.name = "msg91";
    this._initialized = false;
  }

  async _ensureInitialized() {
    if (this._initialized) return true;
    if (!config.msg91.authKey) {
      throw new Error("MSG91_AUTH_KEY is not configured");
    }
    if (!config.msg91.senderId) {
      throw new Error("MSG91_SENDER_ID is not configured");
    }
    this._initialized = true;
    commLogger.info("[Msg91Provider] Initialized");
    return true;
  }

  async sendSms({ recipient, message, template, templateVars } = {}) {
    await this._ensureInitialized();
    commLogger.info(`[Msg91Provider:SMS] Would send to ${recipient}`);
    throw new Error("MSG91 SMS not yet implemented. Set COMMUNICATION_PROVIDER=mock to use mock mode.");
  }

  async sendOtp({ recipient, channel } = {}) {
    await this._ensureInitialized();
    commLogger.info(`[Msg91Provider:OTP] Would send OTP to ${recipient} via ${channel}`);
    throw new Error("MSG91 OTP not yet implemented. Set COMMUNICATION_PROVIDER=mock to use mock mode.");
  }

  async verifyOtp({ recipient, otp } = {}) {
    await this._ensureInitialized();
    throw new Error("MSG91 OTP verification not yet implemented. Set COMMUNICATION_PROVIDER=mock to use mock mode.");
  }

  async sendWhatsApp({ recipient, message, template, templateVars } = {}) {
    await this._ensureInitialized();
    commLogger.info(`[Msg91Provider:WhatsApp] Would send to ${recipient}`);
    throw new Error("MSG91 WhatsApp not yet implemented. Set COMMUNICATION_PROVIDER=mock to use mock mode.");
  }

  async sendEmail({ recipient, subject, body, html, template, templateVars } = {}) {
    await this._ensureInitialized();
    commLogger.info(`[Msg91Provider:Email] Would send to ${recipient}`);
    throw new Error("MSG91 Email not yet implemented. Set COMMUNICATION_PROVIDER=mock to use mock mode.");
  }

  async getDeliveryStatus({ messageId } = {}) {
    await this._ensureInitialized();
    throw new Error("MSG91 delivery status not yet implemented. Set COMMUNICATION_PROVIDER=mock to use mock mode.");
  }

  async healthCheck() {
    try {
      await this._ensureInitialized();
      return {
        status: "inactive",
        provider: this.name,
        mode: "not_implemented",
        message: "MSG91 provider is configured but not yet implemented. Communication will fall back to mock mode.",
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        status: "unconfigured",
        provider: this.name,
        mode: "not_configured",
        message: err.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = Msg91Provider;
