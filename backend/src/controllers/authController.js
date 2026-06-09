const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';

/**
 * POST /api/auth/request-otp
 * Passwordless Auth: Requests an OTP for a given email.
 */
router.post('/request-otp', async (req, res) => {
  try {
    const { email, role, fullName } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required to request OTP.' });
    }

    const result = await authService.generateAndSendOTP(email, role, fullName);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      return res.status(400).json({ error: 'Email and OTP code are required.' });
    }

    const authResult = await authService.verifyOTP(email, otpCode);
    res.status(200).json(authResult);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/auth/admin-login
 * Isolated Admin Login using static password credentials.
 */
router.post('/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide admin email and password.' });
    }

    // Find user
    const { data: user } = await db.from('users').select('*').eq('email', email.toLowerCase()).single();
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized access.' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid admin credentials.' });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user data.
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: user, error } = await db.from('users').select('*').eq('id', req.user.userId).single();
    if (error || !user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      whatsappNumber: user.whatsapp_number || '',
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
