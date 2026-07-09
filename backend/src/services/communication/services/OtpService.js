const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const config = require("../config");
const commLogger = require("../logs");

const otpStore = new Map();

const BCRYPT_SALT_ROUNDS = 10;

class OtpService {
  static async generateOtp(identifier) {
    const otpLength = config.otp.length;
    const min = Math.pow(10, otpLength - 1);
    const max = Math.pow(10, otpLength) - 1;
    const otp = crypto.randomInt(min, max).toString();

    const hash = await bcrypt.hash(otp, BCRYPT_SALT_ROUNDS);
    const expiresAt = Date.now() + config.otp.expiryMinutes * 60 * 1000;

    const record = {
      identifier,
      hash,
      expiresAt,
      attempts: 0,
      used: false,
      createdAt: Date.now(),
    };
    otpStore.set(OtpService._storeKey(identifier), record);

    if (config.isDev) {
      commLogger.info(`[OtpService] OTP generated for ${OtpService.maskIdentifier(identifier)}`);
      if (process.stdout.isTTY) {
        console.log(`\n[MOCK OTP] ${otp[0]}***${otp[otp.length - 1]} (valid ${config.otp.expiryMinutes} min for ${OtpService.maskIdentifier(identifier)})\n`);
      }
    } else {
      commLogger.info(`[OtpService] OTP generated for ${OtpService.maskIdentifier(identifier)}`);
    }

    return otp;
  }

  static async verifyOtp(identifier, otp) {
    const key = OtpService._storeKey(identifier);
    const record = otpStore.get(key);
    if (!record) {
      return { valid: false, reason: "No OTP requested or OTP expired" };
    }

    if (record.used) {
      return { valid: false, reason: "OTP already used" };
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(key);
      return { valid: false, reason: "OTP has expired" };
    }

    record.attempts += 1;

    if (record.attempts > config.otp.maxAttempts) {
      otpStore.delete(key);
      return { valid: false, reason: "Maximum attempts exceeded" };
    }

    const match = await bcrypt.compare(otp, record.hash);
    if (!match) {
      return {
        valid: false,
        reason: "Invalid OTP",
        attemptsRemaining: config.otp.maxAttempts - record.attempts,
      };
    }

    record.used = true;
    otpStore.delete(key);

    commLogger.info(`[OtpService] OTP verified for ${OtpService.maskIdentifier(identifier)}`);
    return { valid: true, reason: "OTP verified successfully" };
  }

  static getOtpStatus(identifier) {
    const key = OtpService._storeKey(identifier);
    const record = otpStore.get(key);
    if (!record) {
      return { active: false, reason: "No active OTP" };
    }
    const expired = Date.now() > record.expiresAt;
    const remainingMs = record.expiresAt - Date.now();
    const attemptsLeft = config.otp.maxAttempts - record.attempts;
    return {
      active: !expired && !record.used,
      expired,
      used: record.used,
      attemptsRemaining: Math.max(0, attemptsLeft),
      remainingMs: Math.max(0, remainingMs),
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  }

  static invalidateOtp(identifier) {
    const key = OtpService._storeKey(identifier);
    otpStore.delete(key);
  }

  static async getDevOtp(identifier) {
    if (!config.isDev) return null;
    const key = OtpService._storeKey(identifier);
    const record = otpStore.get(key);
    if (!record) return null;
    return "[REDACTED]";
  }

  static _storeKey(identifier) {
    return `otp_${identifier}`;
  }

  static maskIdentifier(identifier) {
    if (!identifier) return "unknown";
    const s = String(identifier);
    if (s.includes("@")) {
      const [name, domain] = s.split("@");
      return `${name[0]}***@${domain}`;
    }
    if (s.length >= 10) {
      return s.slice(0, 2) + "****" + s.slice(-4);
    }
    return s.slice(0, 1) + "***" + s.slice(-1);
  }

  static cleanupExpired() {
    const now = Date.now();
    let count = 0;
    for (const [key, record] of otpStore.entries()) {
      if (now > record.expiresAt || record.used) {
        otpStore.delete(key);
        count++;
      }
    }
    if (count > 0) {
      commLogger.info(`[OtpService] Cleaned up ${count} expired OTPs`);
    }
    return count;
  }

  static _getStoreForTesting() {
    return otpStore;
  }
}

module.exports = OtpService;
