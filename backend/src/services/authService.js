const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const userRepo = require('../repositories/userRepository');

const JWT_SECRET = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';

// In-memory OTP store for simulation (email -> { otp, expiresAt, role, fullName })
const otpStore = new Map();

class AuthService {
  /**
   * Generates a 6-digit OTP and simulates sending it via Email/SMS.
   */
  async generateAndSendOTP(email, role, fullName) {
    const emailLower = email.toLowerCase();

    // For simulation, always use 123456 as the OTP, or generate a random one
    // We'll generate a random one and log it, but also accept 123456 as a backdoor for easy testing
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

    otpStore.set(emailLower, {
      otp: generatedOtp,
      expiresAt,
      role: role || 'buyer',
      fullName: fullName || 'Mushroom Enthusiast',
    });

    console.log('\n======================================================');
    console.log('✉️  SIMULATED EMAIL/SMS NOTIFICATION');
    console.log(`To: ${emailLower}`);
    console.log(`Message: Your Sporekart login OTP is ${generatedOtp}.`);
    console.log("(For testing, '123456' will also always work).");
    console.log('======================================================\n');

    return { success: true, message: `OTP sent successfully to ${emailLower}` };
  }

  /**
   * Verifies the OTP. If user doesn't exist, creates a new account.
   */
  async verifyOTP(email, otpCode, opts = {}) {
    const emailLower = email.toLowerCase();
    const record = otpStore.get(emailLower);

    if (!record) {
      throw new Error(
        'No OTP request found for this email. Please request a new OTP.',
      );
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(emailLower);
      throw new Error('OTP has expired. Please request a new one.');
    }

    // Accept generated OTP or backdoor 123456
    if (record.otp !== otpCode && otpCode !== '123456') {
      throw new Error('Invalid OTP code.');
    }

    // OTP verified successfully. Delete from store.
    otpStore.delete(emailLower);

    // Find existing user or create new one
    let { data: user } = await userRepo.findByEmail(emailLower);

    const loginMethod = opts.loginMethod || record.loginMethod || null;
    const whatsappNumber = opts.whatsappNumber || '';

    if (!user) {
      // Create new user automatically (Passwordless Auth)
      const insertPayload = {
        email: emailLower,
        full_name: record.fullName,
        whatsapp_number: whatsappNumber || '',
        role: record.role,
      };
      if (loginMethod) insertPayload.login_method = loginMethod;

      const { data: newUser, error } = await userRepo.create(insertPayload);
      if (error) throw new Error(error.message);
      user = newUser;
    } else {
      // If user exists and opts provided, update immutable fields only if allowed
      const updates = {};
      if (loginMethod && user.login_method !== loginMethod) {
        updates.login_method = loginMethod;
      }
      if (whatsappNumber) updates.whatsapp_number = whatsappNumber;
      if (Object.keys(updates).length) {
        await userRepo.update(user.id, updates);
        const refetch = await userRepo.findById(user.id);
        user = refetch.data;
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    return {
      token,
      user: {
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
      },
    };
  }

  async adminLogin(email, password) {
    const emailLower = String(email).toLowerCase();
    const { data: user } = await userRepo.findByEmail(emailLower);
    if (!user || user.role !== 'admin') {
      const err = new Error('Invalid admin credentials.');
      err.status = 403;
      throw err;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash || '');
    if (!isMatch) {
      const err = new Error('Invalid admin credentials.');
      err.status = 400;
      throw err;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' },
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
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error || !user) {
      const err = new Error('User not found.');
      err.status = 404;
      throw err;
    }
    return user;
  }

  async updateProfile(userId, updates = {}) {
    // Fetch current
    const { data: current, error: getErr } = await userRepo.findById(userId);
    if (getErr || !current) {
      const err = new Error('User not found.');
      err.status = 404;
      throw err;
    }

    const payload = {};
    if (typeof updates.fullName === 'string') payload.full_name = updates.fullName.trim();
    if (typeof updates.email === 'string') payload.email = updates.email.trim().toLowerCase();
    if (typeof updates.whatsappNumber === 'string') payload.whatsapp_number = updates.whatsappNumber.trim();
    if (typeof updates.defaultAddress === 'string') payload.default_address = updates.defaultAddress.trim();
    if (typeof updates.defaultPincode === 'string') payload.default_pincode = updates.defaultPincode.trim();
    if (typeof updates.avatarUrl === 'string') payload.avatar_url = updates.avatarUrl;
    if (typeof updates.addressLine1 === 'string') payload.address_line1 = updates.addressLine1.trim();
    if (typeof updates.addressLine2 === 'string') payload.address_line2 = updates.addressLine2.trim();
    if (typeof updates.landmark === 'string') payload.landmark = updates.landmark.trim();
    if (typeof updates.city === 'string') payload.city = updates.city.trim();
    if (typeof updates.state === 'string') payload.state = updates.state.trim();

    if (
      current.login_method === 'phone'
      && payload.whatsapp_number
      && payload.whatsapp_number !== current.whatsapp_number
    ) {
      const err = new Error(
        'Phone number cannot be changed for phone-verified accounts.',
      );
      err.status = 400;
      throw err;
    }
    if (
      current.login_method === 'google'
      && payload.email
      && payload.email !== current.email
    ) {
      const err = new Error(
        'Email cannot be changed for accounts created via Google sign-in.',
      );
      err.status = 400;
      throw err;
    }

    if (!Object.keys(payload).length) {
      const err = new Error('No valid fields to update.');
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
    if (reason) console.log(`Account deletion requested for ${userId}: ${reason}`);
    return { success: true };
  }
}

module.exports = new AuthService();
