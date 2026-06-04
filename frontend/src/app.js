// SPOREKART CLIENT CONTROLLER

// Global State
let state = {
  user: null,
  token: localStorage.getItem('token') || null,
  products: [],
  cart: JSON.parse(localStorage.getItem('cart')) || [],
  orders: [],
  activePromo: null,
  promoDiscountPct: 0,
  activeTrackingId: null,
  trackingTimer: null
};

// API Base (Handled by Vite proxy, but prefix /api)
const API_BASE = '/api';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadUser();
  fetchProducts();
  updateCartUI();
  initThreeJS();
  initScrollReveal();

  // If hash is present, route to it
  handleRouting();
});

// Routing
window.addEventListener('hashchange', handleRouting);

function handleRouting() {
  const hash = window.location.hash || '#shop';
  const navShop = document.getElementById('btn-nav-shop');
  const navTrack = document.getElementById('btn-nav-track');
  const navAdmin = document.getElementById('btn-nav-admin');
  
  const pageShop = document.getElementById('shop-page');
  const pageTrack = document.getElementById('tracker-page');
  const pageAdmin = document.getElementById('admin-page');
  
  const heroSection = document.getElementById('hero-section');

  // Deactivate all nav links & sections
  navShop.classList.remove('active');
  navTrack.classList.remove('active');
  navAdmin.classList.remove('active');
  
  pageShop.classList.remove('active');
  pageTrack.classList.remove('active');
  pageAdmin.classList.remove('active');

  if (hash === '#shop') {
    navShop.classList.add('active');
    pageShop.classList.add('active');
    heroSection.classList.remove('hidden');
  } else if (hash.startsWith('#track')) {
    // Access validation for tracking (must be grower or admin)
    if (!state.user || (state.user.role !== 'grower' && state.user.role !== 'admin')) {
      window.location.hash = '#shop';
      return;
    }
    
    navTrack.classList.add('active');
    pageTrack.classList.add('active');
    heroSection.classList.add('hidden');
    fetchOrders();

    // Check if tracking specific order from hash (e.g. #track-orderId)
    const match = hash.match(/#track-(.+)/);
    if (match && match[1]) {
      state.activeTrackingId = match[1];
      startTrackingPoll(match[1]);
    }
  } else if (hash === '#admin') {
    // Access validation for admin console
    if (!state.user || state.user.role !== 'admin') {
      window.location.hash = '#shop';
      return;
    }

    navAdmin.classList.add('active');
    pageAdmin.classList.add('active');
    heroSection.classList.add('hidden');
    fetchAdminInventory();
  }
}

// ==========================================================================
// EVENT LISTENERS
// ==========================================================================
function initEventListeners() {
  // Navigation Routing Links
  document.getElementById('btn-nav-shop').addEventListener('click', () => window.location.hash = '#shop');
  
  document.getElementById('btn-nav-track').addEventListener('click', () => {
    if (!state.user) {
      openAuthModal();
      showLoginError("Please log in to view your cultivation support log.");
    } else {
      window.location.hash = '#track';
    }
  });

  document.getElementById('btn-nav-admin').addEventListener('click', () => {
    if (state.user && state.user.role === 'admin') {
      window.location.hash = '#admin';
    }
  });

  document.getElementById('nav-logo').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.hash = '#shop';
  });
  
  document.getElementById('hero-shop-btn').addEventListener('click', () => window.location.hash = '#shop');

  // Auth Modals Open/Close
  document.getElementById('btn-open-auth').addEventListener('click', () => openAuthModal());
  document.getElementById('btn-close-auth').addEventListener('click', () => closeAuthModal());
  document.getElementById('link-to-signup').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthPanel('signup');
  });
  document.getElementById('link-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    toggleAuthPanel('login');
  });

  // Auth Submissions
  document.getElementById('form-login').addEventListener('submit', handleLoginSubmit);
  document.getElementById('form-signup').addEventListener('submit', handleSignupSubmit);

  // Admin Module Submissions
  document.getElementById('form-admin-add-product').addEventListener('submit', handleAdminAddProduct);

  // Cart Slide Out Drawer
  document.getElementById('btn-open-cart').addEventListener('click', () => toggleCartDrawer(true));
  document.getElementById('btn-close-cart').addEventListener('click', () => toggleCartDrawer(false));
  document.getElementById('cart-drawer-overlay').addEventListener('click', () => toggleCartDrawer(false));

  // Promo application
  document.getElementById('btn-apply-promo').addEventListener('click', applyPromoCode);

  // Checkout
  document.getElementById('btn-checkout').addEventListener('click', handleCheckoutInitiation);

  // Calculator
  document.getElementById('btn-calculate-substrate').addEventListener('click', calculateSubstrateMix);

  // General detail modal closure
  document.getElementById('btn-close-detail').addEventListener('click', () => {
    document.getElementById('product-detail-modal').classList.remove('open');
  });

  // Invoice modal closure
  document.getElementById('btn-close-invoice').addEventListener('click', () => {
    document.getElementById('invoice-modal').classList.remove('open');
  });

  // Search input filtering
  document.getElementById('shop-search').addEventListener('input', filterProducts);

  // Category filter button toggles
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterProducts();
    });
  });
}

// ==========================================================================
// USER AUTH CONTROLLERS
// ==========================================================================
async function loadUser() {
  if (!state.token) {
    updateAuthHeaderUI();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    
    if (res.ok) {
      state.user = await res.json();
      updateAuthHeaderUI();
      handleRouting(); // trigger routing refresh for access checks
    } else {
      logout();
    }
  } catch (err) {
    console.error("Auth verify error:", err);
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorPanel = document.getElementById('login-error');
  
  errorPanel.classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (res.ok) {
      saveAuthSession(data.token, data.user);
      closeAuthModal();
      
      // Route based on role
      if (data.user.role === 'admin') {
        window.location.hash = '#admin';
      } else if (data.user.role === 'grower') {
        window.location.hash = '#track';
      } else {
        window.location.hash = '#shop';
      }
    } else {
      showLoginError(data.error || "Login credentials incorrect.");
    }
  } catch (err) {
    showLoginError("Network connection to server failed.");
  }
}

async function handleSignupSubmit(e) {
  e.preventDefault();
  const fullName = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const whatsappNumber = document.getElementById('signup-whatsapp').value;
  const role = document.getElementById('signup-role').value; // account intent
  const password = document.getElementById('signup-password').value;
  const errorPanel = document.getElementById('signup-error');

  errorPanel.classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password, whatsappNumber, role })
    });

    const data = await res.json();
    if (res.ok) {
      saveAuthSession(data.token, data.user);
      closeAuthModal();

      if (data.user.role === 'grower') {
        window.location.hash = '#track';
      } else {
        window.location.hash = '#shop';
      }
    } else {
      errorPanel.textContent = data.error || "Failed to create lab credentials.";
      errorPanel.classList.remove('hidden');
    }
  } catch (err) {
    errorPanel.textContent = "Server communication error.";
    errorPanel.classList.remove('hidden');
  }
}

function saveAuthSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  updateAuthHeaderUI();
  
  // Refresh cart warning state
  document.getElementById('cart-auth-warning').classList.add('hidden');
}

function logout() {
  state.token = null;
  state.user = null;
  state.orders = [];
  if (state.trackingTimer) clearInterval(state.trackingTimer);
  localStorage.removeItem('token');
  updateAuthHeaderUI();
  window.location.hash = '#shop';
}

function updateAuthHeaderUI() {
  const profileSection = document.getElementById('user-profile-section');
  const navTrack = document.getElementById('btn-nav-track');
  const navAdmin = document.getElementById('btn-nav-admin');

  if (state.user) {
    const roleLabel = state.user.role.toUpperCase();
    profileSection.innerHTML = `
      <div class="user-profile-nav">
        <span><i class="fa-solid fa-circle-user text-primary"></i> ${state.user.fullName} <span style="font-size:0.7rem; background:rgba(255,255,255,0.08); padding:0.2rem 0.4rem; border-radius:4px; margin-left:0.25rem;">${roleLabel}</span></span>
        <button class="btn btn-secondary" id="btn-logout" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">
          <i class="fa-solid fa-right-from-bracket"></i> Exit
        </button>
      </div>
    `;
    document.getElementById('btn-logout').addEventListener('click', logout);

    // Toggle navigation visibilities
    if (state.user.role === 'admin') {
      navTrack.style.display = 'inline-flex';
      navAdmin.style.display = 'inline-flex';
    } else if (state.user.role === 'grower') {
      navTrack.style.display = 'inline-flex';
      navAdmin.style.display = 'none';
    } else {
      // Buyer
      navTrack.style.display = 'none';
      navAdmin.style.display = 'none';
    }
  } else {
    profileSection.innerHTML = `
      <button class="btn btn-secondary-glow" id="btn-open-auth">
        <i class="fa-solid fa-user-astronaut"></i> Log In
      </button>
    `;
    document.getElementById('btn-open-auth').addEventListener('click', () => openAuthModal());
    navTrack.style.display = 'none';
    navAdmin.style.display = 'none';
  }
}

function openAuthModal() {
  document.getElementById('auth-modal').classList.add('open');
  toggleAuthPanel('login');
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('open');
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('signup-error').classList.add('hidden');
}

function showLoginError(msg) {
  const errorPanel = document.getElementById('login-error');
  errorPanel.textContent = msg;
  errorPanel.classList.remove('hidden');
}

function toggleAuthPanel(panel) {
  const loginView = document.getElementById('auth-login-view');
  const signupView = document.getElementById('auth-signup-view');
  
  if (panel === 'login') {
    loginView.classList.remove('hidden');
    signupView.classList.add('hidden');
  } else {
    loginView.classList.add('hidden');
    signupView.classList.remove('hidden');
  }
}

// ==========================================================================
// CATALOG CONTROLLERS & DATA FITTING
// ==========================================================================
async function fetchProducts() {
  try {
    const res = await fetch(`${API_BASE}/products`);
    if (res.ok) {
      state.products = await res.json();
      renderProducts(state.products);
    } else {
      document.getElementById('product-grid').innerHTML = `
        <div class="grid-skeleton">
          <i class="fa-solid fa-triangle-exclamation loader-icon" style="color: var(--color-danger)"></i>
          <p>Failed to retrieve lab genetics. Re-attempting connection...</p>
        </div>
      `;
    }
  } catch (err) {
    console.error("Products fetch error:", err);
  }
}

function renderProducts(productsList) {
  const grid = document.getElementById('product-grid');
  
  if (!productsList.length) {
    grid.innerHTML = `
      <div class="grid-skeleton">
        <i class="fa-solid fa-magnifying-glass loader-icon"></i>
        <p>No compatible genetics match your search criteria.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = productsList.map((prod, idx) => {
    // Label translations
    const catLabel = prod.category === 'spawn' ? 'Spawn & Seeds' : 'Mushroom';
    
    return `
      <div class="product-card reveal-element" data-id="${prod.id}" style="transition-delay: ${idx * 0.05}s">
        <div class="product-img-wrapper">
          <img src="${prod.image_url}" alt="${prod.name}" loading="lazy">
          <div class="product-tags">
            <span class="tag tag-difficulty ${prod.difficulty.toLowerCase()}">${prod.difficulty}</span>
          </div>
          <span class="product-gst-badge">${prod.gst_rate}% GST</span>
        </div>
        <div class="product-info">
          <span class="product-category-lbl">${catLabel}</span>
          <h3>${prod.name}</h3>
          <p class="product-desc">${prod.description}</p>
          <div class="product-card-footer">
            <span class="product-price">₹${prod.price.toFixed(2)}</span>
            <button class="btn-card-add" data-id="${prod.id}">
              <i class="fa-solid fa-cart-plus"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Stagger reveal animation trigger
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll('.product-grid .product-card').forEach(card => {
        card.classList.add('revealed');
      });
    }, 50);
  });

  // Add click events for product modals and add buttons
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-card-add')) return;
      const id = card.getAttribute('data-id');
      openProductDetails(id);
    });
  });

  document.querySelectorAll('.btn-card-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      addToCart(id);
    });
  });
}

function filterProducts() {
  const query = document.getElementById('shop-search').value.toLowerCase();
  const selectedCat = document.querySelector('.cat-btn.active').getAttribute('data-category');

  let filtered = state.products;

  if (selectedCat !== 'all') {
    filtered = filtered.filter(p => p.category === selectedCat);
  }

  if (query.trim() !== '') {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query));
  }

  renderProducts(filtered);
}

async function openProductDetails(id) {
  const modal = document.getElementById('product-detail-modal');
  const body = document.getElementById('detail-modal-body');

  body.innerHTML = `
    <div style="grid-column: 1/-1; display:flex; justify-content:center; align-items:center; padding: 4rem;">
      <i class="fa-solid fa-spinner fa-spin loader-icon"></i>
    </div>
  `;
  modal.classList.add('open');

  try {
    const res = await fetch(`${API_BASE}/products/${id}`);
    if (!res.ok) throw new Error("Failed to load details");
    
    const product = await res.json();
    
    let metaHTML = '';
    if (product.growthMetadata && Object.keys(product.growthMetadata).length) {
      const meta = product.growthMetadata;
      metaHTML = `
        <div class="growth-stats-table">
          <div class="stat-row">
            <span class="stat-lbl"><i class="fa-solid fa-temperature-half"></i> Temperature</span>
            <span class="stat-val">${meta.tempRange}</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl"><i class="fa-solid fa-droplet"></i> Relative Humidity</span>
            <span class="stat-val">${meta.humidity}</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl"><i class="fa-solid fa-hourglass-start"></i> Spawn Run Time</span>
            <span class="stat-val">${meta.incubationTime}</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl"><i class="fa-solid fa-clock"></i> Fruiting Harvest</span>
            <span class="stat-val">${meta.fruitingTime}</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl"><i class="fa-solid fa-wheat-awn"></i> Substrate Medium</span>
            <span class="stat-val">${meta.substrate}</span>
          </div>
        </div>
      `;
    } else {
      metaHTML = `
        <div class="growth-stats-table">
          <div class="stat-row">
            <span class="stat-lbl"><i class="fa-solid fa-circle-info"></i> Product Code</span>
            <span class="stat-val">${product.id}</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl"><i class="fa-solid fa-circle-check"></i> Stock Status</span>
            <span class="stat-val">${product.stock > 0 ? 'In Stock' : 'Out of Stock'}</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl"><i class="fa-solid fa-percent"></i> Tax Rate</span>
            <span class="stat-val">${product.gst_rate}% GST (Category: ${product.category})</span>
          </div>
        </div>
      `;
    }

    body.innerHTML = `
      <div class="detail-img-col">
        <img src="${product.image_url}" alt="${product.name}">
      </div>
      <div class="detail-info-col">
        <span class="product-category-lbl">${product.category}</span>
        <h3>${product.name}</h3>
        <span class="detail-price">₹${product.price.toFixed(2)}</span>
        <p style="font-size: 0.95rem; color: var(--color-text-muted); line-height: 1.6;">${product.description}</p>
        
        ${metaHTML}

        <button class="btn btn-primary" id="btn-modal-add" style="margin-top: 1rem;">
          <i class="fa-solid fa-basket-shopping"></i> Add to Basket
        </button>
      </div>
    `;

    document.getElementById('btn-modal-add').addEventListener('click', () => {
      addToCart(product.id);
      modal.classList.remove('open');
    });

  } catch (err) {
    body.innerHTML = `<p style="color: var(--color-danger); text-align:center; padding: 2rem;">Error retrieving specimen record.</p>`;
  }
}

// ==========================================================================
// BASKET / CART CONTROLLERS
// ==========================================================================
function toggleCartDrawer(open) {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-drawer-overlay');
  
  if (open) {
    drawer.classList.add('open');
    overlay.classList.add('open');
  } else {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }
}

function addToCart(productId) {
  const existing = state.cart.find(item => item.id === productId);
  
  if (existing) {
    existing.quantity += 1;
  } else {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    state.cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image_url: product.image_url,
      gst_rate: product.gst_rate,
      quantity: 1
    });
  }

  saveCart();
  updateCartUI();
  toggleCartDrawer(true);
}

function changeQuantity(productId, delta) {
  const item = state.cart.find(item => item.id === productId);
  if (!item) return;

  item.quantity += delta;
  
  if (item.quantity <= 0) {
    state.cart = state.cart.filter(item => item.id !== productId);
  }

  saveCart();
  updateCartUI();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter(item => item.id !== productId);
  saveCart();
  updateCartUI();
}

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(state.cart));
}

function applyPromoCode() {
  const input = document.getElementById('promo-input').value.toUpperCase().trim();
  const feedback = document.getElementById('promo-message');
  
  feedback.classList.add('hidden');

  if (input === 'SPORE10') {
    state.activePromo = 'SPORE10';
    state.promoDiscountPct = 0.10;
    feedback.textContent = 'Code SPORE10 Active (10% Off)!';
    feedback.style.color = 'var(--color-success)';
    feedback.classList.remove('hidden');
  } else if (input === 'SHROOM20') {
    state.activePromo = 'SHROOM20';
    state.promoDiscountPct = 0.20;
    feedback.textContent = 'Code SHROOM20 Active (20% Off)!';
    feedback.style.color = 'var(--color-success)';
    feedback.classList.remove('hidden');
  } else if (input === '') {
    state.activePromo = null;
    state.promoDiscountPct = 0;
  } else {
    state.activePromo = null;
    state.promoDiscountPct = 0;
    feedback.textContent = 'Invalid Promo Code.';
    feedback.style.color = 'var(--color-danger)';
    feedback.classList.remove('hidden');
  }

  updateCartUI();
}

function updateCartUI() {
  const container = document.getElementById('cart-items-container');
  const countBadge = document.getElementById('cart-count');
  
  const totalCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  countBadge.textContent = totalCount;

  if (state.cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty-message">
        <i class="fa-solid fa-basket-shopping"></i>
        <p>Your basket is barren. Select some genetics or spawn to get growing!</p>
      </div>
    `;
    document.getElementById('ledger-subtotal').textContent = '₹0.00';
    document.getElementById('ledger-discount-row').classList.add('hidden');
    document.getElementById('ledger-tax').textContent = '₹0.00';
    document.getElementById('ledger-total').textContent = '₹0.00';
    return;
  }

  container.innerHTML = state.cart.map(item => {
    return `
      <div class="cart-item">
        <img src="${item.image_url}" alt="${item.name}">
        <div class="cart-item-details">
          <h4>${item.name}</h4>
          <span class="cart-item-price">₹${item.price.toFixed(2)} <span style="font-size:0.75rem; color:var(--color-text-muted);">(${item.gst_rate}% GST)</span></span>
          <div class="cart-item-qty-row">
            <button class="qty-btn" onclick="window.changeQty('${item.id}', -1)">-</button>
            <span class="qty-val">${item.quantity}</span>
            <button class="qty-btn" onclick="window.changeQty('${item.id}', 1)">+</button>
          </div>
        </div>
        <button class="btn-remove-item" onclick="window.removeCartItem('${item.id}')">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
  }).join('');

  let subtotal = 0;
  let gstAmount = 0;

  state.cart.forEach(item => {
    const lineSubtotal = item.price * item.quantity;
    subtotal += lineSubtotal;
    const lineDiscount = lineSubtotal * state.promoDiscountPct;
    const lineDiscountedSubtotal = lineSubtotal - lineDiscount;
    const lineGst = lineDiscountedSubtotal * (item.gst_rate / 100);
    
    gstAmount += lineGst;
  });

  const discountAmount = subtotal * state.promoDiscountPct;
  const netTotal = subtotal - discountAmount + gstAmount;

  document.getElementById('ledger-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
  
  if (discountAmount > 0) {
    document.getElementById('ledger-discount').textContent = `-₹${discountAmount.toFixed(2)}`;
    document.getElementById('ledger-discount-row').classList.remove('hidden');
  } else {
    document.getElementById('ledger-discount-row').classList.add('hidden');
  }

  document.getElementById('ledger-tax').textContent = `₹${gstAmount.toFixed(2)}`;
  document.getElementById('ledger-total').textContent = `₹${netTotal.toFixed(2)}`;
}

window.changeQty = changeQuantity;
window.removeCartItem = removeFromCart;

// ==========================================================================
// CULTIVATION SUBSTRATE CALCULATOR
// ==========================================================================
function calculateSubstrateMix() {
  const volume = parseFloat(document.getElementById('tub-volume').value) || 30;
  const ratio = parseFloat(document.getElementById('spawn-ratio').value) || 0.33;
  const depth = parseFloat(document.getElementById('substrate-depth').value) || 3.5;

  const resultsPanel = document.getElementById('calc-results-panel');

  const depthMultiplier = depth / 3.5;
  const totalBedWeight = volume * 0.18 * depthMultiplier;

  const spawnWeight = totalBedWeight * ratio;
  const substrateWeight = totalBedWeight * (1 - ratio);
  const mistingWater = substrateWeight * 1.35;

  document.getElementById('res-grain-spawn').textContent = `${spawnWeight.toFixed(2)} kg`;
  document.getElementById('res-bulk-substrate').textContent = `${substrateWeight.toFixed(2)} kg`;
  document.getElementById('res-water').textContent = `${mistingWater.toFixed(2)} Liters`;

  resultsPanel.classList.remove('hidden');
}

// ==========================================================================
// CHECKOUT & PAYMENT INTEGRATIONS (FORCE LOGIN BEFORE CHECKOUT)
// ==========================================================================
async function handleCheckoutInitiation() {
  const warning = document.getElementById('cart-auth-warning');
  warning.classList.add('hidden');

  // FORCE USER REGISTRATION/LOGIN BEFORE BUYING
  if (!state.user) {
    warning.textContent = "⚠️ Please register or log in to complete checkout.";
    warning.classList.remove('hidden');
    openAuthModal();
    return;
  }

  // Growers are registered for Cultivation Support, block them from buying or suggest Buyer account
  if (state.user.role === 'grower') {
    warning.textContent = "⚠️ Cultivator profiles are read-only. Please create a Buyer account to purchase spawn.";
    warning.classList.remove('hidden');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/orders/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        items: state.cart.map(item => ({ id: item.id, quantity: item.quantity })),
        promoCode: state.activePromo
      })
    });

    const data = await response.json();
    if (!response.ok) {
      alert(data.error || "Failed to create order.");
      return;
    }

    toggleCartDrawer(false);

    const rzpDetails = data.razorpay;
    const orderRecord = data.order;

    if (rzpDetails.keyId.includes('mockKey') || rzpDetails.keyId.includes('rzp_test_mock')) {
      showMockPaymentModal(rzpDetails, orderRecord);
    } else {
      const options = {
        key: rzpDetails.keyId,
        amount: rzpDetails.amount,
        currency: rzpDetails.currency,
        name: "Sporekart Store",
        description: "Fruiting Spore Seeds Checkout",
        order_id: rzpDetails.orderId,
        handler: async function (response) {
          await completeOrderPayment(
            response.razorpay_order_id,
            response.razorpay_payment_id,
            response.razorpay_signature
          );
        },
        prefill: {
          name: state.user.fullName,
          email: state.user.email,
          contact: state.user.whatsappNumber || ""
        },
        theme: {
          color: "#38b17b"
        }
      };

      const rzp = new Razorpay(options);
      rzp.open();
    }

  } catch (err) {
    console.error("Checkout initiation failed: ", err);
    alert("Connection to billing server timed out.");
  }
}

function showMockPaymentModal(rzpDetails, orderRecord) {
  const mockModal = document.createElement('div');
  mockModal.className = 'modal-overlay open';
  mockModal.id = 'mock-payment-gateway-modal';
  mockModal.style.zIndex = '999';

  mockModal.innerHTML = `
    <div class="modal-card modal-small" style="background:#091410; border:2px solid var(--color-primary);">
      <h3 style="color:var(--color-primary); margin-bottom: 0.5rem;"><i class="fa-solid fa-credit-card"></i> Sporekart Sandboxed Checkout</h3>
      <p style="font-size:0.85rem; color:var(--color-text-muted); margin-bottom:1.5rem;">Running offline development simulator. No real money will be charged.</p>
      
      <div class="growth-stats-table" style="margin-bottom:1.5rem; background:rgba(0,0,0,0.4);">
        <div class="stat-row">
          <span class="stat-lbl">Order ID</span>
          <span class="stat-val" style="font-size:0.75rem;">${rzpDetails.orderId}</span>
        </div>
        <div class="stat-row">
          <span class="stat-lbl">Bill Amount</span>
          <span class="stat-val" style="color:var(--color-accent-gold); font-size:1.1rem;">₹${(rzpDetails.amount / 100).toFixed(2)}</span>
        </div>
      </div>

      <div class="input-field">
        <label>Mock Card Number</label>
        <input type="text" value="4111 2222 3333 4444" disabled>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom: 1.5rem;">
        <div class="input-field" style="margin:0;">
          <label>Expiry Date</label>
          <input type="text" value="12/28" disabled>
        </div>
        <div class="input-field" style="margin:0;">
          <label>CVV</label>
          <input type="text" value="123" disabled>
        </div>
      </div>

      <div style="display:flex; gap:1rem;">
        <button class="btn btn-secondary" id="btn-cancel-mock-pay" style="flex:1; justify-content:center;">Decline</button>
        <button class="btn btn-primary" id="btn-submit-mock-pay" style="flex:2; justify-content:center;">Approve Payment</button>
      </div>
    </div>
  `;

  document.body.appendChild(mockModal);

  document.getElementById('btn-cancel-mock-pay').addEventListener('click', () => {
    mockModal.remove();
    alert("Payment transaction cancelled by user.");
  });

  document.getElementById('btn-submit-mock-pay').addEventListener('click', async () => {
    mockModal.remove();
    const mockPaymentId = `pay_mock_${Math.random().toString(36).substr(2, 9)}`;
    const mockSignature = `sig_mock_${Math.random().toString(36).substr(2, 12)}`;
    
    await completeOrderPayment(rzpDetails.orderId, mockPaymentId, mockSignature);
  });
}

async function completeOrderPayment(orderId, paymentId, signature) {
  try {
    const res = await fetch(`${API_BASE}/orders/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature
      })
    });

    const data = await res.json();
    if (res.ok) {
      state.cart = [];
      saveCart();
      updateCartUI();
      state.activePromo = null;
      state.promoDiscountPct = 0;
      document.getElementById('promo-input').value = '';
      document.getElementById('promo-message').classList.add('hidden');

      alert("Inoculation order completed successfully! Review logs in support dashboard.");
      
      // Admin and Growers get redirected to tracking. Buyers go to shop (as they don't have tracking).
      if (state.user.role === 'admin' || state.user.role === 'grower') {
        window.location.hash = `#track-${data.order.id}`;
      } else {
        window.location.hash = '#shop';
      }
    } else {
      alert("Payment verification failed: " + data.error);
    }
  } catch (err) {
    console.error("Verification error:", err);
    alert("Connection error occurred while confirming payment status.");
  }
}

// ==========================================================================
// CULTIVATION ORDER TRACKER & INVOICES
// ==========================================================================
async function fetchOrders() {
  if (!state.token) return;

  try {
    const res = await fetch(`${API_BASE}/orders/my-orders`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (res.ok) {
      state.orders = await res.json();
      renderOrdersSidebar();
    }
  } catch (err) {
    console.error("Fetch orders failed:", err);
  }
}

function renderOrdersSidebar() {
  const list = document.getElementById('orders-list');
  
  if (!state.orders.length) {
    list.innerHTML = `<p class="no-orders">No active runs found. Purchase cultures or spawn to activate incubator tracking!</p>`;
    return;
  }

  const sorted = [...state.orders].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  list.innerHTML = sorted.map(order => {
    const activeClass = state.activeTrackingId === order.id ? 'active' : '';
    const dateFormatted = new Date(order.created_at).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    
    return `
      <div class="order-sidebar-card ${activeClass}" data-id="${order.id}">
        <div class="order-card-header">
          <span class="order-id-lbl">RUN-${order.id.substring(0, 8).toUpperCase()}</span>
          <span class="order-status-badge ${order.delivery_status}">${order.delivery_status}</span>
        </div>
        <div class="order-card-date">${dateFormatted}</div>
        <div class="order-card-total">₹${order.total.toFixed(2)} (${order.items.length} culture${order.items.length > 1 ? 's' : ''})</div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.order-sidebar-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      window.location.hash = `#track-${id}`;
    });
  });
}

function startTrackingPoll(orderId) {
  if (state.trackingTimer) clearInterval(state.trackingTimer);

  const panelEmpty = document.getElementById('tracking-details-panel');
  const viewActive = document.getElementById('tracker-active-view');
  
  panelEmpty.classList.remove('empty');
  viewActive.classList.remove('hidden');

  pollTrackingData(orderId);

  state.trackingTimer = setInterval(() => {
    pollTrackingData(orderId);
  }, 10000);
}

async function pollTrackingData(orderId) {
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/track`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (!res.ok) throw new Error("Order details unavailable");

    const track = await res.json();
    renderTrackingDetails(track);
  } catch (err) {
    console.error("Poll tracking error:", err);
    document.getElementById('tracker-active-view').innerHTML = `
      <p style="color:var(--color-danger); text-align:center; padding: 2rem;">Cultivation logs could not be loaded.</p>
    `;
  }
}

function renderTrackingDetails(track) {
  const container = document.getElementById('tracker-active-view');
  const dateStr = new Date(track.timestamp).toLocaleTimeString();
  
  const timelineHTML = track.timeline.map(checkpoint => {
    const doneClass = checkpoint.done ? 'done' : '';
    const icon = checkpoint.done ? '<i class="fa-solid fa-circle-check" style="color:var(--color-primary);"></i>' : '<i class="fa-regular fa-circle" style="color:var(--color-text-muted);"></i>';
    
    let timeLabel = '';
    if (checkpoint.time && checkpoint.done) {
      timeLabel = `<span style="font-size:0.7rem; color:var(--color-text-muted); margin-left: auto;">${new Date(checkpoint.time).toLocaleTimeString()}</span>`;
    }
    
    return `
      <div class="checkpoint ${doneClass}">
        <span class="checkpoint-node"></span>
        <div style="display:flex; align-items:center; gap: 0.5rem; width:100%;">
          <span class="checkpoint-title">${checkpoint.label}</span>
          ${icon}
          ${timeLabel}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="tracker-details-header">
      <div>
        <h3>Mycelium Incubator Log</h3>
        <p class="subtitle">Run ID: RUN-${track.orderId.substring(0,8).toUpperCase()} | Stage: <span class="order-status-badge ${track.deliveryStatus}">${track.deliveryStatus}</span></p>
      </div>
      <span style="font-size:0.75rem; color:var(--color-text-muted);">Sync time: ${dateStr}</span>
    </div>

    <div class="progress-container">
      <div class="progress-pct-lbl">MYCELIUM RUN: ${track.progressPercent}%</div>
      <div class="progress-track-bg">
        <div class="progress-bar-fill" style="width: ${track.progressPercent}%"></div>
      </div>
    </div>

    <div class="tracker-status-box">
      <h4>Inoculation Stage Notes</h4>
      <p>${track.trackingMessage}</p>
    </div>

    <div class="timeline-checkpoints">
      ${timelineHTML}
    </div>

    <div class="tracker-details-actions">
      <button class="btn btn-secondary" onclick="window.viewInvoice('${track.orderId}')">
        <i class="fa-solid fa-file-invoice-dollar"></i> Generate Tax Invoice
      </button>
      <button class="btn btn-whatsapp-action" onclick="window.whatsappQuickMessage('${track.orderId}')">
        <i class="fa-brands fa-whatsapp"></i> Update via WhatsApp
      </button>
    </div>
  `;

  document.querySelectorAll('.order-sidebar-card').forEach(card => {
    if (card.getAttribute('data-id') === track.orderId) {
      card.classList.add('active');
      const badge = card.querySelector('.order-status-badge');
      if (badge) {
        badge.textContent = track.deliveryStatus;
        badge.className = `order-status-badge ${track.deliveryStatus}`;
      }
    } else {
      card.classList.remove('active');
    }
  });
}

async function viewInvoice(orderId) {
  const modal = document.getElementById('invoice-modal');
  const paper = document.getElementById('invoice-paper');
  
  paper.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; padding: 4rem;">
      <i class="fa-solid fa-spinner fa-spin loader-icon"></i>
    </div>
  `;
  modal.classList.add('open');

  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/invoice`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (!res.ok) throw new Error("Invoice loading failed");

    const inv = await res.json();
    renderInvoicePaper(inv);
  } catch (err) {
    paper.innerHTML = `<p style="color:var(--color-danger); text-align:center; padding:2rem;">Invoice could not be fetched.</p>`;
  }
}

function renderInvoicePaper(inv) {
  const paper = document.getElementById('invoice-paper');
  const dateFormatted = new Date(inv.invoiceDate).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const itemsRows = inv.items.map((item, idx) => {
    const rate = item.price;
    const qty = item.quantity;
    const lineDiscount = item.discountAmount;
    const taxableValue = (rate * qty) - lineDiscount;
    const cgst = item.gstAmount / 2;
    const sgst = item.gstAmount / 2;
    
    return `
      <tr>
        <td class="text-center">${idx + 1}</td>
        <td><strong>${item.name}</strong><br><span style="font-size:0.75rem; color:#6c757d;">GST Rate: ${item.gstRate}%</span></td>
        <td class="text-right">₹${rate.toFixed(2)}</td>
        <td class="text-center">${qty}</td>
        <td class="text-right">₹${lineDiscount.toFixed(2)}</td>
        <td class="text-right">₹${taxableValue.toFixed(2)}</td>
        <td class="text-right">₹${cgst.toFixed(2)} <span style="font-size:0.7rem; color:#6c757d;">(CGST)</span><br>₹${sgst.toFixed(2)} <span style="font-size:0.7rem; color:#6c757d;">(SGST)</span></td>
        <td class="text-right">₹${item.total.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  const slabs = ['slab5', 'slab12', 'slab18'];
  const gstLedgerHTML = slabs.map(slab => {
    const rates = { slab5: '5%', slab12: '12%', slab18: '18%' };
    const data = inv.gstSummary[slab];
    if (data.taxable === 0) return '';
    return `
      <tr>
        <td>GST @ ${rates[slab]}</td>
        <td class="text-right">₹${data.taxable.toFixed(2)}</td>
        <td class="text-right">₹${data.cgst.toFixed(2)}</td>
        <td class="text-right">₹${data.sgst.toFixed(2)}</td>
        <td class="text-right">₹${data.totalGst.toFixed(2)}</td>
      </tr>
    `;
  }).filter(row => row !== '').join('');

  const activePromoCode = inv.totals.promoCode ? `<span style="font-size:0.8rem; font-weight:600; color:#2a9d8f;">(Code ${inv.totals.promoCode} Applied)</span>` : '';

  paper.innerHTML = `
    <div class="invoice-header-grid">
      <div class="invoice-brand">
        <h2><i class="fa-solid fa-mushroom logo-icon" style="color:#38b17b;"></i> Sporekart Store</h2>
        <p>${inv.seller.address}</p>
        <p><strong>GSTIN:</strong> ${inv.seller.gstin}</p>
        <p><strong>Support:</strong> ${inv.seller.email} | ${inv.seller.phone}</p>
      </div>
      <div class="invoice-meta-col">
        <h3>TAX INVOICE</h3>
        <p>Invoice No: <span>${inv.invoiceNumber}</span></p>
        <p>Invoice Date: <span>${dateFormatted}</span></p>
        <p>Payment Mode: <span>Razorpay Gateway</span></p>
        <p>Status: <span style="color:#2a9d8f; font-weight:bold; text-transform:uppercase;">${inv.paymentStatus}</span></p>
      </div>
    </div>

    <div class="invoice-address-grid">
      <div class="invoice-addr">
        <h4>Billed To (Cultivator)</h4>
        <p><strong>${inv.buyer.name}</strong></p>
        <p>Email: ${inv.buyer.email}</p>
        <p>WhatsApp ID: ${inv.buyer.phone || 'Not Specified'}</p>
      </div>
      <div class="invoice-addr">
        <h4>Lab Dispatch Address</h4>
        <p>Registered Laboratory Location of client</p>
        <p>Shipping logistics: Bio-Thermal Dry Ice Express</p>
      </div>
    </div>

    <table class="invoice-table">
      <thead>
        <tr>
          <th class="text-center" width="5%">#</th>
          <th width="35%">Specimen / Seed Details</th>
          <th class="text-right" width="10%">Unit Rate</th>
          <th class="text-center" width="8%">Qty</th>
          <th class="text-right" width="10%">Discount</th>
          <th class="text-right" width="10%">Taxable Value</th>
          <th class="text-right" width="12%">GST Splits (C+S)</th>
          <th class="text-right" width="10%">Net Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <div class="invoice-summary-grid">
      <div class="invoice-gst-ledger">
        <h4>Tax Slab Computation Ledger</h4>
        <table class="gst-ledger-table">
          <thead>
            <tr>
              <th>GST Slab</th>
              <th class="text-right">Taxable Value</th>
              <th class="text-right">CGST (half)</th>
              <th class="text-right">SGST (half)</th>
              <th class="text-right">Slab Tax Total</th>
            </tr>
          </thead>
          <tbody>
            ${gstLedgerHTML || '<tr><td colspan="5" class="text-center">No applicable taxes computed</td></tr>'}
          </tbody>
        </table>
      </div>
      
      <div class="invoice-totals">
        <div class="invoice-totals-row">
          <span>Incubator Subtotal:</span>
          <span>₹${inv.totals.subtotal.toFixed(2)}</span>
        </div>
        <div class="invoice-totals-row" style="color:#2a9d8f;">
          <span>Applied Discount ${activePromoCode}:</span>
          <span>-₹${inv.totals.discount.toFixed(2)}</span>
        </div>
        <div class="invoice-totals-row">
          <span>Net Tax Collected (GST):</span>
          <span>₹${inv.totals.gstAmount.toFixed(2)}</span>
        </div>
        <div class="invoice-totals-row grand-total">
          <span>Grand Total Payable:</span>
          <span>₹${inv.totals.total.toFixed(2)}</span>
        </div>
      </div>
    </div>

    <div class="invoice-declaration">
      <p>Declaration: This is a computer generated invoice. The spawn seeds and fresh mushrooms sold are subject to standard agricultural taxation rates.</p>
      <p style="margin-top:0.5rem; font-weight:600; color:#14281c;">Thank you for growing with Sporekart!</p>
    </div>
  `;

  const shareText = `Hello Sporekart, check my paid invoice ${inv.invoiceNumber} for ₹${inv.totals.total.toFixed(2)}. I'm tracking my spawn growth at http://localhost:3000/#track-${inv.invoiceNumber.split('-')[1].toLowerCase()}`;
  const whatsappUrl = `https://wa.me/${inv.buyer.phone || '918049913822'}?text=${encodeURIComponent(shareText)}`;
  
  const waBtn = document.getElementById('btn-whatsapp-invoice');
  waBtn.onclick = () => window.open(whatsappUrl, '_blank');
}

function whatsappQuickMessage(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;

  const orderNum = `RUN-${order.id.substring(0,8).toUpperCase()}`;
  const orderItemsStr = order.items.map(i => `${i.name} (x${i.quantity})`).join(', ');
  
  const text = `Hi, I am tracking my Sporekart Run ${orderNum} [${orderItemsStr}]. Mycelium incubator status is: ${order.delivery_status.toUpperCase()}. Live updates at: http://localhost:3000/#track-${order.id}`;
  
  const userWhatsapp = state.user ? state.user.whatsappNumber : '';
  const finalWhatsappNumber = userWhatsapp || '918049913822';

  const url = `https://wa.me/${finalWhatsappNumber}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// ==========================================================================
// ADMIN MODULE OPERATIONS (CRUD FOR PRODUCT CATALOG)
// ==========================================================================
async function fetchAdminInventory() {
  const grid = document.getElementById('admin-inventory-grid');
  grid.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; padding: 2rem; width:100%;">
      <i class="fa-solid fa-spinner fa-spin loader-icon" style="font-size: 1.5rem;"></i>
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/products`);
    if (!res.ok) throw new Error("Failed to load products");

    const products = await res.json();
    
    if (products.length === 0) {
      grid.innerHTML = `<p class="no-orders" style="padding:1.5rem;">No products listed in catalog.</p>`;
      return;
    }

    grid.innerHTML = products.map(prod => {
      const catLabel = prod.category === 'spawn' ? 'Spawn & Seeds' : 'Mushroom';
      return `
        <div class="admin-inventory-item" data-id="${prod.id}">
          <img src="${prod.image_url}" alt="${prod.name}">
          <div class="admin-inv-details">
            <h4>${prod.name}</h4>
            <span style="font-size:0.7rem; color:var(--color-text-muted); text-transform:uppercase;">${catLabel} | GST: ${prod.gst_rate}%</span>
            <div class="admin-inv-price-edit">
              <span>Price: ₹</span>
              <input type="number" step="0.01" class="price-input" value="${prod.price.toFixed(2)}" data-id="${prod.id}">
              <button class="btn-admin-price-update" onclick="window.adminUpdatePrice('${prod.id}')">Update</button>
            </div>
          </div>
          <button class="btn-admin-delete" onclick="window.adminDeleteProduct('${prod.id}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;
    }).join('');

  } catch (err) {
    grid.innerHTML = `<p style="color:var(--color-danger); padding:1rem;">Failed to synchronize active inventory directory.</p>`;
  }
}

async function handleAdminAddProduct(e) {
  e.preventDefault();
  const feedback = document.getElementById('admin-add-feedback');
  feedback.classList.add('hidden');

  const name = document.getElementById('admin-prod-name').value.trim();
  const category = document.getElementById('admin-prod-category').value;
  const description = document.getElementById('admin-prod-desc').value.trim();
  const price = document.getElementById('admin-prod-price').value;
  const gst_rate = document.getElementById('admin-prod-gst').value;
  const difficulty = document.getElementById('admin-prod-difficulty').value;
  const stock = document.getElementById('admin-prod-stock').value;
  const image_url = document.getElementById('admin-prod-image').value.trim();

  try {
    const res = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        name, category, description, price, gst_rate, difficulty, stock, image_url
      })
    });

    const data = await res.json();
    
    if (res.ok) {
      alert(`Specimen "${name}" successfully listed in inventory catalog.`);
      document.getElementById('form-admin-add-product').reset();
      
      // Refresh views
      fetchProducts();
      fetchAdminInventory();
    } else {
      feedback.textContent = data.error || "Failed to publish listing.";
      feedback.classList.remove('hidden');
    }
  } catch (err) {
    console.error("Admin add product error:", err);
    feedback.textContent = "Server communication failure.";
    feedback.classList.remove('hidden');
  }
}

async function adminUpdatePrice(productId) {
  const itemCard = document.querySelector(`.admin-inventory-item[data-id="${productId}"]`);
  if (!itemCard) return;

  const priceInput = itemCard.querySelector('.price-input');
  const newPrice = parseFloat(priceInput.value);

  if (isNaN(newPrice) || newPrice < 0) {
    alert("Please enter a valid positive decimal price.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/products/${productId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ price: newPrice })
    });

    if (res.ok) {
      alert("Inventory listing price successfully adjusted.");
      fetchProducts(); // sync shop catalog
      fetchAdminInventory(); // sync list
    } else {
      const data = await res.json();
      alert(data.error || "Failed to modify item price.");
    }
  } catch (err) {
    console.error("Admin price update error:", err);
    alert("Communication error with server.");
  }
}

async function adminDeleteProduct(productId) {
  if (!confirm("Are you sure you want to permanently delete this product from directory inventory?")) return;

  try {
    const res = await fetch(`${API_BASE}/products/${productId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (res.ok) {
      alert("Product successfully deleted from directory inventory.");
      fetchProducts();
      fetchAdminInventory();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to remove item.");
    }
  } catch (err) {
    console.error("Admin delete product error:", err);
    alert("Server communication error.");
  }
}

window.adminUpdatePrice = adminUpdatePrice;
window.adminDeleteProduct = adminDeleteProduct;

// Bind methods globally
window.viewInvoice = viewInvoice;
window.whatsappQuickMessage = whatsappQuickMessage;

// ==========================================================================
// THREE.JS 3D WEBGL ENGINE & INTERACTIVE PARTICLE SYSTEM
// ==========================================================================
function initThreeJS() {
  const canvas = document.getElementById('hero-three-canvas');
  if (!canvas) return;

  const scene = new THREE.Scene();
  
  const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.z = 4.5;

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  // Layer 1: Emerald/Green Spores
  const particlesCount1 = 900;
  const positions1 = new Float32Array(particlesCount1 * 3);
  const colors1 = new Float32Array(particlesCount1 * 3);
  const greenColor = new THREE.Color('#38b17b');

  for (let i = 0; i < particlesCount1 * 3; i += 3) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = Math.cbrt(Math.random()) * 2.0;

    positions1[i] = r * Math.sin(phi) * Math.cos(theta);
    positions1[i + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions1[i + 2] = r * Math.cos(phi);

    const colorMix = Math.random();
    if (colorMix > 0.85) {
      colors1[i] = 1.0;
      colors1[i + 1] = 0.82;
      colors1[i + 2] = 0.4;
    } else {
      colors1[i] = greenColor.r + (Math.random() - 0.5) * 0.1;
      colors1[i + 1] = greenColor.g + (Math.random() - 0.5) * 0.1;
      colors1[i + 2] = greenColor.b + (Math.random() - 0.5) * 0.1;
    }
  }

  const geometry1 = new THREE.BufferGeometry();
  geometry1.setAttribute('position', new THREE.BufferAttribute(positions1, 3));
  geometry1.setAttribute('color', new THREE.BufferAttribute(colors1, 3));

  const material1 = new THREE.PointsMaterial({
    size: 0.07,
    vertexColors: true,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const sporeCloud1 = new THREE.Points(geometry1, material1);
  scene.add(sporeCloud1);

  // Layer 2: Gold/Amber Spores
  const particlesCount2 = 500;
  const positions2 = new Float32Array(particlesCount2 * 3);
  const colors2 = new Float32Array(particlesCount2 * 3);
  const goldColor = new THREE.Color('#ffd166');

  for (let i = 0; i < particlesCount2 * 3; i += 3) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = Math.cbrt(Math.random()) * 1.3;

    positions2[i] = r * Math.sin(phi) * Math.cos(theta);
    positions2[i + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions2[i + 2] = r * Math.cos(phi);

    colors2[i] = goldColor.r + (Math.random() - 0.5) * 0.05;
    colors2[i + 1] = goldColor.g + (Math.random() - 0.5) * 0.05;
    colors2[i + 2] = goldColor.b + (Math.random() - 0.5) * 0.05;
  }

  const geometry2 = new THREE.BufferGeometry();
  geometry2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));
  geometry2.setAttribute('color', new THREE.BufferAttribute(colors2, 3));

  const material2 = new THREE.PointsMaterial({
    size: 0.05,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const sporeCloud2 = new THREE.Points(geometry2, material2);
  scene.add(sporeCloud2);

  // Central Wireframe Cluster
  const coreGeo = new THREE.IcosahedronGeometry(0.7, 2);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x38b17b,
    wireframe: true,
    transparent: true,
    opacity: 0.25
  });
  const nucleus = new THREE.Mesh(coreGeo, coreMat);
  scene.add(nucleus);

  // Interactive Drag Control
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let dragRotation = { x: 0, y: 0 };

  const handlePointerDown = (e) => {
    isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    previousMousePosition = { x: clientX, y: clientY };
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const deltaMove = {
      x: clientX - previousMousePosition.x,
      y: clientY - previousMousePosition.y
    };

    dragRotation.y += deltaMove.x * 0.007;
    dragRotation.x += deltaMove.y * 0.007;

    previousMousePosition = { x: clientX, y: clientY };
  };

  const handlePointerUp = () => {
    isDragging = false;
  };

  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mousemove', handlePointerMove);
  canvas.addEventListener('mouseup', handlePointerUp);
  canvas.addEventListener('mouseleave', handlePointerUp);

  canvas.addEventListener('touchstart', handlePointerDown, { passive: true });
  canvas.addEventListener('touchmove', handlePointerMove, { passive: true });
  canvas.addEventListener('touchend', handlePointerUp);

  // Scroll linkage Parallax
  let scrollTargetY = 0;
  window.addEventListener('scroll', () => {
    scrollTargetY = window.scrollY;
  }, { passive: true });

  // Window Resize
  const handleResize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height, false);
  };
  window.addEventListener('resize', handleResize);

  const clock = new THREE.Clock();

  const animate = () => {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();

    sporeCloud1.rotation.y = elapsedTime * 0.08 + dragRotation.y;
    sporeCloud1.rotation.x = elapsedTime * 0.03 + dragRotation.x;

    sporeCloud2.rotation.y = -elapsedTime * 0.12 + dragRotation.y;
    sporeCloud2.rotation.x = -elapsedTime * 0.05 + dragRotation.x;

    nucleus.rotation.y = elapsedTime * 0.15 + dragRotation.y;
    nucleus.rotation.x = elapsedTime * 0.1 + dragRotation.x;

    sporeCloud1.position.y = -scrollTargetY * 0.0008;
    sporeCloud2.position.y = -scrollTargetY * 0.0005;
    nucleus.position.y = -scrollTargetY * 0.0003;

    const scaleFactor = 1.0 + Math.sin(elapsedTime * 2.0) * 0.05;
    nucleus.scale.set(scaleFactor, scaleFactor, scaleFactor);

    renderer.render(scene, camera);
  };

  animate();
}

// ==========================================================================
// SCROLL-REVEAL OBSERVATION SYSTEM
// ==========================================================================
function initScrollReveal() {
  const targets = [
    document.querySelector('.section-header'),
    document.querySelector('.category-filters-row'),
    document.getElementById('calculator-anchor'),
    document.querySelector('.tracker-layout'),
    document.querySelector('.calc-header')
  ].filter(el => el !== null);

  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        obs.unobserve(entry.target);
      }
    });
  }, observerOptions);

  targets.forEach(target => {
    target.classList.add('reveal-element');
    observer.observe(target);
  });
}
