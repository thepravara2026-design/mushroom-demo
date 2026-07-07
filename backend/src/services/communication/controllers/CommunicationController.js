const CommunicationService = require("../CommunicationService");
const commLogger = require("../logs");

class CommunicationController {
  static async initialize() {
    const service = CommunicationService.getInstance();
    await service.initialize();
    return service;
  }

  static async sendSms(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const result = await service.sendSms(req.body, { async: req.query.async === "true" });
      res.json({ success: true, data: result });
    } catch (err) {
      commLogger.error(`[Controller] sendSms failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async sendOtp(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const result = await service.sendOtp(req.body, { async: req.query.async === "true" });
      res.json({ success: true, data: result });
    } catch (err) {
      commLogger.error(`[Controller] sendOtp failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async verifyOtp(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const result = await service.verifyOtp(req.body);
      if (result.valid) {
        return res.json({ success: true, data: result });
      }
      res.status(400).json({ success: false, error: result.reason, data: result });
    } catch (err) {
      commLogger.error(`[Controller] verifyOtp failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async sendWhatsApp(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const result = await service.sendWhatsApp(req.body, { async: req.query.async === "true" });
      res.json({ success: true, data: result });
    } catch (err) {
      commLogger.error(`[Controller] sendWhatsApp failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async sendEmail(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const result = await service.sendEmail(req.body, { async: req.query.async === "true" });
      res.json({ success: true, data: result });
    } catch (err) {
      commLogger.error(`[Controller] sendEmail failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getLogs(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const filters = {
        channel: req.query.channel,
        status: req.query.status,
        type: req.query.type,
        search: req.query.search,
      };
      const allLogs = service.getLogs(filters);
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const start = (page - 1) * limit;
      const paginatedLogs = allLogs.slice(start, start + limit);
      res.json({
        success: true,
        data: {
          logs: paginatedLogs,
          total: allLogs.length,
          page,
          limit,
          totalPages: Math.ceil(allLogs.length / limit),
        },
      });
    } catch (err) {
      commLogger.error(`[Controller] getLogs failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getLog(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const log = service.getLog(req.params.id);
      if (!log) {
        return res.status(404).json({ success: false, error: "Log not found" });
      }
      res.json({ success: true, data: log });
    } catch (err) {
      commLogger.error(`[Controller] getLog failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getStats(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const stats = service.getLogStats();
      const queueStats = service.getQueueStats();
      res.json({ success: true, data: { logs: stats, queue: queueStats } });
    } catch (err) {
      commLogger.error(`[Controller] getStats failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getQueueStatus(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const queueStatus = service.getQueueStatus();
      res.json({ success: true, data: queueStatus });
    } catch (err) {
      commLogger.error(`[Controller] getQueueStatus failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async retryFailed(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const count = service.retryFailedMessages();
      res.json({ success: true, data: { retried: count } });
    } catch (err) {
      commLogger.error(`[Controller] retryFailed failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async retryMessage(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const result = service.retryMessage(req.params.jobId);
      if (!result) {
        return res.status(404).json({ success: false, error: "Job not found or not in failed state" });
      }
      res.json({ success: true, data: { retried: true } });
    } catch (err) {
      commLogger.error(`[Controller] retryMessage failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async healthCheck(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const health = await service.healthCheck();
      res.json({ success: true, data: health });
    } catch (err) {
      commLogger.error(`[Controller] healthCheck failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getTemplates(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const templates = service.getTemplates();
      res.json({ success: true, data: templates });
    } catch (err) {
      commLogger.error(`[Controller] getTemplates failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async renderTemplate(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const { channel, template, vars } = req.body;
      if (!channel || !template) {
        return res.status(400).json({ success: false, error: "channel and template are required" });
      }
      const rendered = service.renderTemplate(channel, template, vars || {});
      if (!rendered) {
        return res.status(404).json({ success: false, error: "Template not found" });
      }
      res.json({ success: true, data: rendered });
    } catch (err) {
      commLogger.error(`[Controller] renderTemplate failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getOtpStatus(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const status = service.getOtpStatus(req.params.identifier);
      res.json({ success: true, data: status });
    } catch (err) {
      commLogger.error(`[Controller] getOtpStatus failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async invalidateOtp(req, res) {
    try {
      const service = await CommunicationController.initialize();
      service.invalidateOtp(req.params.identifier);
      res.json({ success: true, data: { message: "OTP invalidated" } });
    } catch (err) {
      commLogger.error(`[Controller] invalidateOtp failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getDevOtp(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const otp = await service.getDevOtp(req.params.identifier);
      res.json({ success: true, data: { otp: otp || "No active OTP or not in dev mode" } });
    } catch (err) {
      commLogger.error(`[Controller] getDevOtp failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async sendEventNotification(req, res) {
    try {
      const service = await CommunicationController.initialize();
      const { event, recipient, channel, vars } = req.body;
      if (!event || !recipient || !channel) {
        return res.status(400).json({ success: false, error: "event, recipient, and channel are required" });
      }

      const templateMap = {
        order_confirmation: { sms: "order_confirmation", email: "order_confirmation", whatsapp: "order_confirmation" },
        payment_success: { sms: "payment_success", email: "payment_success", whatsapp: "payment_success" },
        order_cancelled: { sms: "order_cancelled", email: "order_cancelled", whatsapp: "order_cancelled" },
        order_shipped: { sms: "order_shipped", email: "order_shipped", whatsapp: "order_shipped" },
        out_for_delivery: { sms: "out_for_delivery", email: "out_for_delivery", whatsapp: "out_for_delivery" },
        delivered: { sms: "delivered", email: "delivered", whatsapp: "delivered" },
        refund_initiated: { sms: "refund_initiated", email: "refund_initiated", whatsapp: "refund_initiated" },
        low_inventory: { sms: "low_inventory", email: "low_inventory", whatsapp: "low_inventory" },
        admin_alert: { sms: "admin_alert", email: "admin_alert", whatsapp: "admin_alert" },
      };

      const channelMap = templateMap[event];
      if (!channelMap) {
        return res.status(400).json({ success: false, error: `Unknown event: ${event}` });
      }

      const templateName = channelMap[channel];
      if (!templateName) {
        return res.status(400).json({ success: false, error: `Channel ${channel} not supported for event ${event}` });
      }

      const payload = { recipient, template: templateName, templateVars: vars || {} };

      let result;
      switch (channel) {
        case "sms":
          result = await service.sendSms(payload, { async: req.query.async === "true" });
          break;
        case "whatsapp":
          result = await service.sendWhatsApp(payload, { async: req.query.async === "true" });
          break;
        case "email":
          result = await service.sendEmail(payload, { async: req.query.async === "true" });
          break;
        default:
          return res.status(400).json({ success: false, error: `Invalid channel: ${channel}` });
      }

      res.json({ success: true, data: result });
    } catch (err) {
      commLogger.error(`[Controller] sendEventNotification failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = CommunicationController;
