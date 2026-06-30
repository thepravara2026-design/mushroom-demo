import { authApi } from '../api/authApi.js';
import { saveAuth, clearAuth, state } from '../utils/state.js';
import { showErrorToast, showSuccessToast, showPopupModal } from '../utils/notify.js';
import { isValidIndianPhone, isValidEmail, isValidOtp, getFieldError } from '../utils/validation.js';

export class AuthModal {
  constructor() {
    this.modal = document.getElementById('auth-modal');

    // Views
    this.methodView = document.getElementById('auth-method-view');
    this.phoneView = document.getElementById('auth-phone-view');
    this.requestView = document.getElementById('auth-request-view');
    this.verifyView = document.getElementById('auth-verify-view');
    this.adminPasswordView = document.getElementById(
      'auth-admin-password-view',
    );

    // Forms
    this.formRequest = document.getElementById('form-request-otp');
    this.formVerify = document.getElementById('form-verify-otp');
    this.formPhoneRequest = document.getElementById('form-request-phone-otp');
    this.formAdminLogin = document.getElementById('form-admin-login');

    // Inputs
    this.emailInput = document.getElementById('auth-email');
    this.otpInput = document.getElementById('auth-otp');
    this.nameField = document.getElementById('auth-name-field');
    this.nameInput = document.getElementById('auth-fullname');
    this.phoneInput = document.getElementById('auth-phone');
    this.phoneCountry = document.getElementById('auth-phone-country');
    this.phoneNameField = document.getElementById('auth-phone-name-field');
    this.adminEmailInput = document.getElementById('admin-email');
    this.adminOtpInput = document.getElementById('admin-otp');

    // Error containers
    this.requestError = document.getElementById('request-error');
    this.verifyError = document.getElementById('verify-error');
    this.phoneError = document.getElementById('phone-request-error');
    this.adminLoginError = document.getElementById('admin-login-error');

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
      .getElementById('btn-auth-phone')
      ?.addEventListener('click', () => this.showPhoneView());
    document
      .getElementById('btn-auth-email')
      ?.addEventListener('click', () => this.showEmailView());

    // Admin password login
    document
      .getElementById('link-admin-password')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        this.showAdminPasswordView();
      });

    document
      .getElementById('link-back-admin')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        this.showMethodView();
      });

    document
      .getElementById('admin-change-email')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        const otpField = document.getElementById('admin-otp-field');
        const emailField = document.getElementById('admin-email-field');
        const subtitleEl = document.getElementById('admin-subtitle');
        const btn = document.getElementById('admin-login-btn');
        if (otpField) otpField.classList.add('hidden');
        if (emailField) emailField.classList.remove('hidden');
        if (subtitleEl) subtitleEl.textContent = 'Enter your admin email to receive OTP';
        if (btn) btn.textContent = 'Send OTP';
        this.adminLoginError?.classList.add('hidden');
      });

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

    // Admin password form
    this.formAdminLogin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleAdminPasswordLogin();
    });

    // Verify OTP form (shared)
    this.formVerify?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleVerifyOtp();
    });

    // Image URL preview on admin form
    const imgInput = document.getElementById('admin-prod-image');
    if (imgInput) {
      imgInput.addEventListener('input', () => {
        const preview = document.getElementById('admin-img-preview');
        if (preview) {
          if (imgInput.value) {
            preview.innerHTML = '';
            const img = document.createElement('img');
            img.src = imgInput.value;
            img.alt = 'Preview';
            img.style.maxWidth = '100%';
            img.style.maxHeight = '200px';
            img.onerror = function () {
              preview.innerHTML = '<i class="fa-solid fa-image"></i><span>Invalid image URL</span>';
            };
            preview.appendChild(img);
          } else {
            preview.innerHTML = '';
          }
        }
      });
    }

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

    if (this.adminEmailInput) {
      this.adminEmailInput.addEventListener('blur', () => {
        const err = getFieldError('email', this.adminEmailInput.value);
        if (this.adminLoginError) {
          this.adminLoginError.textContent = err;
          this.adminLoginError.classList.toggle('hidden', !err);
        }
      });
    }

    if (this.adminOtpInput) {
      this.adminOtpInput.addEventListener('blur', () => {
        const err = getFieldError('otp', this.adminOtpInput.value);
        if (this.adminLoginError) {
          this.adminLoginError.textContent = err;
          this.adminLoginError.classList.toggle('hidden', !err);
        }
      });
    }
  }

  /**
   * Opens the auth modal.
   * @param {string} role 'buyer' or 'grower' (admin login is accessed via the "Staff? Use admin login" link)
   * @param {function} onSuccess Callback on success
   */
  open(role = 'buyer', onSuccess = null) {
    // If already authenticated, call success immediately
    if (state.token && state.user) {
      if (state.user.role === role || role === 'buyer') {
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

    // Always show name field so first-time users can set their profile name
    if (this.nameField) this.nameField.style.display = 'block';
    if (this.phoneNameField) this.phoneNameField.style.display = 'block';

    const backBtn = document.getElementById('link-back-method-email');
    if (backBtn) {
      if (role === 'grower') backBtn.classList.add('hidden');
      else backBtn.classList.remove('hidden');
    }

    const backBtnPhone = document.getElementById('link-back-method-phone');
    if (backBtnPhone) {
      backBtnPhone.classList.remove('hidden');
    }

    const backRequestBtn = document.getElementById('link-back-request');
    if (backRequestBtn) {
      if (role === 'admin') {
        backRequestBtn.textContent = '← Use a different method';
      }
    }

    if (role === 'admin') {
      titleEl.textContent = 'Admin Portal Access';
    } else if (role === 'grower') {
      titleEl.textContent = 'Grower Portal Access';
    }

    // Hide admin login link for buyer role
    const adminLink = document.getElementById('link-admin-password');
    const adminCaution = document.querySelector('.auth-admin-caution');
    if (adminLink) {
      adminLink.style.display = role === 'buyer' ? 'none' : '';
    }
    if (adminCaution) {
      adminCaution.style.display = role === 'buyer' ? 'none' : '';
    }

    if (role === 'admin') {
      this.showAdminPasswordView();
    } else {
      this.showPhoneView();
    }
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
    this.formAdminLogin?.reset();
    this.requestError?.classList.add('hidden');
    this.verifyError?.classList.add('hidden');
    this.phoneError?.classList.add('hidden');
    this.adminLoginError?.classList.add('hidden');

    const emailField = document.getElementById('admin-email-field');
    const otpField = document.getElementById('admin-otp-field');
    const subtitleEl = document.getElementById('admin-subtitle');
    const btn = document.getElementById('admin-login-btn');
    if (emailField) emailField.classList.remove('hidden');
    if (otpField) otpField.classList.add('hidden');
    if (subtitleEl) subtitleEl.textContent = 'Enter your admin email to receive OTP';
    if (btn) btn.textContent = 'Send OTP';
    if (this.adminOtpInput) this.adminOtpInput.value = '';
  }

  showMethodView() {
    this._hide(this.phoneView);
    this._hide(this.requestView);
    this._hide(this.verifyView);
    this._hide(this.adminPasswordView);
    this._show(this.methodView);

    const emailField = document.getElementById('admin-email-field');
    const otpField = document.getElementById('admin-otp-field');
    const subtitleEl = document.getElementById('admin-subtitle');
    const btn = document.getElementById('admin-login-btn');
    if (emailField) emailField.classList.remove('hidden');
    if (otpField) otpField.classList.add('hidden');
    if (subtitleEl) subtitleEl.textContent = 'Enter your admin email to receive OTP';
    if (btn) btn.textContent = 'Send OTP';
    if (this.adminOtpInput) this.adminOtpInput.value = '';
    this.adminLoginError?.classList.add('hidden');
    this.formAdminLogin?.reset();
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
    this._hide(this.adminPasswordView);
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

  showAdminPasswordView() {
    this._hide(this.methodView);
    this._hide(this.phoneView);
    this._hide(this.requestView);
    this._hide(this.verifyView);
    this._show(this.adminPasswordView);

    const emailField = document.getElementById('admin-email-field');
    const otpField = document.getElementById('admin-otp-field');
    const subtitleEl = document.getElementById('admin-subtitle');
    const btn = document.getElementById('admin-login-btn');
    if (emailField) emailField.classList.remove('hidden');
    if (otpField) otpField.classList.add('hidden');
    if (subtitleEl) subtitleEl.textContent = 'Enter your admin email to receive OTP';
    if (btn) btn.textContent = 'Send OTP';

    this.adminLoginError?.classList.add('hidden');
    this.adminEmailInput?.focus();
    if (this.adminOtpInput) this.adminOtpInput.value = '';
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

  async handleAdminPasswordLogin() {
    const email = this.adminEmailInput?.value.trim();

    const emailErr = getFieldError('email', email);
    if (emailErr) {
      if (this.adminLoginError) {
        this.adminLoginError.textContent = emailErr;
        this.adminLoginError.classList.remove('hidden');
      }
      return;
    }

    const btn = document.getElementById('admin-login-btn');
    const otpField = document.getElementById('admin-otp-field');
    const emailField = document.getElementById('admin-email-field');
    const subtitleEl = document.getElementById('admin-subtitle');
    const sentToEl = document.getElementById('admin-otp-sent-to');

    // Check if we are in the OTP verification step
    if (otpField && !otpField.classList.contains('hidden')) {
      const otpCode = this.adminOtpInput?.value.trim();
      const otpErr = getFieldError('otp', otpCode);
      if (otpErr) {
        if (this.adminLoginError) {
          this.adminLoginError.textContent = otpErr;
          this.adminLoginError.classList.remove('hidden');
        }
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verifying…';
      }

      try {
        clearAuth();
        const data = await authApi.adminVerifyOtp(email, otpCode);
        this.adminLoginError?.classList.add('hidden');
        this.close();
        saveAuth(data.token, data.user);
        window.location.href = '/admin.html';
      } catch (err) {
        if (this.adminLoginError) {
          this.adminLoginError.textContent = err.message || 'OTP verification failed.';
          this.adminLoginError.classList.remove('hidden');
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Verify & Login';
        }
      }
      return;
    }

    // Step 1: Send OTP
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending OTP…';
    }

    try {
      const result = await authApi.adminLogin(email);
      this.adminLoginError?.classList.add('hidden');

      // Switch to OTP step
      if (emailField) emailField.classList.add('hidden');
      if (otpField) otpField.classList.remove('hidden');
      if (subtitleEl) subtitleEl.textContent = 'Enter the 6-digit OTP sent to your registered mobile';
      if (btn) btn.textContent = 'Verify & Login';
      showSuccessToast('OTP sent to registered mobile');

      if (result && result.otp) {
        if (sentToEl) sentToEl.textContent = `Demo OTP: ${result.otp}`;
        if (this.adminOtpInput) this.adminOtpInput.value = result.otp;
        // Auto-submit OTP verification
        setTimeout(() => {
          this.handleAdminPasswordLogin();
        }, 300);
      } else if (sentToEl) {
        sentToEl.textContent = 'OTP sent to registered mobile';
      }

      this.adminOtpInput?.focus();
      this.adminOtpInput?.select();
    } catch (err) {
      if (this.adminLoginError) {
        this.adminLoginError.textContent = err.message || 'Failed to send OTP.';
        this.adminLoginError.classList.remove('hidden');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
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
      clearAuth();
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
