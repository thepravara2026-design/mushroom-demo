// Restore persisted session on page load
const savedToken = (() => { try { return sessionStorage.getItem('jwt_token'); } catch { return null; } })();
const savedUser = (() => { try { const u = sessionStorage.getItem('user_data'); return u ? JSON.parse(u) : null; } catch { return null; } })();

// Restore persisted cart from localStorage (only for active sessions)
const savedCart = (() => {
  try {
    if (!savedToken) return [];
    const c = localStorage.getItem('cart_data');
    return c ? JSON.parse(c) : [];
  } catch {
    return [];
  }
})();

export const state = {
  token: savedToken,
  user: savedUser,
  cart: savedCart,
  products: [],
  orders: [],
  activePromo: null,
  promoDiscountPct: 0,
  shippingCharge: 0,
  activeTrackingId: null,
  activeCategory: 'all',
  cartTotal: 0,
};

export function saveAuth(token, user) {
  state.token = token;
  state.user = user;
  if (token) {
    try { sessionStorage.setItem('jwt_token', token); } catch (e) { /* quota */ }
    try { sessionStorage.setItem('user_data', JSON.stringify(user)); } catch (e) { /* quota */ }
  } else {
    sessionStorage.removeItem('jwt_token');
    sessionStorage.removeItem('user_data');
  }
  try {
    window.dispatchEvent(new CustomEvent('auth:changed', { detail: { token, user } }));
  } catch (e) {
    /* ignore */
  }
}

export function saveCart() {
  try { localStorage.setItem('cart_data', JSON.stringify(state.cart)); } catch (e) { /* quota */ }
}

export function clearAuth() {
  saveAuth(null, null);
  state.orders = [];
  state.cart = [];
  try { localStorage.removeItem('cart_data'); } catch (e) { /* quota */ }
}

export function clearCart() {
  state.cart = [];
  saveCart();
}

// Save or update a user profile without touching auth token (used for guest/local profiles)
export function saveUserProfile(user) {
  state.user = user || null;
  if (user) {
    try { sessionStorage.setItem('user_data', JSON.stringify(user)); } catch (e) { /* quota */ }
  } else {
    sessionStorage.removeItem('user_data');
  }
}

// Delete local profile (and optionally remote account if implemented)
export function deleteUserProfile() {
  state.user = null;
  sessionStorage.removeItem('user_data');
}
