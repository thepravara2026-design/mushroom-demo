const commLogger = require("../logs");

const TEMPLATES = {
  sms: {
    otp_login: "Your verification code is {{otp}}. Valid for {{expiryMinutes}} minutes.",
    otp_registration: "Welcome! Your OTP for registration is {{otp}}. Valid for {{expiryMinutes}} minutes.",
    otp_password_reset: "Your password reset OTP is {{otp}}. Valid for {{expiryMinutes}} minutes.",
    order_confirmation: "Order #{{orderId}} confirmed! Total: ₹{{amount}}. Thank you for your purchase.",
    payment_success: "Payment successful for Order #{{orderId}}. Amount: ₹{{amount}}. Thank you!",
    order_cancelled: "Order #{{orderId}} has been cancelled. Refund of ₹{{amount}} will be processed.",
    order_shipped: "Order #{{orderId}} has been shipped. Track: {{trackingUrl}}",
    out_for_delivery: "Order #{{orderId}} is out for delivery! Expected today.",
    delivered: "Order #{{orderId}} has been delivered. Enjoy your mushrooms!",
    refund_initiated: "Refund of ₹{{amount}} for Order #{{orderId}} has been initiated.",
    low_inventory: "ALERT: Low inventory for {{productName}}. Current stock: {{stock}}",
    admin_alert: "Admin Alert: {{message}}",
  },
  whatsapp: {
    otp_login: "Your verification code is {{otp}}. Valid for {{expiryMinutes}} minutes. Do not share this code.",
    otp_registration: "Welcome! Your OTP for registration is {{otp}}. Valid for {{expiryMinutes}} minutes.",
    otp_password_reset: "Your password reset OTP is {{otp}}. Valid for {{expiryMinutes}} minutes.",
    order_confirmation: "Order Confirmed!\nOrder: #{{orderId}}\nTotal: ₹{{amount}}\nThank you for shopping with us!",
    payment_success: "Payment Successful!\nOrder: #{{orderId}}\nAmount: ₹{{amount}}",
    order_cancelled: "Order #{{orderId}} Cancelled.\nRefund of ₹{{amount}} will be processed within 5-7 business days.",
    order_shipped: "Order #{{orderId}} Shipped!\nTrack: {{trackingUrl}}",
    out_for_delivery: "Out for Delivery!\nOrder #{{orderId}} is on its way!",
    delivered: "Delivered!\nOrder #{{orderId}} has been delivered. Enjoy!",
    refund_initiated: "Refund Initiated: ₹{{amount}} for Order #{{orderId}}.",
    low_inventory: "Low Stock Alert: {{productName}} has only {{stock}} units left.",
    admin_alert: "Admin Alert: {{message}}",
  },
  email: {
    otp_login: { subject: "Your Login OTP", body: "Your verification code is {{otp}}. Valid for {{expiryMinutes}} minutes." },
    otp_registration: { subject: "Welcome! Verify Your Email", body: "Your OTP for registration is {{otp}}. Valid for {{expiryMinutes}} minutes." },
    otp_password_reset: { subject: "Password Reset OTP", body: "Your password reset OTP is {{otp}}. Valid for {{expiryMinutes}} minutes." },
    order_confirmation: { subject: "Order #{{orderId}} Confirmed", body: "Order #{{orderId}} has been confirmed.\nTotal: ₹{{amount}}\nThank you for your purchase!" },
    payment_success: { subject: "Payment Successful - Order #{{orderId}}", body: "Payment of ₹{{amount}} for Order #{{orderId}} was successful." },
    order_cancelled: { subject: "Order #{{orderId}} Cancelled", body: "Order #{{orderId}} has been cancelled.\nRefund of ₹{{amount}} will be processed." },
    order_shipped: { subject: "Order #{{orderId}} Shipped!", body: "Your order #{{orderId}} has been shipped.\nTrack: {{trackingUrl}}" },
    out_for_delivery: { subject: "Order #{{orderId}} Out for Delivery", body: "Order #{{orderId}} is out for delivery! Expected today." },
    delivered: { subject: "Order #{{orderId}} Delivered", body: "Order #{{orderId}} has been delivered. Enjoy your mushrooms!" },
    refund_initiated: { subject: "Refund Initiated - Order #{{orderId}}", body: "A refund of ₹{{amount}} for Order #{{orderId}} has been initiated." },
    low_inventory: { subject: "Low Inventory Alert: {{productName}}", body: "Low inventory for {{productName}}. Current stock: {{stock}}." },
    admin_alert: { subject: "Admin Alert", body: "{{message}}" },
  },
};

class TemplateService {
  static render(channel, templateName, vars = {}) {
    const channelTemplates = TEMPLATES[channel];
    if (!channelTemplates) {
      commLogger.warn(`[TemplateService] Unknown channel: ${channel}`);
      return null;
    }

    const template = channelTemplates[templateName];
    if (!template) {
      commLogger.warn(`[TemplateService] Unknown template: ${channel}.${templateName}`);
      return null;
    }

    if (channel === "email") {
      return TemplateService._renderEmail(template, vars);
    }

    return {
      message: TemplateService._substitute(template, vars),
      templateName,
    };
  }

  static getTemplate(channel, templateName) {
    const channelTemplates = TEMPLATES[channel];
    if (!channelTemplates) return null;
    return channelTemplates[templateName] || null;
  }

  static getAllTemplates() {
    return TEMPLATES;
  }

  static _renderEmail(template, vars) {
    return {
      subject: TemplateService._substitute(template.subject, vars),
      body: TemplateService._substitute(template.body, vars),
      templateName: template.subject,
    };
  }

  static _substitute(text, vars) {
    if (!text) return "";
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (vars[key] !== undefined && vars[key] !== null) {
        return String(vars[key]);
      }
      return match;
    });
  }
}

module.exports = TemplateService;
