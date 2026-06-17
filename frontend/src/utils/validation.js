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
