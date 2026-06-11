import { fetchWithAuth } from './client.js';

export const traineeApi = {
    signup: (payload) => fetchWithAuth('/trainee/signup', {
        method: 'POST',
        body: JSON.stringify(payload),
    }),

    requestOtp: (email) => fetchWithAuth('/trainee/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email }),
    }),

    verifyOtp: (email, otpCode) => fetchWithAuth('/trainee/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email, otpCode }),
    }),

    requestPhoneOtp: (phone) => fetchWithAuth('/trainee/request-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone }),
    }),

    verifyPhoneOtp: (phone, otpCode) => fetchWithAuth('/trainee/verify-phone-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, otpCode }),
    }),

    googleLogin: (googleToken) => fetchWithAuth('/trainee/google-login', {
        method: 'POST',
        body: JSON.stringify({ googleToken }),
    }),

    checkAccess: () => fetchWithAuth('/trainee/check-access'),
};