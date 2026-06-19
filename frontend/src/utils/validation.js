export function isValidIndianPhone(value) {
  if (!value) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return /^[6-9]\d{9}$/.test(digits.slice(2));
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return /^[6-9]\d{9}$/.test(digits.slice(1));
  }
  if (digits.length === 10) {
    return /^[6-9]\d{9}$/.test(digits);
  }
  return false;
}

export function formatIndianPhone(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91 ${digits.slice(1, 6)} ${digits.slice(6)}`;
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return value;
}

export function isValidEmail(value) {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isValidOtp(value) {
  if (!value) return false;
  return /^\d{6}$/.test(value.trim());
}

export function isValidName(value) {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

export function isValidPincode(value) {
  if (!value) return false;
  return /^\d{6}$/.test(value.trim());
}

export function isValidPassword(value) {
  if (!value) return false;
  return value.length >= 6;
}

export function getFieldError(fieldName, value, extra) {
  const v = value != null ? String(value).trim() : '';
  switch (fieldName) {
    case 'email':
      if (!v) return 'Email is required.';
      if (!isValidEmail(v)) return 'Enter a valid email address.';
      return '';
    case 'phone':
      if (!v) return 'Phone number is required.';
      if (!isValidIndianPhone(v)) return 'Enter a valid Indian phone number (e.g. +91 9876543210).';
      return '';
    case 'otp':
      if (!v) return 'OTP is required.';
      if (!isValidOtp(v)) return 'OTP must be a 6-digit code.';
      return '';
    case 'name':
      if (!v) return 'Full name is required.';
      if (!isValidName(v)) return 'Name must be between 2 and 100 characters.';
      return '';
    case 'pincode':
      if (!v) return 'Pincode is required.';
      if (!isValidPincode(v)) return 'Pincode must be a 6-digit number.';
      return '';
    case 'password':
      if (!v) return 'Password is required.';
      if (!isValidPassword(v)) return 'Password must be at least 6 characters.';
      return '';
    case 'address':
      if (!v) return 'Address field cannot be empty.';
      return '';
    case 'city':
      if (!v) return 'City is required.';
      return '';
    case 'state':
      if (!v) return 'State is required.';
      return '';
    case 'role':
      if (!v) return 'Role is required.';
      return '';
    default:
      if (!v && extra && extra.required) return `${fieldName} is required.`;
      return '';
  }
}
