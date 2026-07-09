const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { _getMockStore } = require("../../config/db");

const APP_NAME = "Sporekart Admin";

function getAdminUser() {
  const store = _getMockStore();
  if (!store || !store.users) return null;
  return store.users.find((u) => u.role === "admin") || null;
}

function getTwoFASettings() {
  const admin = getAdminUser();
  if (!admin) return null;
  return admin.twofa || null;
}

function saveTwoFASettings(settings) {
  const store = _getMockStore();
  if (!store || !store.users) return false;
  const idx = store.users.findIndex((u) => u.role === "admin");
  if (idx === -1) return false;
  store.users[idx] = { ...store.users[idx], twofa: settings };
  return true;
}

async function generateTOTPSecret() {
  const secret = speakeasy.generateSecret({
    name: APP_NAME,
    issuer: APP_NAME,
    length: 20,
  });
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  } catch (_) {
  }
  return {
    secret: secret.base32,
    otpauth_url: secret.otpauth_url,
    qr_code: qrDataUrl,
  };
}

function verifyTOTP(token, secret) {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });
}

function isTwoFAEnabled() {
  const settings = getTwoFASettings();
  return settings && settings.enabled === true;
}

function getEnabledMethods() {
  const settings = getTwoFASettings();
  if (!settings || !settings.enabled) return [];
  const methods = [];
  if (settings.totp_enabled) methods.push("totp");
  if (settings.phone_enabled) methods.push("phone");
  return methods;
}

module.exports = {
  getAdminUser,
  getTwoFASettings,
  saveTwoFASettings,
  generateTOTPSecret,
  verifyTOTP,
  isTwoFAEnabled,
  getEnabledMethods,
};
