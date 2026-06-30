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

const traineeSignupSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(100).required().messages({
    "string.min": "Full name must be at least 2 characters.",
    "string.max": "Full name must not exceed 100 characters.",
    "any.required": "Full name is required.",
  }),
  phone: Joi.string()
    .pattern(/^(\+91)?[6-9]\d{9}$/)
    .required()
    .messages({
      "string.pattern.base": "Enter a valid Indian phone number.",
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

const traineeOtpRequestSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email address.",
    "any.required": "Email is required.",
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
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email address.",
    "any.required": "Email from Google authentication is required.",
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

const traineeVerifyOtpSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email address.",
    "any.required": "Email is required.",
  }),
  otpCode: Joi.string().pattern(/^\d{6}$/).required().messages({
    "string.pattern.base": "OTP must be a 6-digit code.",
    "any.required": "OTP is required.",
  }),
});

/**
 * POST /api/trainee/signup
 * Trainee-specific registration with full profile details.
 * Creates user with role 'trainee' and profile fields (city, state, phone, role_type).
 */
router.post("/signup", validateBody(traineeSignupSchema), async (req, res) => {
  try {
    const { fullName, phone, email, roleType, city, state } = req.body;

    const emailLower = email.toLowerCase().trim();

    // Check if email already exists
    const { data: existingUser } = await userRepo.findByEmail(emailLower);
    if (existingUser) {
      return respondError(
        res,
        "This email is already registered. Please login.",
        409,
      );
    }

    // Check if phone already exists (for trainee uniqueness)
    const cleanPhone = phone.replace(/\s/g, "").trim().replace(/^\+91/, "");
    const { data: existingPhone } = await userRepo.findByPhone(cleanPhone);
    if (existingPhone) {
      return respondError(
        res,
        "This phone number is already registered. Please login.",
        409,
      );
    }

    // Create new user with trainee role and extended profile
    const normalizedPhone = cleanPhone.startsWith("+") ? cleanPhone : `+91${cleanPhone}`;
    const insertPayload = {
      email: emailLower,
      full_name: fullName.trim(),
      whatsapp_number: normalizedPhone,
      role: "trainee",
      city: city.trim(),
      state: state.trim(),
      role_type: roleType.trim(), // cultivator, beginner, entrepreneur
      login_method: "email",
    };

    const { data: newUser, error } = await userRepo.create(insertPayload);
    if (error) {
      return respondError(
        res,
        error.message || "Failed to create trainee account",
        500,
      );
    }

    return success(res, {
      id: newUser.id,
      email: newUser.email,
      fullName: newUser.full_name,
      phone: newUser.whatsapp_number,
      role: newUser.role,
      city: newUser.city,
      state: newUser.state,
      roleType: newUser.role_type,
      message: "Trainee account created successfully. Please login.",
    });
  } catch (err) {
    return respondError(res, err.message || "Trainee signup failed", 500);
  }
});

/**
 * POST /api/trainee/request-otp
 * Trainee-specific login via email. Only allows users with role 'trainee' to login.
 * Returns needsSignup: true if user doesn't exist.
 */
router.post("/request-otp", validateBody(traineeOtpRequestSchema), async (req, res) => {
  try {
    const { email } = req.body;

    const emailLower = email.toLowerCase().trim();

    // Look up user — do NOT reveal whether email is registered
    const { data: user } = await userRepo.findByEmail(emailLower);

    if (!user) {
      return success(res, {
        message:
          "If this email is registered with us, you will receive an OTP shortly.",
      });
    }

    if (user.role !== "trainee") {
      return success(res, {
        message: "If this email is registered with us, you will receive an OTP shortly.",
      });
    }

    const authService = require("../services/authService");
    const result = await authService.generateAndSendOTP(
      emailLower,
      "trainee",
      user.full_name,
    );
    return success(res, result);
  } catch (err) {
    return respondError(
      res,
      err.message || "Failed to send OTP",
      err.status || 500,
    );
  }
});

/**
 * POST /api/trainee/request-phone-otp
 * Trainee-specific login via phone number. Looks up user by whatsapp_number.
 */
router.post("/request-phone-otp", validateBody(traineePhoneRequestSchema), async (req, res) => {
  try {
    const { phone } = req.body;

    const cleanPhone = phone.replace(/\s/g, "").trim().replace(/^\+91/, "");

    // Look up user — do NOT reveal whether phone is registered
    const { data: user } = await userRepo.findByPhone(cleanPhone);

    if (!user || user.role !== "trainee") {
      return success(res, {
        message:
          "If this phone number is registered with us, you will receive an OTP shortly.",
      });
    }

    // Use the user's email as the OTP destination, but flag it as phone login
    const authService = require("../services/authService");
    const result = await authService.generateAndSendOTP(
      user.email,
      "trainee",
      user.full_name,
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
 * Expects { googleToken } — looks up by the email extracted from token.
 * For mock: { email } directly.
 */
router.post("/google-login", validateBody(traineeGoogleLoginSchema), async (req, res) => {
  try {
    const { email } = req.body;

    const emailLower = email.toLowerCase().trim();

    const { data: user } = await userRepo.findByEmail(emailLower);

    if (!user) {
      return success(res, {
        needsSignup: true,
        email: emailLower,
        message: "No account found. Please register as a trainee first.",
      });
    }

    if (user.role !== "trainee") {
      return success(res, {
        needsSignup: true,
        message: "No account found. Please register as a trainee first.",
      });
    }

    // Generate JWT token directly (no OTP needed for Google)
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
 * POST /api/trainee/verify-phone-otp
 * Verifies OTP for phone-based login.
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
 * POST /api/trainee/verify-otp
 * Verifies OTP and logs in as trainee.
 */
router.post("/verify-otp", validateBody(traineeVerifyOtpSchema), async (req, res) => {
  try {
    const { email, otpCode } = req.body;

    const emailLower = email.toLowerCase().trim();
    const authService = require("../services/authService");

    // Use existing verifyOTP but ensure role is trainee
    const authResult = await authService.verifyOTP(emailLower, otpCode, {
      loginMethod: "email",
    });

    // Double check the user is still a trainee
    if (authResult.user.role !== "trainee") {
      return respondError(res, "Invalid OTP or email.", 403);
    }

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
