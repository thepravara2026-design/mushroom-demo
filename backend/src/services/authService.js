const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const userRepo = require("../repositories/userRepository");
const { JWT_SECRET, JWT_EXPIRES_IN } = require("../config/jwt");
const logger = require("../utils/logger");
const { sendOtpEmail } = require('./emailService');
const { sendOtpSms } = require('./smsService');

// In-memory OTP store for simulation (email -> { otp, expiresAt, role, fullName })
const otpStore = new Map();
const OTP_TTL_MS = parseInt(process.env.OTP_TTL_MS, 10) || 10 * 60 * 1000;

// Admin OTP store (email -> { otp, expiresAt, phone })
const adminOtpStore = new Map();

// Periodic cleanup of expired OTPs every 5 minutes
function cleanupStore(store) {
  const now = Date.now();
  for (const [key, record] of store) {
    if (now > record.expiresAt) {
      store.delete(key);
    }
  }
}
setInterval(() => cleanupStore(otpStore), 5 * 60 * 1000).unref();
setInterval(() => cleanupStore(adminOtpStore), 5 * 60 * 1000).unref();

class AuthService {
  /**
   * Generates a 6-digit OTP and simulates sending it via Email/SMS.
   
  async generateAndSendOTP(email, role, fullName) {
    const emailLower = email.toLowerCase();

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

    otpStore.set(emailLower, {
      otp: generatedOtp,
      expiresAt,
      role: role || "buyer",
      fullName: fullName || "Mushroom Enthusiast",
    });

    await sendOtpEmail(emailLower, generatedOtp);

    return {
      success: true,
      message: `OTP sent successfully to ${emailLower}`,
    };
  } */


  async generateAndSendOTP(email, role, fullName, phone = null) {
    const emailLower = email.toLowerCase();

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + OTP_TTL_MS;

    otpStore.set(emailLower, {
      otp: generatedOtp,
      expiresAt,
      role: role || "buyer",
      fullName: fullName || "Mushroom Enthusiast",
    });

    // Send via SMS if phone provided, otherwise email
    if (phone) {
      await sendOtpSms(phone, generatedOtp);
    } else {
      await sendOtpEmail(emailLower, generatedOtp);
    }

    return {
      success: true,
      message: phone
        ? `OTP sent to registered mobile`
        : `OTP sent to ${emailLower}`,
    };
  }

  /**
   * Verifies the OTP. If user doesn't exist, creates a new account.
   */
  async verifyOTP(email, otpCode, opts = {}) {
    const emailLower = email.toLowerCase();
    const record = otpStore.get(emailLower);

    if (!record) {
      throw new Error(
        "No OTP request found for this email. Please request a new OTP.",
      );
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(emailLower);
      throw new Error("OTP has expired. Please request a new one.");
    }

    if (record.otp !== otpCode) {
      throw new Error("Invalid OTP code.");
    }

    // OTP verified successfully. Delete from store.
    otpStore.delete(emailLower);

    const loginMethod = opts.loginMethod || record.loginMethod || null;
    const whatsappNumber = opts.whatsappNumber || "";

    // Try live DB first, fall back to mock store for dev/test compatibility
    let user = null;
    if (!db.isMock) {
      try {
        const { data: liveUser } = await userRepo.findByEmail(emailLower);
        if (liveUser) {
          user = liveUser;
        } else {
          // Phone uniqueness check: ensure no existing user has this phone
          if (whatsappNumber) {
            const { data: phoneUser } = await userRepo.findByPhone(whatsappNumber);
            if (phoneUser) {
              const err = new Error("This phone number is already registered to another account.");
              err.status = 409;
              throw err;
            }
          }
          // Try creating in live DB
          const insertPayload = {
            email: emailLower,
            full_name: record.fullName,
            whatsapp_number: whatsappNumber || "",
            role: record.role,
          };
          if (loginMethod) insertPayload.login_method = loginMethod;
          const { data: newUser, error } = await userRepo.create(insertPayload);
          if (!error) user = newUser;
        }
      } catch {
        // Live DB failed — fall through to mock store
      }
    }

    // Fall back to mock store if live DB failed or in mock mode
    if (!user) {
      // Find or create user in mock store
      const dbConfig = require("../config/db");
const mockStore = dbConfig._getMockStore ? dbConfig._getMockStore() : { users: [] };
const mockUsers = mockStore.users;
      user = mockUsers.find(u => u.email === emailLower);
      if (!user) {
        // Phone uniqueness check: if whatsappNumber provided, ensure no other user has it
        if (whatsappNumber) {
          const cleanPhone = whatsappNumber.replace(/^\+91/, "").replace(/\s/g, "").trim();
          const phoneConflict = mockUsers.find(u =>
            u.whatsapp_number && u.whatsapp_number.replace(/^\+91/, "").replace(/\s/g, "").trim() === cleanPhone
          );
          if (phoneConflict) {
            throw new Error("This phone number is already registered to another account.");
          }
        }
        const newUser = {
          id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          email: emailLower,
          full_name: record.fullName,
          whatsapp_number: whatsappNumber || "",
          role: record.role,
          created_at: new Date().toISOString(),
        };
        if (loginMethod) newUser.login_method = loginMethod;
        mockUsers.push(newUser);
        user = newUser;
      } else if (whatsappNumber) {
        user.whatsapp_number = whatsappNumber;
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, fullName: user.full_name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        whatsappNumber: user.whatsapp_number || "",
        role: user.role,
        avatarUrl: user.avatar_url || "",
        defaultAddress: user.default_address || "",
        defaultPincode: user.default_pincode || "",
        addressLine1: user.address_line1 || "",
        addressLine2: user.address_line2 || "",
        landmark: user.landmark || "",
        city: user.city || "",
        state: user.state || "",
      },
    };
  }

  async adminRequestOTP(email) {
    const emailLower = String(email).toLowerCase();

    // Try live DB first, fall back to mock store
    let user = null;
    if (!db.isMock) {
      try {
        const { data: liveUser } = await userRepo.findByEmail(emailLower);
        if (liveUser) user = liveUser;
      } catch {
        // Live DB failed — fall through to mock store
      }
    }

    if (!user) {
      const dbConfig = require("../config/db");
      const mockStore = dbConfig._getMockStore ? dbConfig._getMockStore() : { users: [] };
      user = mockStore.users.find(u => u.email === emailLower);
    }

    if (!user || user.role !== "admin") {
      const err = new Error("Invalid admin credentials.");
      err.status = 403;
      throw err;
    }

    const adminPhone = user.whatsapp_number || "9876543210";

    // Generate 6-digit OTP
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    adminOtpStore.set(emailLower, {
      otp: generatedOtp,
      expiresAt,
      phone: adminPhone,
    });

    await sendOtpSms(adminPhone, generatedOtp);

    const maskedPhone = `XXXXXX${adminPhone.slice(-4)}`;

    return {
      success: true,
      message: `OTP sent to registered mobile ${maskedPhone}`,
    };
  }

  async adminVerifyOTP(email, otpCode) {
    const emailLower = String(email).toLowerCase();
    const record = adminOtpStore.get(emailLower);

    if (!record) {
      const err = new Error("No OTP request found. Please request a new OTP.");
      err.status = 400;
      throw err;
    }

    if (Date.now() > record.expiresAt) {
      adminOtpStore.delete(emailLower);
      const err = new Error("OTP has expired. Please request a new one.");
      err.status = 400;
      throw err;
    }

    if (record.otp !== otpCode) {
      const err = new Error("Invalid OTP code.");
      err.status = 400;
      throw err;
    }

    adminOtpStore.delete(emailLower);

    // Try live DB first, fall back to mock store
    let user = null;
    if (!db.isMock) {
      try {
        const { data: liveUser } = await userRepo.findByEmail(emailLower);
        if (liveUser) user = liveUser;
      } catch {
        // Live DB failed — fall through to mock store
      }
    }

    if (!user) {
      const dbConfig = require("../config/db");
      const mockStore = dbConfig._getMockStore ? dbConfig._getMockStore() : { users: [] };
      user = mockStore.users.find(u => u.email === emailLower);
    }

    if (!user || user.role !== "admin") {
      const err = new Error("Admin user not found.");
      err.status = 403;
      throw err;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, fullName: user.full_name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
      },
    };
  }

  async getUserById(userId) {
    const { data: user, error } = await db
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();
    if (error || !user) {
      const err = new Error("User not found.");
      err.status = 404;
      throw err;
    }
    return user;
  }

  async updateProfile(userId, updates = {}) {
    // Fetch current
    const { data: current, error: getErr } = await userRepo.findById(userId);
    if (getErr || !current) {
      const err = new Error("User not found.");
      err.status = 404;
      throw err;
    }

    const payload = {};
    if (typeof updates.fullName === "string")
      payload.full_name = updates.fullName.trim();
    if (typeof updates.email === "string")
      payload.email = updates.email.trim().toLowerCase();
    if (typeof updates.whatsappNumber === "string")
      payload.whatsapp_number = updates.whatsappNumber.trim();
    if (typeof updates.defaultAddress === "string")
      payload.default_address = updates.defaultAddress.trim();
    if (typeof updates.defaultPincode === "string")
      payload.default_pincode = updates.defaultPincode.trim();
    if (typeof updates.avatarUrl === "string")
      payload.avatar_url = updates.avatarUrl;
    if (typeof updates.addressLine1 === "string")
      payload.address_line1 = updates.addressLine1.trim();
    if (typeof updates.addressLine2 === "string")
      payload.address_line2 = updates.addressLine2.trim();
    if (typeof updates.landmark === "string")
      payload.landmark = updates.landmark.trim();
    if (typeof updates.city === "string") payload.city = updates.city.trim();
    if (typeof updates.state === "string") payload.state = updates.state.trim();

    if (
      current.login_method === "phone" &&
      payload.whatsapp_number &&
      payload.whatsapp_number !== current.whatsapp_number
    ) {
      const err = new Error(
        "Phone number cannot be changed for phone-verified accounts.",
      );
      err.status = 400;
      throw err;
    }
    if (
      current.login_method === "email" &&
      payload.email &&
      payload.email !== current.email
    ) {
      const err = new Error("Email cannot be changed for email-verified accounts.");
      err.status = 400;
      throw err;
    }

    // Uniqueness guard: ensure new email is not already taken by another user
    if (payload.email && payload.email !== current.email) {
      const { data: emailOwner } = await userRepo.findByEmail(payload.email);
      if (emailOwner && emailOwner.id !== userId) {
        const err = new Error("This email address is already registered to another account.");
        err.status = 409;
        throw err;
      }
    }

    // Uniqueness guard: ensure new phone is not already taken by another user
    if (payload.whatsapp_number && payload.whatsapp_number !== current.whatsapp_number) {
      const { data: phoneOwner } = await userRepo.findByPhone(payload.whatsapp_number);
      if (phoneOwner && phoneOwner.id !== userId) {
        const err = new Error("This phone number is already registered to another account.");
        err.status = 409;
        throw err;
      }
    }

    if (!Object.keys(payload).length) {
      const err = new Error("No valid fields to update.");
      err.status = 400;
      throw err;
    }

    const { data: updated, error: upErr } = await userRepo.update(
      userId,
      payload,
    );
    if (upErr) {
      const err = new Error(upErr.message);
      err.status = 500;
      throw err;
    }
    return updated;
  }

  async deleteAccount(userId, reason = null) {
    await userRepo.remove(userId);
    if (reason)
      logger.info(`Account deletion requested for ${userId}: ${reason}`);
    return { success: true };
  }
}

const authService = new AuthService();
// Test helpers — exposed only when FORCE_MOCK is true
if (process.env.FORCE_MOCK === "true") {
  authService.__adminOtpStore = adminOtpStore;
  authService.__otpStore = otpStore;
}
module.exports = authService;
