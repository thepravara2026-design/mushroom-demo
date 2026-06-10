import { fetchWithAuth } from './client.js';

export const authApi = {
  requestOtp: (email, role, fullName) => 
    fetchWithAuth('/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ email, role, fullName })
    }),

  verifyOtp: (email, otpCode, opts = {}) =>
    fetchWithAuth('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify(Object.assign({ email, otpCode }, opts))
    }),

  adminLogin: (email, password) =>
    fetchWithAuth('/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

  getMe: () => fetchWithAuth('/auth/me')
};
