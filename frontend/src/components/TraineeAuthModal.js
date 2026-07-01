import { traineeApi } from '../api/traineeApi.js';
import { saveAuth, clearAuth, state } from '../utils/state.js';
import { showErrorToast, showSuccessToast, showPopupModal } from '../utils/notify.js';
import { isValidIndianPhone, isValidEmail, isValidOtp, isValidName, getFieldError } from '../utils/validation.js';
import { locationApi } from '../api/locationApi.js';

let _tamCitiesCache = {};

async function _tamGetCities(state) {
  if (!state) return [];
  if (_tamCitiesCache[state]) return _tamCitiesCache[state];
  try {
    const cities = await locationApi.getCities(state);
    _tamCitiesCache[state] = cities;
    return cities;
  } catch {
    return [];
  }
}

class TraineeAuthModal {
    constructor() {
        this.modal = document.getElementById('trainee-auth-modal');
        this.bindEvents();
        this.currentView = null;
        this.onSuccessCallback = null;
        this._pendingPhone = null;
        this._pendingEmail = null;
        this._pendingFullName = null;
        this._isSignupFlow = false;
        this._initStateCity();
    }

    _initStateCity() {
        const stateSelect = document.getElementById('trainee-signup-state');
        const citySelect = document.getElementById('trainee-signup-city');

        if (stateSelect && citySelect) {
            stateSelect.addEventListener('change', async () => {
                const selectedState = stateSelect.value;
                citySelect.innerHTML = '<option value="">Select City</option>';
                citySelect.disabled = true;

                if (selectedState) {
                    const cities = await _tamGetCities(selectedState);
                    if (cities.length) {
                        citySelect.disabled = false;
                        cities.forEach(city => {
                            const opt = document.createElement('option');
                            opt.value = city;
                            opt.textContent = city;
                            citySelect.appendChild(opt);
                        });
                    }
                }
            });

            citySelect.disabled = true;
        }
    }

    bindEvents() {
        document.getElementById('btn-close-trainee-auth')
            ?.addEventListener('click', () => this.close());

        document.getElementById('trainee-phone-form')
            ?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handlePhoneSubmit();
            });

        document.getElementById('btn-trainee-google')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleGoogleLogin();
            });

        document.getElementById('trainee-signup-form')
            ?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSignup();
            });

        document.getElementById('trainee-verify-form')
            ?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleVerifyOtp();
            });

        document.getElementById('link-trainee-to-signup')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSignup();
            });

        document.getElementById('link-trainee-to-login')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.showLogin();
            });

        document.getElementById('link-trainee-back-verify')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.showLogin();
            });

        document.getElementById('link-trainee-success-login')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.showLogin();
            });
    }

    open(onSuccess = null) {
        if (state.token && state.user && state.user.role === 'trainee') {
            if (onSuccess) onSuccess();
            return;
        }
        if (state.token && state.user && state.user.role !== 'trainee') {
            showErrorToast('Your current account is not registered as a trainee. Please register as a trainee to access training.');
        }
        this.onSuccessCallback = onSuccess;
        this.showLogin();
        this.modal.classList.add('open');
        this.clearErrors();
    }

    close() {
        this.modal.classList.remove('open');
        this.clearErrors();
        this.clearForms();
        this._pendingPhone = null;
        this._pendingEmail = null;
        this._pendingFullName = null;
        this._isSignupFlow = false;
    }

    showLogin() {
        this._hideAllViews();
        document.getElementById('trainee-login-view').classList.remove('hidden');
        this.currentView = 'login';
        document.getElementById('trainee-phone')?.focus();
    }

    showSignup() {
        this._hideAllViews();
        document.getElementById('trainee-signup-view').classList.remove('hidden');
        this.currentView = 'signup';
    }

    showVerify(contact, mockOtp = null) {
        this._hideAllViews();
        document.getElementById('trainee-verify-view').classList.remove('hidden');
        this.currentView = 'verify';
        const subtitle = document.getElementById('trainee-verify-subtitle');
        if (subtitle) {
            if (mockOtp) {
                subtitle.textContent = `Mock OTP: ${mockOtp} — entering automatically`;
            } else {
                subtitle.textContent = `Enter the 6-digit code sent to ${contact}`;
            }
        }
        const otpInput = document.getElementById('trainee-otp');
        if (otpInput) {
            otpInput.value = mockOtp || '';
            otpInput.focus();
            if (mockOtp) {
                setTimeout(() => {
                    this.handleVerifyOtp();
                }, 300);
            }
        }
    }

    showSignupSuccess() {
        this._hideAllViews();
        document.getElementById('trainee-success-view').classList.remove('hidden');
        this.currentView = 'success';
    }

    _hideAllViews() {
        ['trainee-login-view', 'trainee-signup-view', 'trainee-verify-view', 'trainee-success-view'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }

    clearErrors() {
        ['trainee-login-error', 'trainee-signup-error', 'trainee-verify-error',
            'trainee-phone-error'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }

    clearForms() {
        ['trainee-phone-form', 'trainee-signup-form', 'trainee-verify-form'].forEach(id => {
            const form = document.getElementById(id);
            if (form) form.reset();
        });
    }

    // ======================
    // PHONE CHECK / LOGIN
    // ======================
    async handlePhoneSubmit() {
        const raw = document.getElementById('trainee-phone')?.value;
        const digits = (raw || '').replace(/\D/g, '').slice(-10);
        const country = document.getElementById('trainee-phone-country')?.value || '+91';
        const fullPhone = `${country}${digits}`;
        const errorEl = document.getElementById('trainee-phone-error');

        if (!digits || !/^[6-9]\d{9}$/.test(digits)) {
            if (errorEl) { errorEl.textContent = 'Enter a valid Indian phone number (e.g. +91 9876543210).'; errorEl.classList.remove('hidden'); }
            return;
        }

        const btn = document.querySelector('#trainee-phone-form button');
        if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

        try {
            const data = await traineeApi.requestPhoneOtp(fullPhone);

            if (data && data.needsSignup === true) {
                // Phone not registered — redirect to signup with phone pre-filled
                const phoneInput = document.getElementById('trainee-signup-phone');
                if (phoneInput) phoneInput.value = digits;
                this._pendingPhone = fullPhone;
                errorEl?.classList.add('hidden');
                showSuccessToast('Phone not registered. Fill in your details to continue.');
                this.showSignup();
                return;
            }

            // Phone is registered — OTP was sent via SMS
            this._pendingPhone = fullPhone;
            this._pendingEmail = data.email || null;
            this._isSignupFlow = false;
            errorEl?.classList.add('hidden');
            showSuccessToast('OTP sent to your mobile!');
            this.showVerify(fullPhone, data.otp || null);
        } catch (err) {
            if (errorEl) { errorEl.textContent = err.message || 'Failed to process phone number.'; errorEl.classList.remove('hidden'); }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Continue'; }
        }
    }

    // ======================
    // GOOGLE LOGIN
    // ======================
    async handleGoogleLogin() {
        const errorEl = document.getElementById('trainee-login-error');

        const GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || null;

        if (GOOGLE_CLIENT_ID && typeof google !== 'undefined' && google.accounts) {
            // Production: use Google Identity Services
            google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: async (response) => {
                    if (response.credential) {
                        await this._processGoogleCredential(response.credential);
                    }
                },
            });
            google.accounts.id.prompt();
        } else {
            // Mock/dev mode: prompt for email
            const mockEmail = window.prompt(
                'Google Auth (Mock Mode)\n\nEnter your email to simulate Google login:',
                'trainee@sporekart.com'
            );
            if (!mockEmail || !mockEmail.trim()) return;

            // Encode as base64 JSON payload for mock verification on backend
            const payload = JSON.stringify({
                email: mockEmail.trim(),
                name: window.prompt('Enter your full name (for signup pre-fill):', 'Trainee User') || '',
            });
            const credential = btoa(payload);
            await this._processGoogleCredential(credential);
        }
    }

    async _processGoogleCredential(credential) {
        const errorEl = document.getElementById('trainee-login-error');

        const btn = document.getElementById('btn-trainee-google');
        if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

        try {
            const data = await traineeApi.googleLogin(credential);

            if (data && data.needsSignup === true) {
                // Google account not registered — pre-fill signup
                const nameInput = document.getElementById('trainee-signup-name');
                const emailInput = document.getElementById('trainee-signup-email');
                if (nameInput && data.fullName) nameInput.value = data.fullName;
                if (emailInput && data.email) emailInput.value = data.email;
                this._pendingEmail = data.email || null;
                this._pendingFullName = data.fullName || null;
                errorEl?.classList.add('hidden');
                showSuccessToast('Complete your registration to continue.');
                this.showSignup();
                return;
            }

            // Registered — login directly
            clearAuth();
            saveAuth(data.token, data.user);
            this.close();
            showSuccessToast('Welcome back, Trainee!');
            if (this.onSuccessCallback) this.onSuccessCallback();
            const userName = data.user?.fullName || data.user?.full_name || 'Valued Cultivator';
            showPopupModal({
                title: '🎉 Welcome!',
                message: `Hello ${userName}, welcome to your training dashboard!`,
                duration: 2000,
                refreshOnClose: true,
            });
        } catch (err) {
            if (errorEl) { errorEl.textContent = err.message || 'Google sign in failed.'; errorEl.classList.remove('hidden'); }
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-brands fa-google" style="color:#4285F4"></i> Sign in with Google'; }
        }
    }

    // ======================
    // SIGNUP
    // ======================
    async handleSignup() {
        const fullName = document.getElementById('trainee-signup-name')?.value.trim();
        const phone = document.getElementById('trainee-signup-phone')?.value.trim();
        const email = document.getElementById('trainee-signup-email')?.value.trim();
        const roleType = document.getElementById('trainee-signup-role')?.value;
        const stateVal = document.getElementById('trainee-signup-state')?.value;
        const city = document.getElementById('trainee-signup-city')?.value;
        const errorEl = document.getElementById('trainee-signup-error');

        const nameErr = getFieldError('name', fullName);
        if (nameErr) {
            if (errorEl) { errorEl.textContent = nameErr; errorEl.classList.remove('hidden'); }
            return;
        }

        const emailErr = getFieldError('email', email);
        if (emailErr) {
            if (errorEl) { errorEl.textContent = emailErr; errorEl.classList.remove('hidden'); }
            return;
        }

        const phoneErr = getFieldError('phone', phone);
        if (phoneErr) {
            if (errorEl) { errorEl.textContent = phoneErr; errorEl.classList.remove('hidden'); }
            return;
        }

        const roleErr = getFieldError('role', roleType);
        if (roleErr) {
            if (errorEl) { errorEl.textContent = roleErr; errorEl.classList.remove('hidden'); }
            return;
        }

        const stateErr = getFieldError('state', stateVal);
        if (stateErr) {
            if (errorEl) { errorEl.textContent = stateErr; errorEl.classList.remove('hidden'); }
            return;
        }

        const cityErr = getFieldError('city', city);
        if (cityErr) {
            if (errorEl) { errorEl.textContent = cityErr; errorEl.classList.remove('hidden'); }
            return;
        }

        const btn = document.querySelector('#trainee-signup-form button');
        if (btn) { btn.disabled = true; btn.textContent = 'Registering...'; }

        try {
            const data = await traineeApi.signup({ fullName, phone, email, roleType, city, state: stateVal });

            // Signup succeeded — OTP was auto-sent via SMS
            this._pendingPhone = data.phone || phone;
            this._pendingEmail = data.email || email;
            this._isSignupFlow = true;
            showSuccessToast('Account created! Verify OTP to login.');
            this.showVerify(data.phone || phone, data.otp || null);
        } catch (err) {
            const message = (err.message || '').toLowerCase();
            if (message.includes('already registered') || message.includes('already exists') || message.includes('already taken')) {
                showSuccessToast('You already have an account! Please login.');
                this.showLogin();
                return;
            }
            if (errorEl) { errorEl.textContent = err.message || 'Registration failed. Please try again.'; errorEl.classList.remove('hidden'); }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Register & Continue'; }
        }
    }

    // ======================
    // VERIFY OTP
    // ======================
    async handleVerifyOtp() {
        const otp = document.getElementById('trainee-otp')?.value.trim();
        const errorEl = document.getElementById('trainee-verify-error');

        const otpErr = getFieldError('otp', otp);
        if (otpErr) {
            if (errorEl) { errorEl.textContent = otpErr; errorEl.classList.remove('hidden'); }
            return;
        }

        const btn = document.querySelector('#trainee-verify-form button');
        if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

        try {
            clearAuth();

            // Always verify using phone number (supports login + post-signup)
            const phone = this._pendingPhone;
            if (!phone) {
                if (errorEl) { errorEl.textContent = 'Session expired. Please go back and try again.'; errorEl.classList.remove('hidden'); }
                return;
            }

            const data = await traineeApi.verifyPhoneOtp(phone, otp);

            saveAuth(data.token, data.user);
            this.close();
            showSuccessToast('Welcome, Trainee!');
            if (this.onSuccessCallback) this.onSuccessCallback();
            const userName = data.user?.fullName || data.user?.full_name || 'Valued Cultivator';
            showPopupModal({
                title: '🎉 Welcome!',
                message: `Hello ${userName}, welcome to your training dashboard!`,
                duration: 2000,
                refreshOnClose: true,
            });
        } catch (err) {
            if (errorEl) { errorEl.textContent = err.message || 'OTP verification failed.'; errorEl.classList.remove('hidden'); }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Verify & Login'; }
        }
    }
}

// Lazy singleton
let _traineeAuthModalInstance = null;
export const traineeAuthModal = {
    open: (onSuccess) => {
        if (!_traineeAuthModalInstance) _traineeAuthModalInstance = new TraineeAuthModal();
        _traineeAuthModalInstance.open(onSuccess);
    },
    close: () => {
        if (_traineeAuthModalInstance) _traineeAuthModalInstance.close();
    },
};
