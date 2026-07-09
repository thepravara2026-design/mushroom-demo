import { fetchWithAuth } from './client.js';

// All trainee auth now consolidated under /api/auth (see authController.js)
export const traineeApi = {
    signup: (payload) => fetchWithAuth('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ ...payload, role: 'trainee' }),
    }),

    requestPhoneOtp: (phone) => fetchWithAuth('/auth/request-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone }),
    }),

    verifyPhoneOtp: (phone, otpCode) => fetchWithAuth('/auth/verify-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, otpCode }),
    }),

    googleLogin: (credential) => fetchWithAuth('/auth/google-login', {
        method: 'POST',
        body: JSON.stringify({ credential }),
    }),
};
