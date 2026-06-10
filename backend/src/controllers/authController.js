const express = require('express');

const router = express.Router();
const authService = require('../services/authService');
const authMiddleware = require('../middleware/auth');
const { success, error: respondError } = require('../lib/response');
const db = require('../config/db');

/**
 * POST /api/auth/request-otp
 * Passwordless Auth: Requests an OTP for a given email.
 */
router.post('/request-otp', async (req, res) => {
  try {
    const { email, role, fullName } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ error: 'Email is required to request OTP.' });
    }

    const result = await authService.generateAndSendOTP(email, role, fullName);
    return success(res, result);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to send OTP',
      error.status || 500,
    );
  }
});

/**
 * POST /api/auth/verify-otp
 * Passwordless Auth: Verifies the OTP and issues a JWT token.
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
      return res
        .status(400)
        .json({ error: 'Email and OTP code are required.' });
    }
    // Allow client to optionally pass loginMethod and whatsappNumber so server can persist provider and phone
    const { loginMethod, whatsappNumber } = req.body;
    const authResult = await authService.verifyOTP(email, otpCode, {
      loginMethod,
      whatsappNumber,
    });
    return success(res, authResult);
  } catch (error) {
    return respondError(
      res,
      error.message || 'OTP verification failed',
      error.status || 400,
    );
  }
});

/**
 * PUT /api/auth/me
 * Update profile fields for current user. Enforces immutability for provider-managed fields.
 */
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const updates = {
      fullName: req.body.fullName,
      email: req.body.email,
      whatsappNumber: req.body.whatsappNumber,
      defaultAddress: req.body.default_address,
      defaultPincode: req.body.default_pincode,
    };

    const updated = await authService.updateProfile(userId, updates);

    return success(res, {
      id: updated.id,
      email: updated.email,
      fullName: updated.full_name,
      whatsappNumber: updated.whatsapp_number || '',
      role: updated.role,
      loginMethod: updated.login_method || null,
      defaultAddress: updated.default_address || '',
      defaultPincode: updated.default_pincode || '',
    });
  } catch (err) {
    return respondError(
      res,
      err.message || 'Failed to update profile',
      err.status || 500,
    );
  }
});

/**
 * DELETE /api/auth/me
 * Deletes the current user's account (mock/local). Accepts optional reason.
 */
router.delete('/me', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const reason = req.body && req.body.reason
      ? String(req.body.reason).slice(0, 500)
      : null;
    await authService.deleteAccount(userId, reason);
    return success(res, { message: 'Account deleted.' });
  } catch (err) {
    return respondError(
      res,
      err.message || 'Failed to delete account',
      err.status || 500,
    );
  }
});

/**
 * POST /api/auth/admin-login
 * Isolated Admin Login using static password credentials.
 */
router.post('/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return respondError(res, 'Please provide admin email and password.', 400);
    try {
      const result = await authService.adminLogin(email, password);
      return success(res, result);
    } catch (err) {
      return respondError(
        res,
        err.message || 'Admin login failed',
        err.status || 401,
      );
    }
  } catch (error) {
    return respondError(res, error.message || 'Admin login failed', 500);
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user data.
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await authService.getUserById(req.user.userId);
    return success(res, {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      whatsappNumber: user.whatsapp_number || '',
      role: user.role,
    });
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to fetch user',
      error.status || 500,
    );
  }
});

module.exports = router;
