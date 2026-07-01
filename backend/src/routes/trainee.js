const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const { success, error: respondError } = require("../lib/response");
const { validateBody, Joi } = require("../middleware/validate");
const db = require("../config/db");
const jwt = require("jsonwebtoken");
const userRepo = require("../repositories/userRepository");
const { JWT_SECRET, JWT_EXPIRES_IN } = require("../config/jwt");
const { setAuthCookie } = require("../lib/authCookie");
const logger = require("../utils/logger");

const PHONE_REGEX = /^(\+91)?[6-9]\d{9}$/;

const traineeSignupSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(100).required().messages({
    "string.min": "Full name must be at least 2 characters.",
    "string.max": "Full name must not exceed 100 characters.",
    "any.required": "Full name is required.",
  }),
  phone: Joi.string()
    .pattern(/^(\+)?[\d\s-]{10,15}$/)
    .required()
    .messages({
      "any.required": "Phone number is required.",
    }),
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email address.",
    "any.required": "Email is required.",
  }),
  roleType: Joi.string().trim().min(2).max(50).required().messages({
    "string.min": "Role type must be at least 2 characters.",
    "any.required": "Role type is required.",
  }),
  city: Joi.string().trim().min(2).max(100).required().messages({
    "string.min": "City must be at least 2 characters.",
    "any.required": "City is required.",
  }),
  state: Joi.string().trim().min(2).max(100).required().messages({
    "string.min": "State must be at least 2 characters.",
    "any.required": "State is required.",
  }),
});

const traineePhoneRequestSchema = Joi.object({
  phone: Joi.string()
    .pattern(/^(\+)?[\d\s-]{10,15}$/)
    .required()
    .messages({
      "any.required": "Phone number is required.",
    }),
});

const traineeGoogleLoginSchema = Joi.object({
  credential: Joi.string().required().messages({
    "any.required": "Google credential is required.",
  }),
});

const traineeVerifyPhoneOtpSchema = Joi.object({
  phone: Joi.string().required().messages({
    "any.required": "Phone number is required.",
  }),
  otpCode: Joi.string().pattern(/^\d{6}$/).required().messages({
    "string.pattern.base": "OTP must be a 6-digit code.",
    "any.required": "OTP is required.",
  }),
});

/**
 * POST /api/trainee/request-phone-otp
 * Phone-only login: checks if phone is registered as trainee.
 * If registered → sends OTP via SMS.
 * If not registered → returns { needsSignup: true, phone }.
 */
router.post("/request-phone-otp", validateBody(traineePhoneRequestSchema), async (req, res) => {
  try {
    const { phone } = req.body;
    const cleanPhone = phone.replace(/\s/g, "").trim().replace(/^\+91/, "");
    const { data: user } = await userRepo.findByPhone(cleanPhone);

    if (!user || user.role !== "trainee") {
      return success(res, {
        needsSignup: true,
        phone: phone.trim(),
        message: "Phone number not registered. Please sign up first.",
      });
    }

    const authService = require("../services/authService");
    const normalizedPhone = user.whatsapp_number.startsWith("+")
      ? user.whatsapp_number
      : `+91${user.whatsapp_number}`;
    const result = await authService.generateAndSendOTP(
      user.email,
      "trainee",
      user.full_name,
      normalizedPhone,
    );

    return success(res, {
      ...result,
      email: user.email,
    });
  } catch (err) {
    return respondError(
      res,
      err.message || "Failed to send OTP",
      err.status || 500,
    );
  }
});

/**
 * POST /api/trainee/google-login
 * Handles Google OAuth login for trainees.
 * In production: verifies the Google credential JWT.
 * In mock/dev: decodes the base64 credential to extract email/name.
 * Returns JWT if registered, or { needsSignup: true } if not.
 */
router.post("/google-login", validateBody(traineeGoogleLoginSchema), async (req, res) => {
  try {
    const { credential } = req.body;

    let email = null;
    let fullName = null;

    if (db.isMock) {
      try {
        const decoded = JSON.parse(Buffer.from(credential, "base64").toString("utf-8"));
        email = (decoded.email || "").toLowerCase().trim();
        fullName = (decoded.name || decoded.fullName || "").trim();
      } catch {
        try {
          const raw = Buffer.from(credential, "base64").toString("utf-8").toLowerCase().trim();
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
            email = raw;
          }
        } catch {}
      }
    } else {
      try {
        const { OAuth2Client } = require("google-auth-library");
        const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
        if (!GOOGLE_CLIENT_ID) {
          return respondError(res, "Google authentication is not configured.", 500);
        }
        const client = new OAuth2Client(GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
          idToken: credential,
          audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        email = (payload.email || "").toLowerCase().trim();
        fullName = (payload.name || "").trim();
      } catch (verifyErr) {
        logger.error("Google token verification failed:", verifyErr);
        return respondError(res, "Invalid Google credential.", 401);
      }
    }

    if (!email) {
      return respondError(res, "Could not extract email from Google credential.", 400);
    }

    const { data: user } = await userRepo.findByEmail(email);

    if (!user) {
      return success(res, {
        needsSignup: true,
        email,
        fullName: fullName || "",
        message: "No account found. Please register as a trainee first.",
      });
    }

    if (user.role !== "trainee") {
      return success(res, {
        needsSignup: true,
        email,
        fullName: fullName || user.full_name || "",
        message: "No account found. Please register as a trainee first.",
      });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    setAuthCookie(res, token);
    return success(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        whatsappNumber: user.whatsapp_number || "",
        role: user.role,
        loginMethod: "google",
      },
    });
  } catch (err) {
    return respondError(
      res,
      err.message || "Google login failed",
      err.status || 500,
    );
  }
});

/**
 * POST /api/trainee/signup
 * Creates a new trainee account and auto-sends OTP via SMS.
 */
router.post("/signup", validateBody(traineeSignupSchema), async (req, res) => {
  try {
    const { fullName, phone, email, roleType, city, state } = req.body;

    const emailLower = email.toLowerCase().trim();

    const { data: existingUser } = await userRepo.findByEmail(emailLower);
    if (existingUser) {
      return respondError(
        res,
        "This email is already registered. Please login.",
        409,
      );
    }

    const cleanPhone = phone.replace(/\s/g, "").trim().replace(/^\+91/, "");
    const { data: existingPhone } = await userRepo.findByPhone(cleanPhone);
    if (existingPhone) {
      return respondError(
        res,
        "This phone number is already registered. Please login.",
        409,
      );
    }

    const normalizedPhone = cleanPhone.startsWith("+") ? cleanPhone : `+91${cleanPhone}`;
    const insertPayload = {
      email: emailLower,
      full_name: fullName.trim(),
      whatsapp_number: normalizedPhone,
      role: "trainee",
      city: city.trim(),
      state: state.trim(),
      role_type: roleType.trim(),
      login_method: "phone",
    };

    const { data: newUser, error } = await userRepo.create(insertPayload);
    if (error) {
      return respondError(
        res,
        error.message || "Failed to create trainee account",
        500,
      );
    }

    const authService = require("../services/authService");
    const otpResult = await authService.generateAndSendOTP(
      emailLower,
      "trainee",
      fullName.trim(),
      normalizedPhone,
    );

    return success(res, {
      id: newUser.id,
      email: newUser.email,
      fullName: newUser.full_name,
      phone: newUser.whatsapp_number,
      role: newUser.role,
      city: newUser.city,
      state: newUser.state,
      roleType: newUser.role_type,
      ...otpResult,
      message: "Trainee account created. Verify OTP to login.",
    });
  } catch (err) {
    return respondError(res, err.message || "Trainee signup failed", 500);
  }
});

/**
 * POST /api/trainee/verify-phone-otp
 * Verifies OTP and logs in as trainee. Works for both
 * existing trainee login and post-signup verification.
 */
router.post("/verify-phone-otp", validateBody(traineeVerifyPhoneOtpSchema), async (req, res) => {
  try {
    const { phone, otpCode } = req.body;

    const cleanPhone = phone.replace(/\s/g, "").trim().replace(/^\+91/, "");
    const { data: user } = await userRepo.findByPhone(cleanPhone);

    if (!user || user.role !== "trainee") {
      return respondError(res, "Invalid OTP or phone number.", 401);
    }

    const authService = require("../services/authService");
    const authResult = await authService.verifyOTP(user.email, otpCode, {
      loginMethod: "phone",
    });

    if (authResult.token) setAuthCookie(res, authResult.token);
    return success(res, authResult);
  } catch (err) {
    return respondError(res, err.message || "OTP verification failed", 400);
  }
});

/**
 * GET /api/trainee/check-access
 * Checks if current user has trainee access to view trainings.
 */
router.get("/check-access", authMiddleware, async (req, res) => {
  try {
    const { userId, role } = req.user;

    if (role !== "trainee") {
      return respondError(
        res,
        "Access denied. Only trainees can access training content.",
        403,
      );
    }

    const { data: user } = await userRepo.findById(userId);
    if (!user) {
      return respondError(res, "User not found.", 404);
    }

    return success(res, {
      hasTraineeAccess: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.whatsapp_number,
        city: user.city,
        state: user.state,
        roleType: user.role_type,
        role: user.role,
      },
    });
  } catch (err) {
    return respondError(res, err.message || "Access check failed", 500);
  }
});

module.exports = router;
