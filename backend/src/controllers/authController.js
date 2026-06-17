const express = require('express');

const router = express.Router();
const authService = require('../services/authService');
const authMiddleware = require('../middleware/auth');
const { success, error: respondError } = require('../lib/response');
const db = require('../config/db');
const { supabaseAdmin, supabaseAnon } = require('../config/supabase');

/**
 * POST /api/auth/register
 * Supabase-native registration: creates user in Supabase Auth + inserts profile row in users table.
 * Returns { message, user: { id, email } }
 */
router.post('/register', async (req, res) => {
  if (db.isMock || !supabaseAdmin) {
    return respondError(res, 'Registration via Supabase Auth requires live Supabase credentials.', 503);
  }

  const { email, password, name, role = 'buyer' } = req.body;
  if (!email || !password || !name) {
    return respondError(res, 'email, password and name are required.', 400);
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });

    if (error) return respondError(res, error.message, 400);

    // Upsert profile row in the custom users table
    await db.from('users').insert({
      id: data.user.id,
      email: data.user.email,
      full_name: name,
      role,
    });

    return success(res, {
      message: 'Account created successfully.',
      user: { id: data.user.id, email: data.user.email },
    }, {}, 201);
  } catch (err) {
    return respondError(res, err.message || 'Registration failed', 500);
  }
});

/**
 * POST /api/auth/login
 * Supabase-native email+password login via signInWithPassword.
 * Returns { token, user } in the same shape as the OTP verify-otp flow.
 */
router.post('/login', async (req, res) => {
  if (db.isMock || !supabaseAnon) {
    // In mock mode: fall through to the OTP/admin-login flow instead
    return respondError(res, 'Email+password login requires live Supabase credentials. Use /auth/request-otp for mock mode.', 503);
  }

  const { email, password } = req.body;
  if (!email || !password) {
    return respondError(res, 'email and password are required.', 400);
  }

  try {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (error) return respondError(res, error.message, 401);

    // Fetch user profile from our custom users table for role, fullName, etc.
    const { data: dbUser } = await db.from('users').select('*').eq('email', data.user.email).single();

    return success(res, {
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: dbUser ? dbUser.full_name : (data.user.user_metadata?.name || ''),
        role: dbUser ? dbUser.role : (data.user.app_metadata?.role || 'buyer'),
        whatsappNumber: dbUser ? (dbUser.whatsapp_number || '') : '',
        avatarUrl: dbUser ? (dbUser.avatar_url || '') : '',
        defaultAddress: dbUser ? (dbUser.default_address || '') : '',
      },
    });
  } catch (err) {
    return respondError(res, err.message || 'Login failed', 500);
  }
});

/**
 * POST /api/auth/logout
 * Stateless logout — frontend clears token from localStorage.
 * If using Supabase sessions, also revokes the server-side session.
 */
router.post('/logout', async (req, res) => {
  try {
    // Attempt to revoke Supabase session if live mode
    if (!db.isMock && supabaseAdmin) {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];
      if (token) {
        // Get user to find their session
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) {
          await supabaseAdmin.auth.admin.signOut(user.id);
        }
      }
    }
  } catch {
    // Ignore errors — logout should always succeed from client's perspective
  }
  return success(res, { message: 'Logged out successfully.' });
});

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
      avatarUrl: req.body.avatar_url,
      addressLine1: req.body.address_line1,
      addressLine2: req.body.address_line2,
      landmark: req.body.landmark,
      city: req.body.city,
      state: req.body.state,
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
      avatarUrl: updated.avatar_url || '',
      addressLine1: updated.address_line1 || '',
      addressLine2: updated.address_line2 || '',
      landmark: updated.landmark || '',
      city: updated.city || '',
      state: updated.state || '',
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
      avatarUrl: user.avatar_url || '',
      defaultAddress: user.default_address || '',
      defaultPincode: user.default_pincode || '',
      addressLine1: user.address_line1 || '',
      addressLine2: user.address_line2 || '',
      landmark: user.landmark || '',
      city: user.city || '',
      state: user.state || '',
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
