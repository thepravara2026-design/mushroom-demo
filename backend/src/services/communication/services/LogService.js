const crypto = require("crypto");
const commLogger = require("../logs");

const messageLogs = new Map();

class LogService {
  static createLog({ recipient, channel, type, provider, template, metadata }) {
    const id = `msg_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const entry = {
      id,
      recipient: LogService.maskRecipient(recipient),
      channel,
      type,
      provider,
      status: "queued",
      template: template || null,
      metadata: metadata || {},
      createdAt: new Date().toISOString(),
      sentAt: null,
      deliveredAt: null,
      error: null,
      retryCount: 0,
    };
    messageLogs.set(id, entry);
    commLogger.info(`[LogService] Log created: ${id}`, { channel, type, status: "queued" });
    return id;
  }

  static updateStatus(id, updates) {
    const entry = messageLogs.get(id);
    if (!entry) {
      commLogger.warn(`[LogService] Attempted to update unknown log: ${id}`);
      return false;
    }
    Object.assign(entry, updates);
    return true;
  }

  static markSent(id) {
    return LogService.updateStatus(id, { status: "sent", sentAt: new Date().toISOString() });
  }

  static markDelivered(id) {
    return LogService.updateStatus(id, { status: "delivered", deliveredAt: new Date().toISOString() });
  }

  static markFailed(id, error) {
    return LogService.updateStatus(id, { status: "failed", error: error ? String(error) : "Unknown error" });
  }

  static incrementRetry(id) {
    const entry = messageLogs.get(id);
    if (!entry) return false;
    entry.retryCount = (entry.retryCount || 0) + 1;
    return true;
  }

  static getLog(id) {
    const entry = messageLogs.get(id);
    if (!entry) return null;
    return { ...entry };
  }

  static getAllLogs(filters = {}) {
    let logs = Array.from(messageLogs.values());
    if (filters.channel) {
      logs = logs.filter((l) => l.channel === filters.channel);
    }
    if (filters.status) {
      logs = logs.filter((l) => l.status === filters.status);
    }
    if (filters.type) {
      logs = logs.filter((l) => l.type === filters.type);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      logs = logs.filter((l) => l.recipient.includes(q) || l.id.includes(q));
    }
    logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return logs;
  }

  static getStats() {
    const logs = Array.from(messageLogs.values());
    return {
      total: logs.length,
      queued: logs.filter((l) => l.status === "queued").length,
      sent: logs.filter((l) => l.status === "sent").length,
      delivered: logs.filter((l) => l.status === "delivered").length,
      failed: logs.filter((l) => l.status === "failed").length,
      byChannel: {
        sms: logs.filter((l) => l.channel === "sms").length,
        whatsapp: logs.filter((l) => l.channel === "whatsapp").length,
        email: logs.filter((l) => l.channel === "email").length,
        otp: logs.filter((l) => l.channel === "otp").length,
      },
    };
  }

  static getFailedLogs() {
    return LogService.getAllLogs({ status: "failed" });
  }

  static maskRecipient(recipient) {
    if (!recipient) return "unknown";
    const s = String(recipient);
    if (s.includes("@")) {
      const [name, domain] = s.split("@");
      return `${name[0]}***@${domain}`;
    }
    if (s.length >= 10) {
      return s.slice(0, 2) + "****" + s.slice(-4);
    }
    return s.slice(0, 1) + "***" + s.slice(-1);
  }

  static clearLogs() {
    messageLogs.clear();
    commLogger.info("[LogService] All logs cleared");
  }
}

module.exports = LogService;
