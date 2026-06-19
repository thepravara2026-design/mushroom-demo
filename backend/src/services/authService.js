const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const userRepo = require("../repositories/userRepository");
const { supabaseAnon } = require("../config/supabase");
const { JWT_SECRET, JWT_EXPIRES_IN } = require("../config/jwt");
const logger = require("../utils/logger");

// In-memory OTP store for simulation (email -> { otp, expiresAt, role, fullName })
const otpStore = new Map();
const OTP_TTL_MS = parseInt(process.env.OTP_TTL_MS, 10) || 10 * 60 * 1000;

// Periodic cleanup of expired OTPs every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, record] of otpStore) {
      if (now > record.expiresAt) {
        otpStore.delete(key);
      }
    }
  },
  5 * 60 * 1000,
).unref();

class AuthService {
  /**
   * Generates a 6-digit OTP and simulates sending it via Email/SMS.
   */
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

    return {
      success: true,
      message: `OTP sent successfully to ${emailLower}`,
      ...(process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
        ? { otp: generatedOtp }
        : {}),
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
      const mockUsers = require("../config/db").mockStore?.users || [];
      user = mockUsers.find(u => u.email === emailLower);
      if (!user) {
        const { v4: uuidv4 } = require("uuid") || { v4: () => `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
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

  async adminLogin(email, password) {
    const emailLower = String(email).toLowerCase();

    // ── LIVE SUPABASE MODE ─────────────────────────────────────────────
    if (!db.isMock && supabaseAnon) {
      try {
        const { data, error } = await supabaseAnon.auth.signInWithPassword({
          email: emailLower,
          password,
        });
        if (!error) {
          // Fetch profile from custom users table
          const { data: dbUser } = await userRepo.findByEmail(emailLower);

          // Check role: app_metadata or DB fallback
          const role = data.user.app_metadata?.role || (dbUser ? dbUser.role : "");
          if (role === "admin") {
            return {
              token: data.session.access_token,
              user: {
                id: data.user.id,
                email: data.user.email,
                fullName: dbUser
                  ? dbUser.full_name
                  : data.user.user_metadata?.name || "",
                role: "admin",
              },
            };
          }

          // Supabase user exists but role isn't admin — still allow if DB user has admin role
          if (dbUser && dbUser.role === "admin") {
            const token = jwt.sign(
              { userId: dbUser.id, email: dbUser.email, role: dbUser.role },
              JWT_SECRET,
              { expiresIn: JWT_EXPIRES_IN },
            );
            return {
              token,
              user: {
                id: dbUser.id,
                email: dbUser.email,
                fullName: dbUser.full_name,
                role: "admin",
              },
            };
          }
        }
        // If Supabase auth fails or user is not admin, fall through to mock mode
      } catch {
        // Fall through to mock mode
      }
    }

    // ── MOCK MODE (also used as fallback when Supabase admin login fails) ──
    const { data: user } = await userRepo.findByEmail(emailLower);
    if (!user || user.role !== "admin") {
      const err = new Error("Invalid admin credentials.");
      err.status = 403;
      throw err;
    }

    const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
    if (
      !adminSeedPassword ||
      (adminSeedPassword === "admin123" && process.env.NODE_ENV === "production")
    ) {
      throw new Error(
        "ADMIN_SEED_PASSWORD must be set to a secure value in production.",
      );
    }
    const adminPassword = adminSeedPassword || "admin123";
    let isMatch = false;
    if (user.password_hash) {
      isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        isMatch = password === adminPassword;
      }
    } else {
      isMatch = password === adminPassword;
    }
    if (!isMatch) {
      const err = new Error("Invalid admin credentials.");
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
      current.login_method === "google" &&
      payload.email &&
      payload.email !== current.email
    ) {
      const err = new Error(
        "Email cannot be changed for accounts created via Google sign-in.",
      );
      err.status = 400;
      throw err;
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

module.exports = new AuthService();
