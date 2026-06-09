const db = require('../config/db');
const jwt = require('jsonwebtoken');

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
      fullName: fullName || 'Mushroom Enthusiast'
    });

    console.log(`\n======================================================`);
    console.log(`✉️  SIMULATED EMAIL/SMS NOTIFICATION`);
    console.log(`To: ${emailLower}`);
    console.log(`Message: Your Sporekart login OTP is ${generatedOtp}.`);
    console.log(`(For testing, '123456' will also always work).`);
    console.log(`======================================================\n`);

    return { success: true, message: `OTP sent successfully to ${emailLower}` };
  }

  /**
   * Verifies the OTP. If user doesn't exist, creates a new account.
   */
  async verifyOTP(email, otpCode) {
    const emailLower = email.toLowerCase();
    const record = otpStore.get(emailLower);

    if (!record) {
      throw new Error('No OTP request found for this email. Please request a new OTP.');
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
    let { data: user } = await db.from('users').select('*').eq('email', emailLower).single();

    if (!user) {
      // Create new user automatically (Passwordless Auth)
      const { data: newUser, error } = await db.from('users').insert({
        email: emailLower,
        full_name: record.fullName,
        whatsapp_number: '',
        role: record.role
      }).single();

      if (error) throw new Error(error.message);
      user = newUser;
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        whatsappNumber: user.whatsapp_number || '',
        role: user.role
      }
    };
  }

}

module.exports = new AuthService();
