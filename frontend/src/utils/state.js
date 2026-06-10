export const state = {
  token: localStorage.getItem('jwt_token') || null,
  user: JSON.parse(localStorage.getItem('user_data')) || null,
  cart: JSON.parse(localStorage.getItem('cart_data')) || [],
  products: [],
  orders: [],
  activePromo: null,
  promoDiscountPct: 0,
  shippingCharge: 0,
  activeTrackingId: null,
  activeCategory: 'all'
};

export function saveAuth(token, user) {
  state.token = token;
  state.user = user;
  if (token) {
    localStorage.setItem('jwt_token', token);
    localStorage.setItem('user_data', JSON.stringify(user));
  } else {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_data');
  }
}

export function saveCart() {
  localStorage.setItem('cart_data', JSON.stringify(state.cart));
}

export function clearAuth() {
  saveAuth(null, null);
  state.orders = [];
  state.cart = [];
  saveCart();
}

// Save or update a user profile without touching auth token (used for guest/local profiles)
export function saveUserProfile(user) {
  state.user = user || null;
  if (user) {
    localStorage.setItem('user_data', JSON.stringify(user));
  } else {
    localStorage.removeItem('user_data');
  }
}

// Delete local profile (and optionally remote account if implemented)
export function deleteUserProfile() {
  state.user = null;
  localStorage.removeItem('user_data');
}
