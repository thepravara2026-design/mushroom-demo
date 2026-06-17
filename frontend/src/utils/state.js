export const state = {
  token: sessionStorage.getItem('jwt_token') || null,
  user: JSON.parse(sessionStorage.getItem('user_data')) || null,
  cart: JSON.parse(localStorage.getItem('cart_data')) || [],
  products: [],
  orders: [],
  activePromo: null,
  promoDiscountPct: 0,
  shippingCharge: 0,
  activeTrackingId: null,
  activeCategory: 'all',
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
  // Cart is preserved across logout so unfinished shopping survives
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
