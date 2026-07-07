const express = require("express");
const router = express.Router();
const CommunicationController = require("../controllers/CommunicationController");
const { requireRole } = require("../../../middleware/roles");

const { validateBody } = require("../../../middleware/validate");
const {
  sendSmsSchema,
  sendOtpSchema,
  verifyOtpSchema,
  sendWhatsAppSchema,
  sendEmailSchema,
  retrySchema,
  logsQuerySchema,
} = require("../validators/communicationValidators");

router.post("/send-sms", validateBody(sendSmsSchema), (req, res) => CommunicationController.sendSms(req, res));
router.post("/send-otp", validateBody(sendOtpSchema), (req, res) => CommunicationController.sendOtp(req, res));
router.post("/verify-otp", validateBody(verifyOtpSchema), (req, res) => CommunicationController.verifyOtp(req, res));
router.post("/send-whatsapp", validateBody(sendWhatsAppSchema), (req, res) => CommunicationController.sendWhatsApp(req, res));
router.post("/send-email", validateBody(sendEmailSchema), (req, res) => CommunicationController.sendEmail(req, res));
router.post("/send-event", (req, res) => CommunicationController.sendEventNotification(req, res));
router.get("/templates", (req, res) => CommunicationController.getTemplates(req, res));
router.post("/render-template", (req, res) => CommunicationController.renderTemplate(req, res));

router.get("/logs", (req, res) => CommunicationController.getLogs(req, res));
router.get("/logs/:id", (req, res) => CommunicationController.getLog(req, res));
router.get("/stats", (req, res) => CommunicationController.getStats(req, res));
router.get("/queue", (req, res) => CommunicationController.getQueueStatus(req, res));
router.get("/otp-status/:identifier", (req, res) => CommunicationController.getOtpStatus(req, res));

router.get("/health", (req, res) => CommunicationController.healthCheck(req, res));

const superAdminOnly = requireRole("super_admin", "admin");

router.post("/retry-all", superAdminOnly, (req, res) => CommunicationController.retryFailed(req, res));
router.post("/retry/:jobId", superAdminOnly, (req, res) => CommunicationController.retryMessage(req, res));
router.delete("/otp/:identifier", superAdminOnly, (req, res) => CommunicationController.invalidateOtp(req, res));

router.get("/dev-otp/:identifier", superAdminOnly, (req, res) => CommunicationController.getDevOtp(req, res));

module.exports = router;
