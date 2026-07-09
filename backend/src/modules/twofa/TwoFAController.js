const express = require("express");
const router = express.Router();
const twoFAService = require("./TwoFAService");
const authMiddleware = require("../../middleware/auth");
const { requireRole } = require("../../middleware/roles");
const logger = require("../../utils/logger");

router.use(authMiddleware);

router.get("/admin/2fa/status", requireRole("admin"), (req, res) => {
  try {
    const enabled = twoFAService.isTwoFAEnabled();
    const methods = twoFAService.getEnabledMethods();
    res.json({ success: true, data: { enabled, methods } });
  } catch (err) {
    logger.error("[2FA] status error:", err);
    res.status(500).json({ success: false, error: "Failed to get 2FA status" });
  }
});

router.post("/admin/2fa/setup", requireRole("admin"), async (req, res) => {
  try {
    const existing = twoFAService.getTwoFASettings();
    if (existing && existing.enabled) {
      return res.json({ success: true, data: { alreadyEnabled: true } });
    }
    const secret = await twoFAService.generateTOTPSecret();
    twoFAService.saveTwoFASettings({
      enabled: false,
      totp_enabled: false,
      phone_enabled: false,
      totp_secret: secret.secret,
      totp_otpauth_url: secret.otpauth_url,
    });
    res.json({
      success: true,
      data: {
        secret: secret.secret,
        otpauth_url: secret.otpauth_url,
        qr_code: secret.qr_code,
      },
    });
  } catch (err) {
    logger.error("[2FA] setup error:", err);
    res.status(500).json({ success: false, error: "Failed to setup 2FA" });
  }
});

router.post("/admin/2fa/verify-setup", requireRole("admin"), (req, res) => {
  try {
    const { token } = req.body;
    if (!token || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ success: false, error: "Valid 6-digit code required" });
    }
    const settings = twoFAService.getTwoFASettings();
    if (!settings || !settings.totp_secret) {
      return res.status(400).json({ success: false, error: "2FA not initialized. Run setup first." });
    }
    const valid = twoFAService.verifyTOTP(token, settings.totp_secret);
    if (!valid) {
      return res.status(400).json({ success: false, error: "Invalid code. Please try again." });
    }
    twoFAService.saveTwoFASettings({
      ...settings,
      enabled: true,
      totp_enabled: true,
    });
    res.json({ success: true, data: { enabled: true, method: "totp" } });
  } catch (err) {
    logger.error("[2FA] verify-setup error:", err);
    res.status(500).json({ success: false, error: "Failed to verify 2FA code" });
  }
});

router.post("/admin/2fa/disable", requireRole("admin"), (req, res) => {
  try {
    const { token } = req.body;
    if (!token || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ success: false, error: "Valid 6-digit code required to disable 2FA" });
    }
    const settings = twoFAService.getTwoFASettings();
    if (!settings) {
      return res.status(400).json({ success: false, error: "2FA is not configured" });
    }
    const valid = twoFAService.verifyTOTP(token, settings.totp_secret);
    if (!valid) {
      return res.status(400).json({ success: false, error: "Invalid code. Cannot disable 2FA." });
    }
    twoFAService.saveTwoFASettings(null);
    res.json({ success: true, data: { enabled: false } });
  } catch (err) {
    logger.error("[2FA] disable error:", err);
    res.status(500).json({ success: false, error: "Failed to disable 2FA" });
  }
});

router.post("/admin/verify-2fa", (req, res) => {
  try {
    const { token, method } = req.body;
    if (!token || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ success: false, error: "Valid 6-digit code required" });
    }
    const settings = twoFAService.getTwoFASettings();
    if (!settings || !settings.enabled) {
      return res.status(400).json({ success: false, error: "2FA is not enabled" });
    }
    if (method === "totp" || !method) {
      const valid = twoFAService.verifyTOTP(token, settings.totp_secret);
      if (!valid) {
        return res.status(400).json({ success: false, error: "Invalid 2FA code" });
      }
      return res.json({ success: true, data: { verified: true, method: "totp" } });
    }
    res.status(400).json({ success: false, error: "Unsupported 2FA method" });
  } catch (err) {
    logger.error("[2FA] verify-2fa error:", err);
    res.status(500).json({ success: false, error: "Failed to verify 2FA code" });
  }
});

module.exports = router;
