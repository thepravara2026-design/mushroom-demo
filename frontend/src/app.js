// SPOREKART CLIENT CONTROLLER
import { state, saveAuth, clearAuth, saveCart } from './utils/state.js';
import { authModal } from './components/AuthModal.js';
import { authApi } from './api/authApi.js';
import { API_BASE, fetchWithAuth } from './api/client.js';

// Attach state to window for existing global functions to work during incremental migration
window.state = state;



// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadUser();
  fetchProducts();
  fetchCategories(); // Load categories for nav + admin
  updateCartUI();
  initThreeJS();
  initScrollReveal();

  // If hash is present, route to it
  handleRouting();

  // Routing — must be inside DOMContentLoaded so DOM is available
  window.addEventListener('hashchange', handleRouting);
});

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

  if (hash === '#shop' || hash === '') {
    navShop.classList.add('active');
    pageShop.classList.add('active');
    if (heroSection) heroSection.classList.remove('hidden');
  } else if (hash.startsWith('#track')) {
    // Access validation for tracking/grower portal
    if (!state.user || (state.user.role !== 'grower' && state.user.role !== 'admin')) {
      window.location.hash = '#shop';
      authModal.open('grower', () => {
        window.location.hash = '#track';
      });
      return;
    }
    
    navTrack.classList.add('active');
    pageTrack.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
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
    if (heroSection) heroSection.classList.add('hidden');
    fetchAdminInventory();
    fetchAdminOrders();
    fetchAdminCategories();
  } else if (hash === '#admin-login') {
    // Hidden Isolated Admin Route
    const adminLoginModal = document.getElementById('admin-login-modal');
    if (adminLoginModal) adminLoginModal.classList.add('open');
    navShop.classList.add('active');
    pageShop.classList.add('active');
  }
}

// ==========================================================================
// EVENT LISTENERS
// ==========================================================================
function initEventListeners() {
  // Navigation Routing Links
  document.getElementById('btn-nav-shop').addEventListener('click', () => window.location.hash = '#shop');
  
  document.getElementById('btn-nav-track').addEventListener('click', (e) => {
    e.preventDefault();
    if (!state.user || (state.user.role !== 'grower' && state.user.role !== 'admin')) {
      authModal.open('grower', () => {
        window.location.hash = '#track';
      });
    } else {
      window.location.hash = '#track';
    }
  });

  // Training Section Explore button -> Grower login gate
  const exploreTrainingBtn = document.querySelector('.btn-training');
  if (exploreTrainingBtn) {
    exploreTrainingBtn.addEventListener('click', (e) => {
      e.preventDefault();
      authModal.open('grower', () => {
        window.location.hash = '#track';
      });
    });
  }

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

  // Listen for global auth changes from new modules
  window.addEventListener('auth:changed', () => {
    updateAuthHeaderUI();
    handleRouting();
  });

  // Admin isolated login form
  document.getElementById('form-admin-auth')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = document.getElementById('admin-auth-email').value;
    const pw = document.getElementById('admin-auth-password').value;
    try {
      const data = await authApi.adminLogin(em, pw);
      saveAuth(data.token, data.user);
      document.getElementById('admin-login-modal').classList.remove('open');
      window.location.hash = '#admin';
      window.dispatchEvent(new Event('auth:changed'));
    } catch (err) {
      alert(err.message);
    }
  });
  
  document.getElementById('btn-close-admin-login')?.addEventListener('click', () => {
    document.getElementById('admin-login-modal').classList.remove('open');
    window.location.hash = '#shop';
  });

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
  const searchInput = document.getElementById('shop-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      filterProducts();
      updateSearchSuggestions(searchInput.value);
    });
    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim()) updateSearchSuggestions(searchInput.value);
    });
  }

  // Close suggestions on outside click
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('topbar-search-wrap');
    if (wrap && !wrap.contains(e.target)) {
      const dd = document.getElementById('search-suggestions-dropdown');
      if (dd) dd.classList.add('hidden');
    }
  });

  // Category filter button toggles – scoped to the visible product filters row only
  document.querySelectorAll('#product-filters-row .cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#product-filters-row .cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeCategory = btn.getAttribute('data-category') || 'all';
      filterProducts();
    });
  });

  // Category nav links in NAVBAR (data-category on nav-link)
  document.querySelectorAll('.nav-link[data-category]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToCategory(link.getAttribute('data-category'));
    });
  });

  // Category links in FOOTER
  document.querySelectorAll('.footer-cat-link[data-category]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToCategory(link.getAttribute('data-category'));
    });
  });

  // Category card "Shop Now" buttons – filter products and scroll to grid
  document.querySelectorAll('.btn-category-shop').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToCategory(btn.getAttribute('data-filter-category'));
    });
  });

  // Admin tab switching
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const contentId = `admin-content-${tab.dataset.tab}`;
      const content = document.getElementById(contentId);
      if (content) content.classList.add('active');

      // Lazy load orders if switching to orders tab
      if (tab.dataset.tab === 'orders') fetchAdminOrders();
    });
  });

  // Admin form image preview
  document.getElementById('admin-prod-image')?.addEventListener('input', function() {
    const preview = document.getElementById('admin-img-preview');
    if (preview) {
      if (this.value) {
        preview.innerHTML = `<img src="${this.value}" alt="Preview" onerror="this.parentElement.innerHTML='<i class=\'fa-solid fa-image\'></i><span>Invalid image URL</span>'">`;
      } else {
        preview.innerHTML = '<i class="fa-solid fa-image"></i><span>Image preview</span>';
      }
    }
  });

  // Admin search/filter in inventory tab
  document.getElementById('admin-search-prod')?.addEventListener('input', renderAdminInventory);
  document.getElementById('admin-filter-cat')?.addEventListener('change', renderAdminInventory);

  // Admin form reset button
  document.getElementById('btn-admin-reset-form')?.addEventListener('click', resetAdminForm);

  // Admin exit-to-shop and logout buttons
  document.getElementById('btn-admin-exit-shop')?.addEventListener('click', () => {
    window.location.hash = '#shop';
  });
  document.getElementById('btn-admin-logout')?.addEventListener('click', () => {
    logout();
  });

  // Admin categories tab switching
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === 'categories') fetchAdminCategories();
    });
  });

  // Admin category form actions
  document.getElementById('btn-admin-save-cat')?.addEventListener('click', handleAdminSaveCategory);
  document.getElementById('btn-admin-reset-cat')?.addEventListener('click', resetAdminCatForm);
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
    const user = await authApi.getMe();
    state.user = user;
    updateAuthHeaderUI();
    handleRouting(); // trigger routing refresh for access checks
  } catch (err) {
    console.error("Auth verify error:", err);
    logout();
  }
}

// Old auth logic fully replaced by modular AuthModal.js

function logout() {
  clearAuth();
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
    document.getElementById('btn-open-auth').addEventListener('click', () => authModal.open('buyer'));
    navTrack.style.display = 'none';
    navAdmin.style.display = 'none';
  }
}

// ==========================================================================
// CATALOG CONTROLLERS & DATA FITTING
// ==========================================================================
async function fetchProducts() {
  try {
    const products = await fetchWithAuth('/products');
    state.products = products;
    renderProducts(state.products);
  } catch (err) {
    console.error("Products fetch error:", err);
    document.getElementById('product-grid').innerHTML = `
      <div class="grid-skeleton">
        <i class="fa-solid fa-triangle-exclamation loader-icon" style="color: var(--color-danger)"></i>
        <p>Failed to retrieve products. Please refresh the page.</p>
      </div>
    `;
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
    const hasMrp = prod.mrp_price && prod.mrp_price > prod.price;
    const discountPct = hasMrp ? Math.round((1 - prod.price / prod.mrp_price) * 100) : 0;
    
    return `
      <div class="product-card reveal-element" data-id="${prod.id}" style="transition-delay: ${idx * 0.05}s">
        <div class="product-img-wrapper">
          <img src="${prod.image_url}" alt="${prod.name}" loading="lazy">
          <div class="product-tags">
            <span class="tag tag-difficulty ${prod.difficulty.toLowerCase()}">${prod.difficulty}</span>
          </div>
          <span class="product-gst-badge">${prod.gst_rate}% GST</span>
          ${hasMrp ? `<span class="product-discount-badge" style="position:absolute;top:10px;right:10px;">${discountPct}% OFF</span>` : ''}
        </div>
        <div class="product-info">
          <span class="product-category-lbl">${catLabel}</span>
          <h3>${prod.name}</h3>
          <p class="product-desc">${prod.description}</p>
          <div class="product-card-footer">
            <div class="product-price-wrap">
              <span class="product-price">₹${prod.price.toFixed(2)}</span>
              ${hasMrp ? `<span class="product-mrp">₹${prod.mrp_price.toFixed(2)}</span>` : ''}
            </div>
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
  const selectedCat = state.activeCategory || 'all';

  let filtered = state.products;

  if (selectedCat && selectedCat !== 'all') {
    filtered = filtered.filter(p => p.category === selectedCat);
  }

  if (query.trim() !== '') {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
    );
  }

  renderProducts(filtered);
}

// Category navigation helper (used by navbar, footer, and category cards)
function navigateToCategory(category) {
  // Ensure shop page is active
  if (!document.getElementById('shop-page').classList.contains('active')) {
    window.location.hash = '#shop';
  }
  
  state.activeCategory = category;

  // Update active filter tab
  document.querySelectorAll('#product-filters-row .cat-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-category') === category);
  });
  
  filterProducts();

  // Scroll to products section
  const productsSection = document.getElementById('products-section');
  if (productsSection) {
    productsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Search autocomplete dropdown
function updateSearchSuggestions(query) {
  const dd = document.getElementById('search-suggestions-dropdown');
  if (!dd) return;
  if (!query.trim() || !state.products.length) {
    dd.classList.add('hidden');
    return;
  }
  
  const matches = state.products.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.description.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 6);
  
  if (!matches.length) {
    dd.innerHTML = `<div class="suggestions-empty"><i class="fa-solid fa-magnifying-glass"></i> No products found for "${query}"</div>`;
    dd.classList.remove('hidden');
    return;
  }
  
  dd.innerHTML = matches.map(p => {
    const hasMrp = p.mrp_price && p.mrp_price > p.price;
    const catLabel = p.category === 'spawn' ? 'Spawn' : 'Mushroom';
    return `
      <div class="suggestion-item" data-id="${p.id}">
        <img src="${p.image_url}" alt="${p.name}">
        <div class="suggestion-item-info">
          <div class="suggestion-item-name">${p.name}</div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span class="suggestion-item-price">₹${p.price.toFixed(2)}</span>
            ${hasMrp ? `<span class="suggestion-item-mrp">₹${p.mrp_price.toFixed(2)}</span>` : ''}
          </div>
        </div>
        <span class="suggestion-item-cat">${catLabel}</span>
      </div>
    `;
  }).join('');
  dd.classList.remove('hidden');
  
  // Wire click events
  dd.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.getAttribute('data-id');
      dd.classList.add('hidden');
      document.getElementById('shop-search').value = '';
      filterProducts();
      openProductDetails(id);
    });
  });
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
        <div class="detail-price-wrap">
          <span class="detail-price">₹${product.price.toFixed(2)}</span>
          ${product.mrp_price && product.mrp_price > product.price ? `
            <span class="detail-mrp">₹${product.mrp_price.toFixed(2)}</span>
            <span class="detail-discount-badge">${Math.round((1 - product.price / product.mrp_price) * 100)}% OFF</span>
          ` : ''}
        </div>
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
    warning.textContent = "⚠️ Please verify your identity to complete checkout.";
    warning.classList.remove('hidden');
    authModal.open('buyer', () => {
      // Upon successful auth, attempt checkout again
      handleCheckoutInitiation();
    });
    return;
  }

  // Growers are registered for Cultivation Support, block them from buying or suggest Buyer account
  if (state.user.role === 'grower') {
    warning.textContent = "⚠️ Cultivator profiles are read-only. Please create a Buyer account to purchase spawn.";
    warning.classList.remove('hidden');
    return;
  }

  try {
    const data = await fetchWithAuth('/orders/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: state.cart.map(item => ({ id: item.id, quantity: item.quantity })),
        promoCode: state.activePromo
      })
    });

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
  // Remove existing if any
  document.getElementById('mock-payment-gateway-modal')?.remove();

  const amount = (rzpDetails.amount / 100).toFixed(2);
  const orderId = rzpDetails.orderId;

  const mockModal = document.createElement('div');
  mockModal.id = 'mock-payment-gateway-modal';
  mockModal.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:9999;
    display:flex; align-items:center; justify-content:center;
    padding:1rem; backdrop-filter:blur(6px);
  `;

  mockModal.innerHTML = `
    <div id="pgw-shell" style="
      width:100%; max-width:820px; max-height:92vh; overflow:hidden;
      background:#0d1f17; border:1px solid rgba(56,177,123,0.25);
      border-radius:16px; display:flex; flex-direction:column;
      box-shadow:0 24px 80px rgba(0,0,0,0.6);
      font-family:'Inter',sans-serif; color:#e2e8f0;
    ">
      <!-- ─── HEADER BAR ─── -->
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding:14px 20px; background:#091410;
        border-bottom:1px solid rgba(56,177,123,0.15);
        flex-shrink:0;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#38b17b,#1a7a52);display:flex;align-items:center;justify-content:center;">
            <i class="fa-solid fa-seedling" style="color:#fff;font-size:14px;"></i>
          </div>
          <div>
            <div style="font-weight:700;font-size:0.95rem;color:#fff;">Sporekart</div>
            <div style="font-size:0.72rem;color:#38b17b;">Secure Checkout Sandbox</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.72rem;color:#94a3b8;margin-bottom:2px;">Amount to Pay</div>
          <div style="font-size:1.4rem;font-weight:800;color:#fbbf24;">₹${amount}</div>
        </div>
      </div>

      <!-- ─── BODY: LEFT TABS + RIGHT PANEL ─── -->
      <div style="display:flex; flex:1; overflow:hidden; min-height:0;">

        <!-- LEFT METHOD LIST -->
        <div style="
          width:200px; flex-shrink:0; background:#091410;
          border-right:1px solid rgba(56,177,123,0.12);
          overflow-y:auto; padding:8px 0;
        ">
          ${[
            { id:'upi',    icon:'fa-mobile-screen-button', label:'UPI',          badge:'Recommended' },
            { id:'card',   icon:'fa-credit-card',          label:'Card',          badge:'' },
            { id:'netbank',icon:'fa-building-columns',     label:'Net Banking',   badge:'' },
            { id:'wallet', icon:'fa-wallet',               label:'Wallets',       badge:'' },
            { id:'emi',    icon:'fa-calendar-days',        label:'EMI',           badge:'' },
            { id:'cod',    icon:'fa-box-open',             label:'Cash on Delivery', badge:'' },
          ].map((m,i) => `
            <button class="pgw-tab-btn" data-tab="${m.id}" style="
              width:100%; text-align:left; background:${i===0?'rgba(56,177,123,0.12)':'transparent'};
              border:none; border-left:3px solid ${i===0?'#38b17b':'transparent'};
              padding:12px 14px; cursor:pointer; color:${i===0?'#38b17b':'#94a3b8'};
              display:flex; align-items:center; gap:10px; transition:all 0.18s;
              font-size:0.85rem; font-family:inherit;
            ">
              <i class="fa-solid ${m.icon}" style="width:16px;text-align:center;"></i>
              <div>
                <div style="font-weight:${i===0?'600':'500'}">${m.label}</div>
                ${m.badge ? `<div style="font-size:0.65rem;color:#38b17b;margin-top:1px;">${m.badge}</div>` : ''}
              </div>
            </button>
          `).join('')}
          <div style="margin:12px 14px 0;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:0.68rem;color:#475569;display:flex;align-items:center;gap:6px;">
            <i class="fa-solid fa-shield-halved" style="color:#38b17b;"></i> 100% Secure
          </div>
        </div>

        <!-- RIGHT CONTENT PANEL -->
        <div style="flex:1; overflow-y:auto; padding:20px 22px;">

          <!-- ══ UPI ══ -->
          <div class="pgw-panel" id="pgw-panel-upi" style="display:block;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">PAY VIA UPI</div>

            <!-- UPI Apps -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;">
              ${[
                { name:'GPay',     color:'#4285F4', icon:'fa-google',      label:'Google Pay' },
                { name:'PhonePe',  color:'#5F259F', icon:'fa-mobile',      label:'PhonePe' },
                { name:'Paytm',    color:'#00BAF2', icon:'fa-p',           label:'Paytm' },
                { name:'BHIM',     color:'#138808', icon:'fa-indian-rupee-sign', label:'BHIM' },
              ].map(app => `
                <button class="pgw-upi-app-btn" data-app="${app.name}" style="
                  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1);
                  border-radius:10px; padding:12px 6px; text-align:center; cursor:pointer;
                  transition:all 0.18s; color:#e2e8f0; font-family:inherit;
                ">
                  <div style="width:36px;height:36px;border-radius:50%;background:${app.color};margin:0 auto 6px;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-brands ${app.icon}" style="color:#fff;font-size:16px;" onerror="this.className='fa-solid fa-mobile'"></i>
                  </div>
                  <div style="font-size:0.72rem;font-weight:500;">${app.label}</div>
                </button>
              `).join('')}
            </div>

            <div style="text-align:center;color:#475569;font-size:0.78rem;margin-bottom:14px;">— or enter UPI ID —</div>

            <div style="display:flex;gap:8px;margin-bottom:18px;">
              <input id="pgw-upi-id" type="text" placeholder="yourname@upi" value="test@upi" style="
                flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(56,177,123,0.3);
                border-radius:8px; padding:10px 14px; color:#e2e8f0; font-size:0.9rem;
                outline:none; font-family:inherit;
              ">
              <button id="pgw-upi-verify-btn" style="
                background:rgba(56,177,123,0.15); border:1px solid rgba(56,177,123,0.4);
                border-radius:8px; padding:10px 16px; color:#38b17b; font-size:0.82rem;
                cursor:pointer; font-family:inherit; font-weight:600; white-space:nowrap;
              ">Verify</button>
            </div>
            <div id="pgw-upi-verified" style="display:none;background:rgba(56,177,123,0.1);border:1px solid rgba(56,177,123,0.3);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:0.82rem;color:#38b17b;">
              <i class="fa-solid fa-circle-check"></i> UPI ID verified — Test User
            </div>
            <button class="pgw-pay-btn" id="pgw-btn-pay-upi" style="
              width:100%; padding:14px; background:linear-gradient(135deg,#38b17b,#1a7a52);
              border:none; border-radius:10px; color:#fff; font-size:0.95rem; font-weight:700;
              cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:8px;
            ">
              <i class="fa-solid fa-mobile-screen-button"></i> Pay ₹${amount} via UPI
            </button>
          </div>

          <!-- ══ CARD ══ -->
          <div class="pgw-panel" id="pgw-panel-card" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">CREDIT / DEBIT CARD</div>

            <!-- Accepted cards -->
            <div style="display:flex;gap:8px;margin-bottom:16px;">
              ${['VISA','MC','AMEX','RuPay'].map(c => `
                <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;font-size:0.72rem;font-weight:700;color:#94a3b8;">${c}</div>
              `).join('')}
            </div>

            <div style="position:relative;margin-bottom:16px;">
              <label style="font-size:0.78rem;color:#64748b;display:block;margin-bottom:6px;">Card Number</label>
              <div style="display:flex;gap:8px;align-items:center;background:rgba(255,255,255,0.05);border:1px solid rgba(56,177,123,0.3);border-radius:8px;padding:10px 14px;">
                <i class="fa-regular fa-credit-card" style="color:#475569;"></i>
                <input type="text" id="pgw-card-num" value="4111 2222 3333 4444" maxlength="19" style="
                  flex:1;background:transparent;border:none;color:#e2e8f0;font-size:0.95rem;outline:none;font-family:inherit;letter-spacing:0.08em;
                ">
                <i class="fa-brands fa-cc-visa" style="color:#1a56db;font-size:1.2rem;"></i>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
              <div>
                <label style="font-size:0.78rem;color:#64748b;display:block;margin-bottom:6px;">Expiry (MM/YY)</label>
                <input type="text" id="pgw-card-exp" value="12/28" maxlength="5" style="
                  width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(56,177,123,0.3);
                  border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:0.9rem;outline:none;font-family:inherit;box-sizing:border-box;
                ">
              </div>
              <div>
                <label style="font-size:0.78rem;color:#64748b;display:block;margin-bottom:6px;">CVV <i class="fa-solid fa-circle-question" style="font-size:0.7rem;color:#475569;"></i></label>
                <input type="password" id="pgw-card-cvv" value="123" maxlength="4" style="
                  width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(56,177,123,0.3);
                  border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:0.9rem;outline:none;font-family:inherit;box-sizing:border-box;
                ">
              </div>
            </div>

            <div style="margin-bottom:18px;">
              <label style="font-size:0.78rem;color:#64748b;display:block;margin-bottom:6px;">Name on Card</label>
              <input type="text" id="pgw-card-name" placeholder="As on card" value="${state.user?.fullName || 'Card Holder'}" style="
                width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(56,177,123,0.3);
                border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:0.9rem;outline:none;font-family:inherit;box-sizing:border-box;
              ">
            </div>

            <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
              <input type="checkbox" id="pgw-save-card" checked style="accent-color:#38b17b;">
              <label for="pgw-save-card" style="font-size:0.8rem;color:#64748b;cursor:pointer;">Save card securely for faster checkout</label>
            </div>

            <button class="pgw-pay-btn" id="pgw-btn-pay-card" style="
              width:100%;padding:14px;background:linear-gradient(135deg,#38b17b,#1a7a52);
              border:none;border-radius:10px;color:#fff;font-size:0.95rem;font-weight:700;
              cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;
            ">
              <i class="fa-solid fa-lock"></i> Pay ₹${amount} Securely
            </button>
            <div style="text-align:center;margin-top:10px;font-size:0.72rem;color:#475569;">
              <i class="fa-solid fa-shield-halved" style="color:#38b17b;"></i> 3D Secure & PCI DSS Compliant
            </div>
          </div>

          <!-- ══ NET BANKING ══ -->
          <div class="pgw-panel" id="pgw-panel-netbank" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">NET BANKING</div>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
              ${[
                { name:'SBI',    color:'#003087' },
                { name:'HDFC',   color:'#004C97' },
                { name:'ICICI',  color:'#B02A30' },
                { name:'Axis',   color:'#800020' },
                { name:'Kotak',  color:'#EE2424' },
                { name:'PNB',    color:'#FF6600' },
              ].map(b => `
                <button class="pgw-bank-btn" data-bank="${b.name}" style="
                  background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
                  border-radius:8px;padding:10px;text-align:center;cursor:pointer;
                  color:#e2e8f0;font-family:inherit;transition:all 0.18s;
                ">
                  <div style="width:32px;height:32px;border-radius:6px;background:${b.color};margin:0 auto 6px;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-building-columns" style="color:#fff;font-size:13px;"></i>
                  </div>
                  <div style="font-size:0.78rem;font-weight:600;">${b.name}</div>
                </button>
              `).join('')}
            </div>

            <div style="margin-bottom:16px;">
              <label style="font-size:0.78rem;color:#64748b;display:block;margin-bottom:6px;">Other Banks</label>
              <select id="pgw-bank-select" style="
                width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(56,177,123,0.3);
                border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:0.9rem;outline:none;font-family:inherit;
              ">
                <option value="">Select your bank...</option>
                <option>Bank of Baroda</option><option>Canara Bank</option>
                <option>Union Bank</option><option>IndusInd Bank</option>
                <option>Yes Bank</option><option>IDFC First Bank</option>
                <option>Federal Bank</option><option>Karnataka Bank</option>
              </select>
            </div>

            <button class="pgw-pay-btn" id="pgw-btn-pay-netbank" style="
              width:100%;padding:14px;background:linear-gradient(135deg,#38b17b,#1a7a52);
              border:none;border-radius:10px;color:#fff;font-size:0.95rem;font-weight:700;
              cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;
            ">
              <i class="fa-solid fa-building-columns"></i> Proceed to Bank — ₹${amount}
            </button>
          </div>

          <!-- ══ WALLETS ══ -->
          <div class="pgw-panel" id="pgw-panel-wallet" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">MOBILE WALLETS</div>

            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
              ${[
                { name:'Paytm Wallet',   bal:'₹2,450.00', icon:'fa-p',        color:'#00BAF2', id:'paytm' },
                { name:'Amazon Pay',     bal:'₹800.00',   icon:'fa-amazon',    color:'#FF9900', id:'amazon' },
                { name:'Mobikwik',       bal:'₹320.00',   icon:'fa-mobile',    color:'#E8174B', id:'mobikwik' },
                { name:'Freecharge',     bal:'₹150.00',   icon:'fa-bolt',      color:'#E62272', id:'freecharge' },
                { name:'Airtel Money',   bal:'₹1,200.00', icon:'fa-signal',    color:'#E40000', id:'airtel' },
              ].map(w => `
                <button class="pgw-wallet-btn" data-wallet="${w.id}" style="
                  width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
                  border-radius:10px;padding:12px 16px;cursor:pointer;color:#e2e8f0;font-family:inherit;
                  display:flex;align-items:center;gap:12px;transition:all 0.18s;text-align:left;
                ">
                  <div style="width:38px;height:38px;border-radius:8px;background:${w.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fa-brands ${w.icon} fa-solid" style="color:#fff;font-size:16px;" onerror="this.className='fa-solid fa-wallet'"></i>
                  </div>
                  <div style="flex:1;">
                    <div style="font-size:0.88rem;font-weight:600;">${w.name}</div>
                    <div style="font-size:0.75rem;color:#38b17b;margin-top:2px;">Balance: ${w.bal}</div>
                  </div>
                  <i class="fa-solid fa-chevron-right" style="color:#475569;font-size:0.8rem;"></i>
                </button>
              `).join('')}
            </div>

            <button class="pgw-pay-btn" id="pgw-btn-pay-wallet" style="
              width:100%;padding:14px;background:linear-gradient(135deg,#38b17b,#1a7a52);
              border:none;border-radius:10px;color:#fff;font-size:0.95rem;font-weight:700;
              cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;
            ">
              <i class="fa-solid fa-wallet"></i> Pay ₹${amount} from Wallet
            </button>
          </div>

          <!-- ══ EMI ══ -->
          <div class="pgw-panel" id="pgw-panel-emi" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">EMI OPTIONS</div>

            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
              ${[
                { months:3,  rate:13, bank:'HDFC / ICICI / SBI' },
                { months:6,  rate:14, bank:'All Major Cards' },
                { months:9,  rate:15, bank:'HDFC / Axis / Kotak' },
                { months:12, rate:15, bank:'All Major Cards' },
                { months:18, rate:16, bank:'HDFC / ICICI' },
                { months:24, rate:16, bank:'Select Cards' },
              ].map((e,i) => {
                const emi = ((rzpDetails.amount/100) * (e.rate/100/12)) / (1 - Math.pow(1 + e.rate/100/12, -e.months));
                return `
                  <label style="
                    display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.04);
                    border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 16px;
                    cursor:pointer;transition:all 0.18s;
                  " class="pgw-emi-row">
                    <input type="radio" name="pgw-emi" value="${e.months}" ${i===0?'checked':''} style="accent-color:#38b17b;">
                    <div style="flex:1;">
                      <div style="font-size:0.88rem;font-weight:600;">${e.months} Months EMI</div>
                      <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${e.bank} · ${e.rate}% p.a.</div>
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:0.95rem;font-weight:700;color:#fbbf24;">₹${emi.toFixed(0)}/mo</div>
                      <div style="font-size:0.7rem;color:#475569;">Total ₹${(emi*e.months).toFixed(0)}</div>
                    </div>
                  </label>
                `;
              }).join('')}
            </div>

            <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:0.78rem;color:#fbbf24;">
              <i class="fa-solid fa-circle-info"></i> No-cost EMI available on select HDFC & ICICI cards
            </div>

            <button class="pgw-pay-btn" id="pgw-btn-pay-emi" style="
              width:100%;padding:14px;background:linear-gradient(135deg,#38b17b,#1a7a52);
              border:none;border-radius:10px;color:#fff;font-size:0.95rem;font-weight:700;
              cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;
            ">
              <i class="fa-solid fa-calendar-days"></i> Proceed with EMI
            </button>
          </div>

          <!-- ══ COD ══ -->
          <div class="pgw-panel" id="pgw-panel-cod" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">CASH ON DELIVERY</div>

            <div style="background:rgba(56,177,123,0.08);border:1px solid rgba(56,177,123,0.2);border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
              <div style="font-size:2.5rem;margin-bottom:10px;">💵</div>
              <div style="font-size:1.1rem;font-weight:700;color:#e2e8f0;margin-bottom:6px;">Pay ₹${amount} at Delivery</div>
              <div style="font-size:0.82rem;color:#94a3b8;">Keep exact change ready. Our delivery partner will collect cash at your doorstep.</div>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
              ${[
                { icon:'fa-box-open',    text:'Order confirmed immediately' },
                { icon:'fa-truck-fast',  text:'Delivered in 2–5 business days' },
                { icon:'fa-hand-holding-dollar', text:'Pay only when you receive' },
                { icon:'fa-rotate-left', text:'Easy return policy' },
              ].map(f => `
                <div style="display:flex;align-items:center;gap:10px;font-size:0.82rem;color:#94a3b8;">
                  <i class="fa-solid ${f.icon}" style="color:#38b17b;width:18px;text-align:center;"></i>${f.text}
                </div>
              `).join('')}
            </div>

            <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:0.78rem;color:#fbbf24;">
              <i class="fa-solid fa-triangle-exclamation"></i> COD available on orders up to ₹5,000
            </div>

            <button class="pgw-pay-btn" id="pgw-btn-pay-cod" style="
              width:100%;padding:14px;background:linear-gradient(135deg,#38b17b,#1a7a52);
              border:none;border-radius:10px;color:#fff;font-size:0.95rem;font-weight:700;
              cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;
            ">
              <i class="fa-solid fa-box-open"></i> Place Order — Pay on Delivery
            </button>
          </div>

        </div><!-- end right panel -->
      </div><!-- end body -->

      <!-- ─── FOOTER ─── -->
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding:10px 20px; background:#091410; border-top:1px solid rgba(56,177,123,0.12);
        flex-shrink:0; font-size:0.72rem; color:#475569;
      ">
        <div style="display:flex;align-items:center;gap:6px;">
          <i class="fa-solid fa-shield-halved" style="color:#38b17b;"></i> Powered by Sporekart Sandbox v2.0
        </div>
        <button id="pgw-btn-cancel" style="
          background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:6px;
          padding:5px 14px;color:#64748b;font-size:0.75rem;cursor:pointer;font-family:inherit;
          transition:all 0.18s;
        ">✕ Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(mockModal);

  // ── TAB SWITCHING ──
  function switchTab(tabId) {
    mockModal.querySelectorAll('.pgw-tab-btn').forEach(btn => {
      const active = btn.dataset.tab === tabId;
      btn.style.background    = active ? 'rgba(56,177,123,0.12)' : 'transparent';
      btn.style.borderLeft    = active ? '3px solid #38b17b'     : '3px solid transparent';
      btn.style.color         = active ? '#38b17b'               : '#94a3b8';
      btn.querySelector('div').style.fontWeight = active ? '600' : '500';
    });
    mockModal.querySelectorAll('.pgw-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById(`pgw-panel-${tabId}`);
    if (panel) panel.style.display = 'block';
  }

  mockModal.querySelectorAll('.pgw-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    btn.addEventListener('mouseenter', () => {
      if (!btn.classList.contains('active-tab')) btn.style.background = 'rgba(56,177,123,0.06)';
    });
    btn.addEventListener('mouseleave', () => {
      const isActive = btn.style.borderLeft.includes('#38b17b');
      if (!isActive) btn.style.background = 'transparent';
    });
  });

  // ── UPI App buttons ──
  mockModal.querySelectorAll('.pgw-upi-app-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mockModal.querySelectorAll('.pgw-upi-app-btn').forEach(b => {
        b.style.border = '1px solid rgba(255,255,255,0.1)';
        b.style.background = 'rgba(255,255,255,0.04)';
      });
      btn.style.border = '1px solid #38b17b';
      btn.style.background = 'rgba(56,177,123,0.1)';
    });
  });

  // ── UPI Verify ──
  document.getElementById('pgw-upi-verify-btn')?.addEventListener('click', () => {
    const upiId = document.getElementById('pgw-upi-id').value.trim();
    if (upiId) {
      const verified = document.getElementById('pgw-upi-verified');
      if (verified) {
        verified.style.display = 'block';
        verified.innerHTML = `<i class="fa-solid fa-circle-check"></i> UPI ID verified — ${upiId}`;
      }
    }
  });

  // ── Bank highlight ──
  mockModal.querySelectorAll('.pgw-bank-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mockModal.querySelectorAll('.pgw-bank-btn').forEach(b => {
        b.style.border = '1px solid rgba(255,255,255,0.1)';
        b.style.background = 'rgba(255,255,255,0.04)';
      });
      btn.style.border = '1px solid #38b17b';
      btn.style.background = 'rgba(56,177,123,0.1)';
    });
  });

  // ── Wallet highlight ──
  mockModal.querySelectorAll('.pgw-wallet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mockModal.querySelectorAll('.pgw-wallet-btn').forEach(b => {
        b.style.border = '1px solid rgba(255,255,255,0.1)';
        b.style.background = 'rgba(255,255,255,0.04)';
      });
      btn.style.border = '1px solid #38b17b';
      btn.style.background = 'rgba(56,177,123,0.1)';
    });
  });

  // ── PAYMENT CONFIRM helper ──
  async function doPayment(btnId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    // Show processing state
    const orig = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;
    btn.disabled = true;

    await new Promise(r => setTimeout(r, 1500)); // Simulate network delay

    mockModal.remove();
    const mockPaymentId = `pay_mock_${Math.random().toString(36).substr(2, 9)}`;
    const mockSignature = `sig_mock_${Math.random().toString(36).substr(2, 12)}`;
    await completeOrderPayment(orderId, mockPaymentId, mockSignature);
  }

  // ── Wire all pay buttons ──
  ['pgw-btn-pay-upi','pgw-btn-pay-card','pgw-btn-pay-netbank','pgw-btn-pay-wallet','pgw-btn-pay-emi','pgw-btn-pay-cod'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => doPayment(id));
  });

  // ── Cancel ──
  document.getElementById('pgw-btn-cancel')?.addEventListener('click', () => {
    mockModal.remove();
    showSuccessToast('⚠️ Payment cancelled. Your cart is still saved.');
  });

  // ── Outside click to cancel ──
  mockModal.addEventListener('click', e => {
    if (e.target === mockModal) {
      mockModal.remove();
      showSuccessToast('⚠️ Payment cancelled. Your cart is still saved.');
    }
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
      // Clear cart
      state.cart = [];
      saveCart();
      updateCartUI();
      state.activePromo = null;
      state.promoDiscountPct = 0;
      const promoInput = document.getElementById('promo-input');
      if (promoInput) promoInput.value = '';
      const promoMsg = document.getElementById('promo-message');
      if (promoMsg) promoMsg.classList.add('hidden');

      // Show success notification
      showSuccessToast('🎉 Order placed successfully! Payment confirmed.');
      
      // Admin and Growers can track orders; Buyers go back to shop
      if (state.user && (state.user.role === 'admin' || state.user.role === 'grower')) {
        window.location.hash = `#track-${data.order.id}`;
      } else {
        window.location.hash = '#shop';
      }
    } else {
      alert('Payment verification failed: ' + (data.error || 'Unknown error'));
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
// State for admin inventory (cache)
let _adminProducts = [];

async function fetchAdminInventory() {
  const grid = document.getElementById('admin-inventory-grid');
  if (grid) {
    grid.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; padding: 2rem; width:100%;">
        <i class="fa-solid fa-spinner fa-spin loader-icon" style="font-size: 1.5rem;"></i>
      </div>
    `;
  }

  try {
    const products = await fetchWithAuth('/products');
    _adminProducts = products;
    // Update stats chips
    const statEl = document.getElementById('admin-stat-products');
    if (statEl) statEl.textContent = products.length;
    renderAdminInventory();
  } catch(err) {
    console.error('Admin inventory fetch error:', err);
    if (grid) {
      grid.innerHTML = `<p style="color:var(--color-danger); padding:1rem;">Failed to synchronize active inventory directory.</p>`;
    }
  }
}

function renderAdminInventory() {
  const grid = document.getElementById('admin-inventory-grid');
  if (!grid) return;
  const query = (document.getElementById('admin-search-prod')?.value || '').toLowerCase();
  const catFilter = document.getElementById('admin-filter-cat')?.value || 'all';
  
  let products = _adminProducts;
  if (catFilter !== 'all') products = products.filter(p => p.category === catFilter);
  if (query) products = products.filter(p => p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query));

  if (!products.length) {
    grid.innerHTML = '<div class="admin-loading">No products found.</div>';
    return;
  }

  grid.innerHTML = `
    <div class="admin-product-table-header">
      <span>Image</span><span>Product</span><span>Price / MRP</span><span>Stock</span><span>GST</span><span>Category</span><span>Actions</span>
    </div>
    ${products.map(p => {
      const stockClass = p.stock === 0 ? 'out-stock' : p.stock < 20 ? 'low-stock' : 'in-stock';
      const stockLabel = p.stock === 0 ? 'Out of Stock' : p.stock < 20 ? `Low: ${p.stock}` : `${p.stock} units`;
      return `
        <div class="admin-product-row" data-id="${p.id}">
          <img src="${p.image_url}" alt="${p.name}">
          <div class="admin-prod-name-cell">
            <h4>${p.name}</h4>
            <p>${p.description}</p>
          </div>
          <div class="admin-price-cell">
            <span class="price-act">₹${p.price.toFixed(2)}</span>
            ${p.mrp_price ? `<span class="price-mrp">₹${p.mrp_price.toFixed(2)}</span>` : ''}
          </div>
          <span class="admin-stock-badge ${stockClass}">${stockLabel}</span>
          <span class="admin-gst-badge">${p.gst_rate}%</span>
          <span style="font-size:.8rem;color:var(--text-soft);text-transform:capitalize;">${p.category}</span>
          <div class="admin-row-actions">
            <button class="btn-admin-edit" onclick="window.adminEditProduct('${p.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
            <button class="btn-admin-delete" onclick="window.adminDeleteProduct('${p.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function adminEditProduct(productId) {
  const prod = _adminProducts.find(p => p.id === productId);
  if (!prod) return;
  // Switch to Add/Edit tab
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.admin-tab[data-tab="add-product"]')?.classList.add('active');
  document.getElementById('admin-content-add-product')?.classList.add('active');
  // Fill form
  document.getElementById('admin-edit-id').value = prod.id;
  document.getElementById('admin-prod-name').value = prod.name;
  document.getElementById('admin-prod-desc').value = prod.description;
  document.getElementById('admin-prod-category').value = prod.category;
  document.getElementById('admin-prod-difficulty').value = prod.difficulty;
  document.getElementById('admin-prod-gst').value = String(prod.gst_rate);
  document.getElementById('admin-prod-price').value = prod.price;
  document.getElementById('admin-prod-mrp').value = prod.mrp_price || '';
  document.getElementById('admin-prod-stock').value = prod.stock;
  document.getElementById('admin-prod-image').value = prod.image_url;
  // Show image preview
  const preview = document.getElementById('admin-img-preview');
  if (preview) preview.innerHTML = `<img src="${prod.image_url}" alt="Preview">`;
  // Update submit button
  const label = document.getElementById('admin-submit-label');
  if (label) label.textContent = 'Update Product';
}

function resetAdminForm() {
  document.getElementById('form-admin-add-product').reset();
  document.getElementById('admin-edit-id').value = '';
  const label = document.getElementById('admin-submit-label');
  if (label) label.textContent = 'Publish Product';
  const preview = document.getElementById('admin-img-preview');
  if (preview) preview.innerHTML = '<i class="fa-solid fa-image"></i><span>Image preview</span>';
  const feedback = document.getElementById('admin-add-feedback');
  if (feedback) feedback.classList.add('hidden');
}

async function handleAdminAddProduct(e) {
  e.preventDefault();
  const feedback = document.getElementById('admin-add-feedback');
  feedback.classList.add('hidden');

  const editId = document.getElementById('admin-edit-id').value;
  const name = document.getElementById('admin-prod-name').value.trim();
  const category = document.getElementById('admin-prod-category').value;
  const description = document.getElementById('admin-prod-desc').value.trim();
  const price = document.getElementById('admin-prod-price').value;
  const mrp_price = document.getElementById('admin-prod-mrp').value;
  const gst_rate = document.getElementById('admin-prod-gst').value;
  const difficulty = document.getElementById('admin-prod-difficulty').value;
  const stock = document.getElementById('admin-prod-stock').value;
  const image_url = document.getElementById('admin-prod-image').value.trim();

  try {
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_BASE}/products/${editId}` : `${API_BASE}/products`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({
        name,
        category,
        description,
        price: parseFloat(price),
        mrp_price: mrp_price ? parseFloat(mrp_price) : undefined,
        gst_rate: parseInt(gst_rate, 10),
        difficulty,
        stock: parseInt(stock, 10),
        image_url
      })
    });
    const data = await res.json();
    if (res.ok) {
      showSuccessToast(editId ? '✅ Product updated successfully!' : '✅ Product published successfully!');
      resetAdminForm();
      fetchProducts();
      fetchAdminInventory();
      // Switch back to products tab
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector('.admin-tab[data-tab="products"]')?.classList.add('active');
      document.getElementById('admin-content-products')?.classList.add('active');
    } else {
      feedback.textContent = data.error || 'Failed to save product.';
      feedback.classList.remove('hidden');
    }
  } catch(err) {
    feedback.textContent = 'Server error.';
    feedback.classList.remove('hidden');
  }
}

async function fetchAdminOrders() {
  try {
    const res = await fetch(`${API_BASE}/orders/all-orders`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load orders');
    const orders = await res.json();
    const statEl = document.getElementById('admin-stat-orders');
    if (statEl) statEl.textContent = orders.length;
    renderAdminOrders(orders);
  } catch(err) {
    console.error('Fetch admin orders error:', err);
    const wrap = document.getElementById('admin-orders-list');
    if (wrap) wrap.innerHTML = '<div class="admin-loading" style="color:var(--color-danger)"><i class="fa-solid fa-triangle-exclamation"></i> Could not load orders.</div>';
  }
}

function renderAdminOrders(orders) {
  const wrap = document.getElementById('admin-orders-list');
  if (!wrap) return;
  if (!orders.length) {
    wrap.innerHTML = '<div class="admin-loading">No orders found.</div>';
    return;
  }
  wrap.innerHTML = orders.map(o => {
    const date = new Date(o.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    return `
      <div class="admin-order-row">
        <div>
          <div class="admin-order-id">ORDER-${o.id.substring(0,8).toUpperCase()}</div>
          <div class="admin-order-date">${date} · ${o.items.length} item(s)</div>
          <div style="font-size:.75rem;color:var(--text-soft);">${o.user_email || ''}</div>
        </div>
        <span class="admin-order-total">₹${o.total.toFixed(2)}</span>
        <span class="admin-order-status ${o.delivery_status}">${o.delivery_status}</span>
        <select class="admin-ship-select" onchange="window.adminUpdateShipping('${o.id}', this.value)">
          <option value="pending" ${o.delivery_status==='pending'?'selected':''}>Pending</option>
          <option value="processing" ${o.delivery_status==='processing'?'selected':''}>Processing</option>
          <option value="shipped" ${o.delivery_status==='shipped'?'selected':''}>Shipped</option>
          <option value="delivered" ${o.delivery_status==='delivered'?'selected':''}>Delivered</option>
        </select>
      </div>
    `;
  }).join('');
}

async function adminUpdateShipping(orderId, status) {
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ delivery_status: status })
    });
    if (res.ok) {
      showSuccessToast(`📦 Shipment status updated to "${status}"`);
      fetchAdminOrders();
    } else {
      throw new Error('Failed');
    }
  } catch(err) {
    alert('Failed to update shipping status.');
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
      showSuccessToast("🗑️ Product successfully deleted.");
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

window.adminEditProduct = adminEditProduct;
window.adminDeleteProduct = adminDeleteProduct;
window.adminUpdateShipping = adminUpdateShipping;

// ==========================================================================
// CATEGORY MANAGEMENT (FETCH + CRUD + MOBILE NAV)
// ==========================================================================
let _adminCategories = [];

async function fetchCategories() {
  try {
    const res = await fetch(`${API_BASE}/categories`);
    if (!res.ok) return;
    const categories = await res.json();
    _adminCategories = categories;
    renderMobileCategoryNav(categories);
    populateCategorySelects(categories);
  } catch (err) {
    console.error('Fetch categories error:', err);
  }
}

function renderMobileCategoryNav(categories) {
  const inner = document.getElementById('mobile-cat-nav-inner');
  if (!inner) return;

  // Build nav items: All + each category
  const allItem = `
    <button class="mob-cat-btn active" data-category="all" id="mob-cat-all">
      <i class="fa-solid fa-grid-2"></i>
      <span>All</span>
    </button>
  `;
  const catItems = categories.map(cat => `
    <button class="mob-cat-btn" data-category="${cat.id}" id="mob-cat-${cat.id}">
      <i class="fa-solid fa-seedling"></i>
      <span>${cat.name}</span>
    </button>
  `).join('');

  inner.innerHTML = allItem + catItems;

  // Attach click events
  inner.querySelectorAll('.mob-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      inner.querySelectorAll('.mob-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      navigateToCategory(btn.getAttribute('data-category'));
    });
  });
}

function populateCategorySelects(categories) {
  // Update admin filter dropdown
  const adminFilterSelect = document.getElementById('admin-filter-cat');
  if (adminFilterSelect) {
    adminFilterSelect.innerHTML = `<option value="all">All Categories</option>` +
      categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }
  // Update admin product form category dropdown
  const adminCatSelect = document.getElementById('admin-prod-category');
  if (adminCatSelect) {
    adminCatSelect.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }
  // Update main product filters row
  const filtersRow = document.getElementById('product-filters-row');
  if (filtersRow) {
    const allBtn = filtersRow.querySelector('[data-category="all"]');
    // Set up 'all' button to reset state.activeCategory
    if (allBtn) {
      allBtn.addEventListener('click', () => {
        state.activeCategory = 'all';
      });
    }
    // Remove existing dynamic category buttons (keep 'all')
    filtersRow.querySelectorAll('.cat-btn:not([data-category="all"])').forEach(b => b.remove());
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'cat-btn';
      btn.setAttribute('data-category', cat.id);
      btn.innerHTML = `<i class="fa-solid fa-seedling"></i> ${cat.name}`;
      btn.addEventListener('click', () => {
        filtersRow.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeCategory = cat.id;
        filterProducts();
      });
      filtersRow.appendChild(btn);
    });
  }
}

async function fetchAdminCategories() {
  const list = document.getElementById('admin-categories-list');
  if (list) list.innerHTML = `<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading categories...</div>`;
  try {
    const res = await fetch(`${API_BASE}/categories`);
    const categories = await res.json();
    _adminCategories = categories;
    renderAdminCategoriesList(categories);
  } catch (err) {
    if (list) list.innerHTML = `<div class="admin-loading" style="color:var(--color-danger)">Failed to load categories.</div>`;
  }
}

function renderAdminCategoriesList(categories) {
  const list = document.getElementById('admin-categories-list');
  if (!list) return;
  if (!categories.length) {
    list.innerHTML = `<div class="admin-loading">No categories found. Add one above.</div>`;
    return;
  }
  list.innerHTML = categories.map(cat => `
    <div class="admin-cat-row" data-id="${cat.id}">
      <div class="admin-cat-info">
        <span class="admin-cat-slug">${cat.id}</span>
        <strong class="admin-cat-name">${cat.name}</strong>
        <span class="admin-cat-desc">${cat.description || ''}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn-admin-edit" onclick="window.adminEditCategory('${cat.id}')">
          <i class="fa-solid fa-pen"></i> Edit
        </button>
        <button class="btn-admin-delete" onclick="window.adminDeleteCategory('${cat.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function adminEditCategory(catId) {
  const cat = _adminCategories.find(c => c.id === catId);
  if (!cat) return;
  document.getElementById('admin-edit-cat-id').value = cat.id;
  const slugInput = document.getElementById('admin-cat-id');
  if (slugInput) { slugInput.value = cat.id; slugInput.disabled = true; }
  document.getElementById('admin-cat-name').value = cat.name;
  document.getElementById('admin-cat-desc').value = cat.description || '';
  const feedback = document.getElementById('admin-cat-feedback');
  if (feedback) { feedback.textContent = `Editing: ${cat.name}`; feedback.classList.remove('hidden'); feedback.style.color = 'var(--color-primary)'; }
}

function resetAdminCatForm() {
  document.getElementById('admin-edit-cat-id').value = '';
  const slugInput = document.getElementById('admin-cat-id');
  if (slugInput) { slugInput.value = ''; slugInput.disabled = false; }
  document.getElementById('admin-cat-name').value = '';
  document.getElementById('admin-cat-desc').value = '';
  const feedback = document.getElementById('admin-cat-feedback');
  if (feedback) feedback.classList.add('hidden');
}

async function handleAdminSaveCategory() {
  const feedback = document.getElementById('admin-cat-feedback');
  const editId = document.getElementById('admin-edit-cat-id').value;
  const id = document.getElementById('admin-cat-id').value.trim().toLowerCase().replace(/\s+/g, '-');
  const name = document.getElementById('admin-cat-name').value.trim();
  const description = document.getElementById('admin-cat-desc').value.trim();

  if (!name) {
    if (feedback) { feedback.textContent = 'Category name is required.'; feedback.classList.remove('hidden'); feedback.style.color = 'var(--color-danger)'; }
    return;
  }
  if (!editId && !id) {
    if (feedback) { feedback.textContent = 'Category slug/ID is required for new categories.'; feedback.classList.remove('hidden'); feedback.style.color = 'var(--color-danger)'; }
    return;
  }

  try {
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_BASE}/categories/${editId}` : `${API_BASE}/categories`;
    const body = editId ? { name, description } : { id, name, description };
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      showSuccessToast(editId ? `✅ Category "${name}" updated!` : `✅ Category "${name}" created!`);
      resetAdminCatForm();
      fetchAdminCategories();
      fetchCategories(); // refresh shop nav too
    } else {
      if (feedback) { feedback.textContent = data.error || 'Failed to save category.'; feedback.classList.remove('hidden'); feedback.style.color = 'var(--color-danger)'; }
    }
  } catch (err) {
    if (feedback) { feedback.textContent = 'Server error.'; feedback.classList.remove('hidden'); feedback.style.color = 'var(--color-danger)'; }
  }
}

async function adminDeleteCategory(catId) {
  if (!confirm(`Delete category "${catId}"? Products in this category will be moved to "uncategorized".`)) return;
  try {
    const res = await fetch(`${API_BASE}/categories/${catId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      showSuccessToast(`🗑️ Category "${catId}" deleted.`);
      fetchAdminCategories();
      fetchCategories();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to delete category.');
    }
  } catch (err) {
    alert('Server error while deleting category.');
  }
}

window.adminEditCategory = adminEditCategory;
window.adminDeleteCategory = adminDeleteCategory;

// Bind methods globally
window.viewInvoice = viewInvoice;
window.whatsappQuickMessage = whatsappQuickMessage;

// ==========================================================================
// SUCCESS TOAST NOTIFICATION
// ==========================================================================
function showSuccessToast(message) {
  // Remove any existing toast
  const existing = document.getElementById('spk-success-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'spk-success-toast';
  toast.style.cssText = `
    position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);
    background: #1a5c38; color: #fff; padding: 16px 28px;
    border-radius: 12px; font-size: 0.95rem; font-weight: 600;
    box-shadow: 0 8px 32px rgba(0,0,0,0.25); z-index: 9999;
    display: flex; align-items: center; gap: 10px;
    animation: toastIn 0.3s ease;
  `;
  toast.textContent = message;

  // Add animation keyframe once
  if (!document.getElementById('toast-keyframes')) {
    const style = document.createElement('style');
    style.id = 'toast-keyframes';
    style.textContent = `@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(20px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

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
