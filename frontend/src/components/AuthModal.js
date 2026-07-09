import { authApi } from '../api/authApi.js';
import { saveAuth, clearAuth, saveCart, state } from '../utils/state.js';
import { showErrorToast, showPopupModal } from '../utils/notify.js';
import { isValidIndianPhone, isValidEmail, isValidOtp, getFieldError } from '../utils/validation.js';

export class AuthModal {
  constructor() {
    this.modal = document.getElementById('auth-modal');

    // Views
    this.methodView = document.getElementById('auth-method-view');
    this.phoneView = document.getElementById('auth-phone-view');
    this.requestView = document.getElementById('auth-request-view');
    this.verifyView = document.getElementById('auth-verify-view');
    // Forms
    this.formRequest = document.getElementById('form-request-otp');
    this.formVerify = document.getElementById('form-verify-otp');
    this.formPhoneRequest = document.getElementById('form-request-phone-otp');

    // Inputs
    this.emailInput = document.getElementById('auth-email');
    this.otpInput = document.getElementById('auth-otp');
    this.nameField = document.getElementById('auth-name-field');
    this.nameInput = document.getElementById('auth-fullname');
    this.phoneInput = document.getElementById('auth-phone');
    this.phoneCountry = document.getElementById('auth-phone-country');
    this.phoneNameField = document.getElementById('auth-phone-name-field');

    // Error containers
    this.requestError = document.getElementById('request-error');
    this.verifyError = document.getElementById('verify-error');
    this.phoneError = document.getElementById('phone-request-error');

    // Gating state
    this.currentRole = 'buyer';
    this.onSuccessCallback = null;
    this.activeMethod = 'email'; // 'email' | 'phone'
    this._pendingContact = null; // email or phone used for verify step

    this.bindEvents();
  }

  bindEvents() {
    // Close button
    document
      .getElementById('btn-close-auth')
      ?.addEventListener('click', () => this.close());

    // Method selector buttons
    document
      .getElementById('btn-auth-google')
      ?.addEventListener('click', () => this.handleGoogleLogin());
    document
      .getElementById('btn-auth-phone')
      ?.addEventListener('click', () => this.showPhoneView());
    document
      .getElementById('btn-auth-email')
      ?.addEventListener('click', () => this.showEmailView());

    // Back navigation
    document
      .getElementById('link-back-method-phone')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        this.showMethodView();
      });
    document
      .getElementById('link-back-method-email')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        this.showMethodView();
      });
    document
      .getElementById('link-back-request')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.activeMethod === 'phone') this.showPhoneView();
        else this.showEmailView();
      });

    // Resend OTP
    document
      .getElementById('link-resend-otp')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleResendOtp();
      });

    // Email OTP form
    this.formRequest?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleRequestEmailOtp();
    });

    // Phone OTP form
    this.formPhoneRequest?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleRequestPhoneOtp();
    });

    // Verify OTP form (shared)
    this.formVerify?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleVerifyOtp();
    });

    // Real-time field validation on blur
    if (this.emailInput) {
      this.emailInput.addEventListener('blur', () => {
        const err = getFieldError('email', this.emailInput.value);
        if (this.requestError) {
          this.requestError.textContent = err;
          this.requestError.classList.toggle('hidden', !err);
        }
        this._lookupAndPrefillName(this.emailInput.value.trim(), 'email');
      });
      this.emailInput.addEventListener('input', () => {
        if (this.requestError && !this.requestError.classList.contains('hidden')) {
          const err = getFieldError('email', this.emailInput.value);
          if (!err) this.requestError.classList.add('hidden');
        }
      });
    }

    if (this.phoneInput) {
      this.phoneInput.addEventListener('blur', () => {
        this._lookupAndPrefillName(this.phoneInput.value.trim(), 'phone');
      });
    }

    if (this.otpInput) {
      this.otpInput.addEventListener('blur', () => {
        const err = getFieldError('otp', this.otpInput.value);
        if (this.verifyError) {
          this.verifyError.textContent = err;
          this.verifyError.classList.toggle('hidden', !err);
        }
      });
      this.otpInput.addEventListener('input', () => {
        if (this.verifyError && !this.verifyError.classList.contains('hidden')) {
          const err = getFieldError('otp', this.otpInput.value);
          if (!err) this.verifyError.classList.add('hidden');
        }
      });
    }

  }

  /**
   * Opens the auth modal.
   * @param {string} role 'buyer' or 'grower'
   * @param {function} onSuccess Callback on success
   */
  open(role = 'buyer', onSuccess = null) {
    // If already authenticated, call success immediately
    if (state.token && state.user) {
      if (state.user.role === role || role === 'buyer') {
        this.close();
        if (onSuccess) onSuccess();
        return;
      }
    }

    this.currentRole = role;
    this.onSuccessCallback = onSuccess;

    // Update title and fields based on role
    const titleEl = document.getElementById('auth-modal-title');
    if (titleEl) {
      if (role === 'grower') titleEl.textContent = 'Grower Portal Access';
      else titleEl.textContent = 'Welcome to Sporekart';
    }

    // Name fields stay hidden by default; shown only when lookup pre-fills them or during signup flow

    const backBtn = document.getElementById('link-back-method-email');
    if (backBtn) {
      if (role === 'grower') backBtn.classList.add('hidden');
      else backBtn.classList.remove('hidden');
    }

    const backBtnPhone = document.getElementById('link-back-method-phone');
    if (backBtnPhone) {
      backBtnPhone.classList.remove('hidden');
    }

    this.showMethodView();
    this.modal.classList.add('open');
  }

  close() {
    this._lastPhone = undefined;
    this._mockPhoneEmail = undefined;
    this._pendingContact = null;
    this._lastResendParams = null;
    this.modal.classList.remove('open');
    this.formRequest?.reset();
    this.formVerify?.reset();
    this.formPhoneRequest?.reset();
    this.requestError?.classList.add('hidden');
    this.verifyError?.classList.add('hidden');
    this.phoneError?.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('auth:modal-closed'));
  }

  showMethodView() {
    this._hide(this.phoneView);
    this._hide(this.requestView);
    this._hide(this.verifyView);
    this._show(this.methodView);

    const titleEl = document.getElementById('auth-modal-title');
    if (titleEl) {
      if (this.currentRole === 'grower') titleEl.textContent = 'Grower Portal Access';
      else titleEl.textContent = 'Welcome to Sporekart';
    }
  }

  showPhoneView() {
    this.activeMethod = 'phone';
    this._mockPhoneEmail = undefined;
    this._lastPhone = undefined;
    this._hide(this.methodView);
    this._hide(this.requestView);
    this._hide(this.verifyView);
    this._show(this.phoneView);
  }

  showEmailView() {
    this.activeMethod = 'email';
    this._mockPhoneEmail = undefined;
    this._lastPhone = undefined;
    this._hide(this.methodView);
    this._hide(this.phoneView);
    this._hide(this.verifyView);
    this._show(this.requestView);
    this.emailInput?.focus();
  }

  showVerifyView(contact, mockOtp = null) {
    this._pendingContact = contact;
    this._hide(this.methodView);
    this._hide(this.phoneView);
    this._hide(this.requestView);
    this._show(this.verifyView);

    const subtitle = document.getElementById('verify-subtitle');
    if (subtitle) {
      if (mockOtp) {
        // In mock/dev mode, show the OTP directly in the UI
        subtitle.textContent = `Mock OTP: ${mockOtp} — enter it below to log in`;
      } else {
        const displayContact = this.activeMethod === 'phone'
          ? contact.replace(/^(\+91)?/, '+91 ').trim()
          : contact;
        subtitle.textContent = this.activeMethod === 'phone'
          ? `Enter the 6-digit OTP sent via SMS to ${displayContact}`
          : `Enter the 6-digit code sent to ${displayContact}`;
      }
    }

    // Pre-fill OTP in mock mode for convenience
    const otpInput = this.otpInput;
    if (otpInput && mockOtp) {
      otpInput.value = mockOtp;
      // Auto-submit OTP verification
      setTimeout(() => {
        this.handleVerifyOtp();
      }, 300);
    }

    const backRequestBtn = document.getElementById('link-back-request');
    if (backRequestBtn) {
      if (this.activeMethod === 'phone') {
        backRequestBtn.textContent = '← Change phone number';
      } else if (this.activeMethod === 'email') {
        backRequestBtn.textContent = '← Change email';
      }
    }

    this.otpInput?.focus();

    // Start resend countdown
    this._startResendCountdown();
  }

  _startResendCountdown() {
    if (this._resendTimer) clearInterval(this._resendTimer);
    const link = document.getElementById('link-resend-otp');
    const timer = document.getElementById('resend-timer');
    if (!link || !timer) return;
    let sec = 30;
    timer.textContent = `Resend OTP in ${sec}s`;
    timer.style.display = '';
    link.style.display = 'none';
    this._resendTimer = setInterval(() => {
      sec--;
      if (sec <= 0) {
        clearInterval(this._resendTimer);
        this._resendTimer = null;
        timer.style.display = 'none';
        link.style.display = '';
      } else {
        timer.textContent = `Resend OTP in ${sec}s`;
      }
    }, 1000);
  }

  async handleResendOtp() {
    if (!this._lastResendParams) return;
    const { email, role, fullName, phone } = this._lastResendParams;
    const link = document.getElementById('link-resend-otp');
    if (link) { link.textContent = 'Sending...'; link.style.pointerEvents = 'none'; }
    try {
      const result = await authApi.requestOtp(email, role, fullName || '', phone || '');
      this.showVerifyView(this._pendingContact, result && result.otp ? result.otp : null);
    } catch (err) {
      if (this.verifyError) {
        this.verifyError.textContent = err.message || 'Failed to resend OTP.';
        this.verifyError.classList.remove('hidden');
      }
    } finally {
      if (link) { link.textContent = 'Resend OTP'; link.style.pointerEvents = ''; }
    }
  }

  async handleRequestPhoneOtp() {
    const raw = this.phoneInput?.value;
    const digits = (raw || '').replace(/\D/g, '').slice(-10);
    const country = this.phoneCountry?.value || '+91';
    const fullPhone = `${country}${digits}`;
    const fullName = document
      .getElementById('auth-phone-fullname')
      ?.value.trim();

    if (!digits || !/^[6-9]\d{9}$/.test(digits)) {
      if (this.phoneError) {
        this.phoneError.textContent = 'Enter a valid Indian phone number (digits 6–9, e.g. +91 6123456789).';
        this.phoneError.classList.remove('hidden');
      }
      return;
    }

    const btn = this.formPhoneRequest?.querySelector('button');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending OTP…';
    }

    try {
      // Use phone as email for backend (Joi email() requires a valid TLD)
      const mockEmail = `phone-${digits}@sporekart.com`;
      // Set before the API call so it's available even if request fails
      this._mockPhoneEmail = mockEmail;
      this._lastPhone = fullPhone;

      const resolvedName = fullName || `User ${digits.slice(-4)}`;
      const result = await authApi.requestOtp(
        mockEmail,
        this.currentRole,
        resolvedName,
        fullPhone,
      );
      this._lastResendParams = { email: mockEmail, role: this.currentRole, fullName: resolvedName, phone: fullPhone };
      this.phoneError?.classList.add('hidden');

      this.showVerifyView(fullPhone, result && result.otp ? result.otp : null);
    } catch (err) {
      if (this.phoneError) {
        this.phoneError.textContent = err.message || 'Failed to send OTP.';
        this.phoneError.classList.remove('hidden');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send OTP';
      }
    }
  }

  async handleRequestEmailOtp() {
    const email = this.emailInput?.value.trim();
    const fullName = this.nameInput?.value.trim() || '';

    const emailErr = getFieldError('email', email);
    if (emailErr) {
      if (this.requestError) {
        this.requestError.textContent = emailErr;
        this.requestError.classList.remove('hidden');
      }
      return;
    }

    // Validate name only if provided (optional during login, can be set later in profile)
    if (fullName) {
      const nameErr = getFieldError('name', fullName);
      if (nameErr) {
        if (this.requestError) {
          this.requestError.textContent = nameErr;
          this.requestError.classList.remove('hidden');
        }
        return;
      }
    }

    const btn = this.formRequest?.querySelector('button');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
    }

    try {
      const result = await authApi.requestOtp(email, this.currentRole, fullName);
      this._lastResendParams = { email, role: this.currentRole, fullName };
      this.requestError?.classList.add('hidden');

      this.showVerifyView(email, result && result.otp ? result.otp : null);
    } catch (err) {
      if (this.requestError) {
        this.requestError.textContent = err.message;
        this.requestError.classList.remove('hidden');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Get Access Code';
      }
    }
  }

  async handleVerifyOtp() {
    const otpCode = this.otpInput?.value.trim();

    // Determine contact to verify against
    const contact = this.activeMethod === 'phone'
      ? this._mockPhoneEmail || this._pendingContact
      : this._pendingContact;

    const otpErr = getFieldError('otp', otpCode);
    if (otpErr) {
      if (this.verifyError) {
        this.verifyError.textContent = otpErr;
        this.verifyError.classList.remove('hidden');
      }
      return;
    }

    const btn = this.formVerify?.querySelector('button');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Verifying…';
    }

    try {
      // Preserve cart through auth transition to avoid clearing on checkout
      const _prevCart = state.cart ? [...state.cart] : [];
      const _prevPromo = state.activePromo;
      clearAuth();
      if (_prevCart.length) {
        state.cart = _prevCart;
        state.activePromo = _prevPromo;
        saveCart();
      }
      const data = await authApi.verifyOtp(contact, otpCode, {
        loginMethod: this.activeMethod,
        ...(this.activeMethod === 'phone' ? { whatsappNumber: this._lastPhone } : {}),
      });
      // Mark login method so profile UI can honor immutability rules
      data.user = data.user || {};
      data.user.loginMethod = this.activeMethod || 'email';
      if (this.activeMethod === 'phone') {
        // Attach phone for display (backend may not persist it in this mock)
        data.user.whatsappNumber = this._lastPhone || data.user.whatsappNumber || '';
      }
      saveAuth(data.token, data.user);
      this.close();
      // saveAuth already dispatches auth:changed — no need to dispatch again
      if (this.onSuccessCallback) this.onSuccessCallback();
      const userName = data.user?.fullName || data.user?.full_name || 'Valued Cultivator';
      showPopupModal({
        title: '🎉 Welcome back!',
        message: `Hello ${userName}, glad to see you again!`,
        duration: 2000,
        refreshOnClose: true,
      });
    } catch (err) {
      if (this.verifyError) {
        this.verifyError.textContent = err.message;
        this.verifyError.classList.remove('hidden');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Verify & Login';
      }
    }
  }

  // ======================
  // GOOGLE LOGIN
  // ======================
  async handleGoogleLogin() {
    const GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || null;

    if (GOOGLE_CLIENT_ID && typeof google !== 'undefined' && google.accounts) {
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
      this.showGoogleMockView();
    }
  }

  showGoogleMockView() {
    this._hide(this.phoneView);
    this._hide(this.requestView);
    this._hide(this.verifyView);
    this._hide(this.methodView);

    const container = this.methodView.parentElement;
    if (!container) return;

    let mockView = document.getElementById('auth-google-mock-view');
    if (!mockView) {
      mockView = document.createElement('div');
      mockView.id = 'auth-google-mock-view';
      mockView.className = 'auth-form-panel';
      container.appendChild(mockView);
    }
    mockView.classList.remove('hidden');
    mockView.innerHTML = `
      <div style="text-align:center;margin-bottom:1.25rem;">
        <div style="width:48px;height:48px;background:#e8f5e9;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 0.75rem;font-size:1.2rem;color:#2e7d32;">
          <i class="fa-brands fa-google"></i>
        </div>
        <h3 style="margin:0 0 0.25rem;font-size:1.05rem;">Mock Google Sign In</h3>
        <p style="margin:0;font-size:0.85rem;color:#666;">Enter your details to simulate Google login</p>
      </div>
      <div class="auth-field">
        <label for="google-mock-email">Email</label>
        <input type="email" id="google-mock-email" class="auth-input" placeholder="you@example.com" value="buyer@sporekart.com">
      </div>
      <div class="auth-field" style="margin-top:0.75rem;">
        <label for="google-mock-name">Full Name</label>
        <input type="text" id="google-mock-name" class="auth-input" placeholder="Your name" value="Buyer User">
      </div>
      <div id="google-mock-error" class="auth-error hidden" style="margin-top:0.75rem;"></div>
      <button id="btn-google-mock-submit" class="btn btn-primary btn-block" style="margin-top:1.25rem;width:100%;">Sign in with Google</button>
      <button id="btn-google-mock-back" class="btn btn-secondary btn-block" style="margin-top:0.5rem;width:100%;">← Use a different method</button>
    `;

    document.getElementById('btn-google-mock-submit')?.addEventListener('click', () => this.handleGoogleMockSubmit());
    document.getElementById('btn-google-mock-back')?.addEventListener('click', () => {
      mockView.classList.add('hidden');
      this.showMethodView();
    });
    document.getElementById('google-mock-email')?.focus();
  }

  async handleGoogleMockSubmit() {
    const email = document.getElementById('google-mock-email')?.value.trim();
    const name = document.getElementById('google-mock-name')?.value.trim();
    const errorEl = document.getElementById('google-mock-error');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (errorEl) { errorEl.textContent = 'Enter a valid email address.'; errorEl.classList.remove('hidden'); }
      return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    const btn = document.getElementById('btn-google-mock-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    const payload = JSON.stringify({ email, name: name || '' });
    const credential = btoa(payload);
    await this._processGoogleCredential(credential);
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in with Google'; }
  }

  async _processGoogleCredential(credential) {
    const errorEl = document.getElementById('request-error');
    const btn = document.getElementById('btn-auth-google');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    try {
      const data = await authApi.googleLogin(credential);

      // Preserve cart through auth transition
      const _prevCart = state.cart ? [...state.cart] : [];
      const _prevPromo = state.activePromo;
      clearAuth();
      if (_prevCart.length) {
        state.cart = _prevCart;
        state.activePromo = _prevPromo;
        saveCart();
      }
      saveAuth(data.token, data.user);
      this.close();
      if (this.onSuccessCallback) this.onSuccessCallback();
      const userName = data.user?.fullName || data.user?.full_name || 'Valued Cultivator';
      const { showPopupModal } = await import('../utils/notify.js');
      showPopupModal({
        title: '🎉 Welcome!',
        message: `Hello ${userName}, welcome back!`,
        duration: 2000,
        refreshOnClose: true,
      });
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message || 'Google sign in failed.';
        errorEl.classList.remove('hidden');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-brands fa-google" style="color:#4285F4"></i> Sign in with Google'; }
    }
  }

  _show(el) {
    if (el) el.classList.remove('hidden');
  }

  _hide(el) {
    if (el) el.classList.add('hidden');
  }

  async _lookupAndPrefillName(value, method) {
    if (!value) return;
    if (method === 'phone' && !/^[6-9]\d{9}$/.test(value.replace(/\D/g, '').slice(-10))) return;
    if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return;
    const nameField = method === 'phone'
      ? document.getElementById('auth-phone-fullname')
      : this.nameInput;
    if (!nameField || nameField.value.trim().length >= 2) return;
    try {
      const res = await fetch(`/api/auth/lookup?q=${encodeURIComponent(value)}`);
      if (!res.ok) return;
      const body = await res.json();
      const data = body && body.data ? body.data : body;
      if (data && data.exists && data.fullName) {
        nameField.value = data.fullName;
      }
    } catch { /* silently ignore */ }
  }
}

// Lazy singleton
let _authModalInstance = null;
export const authModal = {
  open: (role, onSuccess) => {
    if (!_authModalInstance) _authModalInstance = new AuthModal();
    _authModalInstance.open(role, onSuccess);
  },
  close: () => {
    if (_authModalInstance) _authModalInstance.close();
  },
};
