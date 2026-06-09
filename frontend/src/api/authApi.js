import { fetchWithAuth } from './client.js';

export const authApi = {
  requestOtp: (email, role, fullName) => 
    fetchWithAuth('/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ email, role, fullName })
    }),

  verifyOtp: (email, otpCode) =>
    fetchWithAuth('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otpCode })
    }),

  adminLogin: (email, password) =>
    fetchWithAuth('/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

  getMe: () => fetchWithAuth('/auth/me')
};
