import { fetchWithAuth } from './client.js';

export const traineeApi = {
    signup: (payload) => fetchWithAuth('/trainee/signup', {
        method: 'POST',
        body: JSON.stringify(payload),
    }),

    requestPhoneOtp: (phone) => fetchWithAuth('/trainee/request-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone }),
    }),

    verifyPhoneOtp: (phone, otpCode) => fetchWithAuth('/trainee/verify-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, otpCode }),
    }),

    googleLogin: (credential) => fetchWithAuth('/trainee/google-login', {
        method: 'POST',
        body: JSON.stringify({ credential }),
    }),

    checkAccess: () => fetchWithAuth('/trainee/check-access'),
};
