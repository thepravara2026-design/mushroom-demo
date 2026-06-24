const express = require("express");

const router = express.Router();
const authService = require("../services/authService");
const authMiddleware = require("../middleware/auth");
const { validateBody, Joi } = require("../middleware/validate");
const { success, error: respondError } = require("../lib/response");
const db = require("../config/db");
const { supabaseAdmin, supabaseAnon } = require("../config/supabase");
const { setAuthCookie, clearAuthCookie } = require("../lib/authCookie");

const registerSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email address.",
    "any.required": "Email is required.",
  }),
  password: Joi.string().min(6).required().messages({
    "string.min": "Password must be at least 6 characters.",
    "any.required": "Password is required.",
  }),
  name: Joi.string().min(2).max(100).required().messages({
    "string.min": "Name must be at least 2 characters.",
    "string.max": "Name must not exceed 100 characters.",
    "any.required": "Name is required.",
  }),
  role: Joi.string().valid("buyer", "grower", "admin").optional(),
});

/**
 * POST /api/auth/register
 * Supabase-native registration: creates user in Supabase Auth + inserts profile row in users table.
 * Returns { message, user: { id, email } }
 */
router.post("/register", validateBody(registerSchema), async (req, res) => {
  if (db.isMock || !supabaseAdmin) {
    return respondError(
      res,
      "Registration via Supabase Auth requires live Supabase credentials.",
      503,
    );
  }

  const { email, password, name, role = "buyer" } = req.body;

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });

    if (error) return respondError(res, error.message, 400);

    // Upsert profile row in the custom users table
    await db.from("users").insert({
      id: data.user.id,
      email: data.user.email,
      full_name: name,
      role,
    });

    return success(
      res,
      {
        message: "Account created successfully.",
        user: { id: data.user.id, email: data.user.email },
      },
      {},
      201,
    );
  } catch (err) {
    return respondError(res, err.message || "Registration failed", 500);
  }
});

const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email address.",
    "any.required": "Email is required.",
  }),
  password: Joi.string().min(1).required().messages({
    "any.required": "Password is required.",
  }),
});

/**
 * POST /api/auth/login
 * Supabase-native email+password login via signInWithPassword.
 * Returns { token, user } in the same shape as the OTP verify-otp flow.
 */
router.post("/login", validateBody(loginSchema), async (req, res) => {
  if (db.isMock || !supabaseAnon) {
    // In mock mode: fall through to the OTP/admin-login flow instead
    return respondError(
      res,
      "Email+password login requires live Supabase credentials. Use /auth/request-otp for mock mode.",
      503,
    );
  }

  const { email, password } = req.body;

  try {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return respondError(res, error.message, 401);

    // Fetch user profile from our custom users table for role, fullName, etc.
    const { data: dbUser } = await db
      .from("users")
      .select("*")
      .eq("email", data.user.email)
      .single();

    setAuthCookie(res, data.session.access_token);

    return success(res, {
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: dbUser
          ? dbUser.full_name
          : data.user.user_metadata?.name || "",
        role: dbUser ? dbUser.role : data.user.app_metadata?.role || "buyer",
        whatsappNumber: dbUser ? dbUser.whatsapp_number || "" : "",
        avatarUrl: dbUser ? dbUser.avatar_url || "" : "",
        defaultAddress: dbUser ? dbUser.default_address || "" : "",
      },
    });
  } catch (err) {
    return respondError(res, err.message || "Login failed", 500);
  }
});

/**
 * POST /api/auth/logout
 * Stateless logout — frontend clears token from localStorage.
 * If using Supabase sessions, also revokes the server-side session.
 */
router.post("/logout", async (req, res) => {
  try {
    // Attempt to revoke Supabase session if live mode
    if (!db.isMock && supabaseAdmin) {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(" ")[1];
      if (token) {
        // Get user to find their session
        const {
          data: { user },
        } = await supabaseAdmin.auth.getUser(token);
        if (user) {
          await supabaseAdmin.auth.admin.signOut(user.id);
        }
      }
    }
  } catch {
    // Ignore errors — logout should always succeed from client's perspective
  }
  clearAuthCookie(res);
  return success(res, { message: "Logged out successfully." });
});

const otpRequestSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email address.",
    "any.required": "Email is required to request OTP.",
  }),
  role: Joi.string().valid("buyer", "grower", "admin").optional(),
  fullName: Joi.string().min(2).max(100).optional().allow(""),
  phone: Joi.string().optional().allow(""),
});

/**
 * POST /api/auth/request-otp
 * Passwordless Auth: Requests an OTP for a given email.
 */
router.post(
  "/request-otp",
  validateBody(otpRequestSchema),
  async (req, res) => {
    try {
      const { email, role, fullName, phone } = req.body;
      const result = await authService.generateAndSendOTP(
        email,
        role,
        fullName,
        phone,
      );
      return success(res, result);
    } catch (error) {
      return respondError(
        res,
        error.message || "Failed to send OTP",
        error.status || 500,
      );
    }
  },
);

const verifyOtpSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email address.",
    "any.required": "Email is required.",
  }),
  otpCode: Joi.string()
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      "string.pattern.base": "OTP must be a 6-digit code.",
      "any.required": "OTP code is required.",
    }),
  loginMethod: Joi.string().valid("email", "phone").optional(),
  whatsappNumber: Joi.string().allow("").optional(),
});

/**
 * POST /api/auth/verify-otp
 * Passwordless Auth: Verifies the OTP and issues a JWT token.
 */
router.post("/verify-otp", validateBody(verifyOtpSchema), async (req, res) => {
  try {
    const { email, otpCode, loginMethod, whatsappNumber } = req.body;
    const authResult = await authService.verifyOTP(email, otpCode, {
      loginMethod,
      whatsappNumber,
    });
    if (authResult.token) setAuthCookie(res, authResult.token);
    return success(res, authResult);
  } catch (error) {
    return respondError(
      res,
      error.message || "OTP verification failed",
      error.status || 400,
    );
  }
});

const updateProfileSchema = Joi.object({
  fullName: Joi.string().min(2).max(100).optional(),
  email: Joi.string().email().optional(),
  whatsappNumber: Joi.string().allow("").optional(),
  default_address: Joi.string().allow("").max(500).optional(),
  defaultAddress: Joi.string().allow("").max(500).optional(),
  default_pincode: Joi.string()
    .pattern(/^\d{6}$/)
    .allow("")
    .optional(),
  defaultPincode: Joi.string()
    .pattern(/^\d{6}$/)
    .allow("")
    .optional(),
  avatar_url: Joi.string().allow("").optional(),
  avatarUrl: Joi.string().allow("").optional(),
  address_line1: Joi.string().allow("").max(200).optional(),
  addressLine1: Joi.string().allow("").max(200).optional(),
  address_line2: Joi.string().allow("").max(200).optional(),
  addressLine2: Joi.string().allow("").max(200).optional(),
  landmark: Joi.string().allow("").max(200).optional(),
  city: Joi.string().allow("").max(100).optional(),
  state: Joi.string().allow("").max(100).optional(),
});

/**
 * PUT /api/auth/me
 * Update profile fields for current user. Enforces immutability for provider-managed fields.
 */
router.put(
  "/me",
  authMiddleware,
  validateBody(updateProfileSchema),
  async (req, res) => {
    try {
      const { userId } = req.user;
      const updates = {
        fullName: req.body.fullName,
        email: req.body.email,
        whatsappNumber: req.body.whatsappNumber,
        defaultAddress: req.body.defaultAddress || req.body.default_address,
        defaultPincode: req.body.defaultPincode || req.body.default_pincode,
        avatarUrl: req.body.avatarUrl || req.body.avatar_url,
        addressLine1: req.body.addressLine1 || req.body.address_line1,
        addressLine2: req.body.addressLine2 || req.body.address_line2,
        landmark: req.body.landmark,
        city: req.body.city,
        state: req.body.state,
      };

      const updated = await authService.updateProfile(userId, updates);

      return success(res, {
        id: updated.id,
        email: updated.email,
        fullName: updated.full_name,
        whatsappNumber: updated.whatsapp_number || "",
        role: updated.role,
        loginMethod: updated.login_method || null,
        defaultAddress: updated.default_address || "",
        defaultPincode: updated.default_pincode || "",
        avatarUrl: updated.avatar_url || "",
        addressLine1: updated.address_line1 || "",
        addressLine2: updated.address_line2 || "",
        landmark: updated.landmark || "",
        city: updated.city || "",
        state: updated.state || "",
      });
    } catch (err) {
      return respondError(
        res,
        err.message || "Failed to update profile",
        err.status || 500,
      );
    }
  },
);

/**
 * DELETE /api/auth/me
 * Deletes the current user's account (mock/local). Accepts optional reason.
 */
const deleteAccountSchema = Joi.object({
  reason: Joi.string().max(500).allow("", null).optional(),
});

router.delete("/me", authMiddleware, validateBody(deleteAccountSchema), async (req, res) => {
  try {
    const { userId } = req.user;
    const reason = req.body.reason || null;
    await authService.deleteAccount(userId, reason);
    return success(res, { message: "Account deleted." });
  } catch (err) {
    return respondError(
      res,
      err.message || "Failed to delete account",
      err.status || 500,
    );
  }
});

const adminLoginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid admin email address.",
    "any.required": "Admin email is required.",
  }),
});

const adminVerifyOtpSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid admin email address.",
    "any.required": "Admin email is required.",
  }),
  otpCode: Joi.string()
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      "string.pattern.base": "OTP must be a 6-digit code.",
      "any.required": "OTP code is required.",
    }),
});

/**
 * POST /api/auth/admin-login
 * Requests an OTP for admin login (passwordless).
 */
router.post(
  "/admin-login",
  validateBody(adminLoginSchema),
  async (req, res) => {
    try {
      const { email } = req.body;
      const result = await authService.adminRequestOTP(email);
      return success(res, result);
    } catch (err) {
      return respondError(
        res,
        err.message || "Admin login failed",
        err.status || 500,
      );
    }
  },
);

/**
 * POST /api/auth/admin-verify-otp
 * Verifies the admin OTP and issues a JWT token.
 */
router.post(
  "/admin-verify-otp",
  validateBody(adminVerifyOtpSchema),
  async (req, res) => {
    try {
      const { email, otpCode } = req.body;
      const result = await authService.adminVerifyOTP(email, otpCode);
      if (result.token) setAuthCookie(res, result.token);
      return success(res, result);
    } catch (err) {
      return respondError(
        res,
        err.message || "OTP verification failed",
        err.status || 400,
      );
    }
  },
);

/**
 * GET /api/auth/me
 * Returns current authenticated user data.
 */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await authService.getUserById(req.user.userId);
    return success(res, {
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
    });
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch user",
      error.status || 500,
    );
  }
});

module.exports = router;
