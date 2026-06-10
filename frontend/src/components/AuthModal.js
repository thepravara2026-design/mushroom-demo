import { authApi } from '../api/authApi.js';
import { saveAuth, state } from '../utils/state.js';

export class AuthModal {
  constructor() {
    this.modal = document.getElementById('auth-modal');

    // Views
    this.methodView  = document.getElementById('auth-method-view');
    this.phoneView   = document.getElementById('auth-phone-view');
    this.requestView = document.getElementById('auth-request-view');
    this.verifyView  = document.getElementById('auth-verify-view');
    this.adminPasswordView = document.getElementById('auth-admin-password-view');

    // Forms
    this.formRequest      = document.getElementById('form-request-otp');
    this.formVerify       = document.getElementById('form-verify-otp');
    this.formPhoneRequest = document.getElementById('form-request-phone-otp');
    this.formAdminLogin   = document.getElementById('form-admin-login');

    // Inputs
    this.emailInput  = document.getElementById('auth-email');
    this.otpInput    = document.getElementById('auth-otp');
    this.nameField   = document.getElementById('auth-name-field');
    this.nameInput   = document.getElementById('auth-fullname');
    this.phoneInput  = document.getElementById('auth-phone');
    this.phoneCountry = document.getElementById('auth-phone-country');
    this.phoneNameField = document.getElementById('auth-phone-name-field');
    this.adminEmailInput = document.getElementById('admin-email');
    this.adminPasswordInput = document.getElementById('admin-password');

    // Error containers
    this.requestError = document.getElementById('request-error');
    this.verifyError  = document.getElementById('verify-error');
    this.phoneError   = document.getElementById('phone-request-error');
    this.adminLoginError = document.getElementById('admin-login-error');

    // Gating state
    this.currentRole = 'buyer';
    this.onSuccessCallback = null;
    this.activeMethod = 'email'; // 'email' | 'phone' | 'google'
    this._pendingContact = null; // email or phone used for verify step

    this.bindEvents();
  }

  bindEvents() {
    // Close button
    document.getElementById('btn-close-auth')?.addEventListener('click', () => this.close());

    // Method selector buttons
    document.getElementById('btn-auth-google')?.addEventListener('click', () => this.handleGoogleLogin());
    document.getElementById('btn-auth-phone')?.addEventListener('click', () => this.showPhoneView());
    document.getElementById('btn-auth-email')?.addEventListener('click', () => this.showEmailView());

    // Admin password login
    document.getElementById('link-admin-password')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showAdminPasswordView();
    });

    document.getElementById('link-back-admin')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showMethodView();
    });

    // Back navigation
    document.getElementById('link-back-method-phone')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showMethodView();
    });
    document.getElementById('link-back-method-email')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showMethodView();
    });
    document.getElementById('link-back-request')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.activeMethod === 'phone') this.showPhoneView();
      else this.showEmailView();
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
        if (preview && imgInput.value) {
          preview.innerHTML = `<img src="${imgInput.value}" alt="Preview" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-image\\'></i><span>Invalid image URL</span>'">`;
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

    // Name fields only for grower registration
    if (this.nameField) this.nameField.style.display = role === 'grower' ? 'block' : 'none';
    if (this.phoneNameField) this.phoneNameField.style.display = role === 'grower' ? 'block' : 'none';

    const backBtn = document.getElementById('link-back-method-email');
    if (backBtn) {
      if (role === 'grower') backBtn.classList.add('hidden');
      else backBtn.classList.remove('hidden');
    }

    // Default to method view for buyer/grower, can switch to admin password via link
    if (role === 'grower') {
      this.showEmailView();
    } else {
      this.showMethodView();
    }
    this.modal.classList.add('open');
  }

  close() {
    this.modal.classList.remove('open');
    this.formRequest?.reset();
    this.formVerify?.reset();
    this.formPhoneRequest?.reset();
    this.formAdminLogin?.reset();
    this.requestError?.classList.add('hidden');
    this.verifyError?.classList.add('hidden');
    this.phoneError?.classList.add('hidden');
    this.adminLoginError?.classList.add('hidden');
  }

  showMethodView() {
    this._hide(this.phoneView);
    this._hide(this.requestView);
    this._hide(this.verifyView);
    this._show(this.methodView);
  }

  showPhoneView() {
    this.activeMethod = 'phone';
    this._hide(this.methodView);
    this._hide(this.requestView);
    this._hide(this.verifyView);
    this._show(this.phoneView);
  }

  showEmailView() {
    this.activeMethod = 'email';
    this._hide(this.methodView);
    this._hide(this.phoneView);
    this._hide(this.verifyView);
    this._show(this.requestView);
    this.emailInput?.focus();
  }

  showVerifyView(contact) {
    this._pendingContact = contact;
    this._hide(this.methodView);
    this._hide(this.phoneView);
    this._hide(this.requestView);
    this._hide(this.adminPasswordView);
    this._show(this.verifyView);

    const subtitle = document.getElementById('verify-subtitle');
    if (subtitle) {
      subtitle.textContent = this.activeMethod === 'phone'
        ? `Enter the 6-digit OTP sent to ${contact}`
        : `Enter the 6-digit code sent to ${contact}`;
    }
    this.otpInput?.focus();
  }

  showAdminPasswordView() {
    this._hide(this.methodView);
    this._hide(this.phoneView);
    this._hide(this.requestView);
    this._hide(this.verifyView);
    this._show(this.adminPasswordView);
    this.adminEmailInput?.focus();
  }

  async handleGoogleLogin() {
    // Mock Google OAuth - simulate the flow
    if (!this.methodView) return;

    // Create a temporary processing overlay instead of replacing the full method view.
    const overlay = document.createElement('div');
    overlay.className = 'auth-google-processing-overlay';
    overlay.innerHTML = `
      <div class="auth-google-processing">
        <i class="fa-brands fa-google fa-spin" style="color:#ea4335; animation: spin 1s linear infinite;"></i>
        <strong>Connecting to Google…</strong>
        <p>Please wait while we authenticate you securely</p>
      </div>
    `;
    this.methodView.appendChild(overlay);

    // Add spin keyframe once
    if (!document.getElementById('spin-kf')) {
      const s = document.createElement('style');
      s.id = 'spin-kf';
      s.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
      document.head.appendChild(s);
    }

    // Use a faster mock OAuth response time for better UX
    await new Promise(r => setTimeout(r, 800));

    // Mock successful Google user
    const mockGoogleUser = {
      email: 'googleuser@gmail.com',
      fullName: 'Google User',
      role: this.currentRole
    };

    try {
      // Send to backend using email OTP flow (backend creates user if not exists)
      await authApi.requestOtp(mockGoogleUser.email, this.currentRole, mockGoogleUser.fullName);

      // Auto-verify with the universal code '123456'
      const data = await authApi.verifyOtp(mockGoogleUser.email, '123456');
      saveAuth(data.token, data.user);
      this.removeGoogleOverlay(overlay);
      this.close();
      window.dispatchEvent(new Event('auth:changed'));
      if (this.onSuccessCallback) this.onSuccessCallback();
    } catch (err) {
      this.removeGoogleOverlay(overlay);
      this.showMethodView();
      alert('Google login simulation failed. Try Email OTP instead.');
    }
  }

  removeGoogleOverlay(overlay) {
    if (overlay && overlay.parentElement) {
      overlay.parentElement.removeChild(overlay);
    }
  }

  async handleRequestPhoneOtp() {
    const phone = this.phoneInput?.value.trim();
    const country = this.phoneCountry?.value || '+91';
    const fullPhone = `${country}${phone}`;
    const fullName = document.getElementById('auth-phone-fullname')?.value.trim();

    if (!phone || phone.length < 8) {
      if (this.phoneError) {
        this.phoneError.textContent = 'Please enter a valid phone number.';
        this.phoneError.classList.remove('hidden');
      }
      return;
    }

    const btn = this.formPhoneRequest?.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending OTP…'; }

    try {
      // Use phone as email for backend (mock: phone@phone.sporekart)
        const mockEmail = `${phone.replace(/\D/g, '')}@phone.sporekart`;
      await authApi.requestOtp(mockEmail, this.currentRole, fullName || `User ${phone.slice(-4)}`);
      this.phoneError?.classList.add('hidden');

      // Store mock email for verification step
      this._mockPhoneEmail = mockEmail;
        // Also store last phone (human-readable) to attach to user after verification
        this._lastPhone = fullPhone;
      this.showVerifyView(fullPhone);
    } catch (err) {
      if (this.phoneError) {
        this.phoneError.textContent = err.message || 'Failed to send OTP.';
        this.phoneError.classList.remove('hidden');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send OTP'; }
    }
  }

  async handleRequestEmailOtp() {
    const email = this.emailInput?.value.trim();
    const fullName = this.nameInput?.value.trim();

    const btn = this.formRequest?.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    try {
      await authApi.requestOtp(email, this.currentRole, fullName);
      this.requestError?.classList.add('hidden');
      this.showVerifyView(email);
    } catch (err) {
      if (this.requestError) {
        this.requestError.textContent = err.message;
        this.requestError.classList.remove('hidden');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Get Access Code'; }
    }
  }

  async handleAdminPasswordLogin() {
    const email = this.adminEmailInput?.value.trim();
    const password = this.adminPasswordInput?.value.trim();

    if (!email || !password) {
      if (this.adminLoginError) {
        this.adminLoginError.textContent = 'Please enter both email and password.';
        this.adminLoginError.classList.remove('hidden');
      }
      return;
    }

    const btn = this.formAdminLogin?.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = 'Logging in…'; }

    try {
      const data = await authApi.adminLogin(email, password);
      saveAuth(data.token, data.user);
      this.adminLoginError?.classList.add('hidden');
      this.close();
      window.dispatchEvent(new Event('auth:changed'));
      if (this.onSuccessCallback) this.onSuccessCallback();
    } catch (err) {
      if (this.adminLoginError) {
        this.adminLoginError.textContent = err.message || 'Login failed. Please check your credentials.';
        this.adminLoginError.classList.remove('hidden');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
    }
  }

  async handleVerifyOtp() {
    const otpCode = this.otpInput?.value.trim();

    // Determine contact to verify against
    const contact = this.activeMethod === 'phone'
      ? (this._mockPhoneEmail || this.emailInput?.value.trim())
      : (this.emailInput?.value.trim());

    const btn = this.formVerify?.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

    try {
      const data = await authApi.verifyOtp(contact, otpCode, { loginMethod: this.activeMethod, whatsappNumber: this._lastPhone });
      // Mark login method so profile UI can honor immutability rules
      data.user = data.user || {};
      data.user.loginMethod = this.activeMethod || 'email';
      if (this.activeMethod === 'phone') {
        // Attach phone for display (backend may not persist it in this mock)
        data.user.whatsappNumber = this._lastPhone || data.user.whatsappNumber || '';
      }
      saveAuth(data.token, data.user);
      this.close();
      window.dispatchEvent(new Event('auth:changed'));
      if (this.onSuccessCallback) this.onSuccessCallback();
    } catch (err) {
      if (this.verifyError) {
        this.verifyError.textContent = err.message;
        this.verifyError.classList.remove('hidden');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Verify & Login'; }
    }
  }

  _show(el) { if (el) el.classList.remove('hidden'); }
  _hide(el) { if (el) el.classList.add('hidden'); }
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
  }
};
