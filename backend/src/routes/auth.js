const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName, whatsappNumber } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Please provide email, password, and fullName.' });
    }

    // Check if user exists
    const { data: existingUser } = await db.from('users').select('*').eq('email', email.toLowerCase()).single();
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const { data: newUser, error } = await db.from('users').insert({
      email: email.toLowerCase(),
      password_hash: passwordHash,
      full_name: fullName,
      whatsapp_number: whatsappNumber || ''
    }).single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.full_name,
        whatsappNumber: newUser.whatsapp_number
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password.' });
    }

    // Find user
    const { data: user, error } = await db.from('users').select('*').eq('email', email.toLowerCase()).single();
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        whatsappNumber: user.whatsapp_number
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/me
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
      whatsappNumber: user.whatsapp_number
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
