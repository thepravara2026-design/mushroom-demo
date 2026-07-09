import { state, clearAuth } from './state.js';
import { authApi } from '../api/authApi.js';

export function isAuthenticated() {
  return Boolean(state && state.token && state.user);
}

export function isAdmin() {
  return isAuthenticated() && state.user.role === 'admin';
}

export function getAuthState() {
  return { token: state.token, user: state.user };
}

export function requireAdmin() {
  return isAuthenticated() && state.user && state.user.role === 'admin';
}

function showLoading(container) {
  if (!container) return;
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;padding:40px;gap:16px;">
      <div class="spinner" style="width:48px;height:48px;border:4px solid rgba(56,177,123,0.15);border-top-color:#38b17b;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <p style="color:var(--color-text-muted);font-size:1rem;">Verifying access…</p>
    </div>
    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  `;
}

export function showForbidden(container) {
  if (!container) return;
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:40px;text-align:center;">
      <i class="fa-solid fa-shield-halved" style="font-size:4rem;color:#dc2626;margin-bottom:16px;"></i>
      <h2 style="color:#1a1a2e;margin:0 0 8px;">403 — Access Denied</h2>
      <p style="color:var(--color-text-muted);max-width:400px;margin-bottom:24px;">
        You do not have the required permissions to access this area.
        Only administrators with the correct role can view this page.
      </p>
      <a href="/" class="btn btn-primary" style="text-decoration:none;">
        <i class="fa-solid fa-store"></i> Back to Shop
      </a>
    </div>
  `;
}

export function showLoginPrompt(container, redirectHash) {
  if (!container) return;
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:40px;text-align:center;">
      <i class="fa-solid fa-lock" style="font-size:4rem;color:#38b17b;margin-bottom:16px;"></i>
      <h2 style="color:#1a1a2e;margin:0 0 8px;">Authentication Required</h2>
      <p style="color:var(--color-text-muted);max-width:400px;margin-bottom:24px;">
        Please log in with an administrator account to access this section.
      </p>
      <button class="btn btn-primary" id="btn-login-redirect" style="cursor:pointer;">
        <i class="fa-solid fa-right-to-bracket"></i> Login as Admin
      </button>
    </div>
  `;
  const loginBtn = container.querySelector('#btn-login-redirect');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const { authModal } = await import('../components/AuthModal.js');
      authModal.open('buyer', () => {
        window.location.hash = redirectHash || '#admin';
      });
    });
  }
}

export function createLoadingScreen() {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;padding:40px;gap:16px;">
      <div style="width:48px;height:48px;border:4px solid rgba(56,177,123,0.15);border-top-color:#38b17b;border-radius:50%;animation:adminspin 0.8s linear infinite;"></div>
      <p style="color:var(--color-text-muted);font-size:1rem;">Loading administration…</p>
    </div>
    <style>
      @keyframes adminspin { to { transform: rotate(360deg); } }
    </style>
  `;
}

export async function verifyAdminSession() {
  if (!state.token) return false;
  try {
    const user = await authApi.getMe();
    if (user && user.role === 'admin') {
      state.user = user;
      return true;
    }
  } catch (err) {
    clearAuth();
  }
  return false;
}
