/**
 * Phone validation utilities for Indian phone numbers
 */

/**
 * Validates an Indian phone number (10 digits starting with 6-9)
 * Accepts: "9876543210", "+919876543210", "+91 9876543210", "91 9876543210"
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid Indian phone
 */
function isValidIndianPhone(phone) {
  if (!phone) return false;
  
  // Ensure phone is a string
  const phoneStr = String(phone).trim();
  if (!phoneStr) return false;
  
  // Extract only digits
  const digits = phoneStr.replace(/\D/g, '');
  
  // 10 digits: must start with 6-9
  if (digits.length === 10) return /^[6-9]\d{9}$/.test(digits);
  
  // 11 digits starting with 0: 0 + 10-digit Indian number
  if (digits.length === 11 && digits.startsWith('0')) return /^0[6-9]\d{9}$/.test(digits);
  
  // 12 digits starting with 91: country code + 10-digit Indian number
  if (digits.length === 12 && digits.startsWith('91')) return /^91[6-9]\d{9}$/.test(digits);
  
  return false;
}

/**
 * Normalizes phone number to E.164 format (+91XXXXXXXXXX)
 * @param {string} phone - Phone number to normalize
 * @returns {string} - Normalized phone or empty string if invalid
 */
function normalizePhoneToE164(phone) {
  if (!phone) return '';
  
  try {
    if (!isValidIndianPhone(phone)) return '';
    
    const phoneStr = String(phone);
    const digits = phoneStr.replace(/\D/g, '');
    const lastTenDigits = digits.slice(-10);
    
    return `+91${lastTenDigits}`;
  } catch (err) {
    return '';
  }
}

/**
 * Normalizes phone to 10-digit format (without country code)
 * @param {string} phone - Phone number to normalize
 * @returns {string} - 10-digit phone or empty string if invalid
 */
function normalizePhoneTo10Digit(phone) {
  if (!phone) return '';
  
  try {
    if (!isValidIndianPhone(phone)) return '';
    
    const phoneStr = String(phone);
    const digits = phoneStr.replace(/\D/g, '');
    return digits.slice(-10);
  } catch (err) {
    return '';
  }
}

module.exports = {
  isValidIndianPhone,
  normalizePhoneToE164,
  normalizePhoneTo10Digit,
};
