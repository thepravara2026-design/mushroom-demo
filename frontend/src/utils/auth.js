import { state, clearAuth } from './state.js';

export function isAuthenticated() {
  return Boolean(state && state.token && state.user);
}

export function getUser() {
  return state.user || null;
}

export function requireRole(role) {
  return (to = () => {}, fallback = () => {}) => {
    if (isAuthenticated() && state.user.role === role) return to();
    return fallback();
  };
}

export function requireAnyRole(roles = []) {
  return (to = () => {}, fallback = () => {}) => {
    if (isAuthenticated() && roles.includes((state.user || {}).role)) return to();
    return fallback();
  };
}

export function logoutAndRedirect() {
  clearAuth();
  window.location.hash = '#shop';
  window.location.reload();
}
