import { fetchWithAuth, API_BASE } from './http.js';
import { state } from '../utils/state.js';

/**
 * Authentication API helpers.
 * All requests go to the Express backend — never to Supabase directly.
 *
 * Token/user storage delegates to state.js (sessionStorage keys 'jwt_token', 'user_data').
 */
export const authApi = {
  // ── Email+password login ─────────────────────────────────────────────────
  /**
   * Login with email + password.
   * Stores token and user via saveAuth() on success.
   */
  async login({ email, password }) {
    return fetchWithAuth('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  /**
   * Register a new account.
   */
  async register({ email, password, name, role = 'buyer' }) {
    return fetchWithAuth('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, role }),
    });
  },

  /**
   * Logout: clears auth state, optionally revokes Supabase session server-side.
   */
  async logout() {
    try {
      if (state.token) {
        await fetchWithAuth('/auth/logout', { method: 'POST' }).catch(() => {});
      }
    } finally {
      clearAuth();
    }
  },

  // ── Local helpers (backed by state — single source of truth) ────────────
  /**
   * Returns the current user from state, or null.
   */
  getUser() {
    return state.user;
  },

  /** Returns true if a token is present in state. */
  isLoggedIn() {
    return !!state.token;
  },

  /** Returns true if the current user has the 'admin' role. */
  isAdmin() {
    return state.user?.role === 'admin';
  },

  /** Returns the raw token string from state, or null. */
  getToken() {
    return state.token;
  },

  // ── OTP flow (preserved, unchanged) ──────────────────────────────────────
  requestOtp: (email, role, fullName) => fetchWithAuth('/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({ email, role, fullName }),
  }),

  verifyOtp: (email, otpCode, opts = {}) => fetchWithAuth('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otpCode, ...opts }),
  }),

  adminLogin: async (email, password) => {
    return fetchWithAuth('/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  getMe: () => fetchWithAuth('/auth/me'),
};
