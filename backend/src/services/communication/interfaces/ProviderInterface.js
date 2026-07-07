class ProviderInterface {
  async sendSms({ recipient, message, template, templateVars }) {
    throw new Error("ProviderInterface: sendSms() not implemented");
  }

  async sendOtp({ recipient, channel }) {
    throw new Error("ProviderInterface: sendOtp() not implemented");
  }

  async verifyOtp({ recipient, otp }) {
    throw new Error("ProviderInterface: verifyOtp() not implemented");
  }

  async sendWhatsApp({ recipient, message, template, templateVars }) {
    throw new Error("ProviderInterface: sendWhatsApp() not implemented");
  }

  async sendEmail({ recipient, subject, body, html, template, templateVars }) {
    throw new Error("ProviderInterface: sendEmail() not implemented");
  }

  async getDeliveryStatus({ messageId }) {
    throw new Error("ProviderInterface: getDeliveryStatus() not implemented");
  }

  async healthCheck() {
    throw new Error("ProviderInterface: healthCheck() not implemented");
  }
}

module.exports = ProviderInterface;
