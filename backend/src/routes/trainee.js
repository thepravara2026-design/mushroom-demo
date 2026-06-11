const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { success, error: respondError } = require('../lib/response');
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const userRepo = require('../repositories/userRepository');

const JWT_SECRET = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';

/**
 * POST /api/trainee/signup
 * Trainee-specific registration with full profile details.
 * Creates user with role 'trainee' and profile fields (city, state, phone, role_type).
 */
router.post('/signup', async (req, res) => {
    try {
        const { fullName, phone, email, roleType, city, state } = req.body;

        if (!fullName || !phone || !email || !roleType || !city || !state) {
            return respondError(res, 'All fields are required: name, phone, email, role, city, state', 400);
        }

        const emailLower = email.toLowerCase().trim();

        // Check if email already exists
        const { data: existingUser } = await userRepo.findByEmail(emailLower);
        if (existingUser) {
            return respondError(res, 'This email is already registered. Please login.', 409);
        }

        // Check if phone already exists (for trainee uniqueness)
        const { data: existingPhone } = await db
            .from('users')
            .eq('whatsapp_number', phone)
            .single();
        if (existingPhone) {
            return respondError(res, 'This phone number is already registered. Please login.', 409);
        }

        // Create new user with trainee role and extended profile
        const insertPayload = {
            email: emailLower,
            full_name: fullName.trim(),
            whatsapp_number: phone.trim(),
            role: 'trainee',
            city: city.trim(),
            state: state.trim(),
            role_type: roleType.trim(),  // cultivator, beginner, entrepreneur
            login_method: 'email',
        };

        const { data: newUser, error } = await userRepo.create(insertPayload);
        if (error) {
            return respondError(res, error.message || 'Failed to create trainee account', 500);
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
            message: 'Trainee account created successfully. Please login.',
        });
    } catch (err) {
        return respondError(res, err.message || 'Trainee signup failed', 500);
    }
});

/**
 * POST /api/trainee/request-otp
 * Trainee-specific login via email. Only allows users with role 'trainee' to login.
 * Returns needsSignup: true if user doesn't exist.
 */
router.post('/request-otp', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return respondError(res, 'Email is required.', 400);
        }

        const emailLower = email.toLowerCase().trim();

        // Check if user exists with this email
        const { data: user } = await userRepo.findByEmail(emailLower);

        if (!user) {
            return success(res, {
                needsSignup: true,
                message: 'No account found. Please register as a trainee first.',
            });
        }

        if (user.role !== 'trainee') {
            return respondError(res, 'This account is not registered as a trainee. Please use user login.', 403);
        }

        const authService = require('../services/authService');
        const result = await authService.generateAndSendOTP(emailLower, 'trainee', user.full_name);
        return success(res, result);
    } catch (err) {
        return respondError(res, err.message || 'Failed to send OTP', err.status || 500);
    }
});

/**
 * POST /api/trainee/request-phone-otp
 * Trainee-specific login via phone number. Looks up user by whatsapp_number.
 */
router.post('/request-phone-otp', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return respondError(res, 'Phone number is required.', 400);
        }

        const cleanPhone = phone.replace(/\s/g, '').trim();

        // Check if user exists with this phone number
        const { data: user } = await userRepo.findByPhone(cleanPhone);

        if (!user) {
            return success(res, {
                needsSignup: true,
                message: 'No account found with this phone number. Please register as a trainee first.',
            });
        }

        if (user.role !== 'trainee') {
            return respondError(res, 'This account is not registered as a trainee. Please use user login.', 403);
        }

        // Use the user's email as the OTP destination, but flag it as phone login
        const authService = require('../services/authService');
        const result = await authService.generateAndSendOTP(user.email, 'trainee', user.full_name);
        return success(res, {
            ...result,
            email: user.email,
        });
    } catch (err) {
        return respondError(res, err.message || 'Failed to send OTP', err.status || 500);
    }
});

/**
 * POST /api/trainee/google-login
 * Handles Google OAuth login for trainees.
 * Expects { googleToken } — looks up by the email extracted from token.
 * For mock: { email } directly.
 */
router.post('/google-login', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return respondError(res, 'Email from Google authentication is required.', 400);
        }

        const emailLower = email.toLowerCase().trim();

        const { data: user } = await userRepo.findByEmail(emailLower);

        if (!user) {
            return success(res, {
                needsSignup: true,
                email: emailLower,
                message: 'No account found. Please register as a trainee first.',
            });
        }

        if (user.role !== 'trainee') {
            return respondError(res, 'This account is not registered as a trainee.', 403);
        }

        // Generate JWT token directly (no OTP needed for Google)
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' },
        );

        return success(res, {
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                whatsappNumber: user.whatsapp_number || '',
                role: user.role,
                loginMethod: 'google',
            },
        });
    } catch (err) {
        return respondError(res, err.message || 'Google login failed', err.status || 500);
    }
});

/**
 * POST /api/trainee/verify-phone-otp
 * Verifies OTP for phone-based login.
 */
router.post('/verify-phone-otp', async (req, res) => {
    try {
        const { phone, otpCode } = req.body;

        if (!phone || !otpCode) {
            return respondError(res, 'Phone and OTP are required.', 400);
        }

        const cleanPhone = phone.replace(/\s/g, '').trim();
        const { data: user } = await userRepo.findByPhone(cleanPhone);

        if (!user) {
            return respondError(res, 'User not found with this phone number.', 404);
        }

        if (user.role !== 'trainee') {
            return respondError(res, 'This account is not a trainee.', 403);
        }

        const authService = require('../services/authService');
        const authResult = await authService.verifyOTP(user.email, otpCode, {
            loginMethod: 'phone',
        });

        return success(res, authResult);
    } catch (err) {
        return respondError(res, err.message || 'OTP verification failed', 400);
    }
});

/**
 * POST /api/trainee/verify-otp
 * Verifies OTP and logs in as trainee.
 */
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otpCode } = req.body;

        if (!email || !otpCode) {
            return respondError(res, 'Email and OTP are required.', 400);
        }

        const emailLower = email.toLowerCase().trim();
        const authService = require('../services/authService');

        // Use existing verifyOTP but ensure role is trainee
        const authResult = await authService.verifyOTP(emailLower, otpCode, {
            loginMethod: 'email',
        });

        // Double check the user is still a trainee
        if (authResult.user.role !== 'trainee') {
            return respondError(res, 'This account is not a trainee. Please use user login.', 403);
        }

        return success(res, authResult);
    } catch (err) {
        return respondError(res, err.message || 'OTP verification failed', 400);
    }
});

/**
 * GET /api/trainee/check-access
 * Checks if current user has trainee access to view trainings.
 */
router.get('/check-access', authMiddleware, async (req, res) => {
    try {
        const { userId, role } = req.user;

        if (role !== 'trainee') {
            return respondError(res, 'Access denied. Only trainees can access training content.', 403);
        }

        const { data: user } = await userRepo.findById(userId);
        if (!user) {
            return respondError(res, 'User not found.', 404);
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
        return respondError(res, err.message || 'Access check failed', 500);
    }
});

module.exports = router;