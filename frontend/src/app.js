import {
  state,
  saveAuth,
  clearAuth,
  clearCart,
  saveCart,
  saveUserProfile,
} from './utils/state.js';
import { authModal } from './components/AuthModal.js';
import { traineeAuthModal } from './components/TraineeAuthModal.js';
import { profileModal } from './components/ProfileModal.js';
import { authApi } from './api/authApi.js';
import { trainingApi } from './api/trainingApi.js';
import { blogApi } from './api/blogApi.js';
import { searchApi } from './api/searchApi.js';
import { locationApi } from './api/locationApi.js';
import { API_BASE, fetchWithAuth, getApiErrorMessage } from './api/client.js';
import { showErrorToast, showSuccessToast, showInfoToast, showPopupModal } from './utils/notify.js';
import { isValidIndianPhone } from './utils/validation.js';
import { createEventSourceWithAuth } from './utils/auth.js';

// Attach state to window for existing global functions to work during incremental migration
window.state = state;

let _statesCache = [];
let _citiesCache = {};
let _checkoutFormOriginalHTML = null;

async function _loadStates() {
  try {
    _statesCache = await locationApi.getStates();
    const checkoutStateSelect = document.getElementById('checkout-state');
    if (checkoutStateSelect && checkoutStateSelect.options.length <= 1) {
      checkoutStateSelect.innerHTML = '<option value="">Select State</option>' +
        _statesCache.map(s => `<option value="${s}">${s}</option>`).join('');
    }
  } catch {
    _statesCache = [];
  }
}

async function _loadCities(state) {
  if (!state) return [];
  if (_citiesCache[state]) return _citiesCache[state];
  try {
    const cities = await locationApi.getCities(state);
    _citiesCache[state] = cities;
    return cities;
  } catch {
    return [];
  }
}

// Storefront pagination/sort state
let _shopInventoryPage = 1;
let shopPageSize = 10;

// Blog pagination state
let _blogPage = 1;
let blogPageSize = 10;
let _allBlogs = [];

// ── Recently Read Blogs (localStorage) ──
const RECENTLY_READ_KEY = 'recentlyReadBlogs';
const MAX_RECENTLY_READ = 20;

function _getRecentlyReadBlogs() {
  try {
    const raw = localStorage.getItem(RECENTLY_READ_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function _saveRecentlyReadBlog(slug) {
  try {
    let list = _getRecentlyReadBlogs();
    // Remove existing entry for this slug (to move it to top)
    list = list.filter(item => item.slug !== slug);
    // Add to the beginning with current timestamp
    list.unshift({ slug, timestamp: Date.now() });
    // Cap the list size
    if (list.length > MAX_RECENTLY_READ) {
      list = list.slice(0, MAX_RECENTLY_READ);
    }
    localStorage.setItem(RECENTLY_READ_KEY, JSON.stringify(list));
  } catch {
    // Ignore localStorage errors
  }
}

function getShopInventorySortValue() {
  return document.getElementById('shop-inventory-sort')?.value || 'name_asc';
}

// ── Inactivity auto-logout ──────────────────────────────────────
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
let _inactivityTimer = null;
let _inactivityBound = [];

function _clearInactivityTimer() {
  if (_inactivityTimer) { clearTimeout(_inactivityTimer); _inactivityTimer = null; }
}

function _removeInactivityListeners() {
  _inactivityBound.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
  _inactivityBound = [];
}

function _resetInactivityTimer() {
  if (!state.token || !state.user) return;
  _clearInactivityTimer();
  _inactivityTimer = setTimeout(_onInactivityTimeout, SESSION_TIMEOUT_MS);
}

function _onInactivityTimeout() {
  saveCart();
  showInfoToast('Session expired due to inactivity. Your cart has been saved.');
  logout();
}

function _startInactivityTracking() {
  _stopInactivityTracking();
  _resetInactivityTimer();
  const events = ['click', 'keydown', 'touchstart', 'mousemove', 'scroll'];
  const handler = () => _resetInactivityTimer();
  events.forEach(type => {
    window.addEventListener(type, handler, { passive: true });
    _inactivityBound.push({ el: window, type, fn: handler });
  });
}

function _stopInactivityTracking() {
  _clearInactivityTimer();
  _removeInactivityListeners();
}

// Initialize App
function _saveCheckoutFormTemplate() {
  const fp = document.querySelector('.checkout-form-panel');
  if (fp && !_checkoutFormOriginalHTML) _checkoutFormOriginalHTML = fp.innerHTML;
}

function initApp() {
  window.scrollTo(0, 0);
  initEventListeners();
  _saveCheckoutFormTemplate();
  loadUser();
  fetchProducts();
  fetchCategories(); // Load categories for nav + admin
  fetchShippingSettings();
  _loadStates();
  updateCartUI();
  initThreeJS();
  initScrollReveal();
  /*
    // Training gallery carousel
    renderTrainingGallery();
    startTgAutoplay();
    window.addEventListener('resize', () => {
      renderTrainingGallery();
    });
  */
  // Training gallery carousel — defer until layout is painted
  requestAnimationFrame(() => {
    renderTrainingGallery();
    startTgAutoplay();
  });
  window.addEventListener('resize', () => {
    renderTrainingGallery();
  });

  // Homepage mushroom carousel
  initCarousel();

  // Success Stories carousel on landing page
  requestAnimationFrame(() => {
    renderSuccessCarousel();
  });

  // Wire up admin controls for success stories
  if (state.user && state.user.role === 'admin') {
    const adminBar = document.getElementById('success-admin-bar');
    if (adminBar) adminBar.style.display = 'flex';
  }

  // If hash is present, route to it
  handleRouting();

  // Routing — must be inside DOMContentLoaded so DOM is available
  window.addEventListener('hashchange', handleRouting);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Listen for category updates from admin (cross-tab)
try {
  const bc = new BroadcastChannel('spore-categories');
  bc.addEventListener('message', (ev) => {
    if (ev?.data?.type === 'categories:updated') {
      fetchCategories();
      fetchProducts();
    }
  });
} catch (err) {
  // BroadcastChannel might not be supported; ignore
}

// Connect to server-sent events to receive order updates cross-browser
try {
  if (state && state.token) {
    const esUrl = `${API_BASE}/orders/events`;
    const orderEs = createEventSourceWithAuth(esUrl, state.token);
    orderEs.addEventListener('order:updated', (ev) => {
      try {
        const payload = JSON.parse(ev.data || '{}');
        const updated = payload.order;
        if (!updated) return;
        // If this client owns the order, refresh user's orders
        if (state.user && state.user.userId === updated.user_id) {
          fetchOrders();
        }
        // If admin, fetch admin orders too (admin page may be open)
        if (state.user && state.user.role === 'admin') {
          // admin page handles its own SSE, but refresh products/orders if present
          fetchOrders();
        }
      } catch (e) {
        /* ignore */
      }
    });
    orderEs.addEventListener('error', () => {
      // noop
    });
  }
} catch (e) {
  // ignore
}

let orderEs = null;
function initOrderSse() {
  try {
    if (!state || !state.token) return;
    if (orderEs) return;
    const esUrl = `${API_BASE}/orders/events`;
    orderEs = createEventSourceWithAuth(esUrl, state.token);
    orderEs.addEventListener('order:updated', (ev) => {
      try {
        const payload = JSON.parse(ev.data || '{}');
        const updated = payload.order;
        if (!updated) return;
        if (state.user && state.user.userId === updated.user_id) {
          fetchOrders();
          if (updated.delivery_status) {
            showInfoToast(`Order ${updated.id} status updated: ${updated.delivery_status}`);
          } else {
            showInfoToast(`Order ${updated.id} has been updated.`);
          }
        }
        if (state.user && state.user.role === 'admin') fetchOrders();
      } catch (e) {
        /* ignore */
      }
    });
    orderEs.addEventListener('error', () => { });
  } catch (e) {
    /* ignore */
  }
}

window.addEventListener('auth:changed', () => {
  initOrderSse();
  if (state.token && state.user) {
    _startInactivityTracking();
  } else {
    _stopInactivityTracking();
  }
});

// Training feature removed: no fetchTrainings implementation
try {
  const bcProd = new BroadcastChannel('spore-products');
  bcProd.addEventListener('message', (ev) => {
    if (ev?.data?.type === 'products:updated') {
      fetchProducts();
      fetchCategories();
    }
  });
} catch (err) {
  // BroadcastChannel might not be supported; ignore
}

function renderCategoryGrid(categories) {
  const grid = document.getElementById('category-grid');
  if (!grid) return;
  const isAdmin = state.user?.role === 'admin';
  grid.innerHTML = categories
    .map(
      (cat) => `
    <div class="category-card" data-filter-category="${cat.id}">
      ${isAdmin ? `<button class="category-admin-edit-btn" data-edit-category="${cat.id}" title="Edit category"><i class="fa-solid fa-pen"></i></button>` : ''}
      <div class="category-img-wrap">
        <img src="${cat.image_url || '/images/product_fresh.png'}" alt="${cat.name}">
      </div>
      <h3>${cat.name}</h3>
      <p>${cat.description || ''}</p>
      <button class="btn-category-shop" data-filter-category="${cat.id}">Shop Now <i class="fa-solid fa-arrow-right"></i></button>
    </div>
  `,
    )
    .join('');

  // Ensure category card buttons navigate to filtered shop
  grid.querySelectorAll('.btn-category-shop').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateToCategory(btn.getAttribute('data-filter-category'));
    });
  });

  if (isAdmin) {
    grid.querySelectorAll('.category-admin-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const catId = btn.getAttribute('data-edit-category');
        window.location.href = `/admin.html#categories?edit=${encodeURIComponent(catId)}`;
      });
    });
  }
}

function handleRouting(opts = {}) {
  const hash = window.location.hash || '#shop';
  const navShop = document.getElementById('btn-nav-shop');
  const navTrack = document.getElementById('btn-nav-track');
  const navAdmin = document.getElementById('btn-nav-admin');

  const pageShop = document.getElementById('shop-page');
  const pageCheckout = document.getElementById('checkout-page');
  const pageTrack = document.getElementById('tracker-page');
  const pageAdmin = document.getElementById('admin-page');
  const pageAbout = document.getElementById('about-page');
  const heroSection = document.getElementById('hero-section');

  // Deactivate all nav links & sections
  navShop.classList.remove('active');
  navTrack.classList.remove('active');
  navAdmin.classList.remove('active');

  pageShop.classList.remove('active');
  if (pageCheckout) pageCheckout.classList.remove('active');
  pageTrack.classList.remove('active');
  if (pageAdmin) pageAdmin.classList.remove('active');
  if (pageAbout) pageAbout.classList.remove('active');

  if (hash === '#shop' || hash === '') {
    navShop.classList.add('active');
    pageShop.classList.add('active');
    if (heroSection) heroSection.classList.remove('hidden');
  } else if (hash === '#about') {
    if (pageAbout) pageAbout.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
    requestAnimationFrame(() => {
      document.querySelectorAll('#about-page .about-block, #about-page .reveal-element').forEach((el) => {
        el.classList.add('revealed');
      });
      if (pageAbout) pageAbout.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else if (hash === '#training-section') {
    navShop.classList.add('active');
    pageShop.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
    requestAnimationFrame(() => {
      const target = document.getElementById('training-section');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else if (hash === '#footer') {
    navShop.classList.add('active');
    pageShop.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
    requestAnimationFrame(() => {
      const target = document.getElementById('footer');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } else if (hash === '#checkout') {
    if (state.user && (state.user.role === 'grower' || state.user.role === 'admin')) {
      if (heroSection) heroSection.classList.remove('hidden');
      window.location.hash = '#shop';
      return;
    }

    if (heroSection) heroSection.classList.add('hidden');
    if (pageCheckout) pageCheckout.classList.add('active');
    renderCheckoutPage();
  } else if (hash.startsWith('#track')) {
    if (!state.user) {
      if (!opts.fromAuthChanged) {
        authModal.open('buyer', () => {
          window.location.hash = '#track';
        });
      } else {
        window.location.hash = '#shop';
      }
      return;
    }

    navTrack.classList.add('active');
    pageTrack.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
    fetchOrders();

    const match = hash.match(/#track-(.+)/);
    if (match && match[1]) {
      state.activeTrackingId = match[1];
      startTrackingPoll(match[1]);
    }
  } else {
    navShop.classList.add('active');
    pageShop.classList.add('active');
    if (heroSection) heroSection.classList.remove('hidden');
  }

  // Landing page: when hero is visible, hide product filter and page-size controls
  try {
    const shopControls = document.querySelector('.shop-inventory-controls');
    const filtersRow = document.getElementById('product-filters-row');
    const heroVisible = heroSection && !heroSection.classList.contains('hidden');
    if (shopControls) shopControls.style.display = heroVisible ? 'none' : 'flex';
    if (filtersRow) filtersRow.style.display = heroVisible ? 'none' : '';
  } catch (e) {
    /* ignore */
  }

  // Stories page routes
  const pageStories = document.getElementById('stories-page');
  const pageStoryDetail = document.getElementById('story-detail-page');

  if (hash === '#stories') {
    if (pageStories) pageStories.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
    pageShop.classList.remove('active');
    if (pageAbout) pageAbout.classList.remove('active');
    if (pageTrack) pageTrack.classList.remove('active');
    if (pageCheckout) pageCheckout.classList.remove('active');
    renderStoriesGrid();
    return;
  }

  const storyMatch = hash.match(/^#story-(.+)/);
  if (storyMatch && storyMatch[1]) {
    if (pageStoryDetail) pageStoryDetail.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
    pageShop.classList.remove('active');
    if (pageAbout) pageAbout.classList.remove('active');
    if (pageTrack) pageTrack.classList.remove('active');
    if (pageCheckout) pageCheckout.classList.remove('active');
    if (pageStories) pageStories.classList.remove('active');
    renderStoryDetail(storyMatch[1]);
    return;
  }

  // Blog routes
  const pageBlogs = document.getElementById('blogs-page');
  const pageBlogDetail = document.getElementById('blog-detail-page');

  if (hash === '#blogs') {
    if (pageBlogs) pageBlogs.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
    pageShop.classList.remove('active');
    if (pageAbout) pageAbout.classList.remove('active');
    if (pageTrack) pageTrack.classList.remove('active');
    if (pageCheckout) pageCheckout.classList.remove('active');
    if (pageStories) pageStories.classList.remove('active');
    if (pageStoryDetail) pageStoryDetail.classList.remove('active');
    _blogPage = 1;
    renderBlogsGrid();
    return;
  }

  const blogMatch = hash.match(/^#blog-(.+)/);
  if (blogMatch && blogMatch[1]) {
    if (pageBlogDetail) pageBlogDetail.classList.add('active');
    if (heroSection) heroSection.classList.add('hidden');
    pageShop.classList.remove('active');
    if (pageAbout) pageAbout.classList.remove('active');
    if (pageTrack) pageTrack.classList.remove('active');
    if (pageCheckout) pageCheckout.classList.remove('active');
    if (pageStories) pageStories.classList.remove('active');
    if (pageStoryDetail) pageStoryDetail.classList.remove('active');
    if (pageBlogs) pageBlogs.classList.remove('active');
    renderBlogDetail(blogMatch[1]);
    return;
  }

  // Additional SPA routes for training register and training courses (anchor-based)
  const shopSection = document.getElementById('shop-section');
  const productsSection = document.getElementById('products-section');
  try {
    const regSection = document.getElementById('training-register');
    const coursesSection = document.getElementById('training-courses');
    if (hash === '#training-register') {
      if (regSection) regSection.style.display = 'block';
      if (coursesSection) coursesSection.style.display = 'none';
      if (shopSection) shopSection.style.display = 'block';
      if (productsSection) productsSection.style.display = 'block';
      if (heroSection) heroSection.classList.add('hidden');
      regSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (hash === '#training-courses') {
      // Require authentication for training courses - any authenticated user can access
      if (!state.token || !state.user) {
        if (regSection) regSection.style.display = 'none';
        if (coursesSection) coursesSection.style.display = 'none';
        if (shopSection) shopSection.style.display = 'block';
        if (productsSection) productsSection.style.display = 'block';
        if (heroSection) heroSection.classList.remove('hidden');
        traineeAuthModal.open(() => {
          window.location.hash = '#training-courses';
        });
        return;
      }
      if (regSection) regSection.style.display = 'none';
      if (coursesSection) coursesSection.style.display = 'block';
      if (shopSection) shopSection.style.display = 'none';
      if (productsSection) productsSection.style.display = 'none';
      if (heroSection) heroSection.classList.add('hidden');
      coursesSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      renderTrainingCourses();
      return;
    }
    if (regSection) regSection.style.display = 'none';
    if (coursesSection) coursesSection.style.display = 'none';
    if (shopSection) shopSection.style.display = 'block';
    if (productsSection) productsSection.style.display = 'block';
  } catch (err) {
    // ignore if elements not present
  }
}


// ==========================================================================
// EVENT LISTENERS
// ==========================================================================
function initEventListeners() {
  // Navigation Routing Links
  // Category dropdown toggle (opens category menu and keeps shop routing available)
  const btnNavShop = document.getElementById('btn-nav-shop');
  if (btnNavShop) {
    btnNavShop.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dd = document.getElementById('cat-dropdown-menu');
      if (!dd) return;
      dd.classList.toggle('hidden');
      dd.setAttribute('aria-hidden', dd.classList.contains('hidden'));
      // Also ensure shop page is visible
      window.location.hash = '#shop';
    });
  }

  // Close category dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('cat-dropdown-menu');
    const btn = document.getElementById('btn-nav-shop');
    if (dd && !dd.classList.contains('hidden')) {
      if (!dd.contains(e.target) && !btn?.contains(e.target)) {
        dd.classList.add('hidden');
        dd.setAttribute('aria-hidden', 'true');
      }
    }
  });

  document.getElementById('btn-nav-track').addEventListener('click', (e) => {
    e.preventDefault();
    if (!state.user) {
      authModal.open('buyer', () => {
        profileModal.open('orders');
      });
    } else {
      profileModal.open('orders');
    }
  });

  // Nav link click handlers (About, Training, Contact, etc.)
  document.querySelectorAll('.nav-link:not(#btn-nav-track)').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href) {
        window.location.hash = href;
      }
    });
  });

  // Training Section Explore button -> open trainee auth modal
  const exploreTrainingBtn = document.querySelector('.btn-training');
  if (exploreTrainingBtn) {
    exploreTrainingBtn.addEventListener('click', (e) => {
      e.preventDefault();
      traineeAuthModal.open(() => {
        // On success, redirect to training courses view
        window.location.hash = '#training-courses';
      });
    });
  }

  const trainingPlayBtn = document.getElementById('training-play-btn');
  if (trainingPlayBtn) {
    trainingPlayBtn.addEventListener('click', async (e) => {
      e.preventDefault();

      const imgEl = document.getElementById('training-farm-img');
      const videoEl = document.getElementById('training-farm-video');
      const closeBtn = document.getElementById('training-video-close');

      if (!videoEl) return;

      // If video is already playing/visible, toggle it off
      if (videoEl.style.display !== 'none') {
        videoEl.pause();
        videoEl.style.display = 'none';
        if (imgEl) imgEl.style.display = 'block';
        if (closeBtn) closeBtn.style.display = 'none';
        trainingPlayBtn.style.display = 'flex';
        return;
      }

      // Find the video file
      const candidates = ['training-tour.mp4'];
      let foundPath = null;
      for (const fname of candidates) {
        const candidatePath = `/videos/${fname}`;
        try {
          const head = await fetch(candidatePath, { method: 'HEAD' });
          if (head.ok) {
            foundPath = candidatePath;
            break;
          }
        } catch (e) {
          // ignore
        }
      }

      if (!foundPath) {
        // Try a broader fallback
        const fallbackCandidates = ['mush.mp4', 'mushroom.mp4'];
        for (const fname of fallbackCandidates) {
          const candidatePath = `/videos/${fname}`;
          try {
            const head = await fetch(candidatePath, { method: 'HEAD' });
            if (head.ok) {
              foundPath = candidatePath;
              break;
            }
          } catch (e) {
            // ignore
          }
        }
      }

      if (foundPath) {
        // Show video inline — hide image, show video
        if (imgEl) imgEl.style.display = 'none';
        videoEl.src = foundPath;
        videoEl.style.display = 'block';
        if (closeBtn) closeBtn.style.display = 'block';
        trainingPlayBtn.style.display = 'none';
        videoEl.load();
        try {
          await videoEl.play();
        } catch (e) {
          console.warn('Autoplay blocked or play failed:', e);
        }
        // When video ends, revert to image
        videoEl.onended = () => {
          videoEl.pause();
          videoEl.style.display = 'none';
          if (imgEl) imgEl.style.display = 'block';
          if (closeBtn) closeBtn.style.display = 'none';
          trainingPlayBtn.style.display = 'flex';
        };
      }
    });
  }

  // Close button handler for inline video
  const videoCloseBtn = document.getElementById('training-video-close');
  if (videoCloseBtn) {
    videoCloseBtn.addEventListener('click', () => {
      const imgEl = document.getElementById('training-farm-img');
      const videoEl = document.getElementById('training-farm-video');
      const playBtn = document.getElementById('training-play-btn');
      if (videoEl) {
        videoEl.pause();
        videoEl.style.display = 'none';
      }
      if (imgEl) imgEl.style.display = 'block';
      if (playBtn) playBtn.style.display = 'flex';
      videoCloseBtn.style.display = 'none';
    });
  }

  document.getElementById('nav-logo').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.hash = '#shop';
  });

  const heroShopBtn = document.getElementById('hero-shop-btn');
  if (heroShopBtn) {
    heroShopBtn.addEventListener('click', () => { window.location.hash = '#shop'; });
  }

  // Listen for global auth changes from new modules
  window.addEventListener('auth:changed', () => {
    updateAuthHeaderUI();
    handleRouting({ fromAuthChanged: true });
  });

  // Cart Slide Out Drawer
  document
    .getElementById('btn-open-cart')
    .addEventListener('click', () => { toggleCartDrawer(true); });
  const btnMobileCart = document.getElementById('btn-mobile-cart');
  if (btnMobileCart) {
    btnMobileCart.addEventListener('click', () => { toggleCartDrawer(true); });
  }
  document
    .getElementById('btn-close-cart')
    .addEventListener('click', () => { toggleCartDrawer(false); });
  document
    .getElementById('cart-drawer-overlay')
    .addEventListener('click', () => { toggleCartDrawer(false); });

  // Promo application
  document
    .getElementById('btn-apply-promo')
    .addEventListener('click', applyPromoCode);

  // Checkout
  const btnCheckout = document.getElementById('btn-checkout');
  if (btnCheckout) {
    btnCheckout.addEventListener('click', handleCheckoutInitiation);
  }

  const btnPaymentContinue = document.getElementById('btn-payment-continue');
  if (btnPaymentContinue) {
    btnPaymentContinue.addEventListener('click', handlePaymentContinue);
  }

  const btnChangeCart = document.getElementById('btn-change-cart');
  if (btnChangeCart) {
    btnChangeCart.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = '#shop';
      toggleCartDrawer(true);
    });
  }

  const checkoutStateSelect = document.getElementById('checkout-state');
  const checkoutCitySelect = document.getElementById('checkout-city');

  const updateCheckoutCities = async (selectedState, defaultCity = '') => {
    if (!checkoutCitySelect) return;
    if (!selectedState) {
      checkoutCitySelect.innerHTML = '<option value="">Select State first</option>';
      return;
    }
    const cities = await _loadCities(selectedState);
    if (!cities.length && !_citiesCache[selectedState]) {
      checkoutCitySelect.innerHTML = '<option value="">Select State first</option>';
      return;
    }
    checkoutCitySelect.innerHTML = '<option value="">Select City</option>' +
      cities.map(c => `<option value="${c}">${c}</option>`).join('');

    if (defaultCity) {
      if (!cities.includes(defaultCity)) {
        const opt = document.createElement('option');
        opt.value = defaultCity;
        opt.textContent = defaultCity;
        checkoutCitySelect.appendChild(opt);
      }
      checkoutCitySelect.value = defaultCity;
    }
  };

  if (checkoutStateSelect) {
    checkoutStateSelect.innerHTML = '<option value="">Select State</option>' +
      _statesCache.map(s => `<option value="${s}">${s}</option>`).join('');

    checkoutStateSelect.addEventListener('change', (e) => {
      updateCheckoutCities(e.target.value);
    });
  }

  const pincodeInput = document.getElementById('checkout-delivery-pincode');
  if (pincodeInput) {
    pincodeInput.addEventListener('input', async (e) => {
      const pin = e.target.value.trim();
      if (pin.length === 6 && /^\d{6}$/.test(pin)) {
        try {
          const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
          const data = await res.json();
          if (data && data[0] && data[0].Status === 'Success') {
            const postOffice = data[0].PostOffice[0];
            const fetchedState = postOffice.State || '';
            const fetchedCity = postOffice.District || postOffice.Region || '';

            if (fetchedState && checkoutStateSelect) {
              if (!_statesCache.includes(fetchedState) && !checkoutStateSelect.querySelector(`option[value="${CSS.escape(fetchedState)}"]`)) {
                const opt = document.createElement('option');
                opt.value = fetchedState;
                opt.textContent = fetchedState;
                checkoutStateSelect.appendChild(opt);
              }
              checkoutStateSelect.value = fetchedState;
              updateCheckoutCities(fetchedState, fetchedCity);
            }
          } else {
            if (checkoutStateSelect) checkoutStateSelect.value = '';
            if (checkoutCitySelect) checkoutCitySelect.innerHTML = '<option value="">Select State first</option>';
          }
        } catch (err) {
          console.error('Failed to fetch pincode details', err);
        }
      } else {
        if (checkoutStateSelect) checkoutStateSelect.value = '';
        if (checkoutCitySelect) checkoutCitySelect.innerHTML = '<option value="">Select State first</option>';
      }
    });
  }

  // Calculator
  document
    .getElementById('btn-calculate-substrate')
    .addEventListener('click', calculateSubstrateMix);

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
    let searchDebounceTimer;
    searchInput.addEventListener('input', () => {
      _shopInventoryPage = 1;
      fetchProducts();
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        updateSearchSuggestions(searchInput.value);
      }, 250);
    });
    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim()) updateSearchSuggestions(searchInput.value);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const dd = document.getElementById('search-suggestions-dropdown');
        if (dd && !dd.classList.contains('hidden')) {
          const firstItem = dd.querySelector('.suggestion-item');
          if (firstItem) firstItem.click();
        }
      }
    });
  }

  // Close suggestions and profile dropdown on outside click
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('topbar-search-wrap');
    if (wrap && !wrap.contains(e.target)) {
      const dd = document.getElementById('search-suggestions-dropdown');
      if (dd) dd.classList.add('hidden');
    }

    const profileArea = document.getElementById('user-profile-section');
    if (profileArea && !profileArea.contains(e.target)) {
      closeUserProfileDropdown();
    }
  });

  // Category filter button toggles â€“ scoped to the visible product filters row only
  document.querySelectorAll('#product-filters-row .cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('#product-filters-row .cat-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeCategory = btn.getAttribute('data-category') || 'all';
      _shopInventoryPage = 1;
      fetchProducts();
    });
  });

  const shopSortSelect = document.getElementById('shop-inventory-sort');
  if (shopSortSelect) {
    shopSortSelect.addEventListener('change', () => {
      _shopInventoryPage = 1;
      fetchProducts();
    });
  }
  const shopPageSizeSelect = document.getElementById('shop-inventory-page-size');
  if (shopPageSizeSelect) {
    shopPageSizeSelect.addEventListener('change', () => {
      shopPageSize = parseInt(shopPageSizeSelect.value, 10) || 10;
      _shopInventoryPage = 1;
      fetchProducts();
    });
  }

  // Category nav links in NAVBAR (data-category on nav-link)
  document.querySelectorAll('.nav-link[data-category]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToCategory(link.getAttribute('data-category'));
    });
  });

  // Category links in FOOTER
  document
    .querySelectorAll('.footer-cat-link[data-category]')
    .forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateToCategory(link.getAttribute('data-category'));
      });
    });

  // Mobile menu toggles
  const btnMobile = document.getElementById('btn-mobile-menu');
  const mobileNav = document.getElementById('mobile-nav');
  const btnMobileClose = document.getElementById('btn-mobile-close');
  if (btnMobile && mobileNav) {
    btnMobile.addEventListener('click', () => {
      mobileNav.classList.remove('hidden');
    });
  }
  if (btnMobileClose && mobileNav) {
    btnMobileClose.addEventListener('click', () => mobileNav.classList.add('hidden'));
  }
  // Clone main nav links into mobile nav
  const mainLinks = document.getElementById('main-nav-links');
  const mobileLinks = document.getElementById('mobile-nav-links');
  if (mainLinks && mobileLinks) {
    mobileLinks.innerHTML = mainLinks.innerHTML;
    mobileLinks.querySelectorAll('.nav-link').forEach((a) => {
      a.addEventListener('click', (e) => {
        mobileNav.classList.add('hidden');
      });
    });
  }

  // Admin inline modal triggers (desktop + mobile)
  // Admin buttons removed - admin login now integrated in auth modal via "Staff? Use admin login" link

  // Mobile regular login button
  const mobileAuthBtn = document.getElementById('btn-open-auth-mobile');
  if (mobileAuthBtn) {
    mobileAuthBtn.addEventListener('click', (e) => {
      e.preventDefault();
      mobileNav.classList.add('hidden');
      authModal.open('buyer');
    });
  }

  // Topbar login button (header)
  const topbarAuthBtn = document.getElementById('btn-open-auth-top');
  if (topbarAuthBtn) {
    topbarAuthBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const existing = document.getElementById('auth-choice-menu');
      if (existing) {
        existing.remove();
        return;
      }

      const menu = document.createElement('div');
      menu.id = 'auth-choice-menu';
      menu.style.position = 'absolute';
      menu.style.background = '#fff';
      menu.style.border = '1px solid rgba(0,0,0,0.12)';
      menu.style.borderRadius = '10px';
      menu.style.boxShadow = '0 14px 35px rgba(0,0,0,0.12)';
      menu.style.padding = '10px';
      menu.style.zIndex = '9999';
      menu.style.minWidth = '200px';
      menu.style.display = 'grid';
      menu.style.gap = '8px';
      menu.innerHTML = `
        <button class="btn btn-secondary-glow" id="auth-choice-user" style="width:100%;">User Login</button>
        <button class="btn btn-secondary" id="auth-choice-trainee" style="width:100%;">Trainee / Grower Login</button>
        <div style="border-top:1px solid #eee;margin:4px 0"></div>
        <button class="btn btn-secondary" id="auth-choice-admin" style="width:100%;font-size:0.85rem;">Admin Login</button>
      `;
      document.body.appendChild(menu);

      const rect = topbarAuthBtn.getBoundingClientRect();
      menu.style.top = `${rect.bottom + window.scrollY + 8}px`;
      menu.style.left = `${Math.max(8, rect.right + window.scrollX - menu.offsetWidth)}px`;

      const closeMenu = () => {
        if (menu.parentElement) menu.parentElement.removeChild(menu);
        document.removeEventListener('click', outsideClickListener);
      };

      const outsideClickListener = (event) => {
        if (!menu.contains(event.target) && event.target !== topbarAuthBtn) {
          closeMenu();
        }
      };

      document.getElementById('auth-choice-user')?.addEventListener('click', () => {
        closeMenu();
        authModal.open('buyer');
      });
      document.getElementById('auth-choice-trainee')?.addEventListener('click', () => {
        closeMenu();
        traineeAuthModal.open(() => {
          window.location.hash = '#training-courses';
        });
      });
      document.getElementById('auth-choice-admin')?.addEventListener('click', () => {
        closeMenu();
        authModal.open('admin');
      });
      setTimeout(() => document.addEventListener('click', outsideClickListener), 0);
    });
  }

  // Initialize training register handlers (if present)
  try {
    initTrainingRegister();
  } catch (e) {
    /* ignore if not loaded yet */
  }

  // ── Homepage Carousel ──
  const carouselPrev = document.getElementById('carousel-prev');
  const carouselNext = document.getElementById('carousel-next');
  if (carouselPrev) carouselPrev.addEventListener('click', () => carouselGo(-1));
  if (carouselNext) carouselNext.addEventListener('click', () => carouselGo(1));

  // Category card "Shop Now" buttons â€“ filter products and scroll to grid
  document.querySelectorAll('.btn-category-shop').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToCategory(btn.getAttribute('data-filter-category'));
    });
  });

  // ── Training Gallery Carousel ──
  const tgPrev = document.getElementById('tg-prev');
  const tgNext = document.getElementById('tg-next');
  if (tgPrev) tgPrev.addEventListener('click', () => { tgPrevPage(); resetTgAutoplay(); });
  if (tgNext) tgNext.addEventListener('click', () => { tgNextPage(); resetTgAutoplay(); });

  const tgAdminEdit = document.getElementById('tg-admin-edit');
  if (tgAdminEdit) {
    tgAdminEdit.addEventListener('click', (e) => {
      e.preventDefault();
      openTgEditorModal();
    });
  }
}

// ==========================================================================
// USER AUTH CONTROLLERS
// ==========================================================================
async function loadUser() {
  if (!state.token) {
    state.user = null;
    updateAuthHeaderUI();
    handleRouting();
    return;
  }

  const tokenAtStart = state.token;
  try {
    const user = await authApi.getMe();
    if (state.token !== tokenAtStart) return;
    state.user = user;
    updateAuthHeaderUI();
    try {
      window.dispatchEvent(new CustomEvent('auth:changed', { detail: { token: state.token, user: state.user } }));
    } catch (e) { }
    handleRouting(); // trigger routing refresh for access checks
  } catch (err) {
    if (state.token !== tokenAtStart) return;
    clearAuth();
    updateAuthHeaderUI();
    if (window.location.hash === '#checkout' || window.location.hash.startsWith('#track')) {
      window.location.hash = '#shop';
    }
  }
}

// Old auth logic fully replaced by modular AuthModal.js

function logout() {
  clearAuth();
  closeUserProfileDropdown();
  updateAuthHeaderUI();
  window.location.hash = '#shop';
}
window.logout = logout;

function closeUserProfileDropdown() {
  const dropdown = document.getElementById('user-profile-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  const profileButton = document.getElementById('btn-open-profile');
  if (profileButton) profileButton.setAttribute('aria-expanded', 'false');
}

function toggleUserProfileDropdown() {
  const dropdown = document.getElementById('user-profile-dropdown');
  if (!dropdown) return;
  const isHidden = dropdown.classList.contains('hidden');
  closeUserProfileDropdown();
  if (isHidden) {
    dropdown.classList.remove('hidden');
    document
      .getElementById('btn-open-profile')
      ?.setAttribute('aria-expanded', 'true');
  }
}

function updateAuthHeaderUI() {
  const profileSection = document.getElementById('user-profile-section');
  const navTrack = document.getElementById('btn-nav-track');
  const navAdmin = document.getElementById('btn-nav-admin');
  const navAdminEntry = document.getElementById('btn-admin-entry');

  if (state.user) {
    const roleLabel = state.user.role.toUpperCase();
    const roleAction = state.user.role === 'admin'
      ? '<button class="profile-dropdown-item" id="btn-open-admin-console"><i class="fa-solid fa-user-shield"></i> Admin Console</button>'
      : state.user.role === 'grower'
        ? '<button class="profile-dropdown-item" id="btn-open-track-orders"><i class="fa-solid fa-truck-fast"></i> Track Orders</button>'
        : '';

    profileSection.innerHTML = `
      <div class="user-profile-wrap">
        <button class="user-profile-btn" id="btn-open-profile" type="button" aria-haspopup="menu" aria-expanded="false">
          ${state.user.avatarUrl ? `<img src="${state.user.avatarUrl}" class="nav-profile-avatar" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;">` : '<i class="fa-solid fa-circle-user"></i>'}
          <span class="user-profile-name">${state.user.fullName}</span>
          <i class="fa-solid fa-chevron-down dropdown-caret"></i>
        </button>
        <div class="user-profile-dropdown hidden" id="user-profile-dropdown" role="menu" aria-label="User menu">
          <button class="profile-dropdown-item" id="btn-open-profile-modal" type="button"><i class="fa-solid fa-id-badge"></i> Profile</button>
          ${roleAction}
          <button class="profile-dropdown-item danger" id="btn-user-logout" type="button"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>
        </div>
      </div>
    `;

    document
      .getElementById('btn-open-profile')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUserProfileDropdown();
      });
    document
      .getElementById('btn-open-profile-modal')
      ?.addEventListener('click', () => {
        closeUserProfileDropdown();
        profileModal.open();
      });
    document
      .getElementById('btn-open-admin-console')
      ?.addEventListener('click', () => {
        closeUserProfileDropdown();
        window.location.href = '/admin.html';
      });
    document
      .getElementById('btn-open-track-orders')
      ?.addEventListener('click', () => {
        closeUserProfileDropdown();
        window.location.hash = '#track';
      });
    document
      .getElementById('btn-open-my-orders')
      ?.addEventListener('click', () => {
        closeUserProfileDropdown();
        window.location.hash = '#checkout';
      });
    document
      .getElementById('btn-user-logout')
      ?.addEventListener('click', logout);

    // Toggle navigation visibilities
    navTrack.style.display = 'inline-flex';
    if (state.user.role === 'admin') {
      navAdmin.style.display = 'inline-flex';
      if (navAdminEntry) navAdminEntry.style.display = 'none';
      // Hide cart for admins
      const cartTrigger = document.getElementById('btn-open-cart');
      if (cartTrigger) cartTrigger.style.display = 'none';
      const mobileCart = document.getElementById('btn-mobile-cart');
      if (mobileCart) mobileCart.style.display = 'none';
    } else {
      navAdmin.style.display = 'none';
      if (navAdminEntry) navAdminEntry.style.display = 'inline-flex';
      const cartTrigger = document.getElementById('btn-open-cart');
      if (cartTrigger) cartTrigger.style.display = '';
      const mobileCart = document.getElementById('btn-mobile-cart');
      if (mobileCart) mobileCart.style.display = '';
    }
  } else {
    profileSection.innerHTML = '';
    navTrack.style.display = 'none';
    navAdmin.style.display = 'none';
    if (navAdminEntry) navAdminEntry.style.display = 'inline-flex';
    const topbarAuth = document.getElementById('btn-open-auth-top');
    if (topbarAuth) topbarAuth.style.display = 'inline-flex';
  }

  // Hide topbar login when user is logged in
  if (state.user) {
    const topbarAuth = document.getElementById('btn-open-auth-top');
    if (topbarAuth) topbarAuth.style.display = 'none';
  }
}

// ==========================================================================
// CATALOG CONTROLLERS & DATA FITTING
// ==========================================================================
let _shopPagination = null;

async function fetchProducts() {
  try {
    const params = new URLSearchParams();
    const sort = getShopInventorySortValue();
    if (sort && sort !== 'name_asc') params.set('sort', sort);
    const cat = state.activeCategory;
    if (cat && cat !== 'all') params.set('category', cat);
    const search = document.getElementById('shop-search')?.value?.trim();
    if (search) params.set('search', search);
    params.set('page', _shopInventoryPage);
    params.set('limit', shopPageSize);

    const path = `/products?${params.toString()}`;
    const result = await fetchWithAuth(path);

    if (Array.isArray(result)) {
      state.products = result;
      _shopPagination = null;
    } else if (result && typeof result === 'object' && result.products) {
      state.products = result.products;
      _shopPagination = result.pagination;
      _shopInventoryPage = result.pagination?.page || _shopInventoryPage;
    } else {
      state.products = [];
      _shopPagination = null;
    }
    renderProducts();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err));
    document.getElementById('product-grid').innerHTML = `
      <div class="grid-skeleton">
        <i class="fa-solid fa-triangle-exclamation loader-icon" style="color: var(--color-danger)"></i>
        <p>Failed to retrieve products. Please refresh the page.</p>
      </div>
    `;
  }
}

function _formatCurrency(n) {
  return `₹${Number(n).toFixed(2)}`;
}

function _getStockMeta(stock) {
  if (stock > 10) return { label: 'Available', variant: 'available' };
  if (stock > 5) return { label: 'Limited Stocks', variant: 'limited' };
  return { label: 'Few Available', variant: 'few' };
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  const productsList = state.products;

  if (!productsList || productsList.length === 0) {
    grid.innerHTML = `
      <div class="grid-skeleton">
        <i class="fa-solid fa-magnifying-glass loader-icon"></i>
        <p>No products found.</p>
      </div>
    `;
    return;
  }

  // Server already sorted and paginated — no local sorting/pagination needed
  const pageProducts = productsList;

  const isAdmin = state.user?.role === 'admin';

  const html = pageProducts
    .map((prod, idx) => {
      const catLabel = prod.category === 'spawn' ? 'Spawn & Seeds' : 'Mushroom';
      const fallbackPrice = prod.price || 0;
      const hasMrp = prod.mrp_price && prod.mrp_price > fallbackPrice;
      const discountPct = hasMrp
        ? Math.round((1 - fallbackPrice / prod.mrp_price) * 100)
        : 0;
      const stockMeta = prod.stock_status || _getStockMeta(prod.stock);
      const hasWeights = Array.isArray(prod.weight_pricing) && prod.weight_pricing.length > 0;
      const defaultWeight = hasWeights ? prod.weight_pricing[0] : null;

      const galleryImages = (prod.image_urls && prod.image_urls.length > 0) ? prod.image_urls : [prod.image_url];
      const mainImage = galleryImages[0] || prod.image_url;
      const carouselId = `carousel-${prod.id}`;

      return `
        <div class="product-card reveal-element" data-id="${prod.id}" style="transition-delay: ${idx * 0.05}s">
          <div class="product-img-wrapper">
            <div class="product-carousel" id="${carouselId}" data-images='${JSON.stringify(galleryImages.map(img => img || prod.image_url).filter(Boolean)).replace(/'/g, "&#39;")}'>
              <div class="carousel-track">
                ${galleryImages.filter(Boolean).map((img, i) => `
                  <img src="${img}" alt="${prod.name} - ${i + 1}" loading="lazy" class="carousel-slide ${i === 0 ? 'active' : ''}">
                `).join('')}
              </div>
              ${galleryImages.length > 1 ? `
                <button type="button" class="carousel-btn carousel-prev" data-carousel="${carouselId}"><i class="fa-solid fa-chevron-left"></i></button>
                <button type="button" class="carousel-btn carousel-next" data-carousel="${carouselId}"><i class="fa-solid fa-chevron-right"></i></button>
                <div class="carousel-dots">
                  ${galleryImages.filter(Boolean).map((_, i) => `
                    <span class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}" data-carousel="${carouselId}"></span>
                  `).join('')}
                </div>
              ` : ''}
            </div>
            <div class="product-badges-overlay">
              <span class="tag tag-stock tag-stock-${stockMeta.variant}">${stockMeta.label}</span>
              <span class="product-gst-badge">${prod.gst_rate}% GST</span>
            </div>
            ${hasMrp ? `
              <span class="product-discount-badge" data-prod-id="${prod.id}">${discountPct}% OFF</span>
            ` : `
              <span class="product-discount-badge" data-prod-id="${prod.id}" style="display: none;"></span>
            `}
          </div>
          <div class="product-info">
            <div class="product-meta-row">
              <span class="product-category-lbl">${catLabel}</span>
              <span class="product-free-shipping-badge"><i class="fa-solid fa-truck-fast"></i> Free Shipping</span>
            </div>
            <h3>${prod.name}</h3>
            <p class="product-desc">${prod.description}</p>
            
            ${hasWeights ? `
              <div class="product-weight-selector">
                <span class="selector-lbl">Select Variant:</span>
                <div class="weight-chips-container">
                  ${prod.weight_pricing.map(w => {
        const label = w.unit === 'kg' ? `${w.weight} kg` : w.unit === 'l' ? `${w.weight} l` : w.unit === 'ml' ? `${w.weight} ml` : `${w.weight} g`;
        const isDefault = w === defaultWeight;
        return `
                      <button type="button" class="weight-chip ${isDefault ? 'active' : ''}" 
                        data-value="${w.weight}_${w.unit}_${w.price}_${w.mrp_price || ''}" 
                        data-prod-id="${prod.id}">
                        ${label}
                      </button>
                    `;
      }).join('')}
                </div>
              </div>
            ` : ''}
            
            <div class="product-card-footer">
              <div class="product-price-section">
                <div class="product-price-wrap">
                  <span class="product-price" data-prod-id="${prod.id}">${_formatCurrency(defaultWeight ? defaultWeight.price : fallbackPrice)}</span>
                  ${defaultWeight && defaultWeight.mrp_price && defaultWeight.mrp_price > defaultWeight.price
          ? `<span class="product-mrp" data-prod-id="${prod.id}">${_formatCurrency(defaultWeight.mrp_price)}</span>`
          : hasMrp ? `<span class="product-mrp" data-prod-id="${prod.id}">${_formatCurrency(prod.mrp_price)}</span>` : `<span class="product-mrp" data-prod-id="${prod.id}" style="display: none;"></span>`}
                </div>
              </div>
              ${isAdmin ? `
                <span class="admin-view-badge"><i class="fa-solid fa-eye"></i> View Only</span>
              ` : `
                <button class="btn-card-add" data-id="${prod.id}" title="Add to Cart">
                  <i class="fa-solid fa-cart-plus"></i> Add
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  grid.innerHTML = html;

  // reveal animation
  requestAnimationFrame(() => {
    setTimeout(() => {
      grid
        .querySelectorAll('.product-card')
        .forEach((card) => card.classList.add('revealed'));
    }, 50);
  });

  // interactions
  grid.querySelectorAll('.product-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-card-add') || e.target.closest('.weight-chip')) return;
      const id = card.getAttribute('data-id');
      if (isAdmin) {
        openProductDetails(id);
      } else {
        showQuickAddModal(id);
      }
    });
  });

  // Product carousel interactions
  grid.querySelectorAll('.carousel-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const carouselId = btn.getAttribute('data-carousel');
      const carousel = document.getElementById(carouselId);
      if (!carousel) return;
      const slides = carousel.querySelectorAll('.carousel-slide');
      const dots = carousel.querySelectorAll('.carousel-dot');
      if (slides.length === 0) return;
      const currentIndex = carousel.querySelector('.carousel-slide.active') ? Array.from(slides).indexOf(carousel.querySelector('.carousel-slide.active')) : 0;
      let newIndex = currentIndex;
      if (btn.classList.contains('carousel-prev')) {
        newIndex = (currentIndex - 1 + slides.length) % slides.length;
      } else {
        newIndex = (currentIndex + 1) % slides.length;
      }
      carousel.querySelectorAll('.carousel-slide').forEach(s => s.classList.remove('active'));
      carousel.querySelectorAll('.carousel-dot').forEach(d => d.classList.remove('active'));
      if (slides[newIndex]) slides[newIndex].classList.add('active');
      if (dots[newIndex]) dots[newIndex].classList.add('active');
    });
  });

  grid.querySelectorAll('.carousel-dot').forEach((dot) => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const carouselId = dot.getAttribute('data-carousel');
      const index = parseInt(dot.getAttribute('data-index'), 10);
      const carousel = document.getElementById(carouselId);
      if (!carousel) return;
      const slides = carousel.querySelectorAll('.carousel-slide');
      const dots = carousel.querySelectorAll('.carousel-dot');
      carousel.querySelectorAll('.carousel-slide').forEach(s => s.classList.remove('active'));
      carousel.querySelectorAll('.carousel-dot').forEach(d => d.classList.remove('active'));
      if (slides[index]) slides[index].classList.add('active');
      dot.classList.add('active');
    });
  });

  grid.querySelectorAll('.btn-card-add').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      const origContent = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      const id = btn.getAttribute('data-id');
      const product = state.products.find(p => p.id === id);
      const activeChip = grid.querySelector(`.weight-chip.active[data-prod-id="${id}"]`);
      let weightInfo = null;
      if (activeChip) {
        const parts = activeChip.getAttribute('data-value').split('_');
        if (parts.length >= 4) {
          weightInfo = { weight: parseInt(parts[0], 10), unit: parts[1], price: parseFloat(parts[2]), mrp_price: parts[3] ? parseFloat(parts[3]) : undefined };
        }
      }
      addToCart(id, weightInfo);
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = origContent;
      }, 600);
    });
  });

  // Weight chip change: update displayed price, active state and discount badge
  grid.querySelectorAll('.weight-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const prodId = chip.getAttribute('data-prod-id');

      // Remove active class from all other chips of this product
      grid.querySelectorAll(`.weight-chip[data-prod-id="${prodId}"]`).forEach(c => c.classList.remove('active'));

      // Set active
      chip.classList.add('active');

      const parts = chip.getAttribute('data-value').split('_');
      if (parts.length < 4) return;
      const price = parseFloat(parts[2]);
      const mrp = parts[3] ? parseFloat(parts[3]) : null;

      const priceEl = grid.querySelector(`.product-price[data-prod-id="${prodId}"]`);
      const mrpEl = grid.querySelector(`.product-mrp[data-prod-id="${prodId}"]`);
      const discountEl = grid.querySelector(`.product-discount-badge[data-prod-id="${prodId}"]`);

      if (priceEl) priceEl.textContent = _formatCurrency(price);
      if (mrpEl) {
        if (mrp && mrp > price) {
          mrpEl.textContent = _formatCurrency(mrp);
          mrpEl.style.display = '';
        } else {
          mrpEl.style.display = 'none';
        }
      }

      if (discountEl) {
        if (mrp && mrp > price) {
          const discountPct = Math.round((1 - price / mrp) * 100);
          discountEl.textContent = `${discountPct}% OFF`;
          discountEl.style.display = '';
        } else {
          discountEl.style.display = 'none';
        }
      }
    });
  });

  // Pagination controls
  const paginationWrap = document.getElementById('product-pagination');
  if (paginationWrap) {
    const totalPages = _shopPagination ? _shopPagination.totalPages : Math.max(1, Math.ceil(productsList.length / shopPageSize));
    const totalItems = _shopPagination ? _shopPagination.total : productsList.length;
    if (_shopInventoryPage > totalPages) _shopInventoryPage = totalPages;

    paginationWrap.innerHTML = `
  <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding: 0 4px;">
    <span style="font-size:0.85rem; color:var(--color-text-muted);">
      ${totalItems > 0 ? `Page ${_shopInventoryPage} of ${totalPages} (${totalItems} products)` : ''}
    </span>
    <div>
      <button type="button" id="shop-page-prev" ${_shopInventoryPage <= 1 ? 'disabled' : ''} 
        style="background:none; border:none; cursor:pointer; color:var(--color-text-secondary); font-size:1.4rem; padding:4px 8px; opacity:${_shopInventoryPage <= 1 ? '0.3' : '1'};">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <button type="button" id="shop-page-next" ${_shopInventoryPage >= totalPages ? 'disabled' : ''}
        style="background:none; border:none; cursor:pointer; color:var(--color-text-secondary); font-size:1.4rem; padding:4px 8px; opacity:${_shopInventoryPage >= totalPages ? '0.3' : '1'};">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
  </div>
`;

    const prev = document.getElementById('shop-page-prev');
    const next = document.getElementById('shop-page-next');
    if (prev) prev.addEventListener('click', () => { if (_shopInventoryPage > 1) { _shopInventoryPage -= 1; fetchProducts(); } });
    if (next) next.addEventListener('click', () => { if (_shopInventoryPage < totalPages) { _shopInventoryPage += 1; fetchProducts(); } });
  }
}

// Category navigation helper (used by navbar, footer, and category cards)
function navigateToCategory(category) {
  // Ensure shop page is active
  if (!document.getElementById('shop-page').classList.contains('active')) {
    window.location.hash = '#shop';
  }

  state.activeCategory = category;

  // Update active filter tab
  document.querySelectorAll('#product-filters-row .cat-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-category') === category);
  });

  _shopInventoryPage = 1;
  fetchProducts();

  // Scroll to products section
  const productsSection = document.getElementById('products-section');
  if (productsSection) {
    productsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Search autocomplete dropdown
async function updateSearchSuggestions(query) {
  const dd = document.getElementById('search-suggestions-dropdown');
  if (!dd) return;
  if (!query.trim()) {
    dd.classList.add('hidden');
    return;
  }

  let result;
  try {
    result = await searchApi.search(query);
  } catch {
    dd.classList.add('hidden');
    return;
  }

  const { products = [], categories = [], trainings = [] } = result || {};
  const hasProducts = Array.isArray(products) && products.length > 0;
  const hasCategories = Array.isArray(categories) && categories.length > 0;
  const hasTrainings = Array.isArray(trainings) && trainings.length > 0;

  if (!hasProducts && !hasCategories && !hasTrainings) {
    dd.innerHTML = `<div class="suggestions-empty"><i class="fa-solid fa-magnifying-glass"></i> No results found for "${query}"</div>`;
    dd.classList.remove('hidden');
    return;
  }

  const productItems = products
    .slice(0, 4)
    .map((p) => {
      const hasWeights = Array.isArray(p.weight_pricing) && p.weight_pricing.length > 0;
      const fallbackP = p.price || 0;
      const displayPrice = hasWeights ? p.weight_pricing[0].price : fallbackP;
      const displayMrp = hasWeights && p.weight_pricing[0].mrp_price && p.weight_pricing[0].mrp_price > p.weight_pricing[0].price
        ? p.weight_pricing[0].mrp_price : (p.mrp_price && p.mrp_price > fallbackP ? p.mrp_price : null);
      return `
      <div class="suggestion-item" data-type="product" data-id="${p.id}">
        <img src="${p.image_url}" alt="${p.name}">
        <div class="suggestion-item-info">
          <div class="suggestion-item-name">${p.name}</div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span class="suggestion-item-price">₹${displayPrice.toFixed(2)}</span>
            ${displayMrp ? `<span class="suggestion-item-mrp">₹${displayMrp.toFixed(2)}</span>` : ''}
          </div>
        </div>
        <span class="suggestion-item-cat">Product</span>
      </div>
    `;
    })
    .join('');

  const categoryItems = categories
    .slice(0, 4)
    .map((c) => `
      <div class="suggestion-item" data-type="category" data-id="${c.id}">
        <div class="suggestion-item-icon"><i class="fa-solid fa-layer-group"></i></div>
        <div class="suggestion-item-info">
          <div class="suggestion-item-name">${c.name}</div>
          <div class="suggestion-item-sub">${c.description || ''}</div>
        </div>
        <span class="suggestion-item-cat">Category</span>
      </div>
    `)
    .join('');

  const trainingItems = trainings
    .slice(0, 4)
    .map((t) => {
      const priceDisplay = t.price_actual
        ? `<span class="suggestion-item-price">₹${Number(t.price_actual).toFixed(2)}</span>`
        : '';
      return `
      <div class="suggestion-item" data-type="training" data-id="${t.id}">
        <div class="suggestion-item-icon"><i class="fa-solid fa-graduation-cap"></i></div>
        <div class="suggestion-item-info">
          <div class="suggestion-item-name">${t.title}</div>
          ${priceDisplay}
        </div>
        <span class="suggestion-item-cat">${t.category || 'Course'}</span>
      </div>
    `;
    })
    .join('');

  let html = '';
  if (productItems) {
    html += `<div class="suggestions-group-label"><i class="fa-solid fa-bag-shopping"></i> Products</div>${productItems}`;
  }
  if (categoryItems) {
    html += `<div class="suggestions-group-label"><i class="fa-solid fa-layer-group"></i> Categories</div>${categoryItems}`;
  }
  if (trainingItems) {
    html += `<div class="suggestions-group-label"><i class="fa-solid fa-graduation-cap"></i> Training & Courses</div>${trainingItems}`;
  }

  dd.innerHTML = html;
  dd.classList.remove('hidden');

  // Wire click events
  dd.querySelectorAll('.suggestion-item').forEach((item) => {
    item.addEventListener('click', () => {
      const type = item.getAttribute('data-type');
      const id = item.getAttribute('data-id');
      dd.classList.add('hidden');
      document.getElementById('shop-search').value = '';

      if (type === 'product') {
        _shopInventoryPage = 1;
        fetchProducts();
        openProductDetails(id);
      } else if (type === 'category') {
        navigateToCategory(id);
      } else if (type === 'training') {
        window.location.hash = '#training-section';
      }
    });
  });
}

// Quick add to cart modal
function showQuickAddModal(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;

  const modal = document.getElementById('quick-add-modal');
  const body = document.getElementById('quick-add-body');

  const hasWeights = Array.isArray(product.weight_pricing) && product.weight_pricing.length > 0;
  const defaultWeight = hasWeights ? product.weight_pricing[0] : null;
  const fallbackP = product.price || 0;
  const displayPrice = defaultWeight ? defaultWeight.price : fallbackP;
  const displayMrp = defaultWeight && defaultWeight.mrp_price && defaultWeight.mrp_price > defaultWeight.price
    ? defaultWeight.mrp_price : (product.mrp_price && product.mrp_price > fallbackP ? product.mrp_price : null);

  let qty = 1;

  body.innerHTML = `
    <div class="quick-add-loader" style="display:none"><i class="fa-solid fa-spinner fa-spin loader-icon"></i></div>
    <div class="quick-add-product">
      <img src="${product.image_url}" alt="${product.name}">
      <div class="quick-add-product-info">
        <div class="quick-add-product-name">${product.name}</div>
        <div>
          <span class="quick-add-product-price" id="quick-add-price">₹${displayPrice.toFixed(2)}</span>
          ${displayMrp ? `<span class="quick-add-product-mrp">₹${displayMrp.toFixed(2)}</span>` : ''}
        </div>
      </div>
    </div>
    ${hasWeights ? `
      <div class="quick-add-weight">
        <span class="quick-add-weight-label">Select Variant</span>
        <div class="weight-chips-container">
          ${product.weight_pricing.map(w => {
    const label = w.unit === 'kg' ? `${w.weight} kg` : w.unit === 'l' ? `${w.weight} l` : w.unit === 'ml' ? `${w.weight} ml` : `${w.weight} g`;
    const isDefault = w === defaultWeight;
    return `<button type="button" class="weight-chip ${isDefault ? 'active' : ''}" data-value="${w.weight}_${w.unit}_${w.price}_${w.mrp_price || ''}">${label}</button>`;
  }).join('')}
        </div>
      </div>
    ` : ''}
    <div class="quick-add-qty">
      <span class="quick-add-qty-label">Quantity</span>
      <div class="quick-add-qty-controls">
        <button class="quick-add-qty-btn" id="quick-add-qty-minus"><i class="fa-solid fa-minus"></i></button>
        <span class="quick-add-qty-value" id="quick-add-qty-value">1</span>
        <button class="quick-add-qty-btn" id="quick-add-qty-plus"><i class="fa-solid fa-plus"></i></button>
      </div>
    </div>
    <div class="quick-add-actions">
      <button class="btn btn-secondary" id="quick-add-cancel">Cancel</button>
      <button class="btn btn-primary" id="quick-add-submit"><i class="fa-solid fa-cart-plus"></i> Add to Cart — <span id="quick-add-total">₹${displayPrice.toFixed(2)}</span></button>
    </div>
  `;

  modal.classList.add('open');

  // Weight chip handlers
  body.querySelectorAll('.weight-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      body.querySelectorAll('.weight-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const parts = chip.getAttribute('data-value').split('_');
      if (parts.length >= 4) {
        const price = parseFloat(parts[2]);
        const mrp = parts[3] ? parseFloat(parts[3]) : null;
        document.getElementById('quick-add-price').textContent = `₹${price.toFixed(2)}`;
        document.getElementById('quick-add-total').textContent = `₹${(price * qty).toFixed(2)}`;
      }
    });
  });

  // Qty handlers
  document.getElementById('quick-add-qty-minus').addEventListener('click', () => {
    if (qty > 1) {
      qty -= 1;
      updateQuickAddTotal();
    }
  });

  document.getElementById('quick-add-qty-plus').addEventListener('click', () => {
    qty += 1;
    updateQuickAddTotal();
  });

  function updateQuickAddTotal() {
    const valEl = document.getElementById('quick-add-qty-value');
    const totalEl = document.getElementById('quick-add-total');
    if (valEl) valEl.textContent = qty;
    const activeChip = body.querySelector('.weight-chip.active');
    let unitPrice = displayPrice;
    if (activeChip) {
      const parts = activeChip.getAttribute('data-value').split('_');
      if (parts.length >= 4) unitPrice = parseFloat(parts[2]);
    }
    if (totalEl) totalEl.textContent = `₹${(unitPrice * qty).toFixed(2)}`;
  }

  // Cancel
  document.getElementById('quick-add-cancel').addEventListener('click', closeQuickAdd);

  // Close button
  document.getElementById('btn-close-quick-add').addEventListener('click', closeQuickAdd);

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeQuickAdd();
  });

  // Submit
  document.getElementById('quick-add-submit').addEventListener('click', () => {
    const activeChip = body.querySelector('.weight-chip.active');
    let weightInfo = null;
    if (activeChip) {
      const parts = activeChip.getAttribute('data-value').split('_');
      if (parts.length >= 4) {
        weightInfo = { weight: parseInt(parts[0], 10), unit: parts[1], price: parseFloat(parts[2]), mrp_price: parts[3] ? parseFloat(parts[3]) : undefined };
      }
    }
    for (let i = 0; i < qty; i++) {
      addToCart(product.id, weightInfo);
    }
    closeQuickAdd();
  });

  function closeQuickAdd() {
    modal.classList.remove('open');
  }
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
    if (!res.ok) throw new Error('Failed to load details');

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

    const hasWeights = Array.isArray(product.weight_pricing) && product.weight_pricing.length > 0;
    const defaultW = hasWeights ? product.weight_pricing[0] : null;
    const displayPrice = defaultW ? defaultW.price : (product.price || 0);

    const displayMrp = defaultW && defaultW.mrp_price && defaultW.mrp_price > defaultW.price ? defaultW.mrp_price : (product.mrp_price && product.price && product.mrp_price > product.price ? product.mrp_price : null);
    const detailImages = (product.image_urls && product.image_urls.length > 0) ? product.image_urls : [product.image_url];
    const detailCarouselId = `detail-carousel-${product.id}`;
    body.innerHTML = `
      <div class="detail-img-col">
        <div class="product-carousel" id="${detailCarouselId}" data-images='${JSON.stringify(detailImages.filter(Boolean)).replace(/'/g, "&#39;")}'>
          <div class="carousel-track">
            ${detailImages.filter(Boolean).map((img, i) => `
              <img src="${img}" alt="${product.name} - ${i + 1}" class="carousel-slide ${i === 0 ? 'active' : ''}">
            `).join('')}
          </div>
          ${detailImages.length > 1 ? `
            <button type="button" class="carousel-btn carousel-prev" data-carousel="${detailCarouselId}"><i class="fa-solid fa-chevron-left"></i></button>
            <button type="button" class="carousel-btn carousel-next" data-carousel="${detailCarouselId}"><i class="fa-solid fa-chevron-right"></i></button>
            <div class="carousel-dots">
              ${detailImages.filter(Boolean).map((_, i) => `
                <span class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}" data-carousel="${detailCarouselId}"></span>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
      <div class="detail-info-col">
        <span class="product-category-lbl">${product.category}</span>
        <h3>${product.name}</h3>
        ${hasWeights ? `
          <div class="detail-weight-selector">
            <label>Select ${hasWeights && (product.weight_pricing[0].unit === 'ml' || product.weight_pricing[0].unit === 'l') ? 'Volume' : 'Weight'}:</label>
            <div class="detail-weight-chips" id="detail-weight-select-container">
              ${product.weight_pricing.map((w, wIdx) => {
      const label = w.unit === 'kg' ? `${w.weight} kg` : w.unit === 'l' ? `${w.weight} l` : w.unit === 'ml' ? `${w.weight} ml` : `${w.weight} g`;
      const isDefault = wIdx === 0;
      return `
                  <button type="button" class="detail-weight-chip ${isDefault ? 'active' : ''}" 
                    data-value="${w.weight}_${w.unit}_${w.price}_${w.mrp_price || ''}">
                    ${label}
                  </button>
                `;
    }).join('')}
            </div>
          </div>
        ` : ''}
        <div class="detail-price-wrap">
          <span class="detail-price" id="detail-price-display">₹${displayPrice.toFixed(2)}</span>
          ${displayMrp ? `<span class="detail-mrp" id="detail-mrp-display">₹${displayMrp.toFixed(2)}</span>` : ''}
          ${displayMrp ? `<span class="detail-discount-badge" id="detail-discount-display">${Math.round((1 - displayPrice / displayMrp) * 100)}% OFF</span>` : ''}
        </div>
        <p style="font-size: 0.95rem; color: var(--color-text-muted); line-height: 1.6;">${product.description}</p>
        
        ${metaHTML}

        ${state.user?.role === 'admin' ? `
          <div style="margin-top: 1rem; padding: 0.75rem; background: var(--color-bg-muted, #f5f5f5); border-radius: 8px; text-align: center; color: var(--color-text-muted);">
            <i class="fa-solid fa-eye"></i> Admin — View Only
          </div>
        ` : `
          <button class="btn btn-primary" id="btn-modal-add" style="margin-top: 1rem;">
            <i class="fa-solid fa-basket-shopping"></i> Add to Basket
          </button>
        `}
      </div>
    `;

    // Weight change handler for detail modal
    const detailChips = body.querySelectorAll('.detail-weight-chip');
    detailChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        detailChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const parts = chip.getAttribute('data-value').split('_');
        if (parts.length < 4) return;
        const p = parseFloat(parts[2]);
        const m = parts[3] ? parseFloat(parts[3]) : null;
        const priceDisplay = document.getElementById('detail-price-display');
        const mrpDisplay = document.getElementById('detail-mrp-display');
        const discountDisplay = document.getElementById('detail-discount-display');
        if (priceDisplay) priceDisplay.textContent = `₹${p.toFixed(2)}`;
        if (mrpDisplay) {
          if (m && m > p) {
            mrpDisplay.textContent = `₹${m.toFixed(2)}`;
            mrpDisplay.style.display = '';
          } else {
            mrpDisplay.style.display = 'none';
          }
        }
        if (discountDisplay) {
          if (m && m > p) {
            discountDisplay.textContent = `${Math.round((1 - p / m) * 100)}% OFF`;
            discountDisplay.style.display = '';
          } else {
            discountDisplay.style.display = 'none';
          }
        }
      });
    });

    document.getElementById('btn-modal-add').addEventListener('click', () => {
      let weightInfo = null;
      const activeDetailChip = body.querySelector('.detail-weight-chip.active');
      if (activeDetailChip) {
        const parts = activeDetailChip.getAttribute('data-value').split('_');
        if (parts.length >= 4) {
          weightInfo = { weight: parseInt(parts[0], 10), unit: parts[1], price: parseFloat(parts[2]), mrp_price: parts[3] ? parseFloat(parts[3]) : undefined };
        }
      }
      addToCart(product.id, weightInfo);
      modal.classList.remove('open');
    });
  } catch (err) {
    body.innerHTML = '<p style="color: var(--color-danger); text-align:center; padding: 2rem;">Error retrieving specimen record.</p>';
  }
}

// ==========================================================================
// BASKET / CART CONTROLLERS
// ==========================================================================
function toggleCartDrawer(open) {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-drawer-overlay');
  const phoneInput = document.getElementById('checkout-delivery-phone');

  if (open) {
    drawer.classList.add('open');
    overlay.classList.add('open');
    if (phoneInput && state.user) {
      const phoneValue = state.user.whatsapp_number
        || state.user.whatsappNumber
        || state.user.phone
        || '';
      if (!phoneInput.value && phoneValue) phoneInput.value = phoneValue;
    }
  } else {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }
}

function addToCart(productId, weightInfo) {
  if (state.user?.role === 'admin') {
    showInfoToast('Admins cannot purchase products. Use a buyer account to shop.');
    return;
  }

  // Ensure a lightweight guest profile exists for anonymous users so they have a profile page
  if (!state.user) {
    const guest = {
      id: `guest_${Date.now()}`,
      fullName: 'Guest User',
      email: '',
      whatsappNumber: '',
      role: 'buyer',
      loginMethod: 'guest',
    };
    saveUserProfile(guest);
    updateAuthHeaderUI();
  }

  const product = state.products.find((p) => p.id === productId);
  if (!product) return;

  // Determine effective price based on weight selection
  const effectivePrice = weightInfo ? weightInfo.price : (product.price || 0);
  const weightLabel = weightInfo ? (weightInfo.unit === 'kg' ? `${weightInfo.weight} kg` : weightInfo.unit === 'l' ? `${weightInfo.weight} l` : weightInfo.unit === 'ml' ? `${weightInfo.weight} ml` : `${weightInfo.weight} g`) : '';

  // Build a unique cart key: if weight variant, include weight in the id
  const cartId = weightInfo ? `${productId}_${weightInfo.weight}${weightInfo.unit}` : productId;

  const existing = state.cart.find((item) => item._cartId === cartId || (item.id === productId && !weightInfo && !item._cartId));
  let addedItem;

  if (existing) {
    existing.quantity += 1;
    addedItem = existing;
  } else {
    const newItem = {
      id: product.id,
      _cartId: cartId,
      name: weightLabel ? `${product.name} (${weightLabel})` : product.name,
      price: effectivePrice,
      image_url: product.image_url,
      gst_rate: product.gst_rate,
      quantity: 1,
      weightInfo: weightInfo || null,
    };
    state.cart.push(newItem);
    addedItem = newItem;
  }

  saveCart();
  updateCartUI();
  showAddedToCartPopup(addedItem);
}

function showAddedToCartPopup(item) {
  document.getElementById('added-to-cart-popup')?.remove();
  const totalCount = state.cart.reduce((sum, cartItem) => sum + cartItem.quantity, 0);
  const popup = document.createElement('div');
  popup.id = 'added-to-cart-popup';
  popup.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;max-width:340px;background:#fff;padding:14px 16px;border-radius:14px;box-shadow:0 18px 52px rgba(0,0,0,0.18);font-family:inherit;';
  popup.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;">
      <img src="${item.image_url || '/images/product_fresh.png'}" alt="${item.name}" style="width:56px;height:56px;object-fit:cover;border-radius:12px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;margin-bottom:3px;">Added to cart</div>
        <div style="font-size:0.92rem;color:#4b5563;line-height:1.3;">${item.name}</div>
        <div style="font-size:0.95rem;color:#111;margin-top:6px;">₹${item.price.toFixed(2)}</div>
      </div>
    </div>
    <div style="margin-top:10px;padding:8px 12px;background:#f0fdf4;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:0.85rem;color:#166534;"><i class="fa-solid fa-cart-shopping"></i> ${totalCount} item${totalCount !== 1 ? 's' : ''} in cart</span>
      <span style="font-size:0.85rem;font-weight:600;color:#166534;">₹${state.cart.reduce((sum, ci) => sum + ci.price * ci.quantity, 0).toFixed(2)}</span>
    </div>
    <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px;">
      <button id="popup-view-cart" class="btn btn-secondary" style="flex:1;">View Cart</button>
      <button id="popup-continue" class="btn btn-primary" style="flex:1;">Continue</button>
    </div>
  `;

  document.body.appendChild(popup);
  document.getElementById('popup-view-cart')?.addEventListener('click', () => {
    toggleCartDrawer(true);
    popup.remove();
  });
  document
    .getElementById('popup-continue')
    ?.addEventListener('click', () => popup.remove());
}

function changeQuantity(cartId, delta) {
  const item = state.cart.find((item) => (item._cartId || item.id) === cartId);
  if (!item) return;

  item.quantity += delta;

  if (item.quantity <= 0) {
    state.cart = state.cart.filter((item) => (item._cartId || item.id) !== cartId);
  }

  saveCart();
  updateCartUI();

  if (state.cart.length === 0) {
    toggleCartDrawer(false);
    if (window.location.hash === '#checkout') window.location.hash = '#shop';
  }
}

function removeFromCart(cartId) {
  state.cart = state.cart.filter((item) => (item._cartId || item.id) !== cartId);
  saveCart();
  updateCartUI();

  if (state.cart.length === 0) {
    toggleCartDrawer(false);
    if (window.location.hash === '#checkout') window.location.hash = '#shop';
  }
}

async function applyPromoCode() {
  const input = document.getElementById('promo-input').value.trim();
  const feedback = document.getElementById('promo-message');
  feedback.classList.add('hidden');

  if (!input) {
    state.activePromo = null;
    state.promoDiscountPct = 0;
    updateCartUI();
    return;
  }

  try {
    const result = await fetchWithAuth(`/promo/validate?code=${encodeURIComponent(input)}`);

    if (result && result.valid) {
      state.activePromo = result.code;
      state.promoDiscountPct = result.discountPercent;
      feedback.textContent = `Code ${result.code} Active (${result.description})!`;
      feedback.style.color = 'var(--color-success)';
    } else {
      state.activePromo = null;
      state.promoDiscountPct = 0;
      feedback.textContent = result?.error || 'Invalid Promo Code.';
      feedback.style.color = 'var(--color-danger)';
    }
    feedback.classList.remove('hidden');
  } catch (err) {
    state.activePromo = null;
    state.promoDiscountPct = 0;
    feedback.textContent = getApiErrorMessage(err);
    feedback.style.color = 'var(--color-danger)';
    feedback.classList.remove('hidden');
  }

  updateCartUI();
}

async function fetchShippingSettings() {
  try {
    const response = await fetch(`${API_BASE}/orders/shipping-settings`);
    const data = await response.json();
    state.shippingCharge = 0; // delivery is always free
    updateCartUI();
  } catch (err) {
    console.warn('Unable to load shipping charge:', err);
  }
}

function updateCartUI() {
  const container = document.getElementById('cart-items-container');
  const countBadge = document.getElementById('cart-count');
  const mobileCountBadge = document.getElementById('mobile-cart-count');

  const totalCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  countBadge.textContent = totalCount;
  if (mobileCountBadge) mobileCountBadge.textContent = totalCount;

  if (state.cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty-message">
        <i class="fa-solid fa-basket-shopping"></i>
        <p>Your basket is barren. Select some genetics or spawn to get growing!</p>
      </div>
    `;
    const subtotalEl = document.getElementById('ledger-subtotal');
    const discountRow = document.getElementById('ledger-discount-row');
    const taxEl = document.getElementById('ledger-tax');
    const totalEl = document.getElementById('ledger-total');
    if (subtotalEl) subtotalEl.textContent = '₹0.00';
    if (discountRow) discountRow.classList.add('hidden');
    if (taxEl) taxEl.textContent = '₹0.00';
    if (totalEl) totalEl.textContent = '₹0.00';
    return;
  }

  container.innerHTML = state.cart
    .map(
      (cartItem) => {
        const cartId = cartItem._cartId || cartItem.id;
        return `
      <div class="cart-item">
        <img src="${cartItem.image_url}" alt="${cartItem.name}">
        <div class="cart-item-details">
          <h4>${cartItem.name}</h4>
          <span class="cart-item-price">₹${cartItem.price.toFixed(2)} <span style="font-size:0.75rem; color:var(--color-text-muted);">(${cartItem.gst_rate}% GST)</span></span>
          <div class="cart-item-qty-row">
            <button class="qty-btn" onclick="window.changeQty('${cartId}', -1)">-</button>
            <span class="qty-val">${cartItem.quantity}</span>
            <button class="qty-btn" onclick="window.changeQty('${cartId}', 1)">+</button>
          </div>
          <div class="cart-item-shipping-note">Free shipping</div>
        </div>
        <button class="btn-remove-item" onclick="window.removeCartItem('${cartId}')">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
      },
    )
    .join('');

  let subtotal = 0;
  let gstAmount = 0;

  state.cart.forEach((item) => {
    const lineSubtotal = item.price * item.quantity;
    subtotal += lineSubtotal;
    const lineDiscount = lineSubtotal * state.promoDiscountPct;
    const lineDiscountedSubtotal = lineSubtotal - lineDiscount;
    const lineGst = lineDiscountedSubtotal * (item.gst_rate / 100);

    gstAmount += lineGst;
  });

  const discountAmount = subtotal * state.promoDiscountPct;
  const shippingCharge = Number(state.shippingCharge || 0);
  const netTotal = subtotal - discountAmount + gstAmount + shippingCharge;

  const subtotalEl = document.getElementById('ledger-subtotal');
  const discountEl = document.getElementById('ledger-discount');
  const discountRow = document.getElementById('ledger-discount-row');
  const shippingRow = document.getElementById('ledger-shipping-row');
  const shippingEl = document.getElementById('ledger-shipping');
  const taxEl = document.getElementById('ledger-tax');
  const totalEl = document.getElementById('ledger-total');

  if (subtotalEl) subtotalEl.textContent = `₹${subtotal.toFixed(2)}`;

  if (discountAmount > 0) {
    if (discountEl) discountEl.textContent = `-₹${discountAmount.toFixed(2)}`;
    if (discountRow) discountRow.classList.remove('hidden');
  } else if (discountRow) discountRow.classList.add('hidden');

  if (shippingEl && shippingRow) {
    shippingEl.textContent = `₹${shippingCharge.toFixed(2)}`;
    shippingRow.style.display = shippingCharge > 0 ? 'flex' : 'none';
  }

  if (taxEl) taxEl.textContent = `₹${gstAmount.toFixed(2)}`;
  if (totalEl) totalEl.textContent = `₹${netTotal.toFixed(2)}`;
}

// ========================================================================
// Training registration & courses
// ========================================================================
function initTrainingRegister() {
  const form = document.getElementById('training-register-form');
  if (!form) return;

  const nameEl = document.getElementById('reg-fullname');
  const roleEl = document.getElementById('reg-role');
  const emailEl = document.getElementById('reg-email');
  const phoneCountryEl = document.getElementById('reg-phone-country');
  const phoneEl = document.getElementById('reg-phone');
  const googleBtn = document.getElementById('reg-google');
  const emailOtpBtn = document.getElementById('reg-email-otp');
  const phoneOtpBtn = document.getElementById('reg-phone-otp');
  const otpArea = document.getElementById('reg-otp-area');
  const otpInput = document.getElementById('reg-otp');
  const verifyBtn = document.getElementById('reg-verify-otp');
  const cancelOtp = document.getElementById('reg-cancel-otp');
  const errEl = document.getElementById('reg-error');

  let pendingContact = null;
  let pendingMethod = null;
  let lastPhone = null;

  function showError(msg) {
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
  }
  function clearError() {
    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }
  }

  googleBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    // Reuse authModal Google flow which mocks OAuth; on success navigate to courses
    authModal.open('grower', () => {
      window.location.hash = '#training-courses';
    });
  });

  emailOtpBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    clearError();
    const email = (emailEl?.value || '').trim();
    const name = (nameEl?.value || '').trim();
    const trainingRole = roleEl?.value || 'trainee';
    if (!email) return showError('Please provide an email.');
    try {
      emailOtpBtn.disabled = true;
      emailOtpBtn.textContent = 'Sending…';
      await authApi.requestOtp(email, 'grower', name);
      // persist selected training role locally so courses page can use it even before login
      localStorage.setItem('training_role', trainingRole);
      pendingContact = email;
      pendingMethod = 'email';
      otpArea.style.display = 'block';
    } catch (err) {
      showError(err.message || 'Failed to send OTP');
    } finally {
      emailOtpBtn.disabled = false;
      emailOtpBtn.textContent = 'Send Email OTP';
    }
  });

  phoneOtpBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    clearError();
    const phone = (phoneEl?.value || '').trim();
    const country = phoneCountryEl?.value || '+91';
    const name = (nameEl?.value || '').trim();
    const trainingRole = roleEl?.value || 'trainee';
    if (!isValidIndianPhone(phone)) return showError('Enter a valid Indian phone number (e.g. +91 9876543210).');
    try {
      phoneOtpBtn.disabled = true;
      phoneOtpBtn.textContent = 'Sending…';
      const fullPhone = `${country}${phone}`;
      const mockEmail = `${phone.replace(/\D/g, '')}@phone.sporekart`;
      await authApi.requestOtp(
        mockEmail,
        'grower',
        name || `User ${phone.slice(-4)}`,
      );
      localStorage.setItem('training_role', trainingRole);
      pendingContact = mockEmail;
      pendingMethod = 'phone';
      lastPhone = fullPhone;
      otpArea.style.display = 'block';
      // Autofill local fields with phone value
      if (phoneEl && !phoneEl.value) phoneEl.value = phone;
    } catch (err) {
      showError(err.message || 'Failed to send OTP');
    } finally {
      phoneOtpBtn.disabled = false;
      phoneOtpBtn.textContent = 'Send Phone OTP';
    }
  });

  verifyBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    clearError();
    const code = (otpInput?.value || '').trim();
    if (!code) return showError('Enter the 6-digit code');
    try {
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying…';
      const data = await authApi.verifyOtp(pendingContact, code, {
        loginMethod: pendingMethod,
        whatsappNumber: lastPhone,
      });
      if (data && data.token) {
        saveAuth(data.token, data.user);
        window.dispatchEvent(new Event('auth:changed'));
        // Ensure required fields are filled from profile
        if (data.user) {
          if (nameEl && !nameEl.value && data.user.fullName) nameEl.value = data.user.fullName;
          if (emailEl && !emailEl.value && data.user.email) emailEl.value = data.user.email;
          if (
            phoneEl
            && !phoneEl.value
            && (data.user.whatsappNumber || data.user.whatsapp_number)
          ) phoneEl.value = data.user.whatsappNumber || data.user.whatsapp_number;
        }
        // Persist training role to user profile and local storage
        const selRole = roleEl?.value || localStorage.getItem('training_role') || 'trainee';
        try {
          const updatedUser = { ...state.user, trainingRole: selRole };
          saveUserProfile(updatedUser);
        } catch (e) {
          localStorage.setItem('training_role', selRole);
        }
        // Navigate to courses
        window.location.hash = '#training-courses';
      } else {
        showError('Verification failed.');
      }
    } catch (err) {
      showError(err.message || 'Verification failed');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify & Continue';
    }
  });

  cancelOtp?.addEventListener('click', (e) => {
    e.preventDefault();
    otpArea.style.display = 'none';
    otpInput.value = '';
    pendingContact = null;
    pendingMethod = null;
    lastPhone = null;
    clearError();
  });
}

async function renderTrainingCourses() {
  const dash = document.querySelector('.tr-dashboard');
  if (!dash) return;

  const futureGrid = document.getElementById('tr-course-grid-future');
  const ongoingGrid = document.getElementById('tr-course-grid-ongoing');
  const completedGrid = document.getElementById('tr-course-grid-completed');
  if (!futureGrid || !ongoingGrid) return;

  let allTrainings = [];
  let enrolledIds = new Set();

  try {
    const trainings = await trainingApi.getTrainings();
    allTrainings = Array.isArray(trainings) ? trainings : [];

    if (state.user) {
      try {
        const enrollments = await trainingApi.getMyEnrollments();
        if (Array.isArray(enrollments)) {
          enrolledIds = new Set(enrollments.map(e => e.training_id));
        }
      } catch (e) {
        /* non-critical */
      }
    }
  } catch (err) {
    futureGrid.innerHTML = '<div class="tr-loading" style="color:#e74c3c;">Failed to load trainings.</div>';
    return;
  }

  // ── Tab Switching (once) ──
  const tabBar = document.getElementById('tr-tab-bar');
  if (tabBar && !tabBar.dataset.bound) {
    tabBar.dataset.bound = '1';
    tabBar.querySelectorAll('.tr-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabBar.querySelectorAll('.tr-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tr-tab-content').forEach(c => c.classList.remove('active'));
        const target = document.getElementById(`tr-content-${tab.dataset.tab}`);
        if (target) target.classList.add('active');
      });
    });
  }

  // ── Back to Shop (once) ──
  const backBtn = document.getElementById('btn-tr-back-shop');
  if (backBtn && !backBtn.dataset.bound) {
    backBtn.dataset.bound = '1';
    backBtn.addEventListener('click', () => {
      window.location.hash = '#shop';
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function getDate(dateStr) {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Render Future Courses ──
  function renderFutureCourses(filter) {
    const category = filter || 'all';
    const visible = allTrainings.filter(t => {
      if (!t.start_date) return false;
      if (category !== 'all' && (t.category || '').toLowerCase() !== category.toLowerCase()) return false;
      return getDate(t.start_date) >= today;
    });

    if (visible.length === 0) {
      futureGrid.innerHTML = `<div class="tr-empty-state">
        <i class="fa-solid fa-calendar-day"></i>
        <h4>No courses found</h4>
        <p>${category === 'all' ? 'No trainings available at the moment.' : `No ${category} courses available.`}</p>
      </div>`;
      return;
    }

    futureGrid.innerHTML = visible.map(t => buildCourseCard(t, enrolledIds)).join('');
    wireEnrollButtons(futureGrid);
  }

  // ── Render Ongoing ──
  function renderOngoing() {
    const enrolled = allTrainings.filter(t =>
      enrolledIds.has(t.id) &&
      t.start_date && getDate(t.start_date) <= today &&
      t.end_date && getDate(t.end_date) >= today
    );
    if (enrolled.length === 0) {
      ongoingGrid.innerHTML = `<div class="tr-empty-state">
        <i class="fa-solid fa-play-circle"></i>
        <h4>No ongoing training</h4>
        <p>Enroll in a course to get started with your training journey.</p>
      </div>`;
      return;
    }
    ongoingGrid.innerHTML = enrolled.map(t => buildCourseCard(t, enrolledIds, true)).join('');
    wireEnrollButtons(ongoingGrid);
  }

  // ── Render Completed ──
  function renderCompleted() {
    const completed = allTrainings.filter(t =>
      enrolledIds.has(t.id) &&
      t.end_date && getDate(t.end_date) < today
    );
    if (completed.length === 0) {
      completedGrid.innerHTML = `<div class="tr-empty-state">
        <i class="fa-solid fa-check-double"></i>
        <h4>No completed training yet</h4>
        <p>Your completed courses will appear here once you finish them.</p>
      </div>`;
      return;
    }
    completedGrid.innerHTML = completed.map(t => buildCourseCard(t, enrolledIds, true, true)).join('');
    wireEnrollButtons(completedGrid);
  }

  // ── Filter Buttons ──
  const filterRow = document.querySelector('.tr-filter-row');
  if (filterRow) {
    filterRow.querySelectorAll('.tr-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterRow.querySelectorAll('.tr-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderFutureCourses(btn.dataset.filter);
      });
    });
  }

  // Initial render
  renderFutureCourses('all');
  renderOngoing();
  renderCompleted();
}

function buildCourseCard(t, enrolledIds, isOngoing, isCompleted) {
  const cat = t.category || 'Beginner';
  const catLower = cat.toLowerCase();
  const catClass = catLower === 'beginner' ? 'beginner'
    : catLower === 'farmer' ? 'farmer'
      : catLower === 'entrepreneur' ? 'entrepreneur'
        : catLower === 'certification' ? 'certification'
          : 'beginner';
  const isEnrolled = enrolledIds.has(t.id);

  const imgHtml = t.image_url
    ? `<img class="tr-course-img" src="${t.image_url}" alt="${t.title}" loading="lazy">`
    : `<div class="tr-course-img-placeholder"><i class="fa-solid fa-graduation-cap"></i></div>`;

  let actionHtml;
  if (isCompleted) {
    actionHtml = `<span class="tr-enrolled-badge" style="background:#e0e7ff;color:#3730a3;"><i class="fa-solid fa-check-double"></i> Completed</span>`;
  } else if (isOngoing) {
    actionHtml = `<span class="tr-enrolled-badge"><i class="fa-solid fa-play"></i> Ongoing</span>`;
  } else if (isEnrolled) {
    actionHtml = `<span class="tr-enrolled-badge"><i class="fa-solid fa-check"></i> Enrolled</span>`;
  } else {
    actionHtml = `<button class="tr-enroll-btn" data-id="${t.id}">Enroll Now</button>`;
  }

  const priceHtml = (t.price_strikeout && t.price_actual)
    ? `<div class="tr-course-price"><span class="tr-price-strikeout">₹${Number(t.price_strikeout).toLocaleString()}</span><span class="tr-price-actual">₹${Number(t.price_actual).toLocaleString()}</span></div>`
    : '';

  const dateHtml = (t.start_date || t.end_date) ? `
    <div class="tr-course-dates">
      ${t.start_date ? `<span><i class="fa-solid fa-calendar-day"></i> ${formatDate(t.start_date)}</span>` : ''}
      ${t.end_date ? `<span><i class="fa-solid fa-calendar-check"></i> ${formatDate(t.end_date)}</span>` : ''}
      ${t.duration_days ? `<span><i class="fa-solid fa-clock"></i> ${t.duration_days} days</span>` : ''}
    </div>` : '';

  return `
    <div class="tr-course-card">
      ${imgHtml}
      <div class="tr-course-body">
        <span class="tr-course-category ${catClass}">${cat}</span>
        <h4 class="tr-course-title">${t.title}</h4>
        ${dateHtml}
        <p class="tr-course-desc">${t.description || ''}</p>
        ${priceHtml}
        <div class="tr-course-actions">
          ${actionHtml}
        </div>
      </div>
    </div>
  `;
}

function wireEnrollButtons(grid) {
  grid.querySelectorAll('.tr-enroll-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!state.user) {
        authModal.open('buyer', () => {
          window.location.hash = '#training-courses';
        });
        return;
      }
      try {
        btn.disabled = true;
        btn.textContent = 'Enrolling…';
        const role = state.user.trainingRole || localStorage.getItem('training_role') || 'trainee';
        await trainingApi.enroll(id, { role });
        showSuccessToast('Successfully enrolled!');
        btn.outerHTML = `<span class="tr-enrolled-badge"><i class="fa-solid fa-check"></i> Enrolled</span>`;
      } catch (err) {
        showErrorToast('Enrollment failed. Try again.');
        btn.disabled = false;
        btn.textContent = 'Enroll Now';
      }
    });
  });
}

window.changeQty = changeQuantity;
window.removeCartItem = removeFromCart;

// ==========================================================================
// TRAINING GALLERY CAROUSEL — FIXED
// ==========================================================================
const DEFAULT_TG_IMAGES = [
  { url: "https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=600&h=400&fit=crop", caption: "Spawn inoculation lab" },
  { url: "https://images.unsplash.com/photo-1607168668428-b1c53a70c4e6?w=600&h=400&fit=crop", caption: "Mushroom fruiting room" },
  { url: "https://images.unsplash.com/photo-1587048948384-f4b931f45cde?w=600&h=400&fit=crop", caption: "Substrate preparation" },
  { url: "https://images.unsplash.com/photo-1593001872095-7d5b3868fd78?w=600&h=400&fit=crop", caption: "Farmer training workshop" },
  { url: "https://images.unsplash.com/photo-1590614024037-77e1a8e5b073?w=600&h=400&fit=crop", caption: "Fresh oyster mushrooms" },
  { url: "https://images.unsplash.com/photo-1562967914-608f82629710?w=600&h=400&fit=crop", caption: "Mushroom harvest sorting" },
  { url: "https://images.unsplash.com/photo-1504545102780-267741d26080?w=600&h=400&fit=crop", caption: "Packaging station" },
  // ✅ FIXED URL (was "ber6b0", now "b6b0")
  { url: "https://images.unsplash.com/photo-1518977676601-b53f82b6b0b0?w=600&h=400&fit=crop", caption: "Climate control room" },
  { url: "https://images.unsplash.com/photo-1596363104785-8c65da3d80b4?w=600&h=400&fit=crop", caption: "Quality inspection" },
  { url: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&h=400&fit=crop", caption: "Business planning session" }
];

function getTgImages() {
  try {
    const stored = localStorage.getItem("spore_training_gallery_images");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) { /* ignore */ }
  return [...DEFAULT_TG_IMAGES];
}

function saveTgImages(imgs) {
  localStorage.setItem("spore_training_gallery_images", JSON.stringify(imgs));
}

let tgCurrentPage = 0;
let tgAutoplayTimer = null;

function getTgVisibleCount() {
  const w = window.innerWidth;
  if (w <= 400) return 1;
  if (w <= 640) return 2;
  if (w <= 900) return 3;
  return 4;
}

function renderTrainingGallery() {
  const track = document.getElementById("training-gallery-track");
  const dotsWrap = document.getElementById("training-gallery-dots");
  if (!track || !dotsWrap) return;

  const images = getTgImages();
  const visible = getTgVisibleCount();
  //const offset = tgCurrentPage * (slide +gap);

  /* const totalPages = Math.max(1, Math.ceil(images.length / visible));
 
   if (tgCurrentPage >= totalPages) tgCurrentPage = 0;
   if (tgCurrentPage < 0) tgCurrentPage = totalPages - 1; */

  const totalSlides = images.length;

  if (tgCurrentPage >= totalSlides) tgCurrentPage = 0;
  if (tgCurrentPage < 0) tgCurrentPage = totalSlides - 1;


  const gap = 16;
  const containerWidth = track.parentElement.offsetWidth || 800;
  const slideW = (containerWidth - gap * (visible - 1)) / visible;

  /*FIX: Set flex layout on track
  track.style.display = "flex";
  track.style.flexWrap = "nowrap";
  track.style.transition = "transform 0.45s ease";
  track.style.gap = gap + "px";
  track.style.willChange = "transform";

  // FIX: Each slide gets an explicit pixel width
  track.innerHTML = images.map((img) => `
    <div class="tg-slide" style="flex: 0 0 ${slideW}px; width: ${slideW}px; overflow: hidden; border-radius: 12px;">
      <div class="tg-slide-inner" style="position:relative; width:100%; height:220px;">
        <img
          src="${img.url}"
          alt="${img.caption || 'Training glimpse'}"
          loading="lazy"
          style="width:100%; height:100%; object-fit:cover; display:block; border-radius:12px;"
          onerror="this.parentElement.style.background='#e5e7eb';"
        />
        ${img.caption ? `
          <div class="tg-slide-caption" style="
            position:absolute; bottom:0; left:0; right:0;
            background:linear-gradient(transparent, rgba(0,0,0,0.65));
            color:#fff; padding:12px 14px 10px;
            font-size:0.82rem; border-radius:0 0 12px 12px;
          "><i class="fa-solid fa-image"></i> ${img.caption}</div>` : ''}
      </div>
    </div>
  `).join("");

  // FIX: Apply translate AFTER slides are in the DOM
  //const offset = tgCurrentPage * visible * (slideW + gap);

  const offset = tgCurrentPage * (slideW + gap);
  track.style.transform = `translateX(-${offset}px)`; */

  track.style.display = "flex";
  track.style.flexWrap = "nowrap";
  track.style.gap = gap + "px";
  track.style.willChange = "transform";

  // Clone last `visible` slides to front and first `visible` to end for infinite loop
  const clonesBefore = images.slice(-visible);
  const clonesAfter = images.slice(0, visible);
  const allSlides = [...clonesBefore, ...images, ...clonesAfter];

  track.innerHTML = allSlides.map((img) => `
    <div class="tg-slide" style="flex: 0 0 ${slideW}px; width: ${slideW}px; overflow: hidden; border-radius: 12px;">
      <div class="tg-slide-inner" style="position:relative; width:100%; height:220px;">
        <img
          src="${img.url}"
          alt="${img.caption || 'Training glimpse'}"
          loading="lazy"
          style="width:100%; height:100%; object-fit:cover; display:block; border-radius:12px;"
          onerror="this.parentElement.style.background='#e5e7eb';"
        />
        ${img.caption ? `
          <div class="tg-slide-caption" style="
            position:absolute; bottom:0; left:0; right:0;
            background:linear-gradient(transparent, rgba(0,0,0,0.65));
            color:#fff; padding:12px 14px 10px;
            font-size:0.82rem; border-radius:0 0 12px 12px;
          "><i class="fa-solid fa-image"></i> ${img.caption}</div>` : ''}
      </div>
    </div>
  `).join("");

  // Offset by `visible` clones prepended, then current page
  const offset = (visible + tgCurrentPage) * (slideW + gap);
  track.style.transition = "transform 0.45s ease";
  track.style.transform = `translateX(-${offset}px)`;

  // Render dots
  dotsWrap.innerHTML = "";
  for (let i = 0; i < totalSlides; i++) {
    const dot = document.createElement("button");
    dot.className = "tg-dot" + (i === tgCurrentPage ? " active" : "");
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;border:none;cursor:pointer;padding:0;
      background:${i === tgCurrentPage ? '#38b17b' : '#d1d5db'};transition:background 0.3s;`;
    dot.addEventListener("click", () => {
      tgCurrentPage = i;
      renderTrainingGallery();
      resetTgAutoplay();
    });
    dotsWrap.appendChild(dot);
  }

  // Show/hide admin edit button
  const editBtn = document.getElementById("tg-admin-edit");
  if (editBtn) {
    editBtn.style.display = state.user?.role === "admin" ? "inline-flex" : "none";
  }
}

function renderTgDots(dotsWrap, currentPage) {
  if (!dotsWrap) return;
  dotsWrap.querySelectorAll(".tg-dot").forEach((d, i) => {
    d.classList.toggle("active", i === currentPage);
    d.style.background = i === currentPage ? '#38b17b' : '#d1d5db';
  });
}

function tgNextPage() {
  /*const images = getTgImages();
  const visible = getTgVisibleCount();
  const totalPages = Math.max(1, Math.ceil(images.length / visible));
  tgCurrentPage = (tgCurrentPage + 1) % totalPages;
  renderTrainingGallery(); 

  const images = getTgImages();
  const totalSlides = images.length;
  tgCurrentPage = (tgCurrentPage + 1) % totalSlides;
  renderTrainingGallery();*/

  // for slides running on loop -pravara
  const images = getTgImages();
  const visible = getTgVisibleCount();
  const gap = 16;
  const track = document.getElementById("training-gallery-track");
  const containerWidth = track ? (track.parentElement.offsetWidth || 800) : 800;
  const slideW = (containerWidth - gap * (visible - 1)) / visible;

  tgCurrentPage++;

  // Animate to next
  const offset = (visible + tgCurrentPage) * (slideW + gap);
  track.style.transition = "transform 0.45s ease";
  track.style.transform = `translateX(-${offset}px)`;

  // If we've gone past the real slides, silently jump to the real start
  if (tgCurrentPage >= images.length) {
    setTimeout(() => {
      tgCurrentPage = 0;
      track.style.transition = "none";
      track.style.transform = `translateX(-${visible * (slideW + gap)}px)`;
    }, 460);
  }

  //update dots
  const dotsWrap = document.getElementById("training-gallery-dots");
  renderTgDots(dotsWrap, tgCurrentPage % images.length)
}

function tgPrevPage() {
  /*const images = getTgImages();
   const visible = getTgVisibleCount();
   const totalPages = Math.max(1, Math.ceil(images.length / visible));
   tgCurrentPage = (tgCurrentPage - 1 + totalPages) % totalPages;
   renderTrainingGallery(); 

  const images = getTgImages();
  const totalSlides = images.length;
  tgCurrentPage = (tgCurrentPage - 1 + totalSlides) % totalSlides;
  renderTrainingGallery(); */

  // for looping carousal slide -pravara
  const images = getTgImages();
  const visible = getTgVisibleCount();
  const gap = 16;
  const track = document.getElementById("training-gallery-track");
  const containerWidth = track ? (track.parentElement.offsetWidth || 800) : 800;
  const slideW = (containerWidth - gap * (visible - 1)) / visible;

  tgCurrentPage--;

  // Animate to prev
  const offset = (visible + tgCurrentPage) * (slideW + gap);
  track.style.transition = "transform 0.45s ease";
  track.style.transform = `translateX(-${offset}px)`;

  // If we've gone before the real slides, silently jump to the real end
  if (tgCurrentPage < 0) {
    setTimeout(() => {
      tgCurrentPage = images.length - 1;
      track.style.transition = "none";
      track.style.transform = `translateX(-${(visible + tgCurrentPage) * (slideW + gap)}px)`;
    }, 460);
  }
  // Update dots
  const dotsWrap = document.getElementById("training-gallery-dots");
  renderTgDots(dotsWrap, ((tgCurrentPage % images.length) + images.length) % images.length);
}



function startTgAutoplay() {
  stopTgAutoplay();
  tgAutoplayTimer = setInterval(tgNextPage, 3500);
}

function stopTgAutoplay() {
  if (tgAutoplayTimer) { clearInterval(tgAutoplayTimer); tgAutoplayTimer = null; }
}

function resetTgAutoplay() { stopTgAutoplay(); startTgAutoplay(); }

// Admin gallery editor
function openTgEditorModal() {
  const existing = document.getElementById("tg-editor-modal");
  if (existing) existing.remove();

  const images = getTgImages();
  const modal = document.createElement("div");
  modal.id = "tg-editor-modal";
  modal.className = "modal-overlay open";
  modal.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";
  modal.innerHTML = `
    <div style="width:100%;max-width:700px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 28px 80px rgba(0,0,0,0.24);max-height:90vh;overflow-y:auto;">
      <div style="padding:18px 22px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background:#f8fafc;">
        <h3 style="margin:0;font-size:1.15rem;color:#111;"><i class="fa-solid fa-images" style="margin-right:8px;color:#2d7a50;"></i>Manage Training Gallery</h3>
        <button id="tg-editor-close" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#666;"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:18px 22px;">
        <p style="font-size:0.85rem;color:#6b7280;margin:0 0 14px;">Add, remove or reorder images. Click <strong>Add Image</strong> to paste a URL. Changes save for the site (localStorage).</p>
        <div id="tg-editor-list" style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;"></div>
        <button class="btn" id="tg-editor-add" style="background:#e8f5ee;color:#1a5c38;border:1.5px dashed #2d7a50;width:100%;margin-bottom:12px;"><i class="fa-solid fa-plus"></i> Add Image</button>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="tg-editor-reset">Reset to Defaults</button>
          <button class="btn btn-primary" id="tg-editor-save">Save Gallery</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const list = document.getElementById("tg-editor-list");
  let editImgs = [...images];

  function renderList() {
    list.innerHTML = editImgs.map((img, i) => `
      <div style="display:flex;gap:10px;align-items:center;background:#f9fafb;padding:10px;border-radius:10px;border:1px solid #e5e7eb;" data-idx="${i}">
        <span style="font-size:0.78rem;color:#999;width:20px;text-align:center;cursor:grab;">&#9776;</span>
        <img src="${img.url}" style="width:64px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" />
        <div style="flex:1;min-width:0;">
          <input type="text" class="tg-ed-url" data-idx="${i}" value="${img.url}" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem;" placeholder="Image URL" />
          <input type="text" class="tg-ed-cap" data-idx="${i}" value="${img.caption || ''}" style="width:100%;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.78rem;margin-top:4px;" placeholder="Caption (optional)" />
        </div>
        <button class="tg-ed-remove" data-idx="${i}" style="background:none;border:none;color:#e74c3c;cursor:pointer;padding:4px;"><i class="fa-solid fa-trash-can"></i></button>
        <button class="tg-ed-up" data-idx="${i}" style="background:none;border:none;color:#666;cursor:pointer;padding:4px;"><i class="fa-solid fa-chevron-up"></i></button>
        <button class="tg-ed-down" data-idx="${i}" style="background:none;border:none;color:#666;cursor:pointer;padding:4px;"><i class="fa-solid fa-chevron-down"></i></button>
      </div>
    `).join("");

    list.querySelectorAll(".tg-ed-url").forEach((inp) => {
      inp.addEventListener("change", () => { editImgs[parseInt(inp.dataset.idx)].url = inp.value; renderList(); });
    });
    list.querySelectorAll(".tg-ed-cap").forEach((inp) => {
      inp.addEventListener("change", () => { editImgs[parseInt(inp.dataset.idx)].caption = inp.value; });
    });
    list.querySelectorAll(".tg-ed-remove").forEach((btn) => {
      btn.addEventListener("click", () => { editImgs.splice(parseInt(btn.dataset.idx), 1); renderList(); });
    });
    list.querySelectorAll(".tg-ed-up").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx);
        if (i > 0) { [editImgs[i - 1], editImgs[i]] = [editImgs[i], editImgs[i - 1]]; renderList(); }
      });
    });
    list.querySelectorAll(".tg-ed-down").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx);
        if (i < editImgs.length - 1) { [editImgs[i + 1], editImgs[i]] = [editImgs[i], editImgs[i + 1]]; renderList(); }
      });
    });
  }
  renderList();

  document.getElementById("tg-editor-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  document.getElementById("tg-editor-add").addEventListener("click", () => {
    if (editImgs.length >= 10) {
      showErrorToast("Maximum of 10 images are allowed in the gallery.");
      return;
    }
    editImgs.push({ url: "https://via.placeholder.com/600x400?text=New+Image", caption: "" });
    renderList();
  });

  document.getElementById("tg-editor-reset").addEventListener("click", () => {
    editImgs = [...DEFAULT_TG_IMAGES];
    renderList();
  });

  document.getElementById("tg-editor-save").addEventListener("click", () => {
    // Re-read latest input values
    list.querySelectorAll(".tg-ed-url").forEach((inp) => { editImgs[parseInt(inp.dataset.idx)].url = inp.value; });
    list.querySelectorAll(".tg-ed-cap").forEach((inp) => { editImgs[parseInt(inp.dataset.idx)].caption = inp.value; });
    saveTgImages(editImgs);
    tgCurrentPage = 0;
    renderTrainingGallery();
    resetTgAutoplay();
    modal.remove();
    showSuccessToast("Training gallery updated!");
  });
}

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
  if (warning) warning.classList.add('hidden');

  if (state.user && state.user.role === 'grower') {
    if (warning) {
      warning.textContent = '⚠️ Cultivator profiles are read-only. Please create a Buyer account to purchase spawn.';
      warning.classList.remove('hidden');
    }
    return;
  }

  toggleCartDrawer(false);
  window.location.hash = '#checkout';
}

function renderCheckoutPage() {
  const summaryContainer = document.getElementById('checkout-order-summary');
  if (!summaryContainer) return;

  if (!state.cart.length) {
    summaryContainer.innerHTML = `
      <div class="grid-skeleton">
        <i class="fa-solid fa-cart-shopping loader-icon"></i>
        <p>Your cart is empty. Add items before continuing to payment.</p>
      </div>
    `;
    return;
  }

  renderCheckoutOrderSummary(summaryContainer);

  if (!state.token || !state.user) {
    renderCheckoutLoginSection();
  } else {
    renderCheckoutDeliveryForm();
  }
}

function renderCheckoutOrderSummary(container) {
  const lines = state.cart.map((item) => {
    const product = state.products.find((p) => p.id === item.id) || {};
    return `
      <div class="checkout-summary-line">
        <span>${item.quantity}× ${item.name}</span>
        <strong>₹${(item.price * item.quantity).toFixed(2)}</strong>
      </div>
    `;
  });

  const subtotal = state.cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const gst = +(subtotal * 0.05).toFixed(2);
  const discount = state.activePromo ? 50 : 0;
  const shipping = 0;
  const total = subtotal + gst + shipping - discount;

  container.innerHTML = `
    <div class="checkout-summary-item-list">
      ${lines.join('')}
    </div>
    <div class="checkout-summary-totals">
      <div><span>Subtotal</span><span>₹${subtotal.toFixed(2)}</span></div>
      <div><span>GST (5%)</span><span>₹${gst.toFixed(2)}</span></div>
      <div><span>Shipping</span><span>₹0.00</span></div>
      <div class="checkout-summary-free-shipping">Free shipping applied</div>
      <div><span>Discount</span><span>₹${discount.toFixed(2)}</span></div>
      <div class="checkout-summary-total"><span>Total</span><strong>₹${total.toFixed(2)}</strong></div>
    </div>
  `;
}

function renderCheckoutLoginSection() {
  const formPanel = document.querySelector('.checkout-form-panel');
  if (!formPanel) return;

  formPanel.innerHTML = `
    <div class="checkout-auth-section">
      <div class="checkout-auth-header">
        <i class="fa-solid fa-user-lock" style="font-size:2rem;color:var(--green-mid);"></i>
        <h3 style="margin:8px 0 4px;">Login to Checkout</h3>
        <p style="color:var(--text-muted);font-size:0.9rem;">Verify your identity to proceed with your order</p>
      </div>

      <div class="checkout-auth-tabs" style="display:flex;gap:8px;margin:16px 0;">
        <button class="btn checkout-auth-tab active" data-method="phone" style="flex:1;padding:10px;border:2px solid var(--green-mid);background:var(--green-mid);color:#fff;border-radius:8px;cursor:pointer;">
          <i class="fa-solid fa-mobile-screen"></i> Phone OTP
        </button>
        <button class="btn checkout-auth-tab" data-method="email" style="flex:1;padding:10px;border:2px solid var(--border);background:transparent;color:var(--text-dark);border-radius:8px;cursor:pointer;">
          <i class="fa-solid fa-envelope"></i> Email OTP
        </button>
      </div>

      <div id="checkout-auth-step1">
        <div id="checkout-auth-phone-group">
          <label style="display:block;margin-bottom:6px;font-weight:600;">Phone Number</label>
          <div style="display:flex;gap:8px;">
            <input type="tel" id="checkout-auth-contact" placeholder="Enter phone number" maxlength="10" style="flex:1;padding:12px;border:1.5px solid var(--border);border-radius:8px;outline:none;" />
            <button class="btn btn-primary" id="checkout-auth-send-otp" style="white-space:nowrap;">Send OTP</button>
          </div>
        </div>
        <div id="checkout-auth-email-group" class="hidden" style="margin-top:12px;">
          <label style="display:block;margin-bottom:6px;font-weight:600;">Email Address</label>
          <div style="display:flex;gap:8px;">
            <input type="email" id="checkout-auth-email" placeholder="Enter email address" style="flex:1;padding:12px;border:1.5px solid var(--border);border-radius:8px;outline:none;" />
            <button class="btn btn-primary" id="checkout-auth-send-email-otp" style="white-space:nowrap;">Send OTP</button>
          </div>
        </div>
        <p style="margin-top:8px;font-size:0.85rem;color:var(--text-muted);">
          <a href="#" id="checkout-auth-toggle-method" style="color:var(--green-mid);">or use Email OTP instead</a>
        </p>
      </div>

      <div id="checkout-auth-step2" class="hidden" style="margin-top:16px;">
        <p id="checkout-auth-otp-subtitle" style="margin-bottom:8px;font-size:0.9rem;color:var(--text-muted);">Enter the 6-digit code sent</p>
        <div style="display:flex;gap:8px;">
          <input type="text" id="checkout-auth-otp" placeholder="Enter OTP" maxlength="6" style="flex:1;padding:12px;border:1.5px solid var(--border);border-radius:8px;outline:none;text-align:center;letter-spacing:0.3rem;font-size:1.1rem;" />
          <button class="btn btn-primary" id="checkout-auth-verify-btn">Verify</button>
        </div>
        <p style="margin-top:8px;font-size:0.85rem;">
          <a href="#" id="checkout-auth-back-step1" style="color:var(--text-muted);">Change phone/email</a>
        </p>
      </div>

      <div class="auth-error-msg hidden" id="checkout-auth-error" style="margin-top:12px;padding:8px 12px;background:#fef2f2;color:#dc2626;border-radius:6px;font-size:0.85rem;"></div>

      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
        <button class="btn btn-secondary btn-block" id="checkout-back-cart-btn">
          <i class="fa-solid fa-arrow-left"></i> Back to cart
        </button>
      </div>
    </div>
  `;

  bindCheckoutAuthEvents();
}

function bindCheckoutAuthEvents() {
  let activeMethod = 'phone';
  let pendingContact = null;
  let mockOtp = null;

  const tabPhone = document.querySelector('.checkout-auth-tab[data-method="phone"]');
  const tabEmail = document.querySelector('.checkout-auth-tab[data-method="email"]');
  const phoneGroup = document.getElementById('checkout-auth-phone-group');
  const emailGroup = document.getElementById('checkout-auth-email-group');
  const step1 = document.getElementById('checkout-auth-step1');
  const step2 = document.getElementById('checkout-auth-step2');
  const contactInput = document.getElementById('checkout-auth-contact');
  const emailInput = document.getElementById('checkout-auth-email');
  const otpInput = document.getElementById('checkout-auth-otp');
  const sendBtn = document.getElementById('checkout-auth-send-otp');
  const sendEmailBtn = document.getElementById('checkout-auth-send-email-otp');
  const verifyBtn = document.getElementById('checkout-auth-verify-btn');
  const toggleLink = document.getElementById('checkout-auth-toggle-method');
  const backLink = document.getElementById('checkout-auth-back-step1');
  const errorEl = document.getElementById('checkout-auth-error');
  const otpSubtitle = document.getElementById('checkout-auth-otp-subtitle');
  const backCartBtn = document.getElementById('checkout-back-cart-btn');

  if (backCartBtn) {
    backCartBtn.addEventListener('click', () => toggleCartDrawer(true));
  }

  function showError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  }

  function hideError() {
    if (errorEl) errorEl.classList.add('hidden');
  }

  function switchMethod(method) {
    activeMethod = method;
    if (tabPhone && tabEmail) {
      tabPhone.className = `btn checkout-auth-tab ${method === 'phone' ? 'active' : ''}`;
      tabEmail.className = `btn checkout-auth-tab ${method === 'email' ? 'active' : ''}`;
      tabPhone.style.background = method === 'phone' ? 'var(--green-mid)' : 'transparent';
      tabPhone.style.color = method === 'phone' ? '#fff' : 'var(--text-dark)';
      tabPhone.style.borderColor = method === 'phone' ? 'var(--green-mid)' : 'var(--border)';
      tabEmail.style.background = method === 'email' ? 'var(--green-mid)' : 'transparent';
      tabEmail.style.color = method === 'email' ? '#fff' : 'var(--text-dark)';
      tabEmail.style.borderColor = method === 'email' ? 'var(--green-mid)' : 'var(--border)';
    }
    if (phoneGroup) phoneGroup.classList.toggle('hidden', method !== 'phone');
    if (emailGroup) emailGroup.classList.toggle('hidden', method !== 'email');
    if (toggleLink) {
      toggleLink.textContent = method === 'phone' ? 'or use Email OTP instead' : 'or use Phone OTP instead';
    }
    if (step1) step1.classList.remove('hidden');
    if (step2) step2.classList.add('hidden');
    hideError();
  }

  if (tabPhone) tabPhone.addEventListener('click', () => switchMethod('phone'));
  if (tabEmail) tabEmail.addEventListener('click', () => switchMethod('email'));

  if (toggleLink) {
    toggleLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchMethod(activeMethod === 'phone' ? 'email' : 'phone');
    });
  }

  if (backLink) {
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (step1) step1.classList.remove('hidden');
      if (step2) step2.classList.add('hidden');
      hideError();
    });
  }

  async function handleSendOtp() {
    hideError();
    const contact = activeMethod === 'phone' ? contactInput?.value.trim() : emailInput?.value.trim();
    if (!contact) {
      showError(activeMethod === 'phone' ? 'Please enter a phone number.' : 'Please enter an email address.');
      return;
    }

    if (activeMethod === 'phone' && !/^\d{10}$/.test(contact)) {
      showError('Enter a valid 10-digit Indian phone number.');
      return;
    }

    if (activeMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      showError('Enter a valid email address.');
      return;
    }

    const btn = activeMethod === 'phone' ? sendBtn : sendEmailBtn;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    try {
      const emailForOtp = activeMethod === 'phone'
        ? `phone-${contact.replace(/\D/g, '')}@sporekart.com`
        : contact;

      pendingContact = emailForOtp;
      const result = await authApi.requestOtp(emailForOtp, 'buyer', '');
      mockOtp = (result && result.otp) ? result.otp : null;

      if (step1) step1.classList.add('hidden');
      if (step2) step2.classList.remove('hidden');
      if (otpSubtitle) {
        const displayContact = activeMethod === 'phone' ? `+91 ${contact}` : contact;
        if (mockOtp) {
          otpSubtitle.textContent = `Mock OTP: ${mockOtp} - enter it below to continue`;
        } else {
          otpSubtitle.textContent = `Enter the 6-digit code sent to ${displayContact}`;
        }
      }
      if (otpInput && mockOtp) otpInput.value = mockOtp;
      hideError();
    } catch (err) {
      showError(err.message || 'Failed to send OTP.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = activeMethod === 'phone' ? 'Send OTP' : 'Send OTP'; }
    }
  }

  if (sendBtn) sendBtn.addEventListener('click', handleSendOtp);
  if (sendEmailBtn) sendEmailBtn.addEventListener('click', handleSendOtp);

  if (contactInput) {
    contactInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSendOtp();
    });
  }
  if (emailInput) {
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSendOtp();
    });
  }

  async function handleVerifyOtp() {
    const otpCode = otpInput?.value.trim();
    if (!otpCode || !/^\d{6}$/.test(otpCode)) {
      showError('Enter a valid 6-digit OTP.');
      return;
    }

    if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying...'; }

    try {
      const data = await authApi.verifyOtp(pendingContact, otpCode, {
        loginMethod: activeMethod,
        whatsappNumber: activeMethod === 'phone' ? `+91${contactInput?.value.trim()}` : '',
      });
      data.user = data.user || {};
      data.user.loginMethod = activeMethod;
      if (activeMethod === 'phone') {
        data.user.whatsappNumber = `+91${contactInput?.value.trim()}`;
      }
      saveAuth(data.token, data.user);
      hideError();
    } catch (err) {
      showError(err.message || 'OTP verification failed.');
      if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = 'Verify'; }
    }
  }

  if (verifyBtn) verifyBtn.addEventListener('click', handleVerifyOtp);
  if (otpInput) {
    otpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleVerifyOtp();
    });
  }
}

function renderCheckoutDeliveryForm() {
  const formPanel = document.querySelector('.checkout-form-panel');
  if (!formPanel) return;

  if (_checkoutFormOriginalHTML) {
    formPanel.innerHTML = _checkoutFormOriginalHTML;
  }

  // Re-populate state dropdown (lost when HTML was replaced by login section)
  const stateSelectEl = document.getElementById('checkout-state');
  if (stateSelectEl) {
    if (_statesCache.length > 0 && stateSelectEl.options.length <= 1) {
      stateSelectEl.innerHTML = '<option value="">Select State</option>' +
        _statesCache.map(s => `<option value="${s}">${s}</option>`).join('');
    } else if (_statesCache.length === 0) {
      _loadStates();
    }
  }

  const isReturningUser = state.user && (
    state.user.addressLine1 || state.user.address_line1 ||
    state.user.addressLine2 || state.user.address_line2
  );

  const user = state.user || {};

  const phoneInput = document.getElementById('checkout-delivery-phone');
  const nameInput = document.getElementById('checkout-delivery-name');
  const emailInput = document.getElementById('checkout-delivery-email');
  const pincodeInput = document.getElementById('checkout-delivery-pincode');
  const line1Input = document.getElementById('checkout-address-line1');
  const line2Input = document.getElementById('checkout-address-line2');
  const landmarkInput = document.getElementById('checkout-landmark');
  const stateSelect = document.getElementById('checkout-state');
  const citySelect = document.getElementById('checkout-city');

  if (nameInput) {
    nameInput.value = user.fullName || user.full_name || '';
  }

  const uPhone = user.whatsappNumber || user.whatsapp_number || '';
  if (phoneInput) {
    if (uPhone) phoneInput.value = uPhone;
    if (isReturningUser) {
      phoneInput.readOnly = true;
      phoneInput.style.background = '#f3f4f6';
      phoneInput.style.cursor = 'not-allowed';
    }
  }

  const uEmail = user.email || '';
  if (emailInput && !emailInput.value && uEmail) emailInput.value = uEmail;

  const uPincode = user.defaultPincode || user.default_pincode || '';
  if (pincodeInput && !pincodeInput.value && uPincode) pincodeInput.value = uPincode;

  const uLine1 = user.addressLine1 || user.address_line1 || '';
  if (line1Input && !line1Input.value && uLine1) line1Input.value = uLine1;

  const uLine2 = user.addressLine2 || user.address_line2 || '';
  if (line2Input && !line2Input.value && uLine2) line2Input.value = uLine2;

  const uLandmark = user.landmark || '';
  if (landmarkInput && !landmarkInput.value && uLandmark) landmarkInput.value = uLandmark;

  const uState = user.state || '';
  const uCity = user.city || '';

  if (stateSelect && !stateSelect.value && uState) {
    if (!_statesCache.includes(uState)) {
      const opt = document.createElement('option');
      opt.value = uState;
      opt.textContent = uState;
      stateSelect.appendChild(opt);
    }
    stateSelect.value = uState;
    if (citySelect && uState) {
      _loadCities(uState).then(cities => {
        citySelect.innerHTML = '<option value="">Select City</option>' +
          cities.map(c => `<option value="${c}">${c}</option>`).join('');
        if (uCity) {
          if (!cities.includes(uCity)) {
            const opt = document.createElement('option');
            opt.value = uCity;
            opt.textContent = uCity;
            citySelect.appendChild(opt);
          }
          citySelect.value = uCity;
        }
      });
    }
  }

  _attachCheckoutValidation();

  // Re-bind state→city dropdown and pincode auto-fill (lost when HTML was replaced)
  const _stateSelect = document.getElementById('checkout-state');
  const _citySelect = document.getElementById('checkout-city');
  if (_stateSelect) {
    _stateSelect.addEventListener('change', async (e) => {
      const selState = e.target.value;
      if (!_citySelect) return;
      if (!selState) {
        _citySelect.innerHTML = '<option value="">Select State first</option>';
        return;
      }
      const cities = await _loadCities(selState);
      if (!cities.length && !_citiesCache[selState]) {
        _citySelect.innerHTML = '<option value="">Select State first</option>';
        return;
      }
      _citySelect.innerHTML = '<option value="">Select City</option>' +
        cities.map(c => `<option value="${c}">${c}</option>`).join('');
    });
  }
  const _pincodeInput = document.getElementById('checkout-delivery-pincode');
  if (_pincodeInput) {
    _pincodeInput.addEventListener('input', async (e) => {
      const pin = e.target.value.trim();
      if (pin.length === 6 && /^\d{6}$/.test(pin)) {
        try {
          const resp = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
          if (!resp.ok) return;
          const data = await resp.json();
          if (data[0]?.Status === 'Success') {
            const d = data[0].PostOffice[0];
            const foundState = d.State;
            if (_stateSelect && !_stateSelect.value) {
              _stateSelect.value = foundState;
              _stateSelect.dispatchEvent(new Event('change'));
            }
          }
        } catch { /* ignore */ }
      }
    });
  }

  document.getElementById('btn-payment-continue')?.addEventListener('click', handlePaymentContinue);
  const backCartBtn = document.getElementById('btn-change-cart');
  if (backCartBtn) {
    backCartBtn.addEventListener('click', () => toggleCartDrawer(true));
  }
}

function _attachCheckoutValidation() {
  const checkoutFields = [
    { id: 'checkout-delivery-name', validator: (v) => v.trim().length >= 2 ? '' : 'Please enter your full name.' },
    { id: 'checkout-delivery-phone', validator: (v) => isValidIndianPhone(v.trim()) || !v.trim() ? '' : 'Enter a valid Indian phone number.' },
    { id: 'checkout-delivery-email', validator: (v) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter a valid email address.' },
    { id: 'checkout-delivery-pincode', validator: (v) => !v.trim() || /^\d{6}$/.test(v.trim()) ? '' : 'Enter a valid 6-digit pincode.' },
    { id: 'checkout-address-line1', validator: (v) => v.trim() ? '' : 'Address Line 1 is required.' },
    { id: 'checkout-address-line2', validator: (v) => v.trim() ? '' : 'Address Line 2 is required.' },
    { id: 'checkout-landmark', validator: (v) => v.trim() ? '' : 'Landmark is required.' },
    { id: 'checkout-state', validator: (v) => v.trim() ? '' : 'Please select a state.' },
    { id: 'checkout-city', validator: (v) => v.trim() ? '' : 'Please select a city.' },
  ];

  checkoutFields.forEach(({ id, validator }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => {
      const feedback = document.getElementById('checkout-page-feedback');
      if (feedback) { feedback.textContent = ''; feedback.classList.add('hidden'); }
      const errEl = document.getElementById(`error-${id}`);
      const msg = validator(el.value);
      if (msg) {
        el.classList.add('input-error');
        if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
      } else {
        el.classList.remove('input-error');
        if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
      }
    });
    el.addEventListener('focus', () => {
      el.classList.remove('input-error');
      const errEl = document.getElementById(`error-${id}`);
      if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
    });
  });
}

async function handlePaymentContinue() {
  const deliveryName = document.getElementById('checkout-delivery-name')?.value.trim() || state.user?.fullName || '';
  const deliveryPhone = document.getElementById('checkout-delivery-phone')?.value.trim() || '';
  const deliveryEmail = document.getElementById('checkout-delivery-email')?.value.trim() || state.user?.email || '';
  const addressLine1 = document.getElementById('checkout-address-line1')?.value.trim() || '';
  const addressLine2 = document.getElementById('checkout-address-line2')?.value.trim() || '';
  const landmark = document.getElementById('checkout-landmark')?.value.trim() || '';
  const city = document.getElementById('checkout-city')?.value.trim() || '';
  const stateVal = document.getElementById('checkout-state')?.value.trim() || '';
  const deliveryPincode = document.getElementById('checkout-delivery-pincode')?.value.trim() || '';

  function clearFieldErrors() {
    document.querySelectorAll('.checkout-page .input-error').forEach(el => el.classList.remove('input-error'));
    document.querySelectorAll('.checkout-page .input-error-msg').forEach(el => { el.textContent = ''; el.classList.remove('visible'); });
  }

  function markFieldError(id, message) {
    const input = document.getElementById(id);
    const error = document.getElementById(`error-${id}`);
    if (input) input.classList.add('input-error');
    if (error) { error.textContent = message; error.classList.add('visible'); }
  }

  clearFieldErrors();

  let hasError = false;

  if (!deliveryName || deliveryName.length < 2) {
    markFieldError('checkout-delivery-name', 'Please enter your full name.');
    hasError = true;
  }

  if (!isValidIndianPhone(deliveryPhone)) {
    markFieldError('checkout-delivery-phone', 'Enter a valid Indian phone number (e.g. +91 9876543210).');
    hasError = true;
  }

  if (!deliveryPincode || !/^\d{6}$/.test(deliveryPincode)) {
    markFieldError('checkout-delivery-pincode', 'Enter a valid 6-digit pincode.');
    hasError = true;
  }

  if (!addressLine1) {
    markFieldError('checkout-address-line1', 'Address Line 1 is required.');
    hasError = true;
  }

  if (!addressLine2) {
    markFieldError('checkout-address-line2', 'Address Line 2 is required.');
    hasError = true;
  }

  if (!landmark) {
    markFieldError('checkout-landmark', 'Landmark is required.');
    hasError = true;
  }

  if (!stateVal) {
    markFieldError('checkout-state', 'Please select a state.');
    hasError = true;
  }

  if (!city) {
    markFieldError('checkout-city', 'Please select a city.');
    hasError = true;
  }

  if (hasError) {
    const feedback = document.getElementById('checkout-page-feedback');
    if (feedback) {
      feedback.textContent = 'Please fix the highlighted fields above.';
      feedback.classList.remove('hidden');
    }
    const firstError = document.querySelector('.checkout-page .input-error');
    if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  try {
    const data = await fetchWithAuth('/orders/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: state.cart.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          ...(item.weightInfo ? { weight: item.weightInfo.weight, unit: item.weightInfo.unit } : {}),
        })),
        promoCode: state.activePromo || "",
        customer_name: deliveryName,
        customer_email: deliveryEmail,
        delivery_phone: deliveryPhone,
        address_line1: addressLine1,
        address_line2: addressLine2,
        landmark: landmark,
        city: city,
        state: stateVal,
        pincode: deliveryPincode,
      }),
    });

    toggleCartDrawer(false);

    const rzpDetails = data.razorpay;
    const orderRecord = data.order;

    if (
      !rzpDetails.keyId
      || rzpDetails.keyId.includes('mockKey')
      || rzpDetails.keyId.includes('rzp_test_mock')
    ) {
      showMockPaymentModal(rzpDetails, orderRecord);
    } else {
      showPaymentChoiceModal(rzpDetails, orderRecord);
    }
  } catch (err) {
    showErrorToast(getApiErrorMessage(err));
    if (feedback) {
      feedback.textContent = 'Unable to connect to payment service. Please try again later.';
      feedback.classList.remove('hidden');
    }
  }
}

// ── Payment Method Choice Modal (for real Razorpay) ────────────────────────
function showPaymentChoiceModal(rzpDetails, orderRecord) {
  document.getElementById('payment-choice-modal')?.remove();
  const amount = (rzpDetails.amount / 100).toFixed(2);

  function buildRzpOptions(extraPrefill) {
    return {
      key: rzpDetails.keyId,
      amount: rzpDetails.amount,
      currency: rzpDetails.currency,
      name: 'Sporekart',
      description: 'Sporekart Order',
      order_id: rzpDetails.orderId,
      async handler(response) {
        choiceModal.remove();
        await completeOrderPayment(
          response.razorpay_order_id,
          response.razorpay_payment_id,
          response.razorpay_signature,
        );
      },
      prefill: {
        name: state.user?.fullName || '',
        email: state.user?.email || '',
        contact: state.user?.whatsappNumber || '',
        ...(extraPrefill || {}),
      },
      theme: { color: '#38b17b' },
    };
  }

  const choiceModal = document.createElement('div');
  choiceModal.id = 'payment-choice-modal';
  choiceModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(8px);font-family:Inter,sans-serif;';
  choiceModal.innerHTML = `
    <div style="background:#0d1f17;border:1px solid rgba(56,177,123,0.25);border-radius:22px;width:100%;max-width:460px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.6);color:#e2e8f0;">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="width:54px;height:54px;border-radius:14px;background:linear-gradient(135deg,#38b17b,#1a7a52);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
          <i class="fa-solid fa-credit-card" style="color:#fff;font-size:22px;"></i>
        </div>
        <h3 style="margin:0 0 6px;font-size:1.18rem;font-weight:700;color:#fff;">Choose Payment Method</h3>
        <p style="margin:0;color:#64748b;font-size:0.85rem;">Amount: <strong style="color:#fbbf24;font-size:1rem;">₹${amount}</strong></p>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:22px;">
        <button id="pcm-btn-razorpay" style="width:100%;background:rgba(56,177,123,0.08);border:1.5px solid rgba(56,177,123,0.35);border-radius:14px;padding:18px 20px;cursor:pointer;color:#e2e8f0;font-family:inherit;display:flex;align-items:center;gap:16px;text-align:left;transition:all 0.2s;">
          <div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#38b17b,#1a7a52);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fa-solid fa-lock" style="color:#fff;font-size:18px;"></i>
          </div>
          <div style="flex:1;">
            <div style="font-size:0.95rem;font-weight:700;color:#fff;">Razorpay Secure Checkout</div>
            <div style="font-size:0.75rem;color:#64748b;margin-top:3px;">Card · Net Banking · Wallet · UPI · EMI</div>
          </div>
          <i class="fa-solid fa-chevron-right" style="color:#38b17b;"></i>
        </button>

        <button id="pcm-btn-upi-id" style="width:100%;background:rgba(250,204,21,0.07);border:1.5px solid rgba(250,204,21,0.28);border-radius:14px;padding:18px 20px;cursor:pointer;color:#e2e8f0;font-family:inherit;display:flex;align-items:center;gap:16px;text-align:left;transition:all 0.2s;">
          <div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fa-solid fa-indian-rupee-sign" style="color:#fff;font-size:18px;"></i>
          </div>
          <div style="flex:1;">
            <div style="font-size:0.95rem;font-weight:700;color:#fff;">Pay via UPI ID</div>
            <div style="font-size:0.75rem;color:#64748b;margin-top:3px;">Enter your UPI ID (GPay / PhonePe / Paytm)</div>
          </div>
          <i class="fa-solid fa-chevron-right" style="color:#f59e0b;"></i>
        </button>

        <button id="pcm-btn-upi-qr" style="width:100%;background:rgba(99,102,241,0.08);border:1.5px solid rgba(99,102,241,0.3);border-radius:14px;padding:18px 20px;cursor:pointer;color:#e2e8f0;font-family:inherit;display:flex;align-items:center;gap:16px;text-align:left;transition:all 0.2s;">
          <div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#4f46e5);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fa-solid fa-qrcode" style="color:#fff;font-size:20px;"></i>
          </div>
          <div style="flex:1;">
            <div style="font-size:0.95rem;font-weight:700;color:#fff;">Pay via UPI QR Code</div>
            <div style="font-size:0.75rem;color:#64748b;margin-top:3px;">GPay · PhonePe · Paytm · BHIM · Any UPI App</div>
          </div>
          <i class="fa-solid fa-chevron-right" style="color:#6366f1;"></i>
        </button>
      </div>

      <button id="pcm-btn-cancel" style="width:100%;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:11px;color:#64748b;font-size:0.85rem;cursor:pointer;font-family:inherit;">✕ Cancel</button>
    </div>
  `;
  document.body.appendChild(choiceModal);

  document.getElementById('pcm-btn-razorpay')?.addEventListener('click', () => {
    choiceModal.remove();
    const rzp = new Razorpay(buildRzpOptions());
    rzp.open();
  });
  document.getElementById('pcm-btn-upi-id')?.addEventListener('click', () => {
    choiceModal.remove();
    showUpiIdModal(rzpDetails, orderRecord);
  });
  document.getElementById('pcm-btn-upi-qr')?.addEventListener('click', () => {
    choiceModal.remove();
    showUpiQrModal(rzpDetails, orderRecord);
  });
  document.getElementById('pcm-btn-cancel')?.addEventListener('click', () => {
    choiceModal.remove();
    showSuccessToast('⚠️ Payment cancelled.');
  });
  choiceModal.addEventListener('click', (e) => { if (e.target === choiceModal) choiceModal.remove(); });
}

// ── UPI ID Entry Modal ───────────────────────────────────────────────────────
function showUpiIdModal(rzpDetails, orderRecord) {
  document.getElementById('upi-id-modal')?.remove();
  const amount = (rzpDetails.amount / 100).toFixed(2);

  const modal = document.createElement('div');
  modal.id = 'upi-id-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(8px);font-family:Inter,sans-serif;';
  modal.innerHTML = `
    <div style="background:#0d1f17;border:1px solid rgba(250,204,21,0.25);border-radius:22px;width:100%;max-width:420px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.6);color:#e2e8f0;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
          <i class="fa-solid fa-indian-rupee-sign" style="color:#fff;font-size:22px;"></i>
        </div>
        <h3 style="margin:0 0 6px;font-size:1.1rem;font-weight:700;color:#fff;">Enter UPI ID</h3>
        <div style="font-size:1.5rem;font-weight:800;color:#fbbf24;">₹${amount}</div>
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-size:0.75rem;color:#94a3b8;margin-bottom:8px;letter-spacing:0.04em;">YOUR UPI ID</div>
        <div style="display:flex;gap:8px;">
          <input id="upi-id-input" type="text" placeholder="yourname@upi" style="flex:1;background:rgba(255,255,255,0.06);border:1.5px solid rgba(250,204,21,0.3);border-radius:10px;padding:12px 16px;color:#fff;font-size:0.95rem;font-family:monospace;outline:none;" />
          <button id="upi-id-verify-btn" style="padding:12px 18px;background:rgba(250,204,21,0.12);border:1.5px solid rgba(250,204,21,0.3);border-radius:10px;color:#fbbf24;font-size:0.82rem;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;">Verify</button>
        </div>
        <div id="upi-id-status" style="margin-top:8px;font-size:0.8rem;color:#64748b;">Examples: 9876543210@ybl · name@okaxis · name@paytm</div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;">
        ${['@ybl', '@oksbi', '@okaxis', '@paytm', '@ibl', '@upi'].map(s => `<button class="upi-suffix-chip" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:5px 13px;color:#94a3b8;font-size:0.75rem;cursor:pointer;font-family:inherit;">${s}</button>`).join('')}
      </div>

      <button id="upi-id-pay-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;border-radius:12px;color:#fff;font-size:0.95rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px;">
        <i class="fa-solid fa-paper-plane"></i> Pay ₹${amount} via UPI
      </button>
      <button id="upi-id-back-btn" style="width:100%;padding:10px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#64748b;font-size:0.82rem;cursor:pointer;font-family:inherit;">← Back</button>
    </div>
  `;
  document.body.appendChild(modal);

  // Suffix chips auto-fill
  modal.querySelectorAll('.upi-suffix-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const inp = document.getElementById('upi-id-input');
      const current = inp.value.split('@')[0];
      inp.value = (current || '') + chip.textContent;
      inp.focus();
    });
  });

  // Verify button
  document.getElementById('upi-id-verify-btn')?.addEventListener('click', () => {
    const upiId = document.getElementById('upi-id-input').value.trim();
    const status = document.getElementById('upi-id-status');
    if (upiId.includes('@')) {
      status.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#38b17b;"></i> <span style="color:#38b17b;">UPI ID looks valid</span>';
    } else {
      status.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <span style="color:#f87171;">Please enter a valid UPI ID (e.g. name@ybl)</span>';
    }
  });

  // Pay button — open Razorpay with UPI pre-selected
  document.getElementById('upi-id-pay-btn')?.addEventListener('click', () => {
    const upiId = document.getElementById('upi-id-input').value.trim();
    if (!upiId || !upiId.includes('@')) {
      const status = document.getElementById('upi-id-status');
      status.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#f87171;"></i> <span style="color:#f87171;">Please enter a valid UPI ID first</span>';
      return;
    }
    modal.remove();
    const opts = {
      key: rzpDetails.keyId,
      amount: rzpDetails.amount,
      currency: rzpDetails.currency,
      name: 'Sporekart',
      description: 'UPI Payment',
      order_id: rzpDetails.orderId,
      async handler(response) {
        await completeOrderPayment(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature);
      },
      prefill: { name: state.user?.fullName || '', email: state.user?.email || '', contact: state.user?.whatsappNumber || '', vpa: upiId },
      method: 'upi',
      theme: { color: '#f59e0b' },
    };
    const rzp = new Razorpay(opts);
    rzp.open();
  });

  document.getElementById('upi-id-back-btn')?.addEventListener('click', () => { modal.remove(); showPaymentChoiceModal(rzpDetails, orderRecord); });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ── UPI QR Code Modal ────────────────────────────────────────────────────────
function showUpiQrModal(rzpDetails, orderRecord) {
  document.getElementById('upi-qr-modal')?.remove();
  const amount = (rzpDetails.amount / 100).toFixed(2);
  const orderId = rzpDetails.orderId || orderRecord?.id || 'ORDER';
  const merchantUpi = 'sporekart@ybl';
  const upiUrl = `upi://pay?pa=${merchantUpi}&pn=Sporekart&am=${amount}&cu=INR&tn=Order%20${orderId}`;

  const modal = document.createElement('div');
  modal.id = 'upi-qr-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(10px);font-family:Inter,sans-serif;';
  modal.innerHTML = `
    <div style="background:#0d1f17;border:1px solid rgba(99,102,241,0.3);border-radius:22px;width:100%;max-width:400px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,0.6);color:#e2e8f0;text-align:center;">
      <div style="margin-bottom:20px;">
        <div style="width:50px;height:50px;border-radius:14px;background:linear-gradient(135deg,#6366f1,#4f46e5);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">
          <i class="fa-solid fa-qrcode" style="color:#fff;font-size:22px;"></i>
        </div>
        <h3 style="margin:0 0 4px;font-size:1.1rem;font-weight:700;color:#fff;">Scan &amp; Pay via UPI</h3>
        <div style="font-size:1.6rem;font-weight:800;color:#fbbf24;">₹${amount}</div>
      </div>

      <div style="background:#fff;display:inline-block;padding:14px;border-radius:16px;box-shadow:0 0 0 2px rgba(99,102,241,0.45),0 8px 32px rgba(0,0,0,0.3);margin-bottom:16px;">
        <div id="upi-qr-canvas" style="width:200px;height:200px;"></div>
      </div>

      <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:9px 14px;margin-bottom:14px;">
        <div style="font-size:0.7rem;color:#64748b;margin-bottom:2px;">MERCHANT UPI ID</div>
        <div style="font-size:0.9rem;font-weight:600;color:#a5b4fc;font-family:monospace;">${merchantUpi}</div>
      </div>

      <div style="display:flex;justify-content:center;gap:12px;margin-bottom:14px;">
        ${[{ l: 'GPay', c: '#4285F4', i: 'fa-google' }, { l: 'PhonePe', c: '#5F259F', i: 'fa-mobile' }, { l: 'Paytm', c: '#00BAF2', i: 'fa-p' }, { l: 'BHIM', c: '#138808', i: 'fa-indian-rupee-sign' }].map(a => `
          <div><div style="width:38px;height:38px;border-radius:9px;background:${a.c};display:flex;align-items:center;justify-content:center;margin:0 auto 3px;"><i class="fa-solid ${a.i}" style="color:#fff;font-size:14px;"></i></div><div style="font-size:0.65rem;color:#94a3b8;">${a.l}</div></div>`).join('')}
      </div>

      <div style="font-size:0.78rem;color:#64748b;margin-bottom:18px;line-height:1.6;">Open any UPI app → Scan QR → Confirm <strong style="color:#fbbf24;">₹${amount}</strong></div>

      <button id="upi-qr-confirm-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;border-radius:12px;color:#fff;font-size:0.95rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;">
        <i class="fa-solid fa-circle-check"></i> I've Completed Payment
      </button>
      <button id="upi-qr-back-btn" style="width:100%;padding:10px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#64748b;font-size:0.82rem;cursor:pointer;font-family:inherit;">← Back to Payment Options</button>
    </div>
  `;
  document.body.appendChild(modal);

  // Generate QR code
  setTimeout(() => {
    const canvas = document.getElementById('upi-qr-canvas');
    if (canvas && window.QRCode) {
      new QRCode(canvas, { text: upiUrl, width: 200, height: 200, colorDark: '#1a3a2a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } else if (canvas) {
      canvas.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:#475569;padding:8px;word-break:break-all;';
      canvas.textContent = upiUrl;
    }
  }, 60);

  // Confirm → record UPI payment directly, no Razorpay re-open
  document.getElementById('upi-qr-confirm-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('upi-qr-confirm-btn');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Confirming...';
    btn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/orders/confirm-upi-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        },
        body: JSON.stringify({ razorpay_order_id: orderId }),
      });
      const data = await res.json();
      modal.remove();

      if (res.ok) {
        // Clear cart
        clearCart();
        updateCartUI();
        state.activePromo = null;
        state.promoDiscountPct = 0;
        const promoInput = document.getElementById('promo-input');
        if (promoInput) promoInput.value = '';
        const promoMsg = document.getElementById('promo-message');
        if (promoMsg) promoMsg.classList.add('hidden');

        await fetchProducts();
        await loadUser();

        const isPending = (data.data?.status || data.status) === 'pending_upi_verification';
        const userName = state.user?.fullName || state.user?.full_name || 'Valued Cultivator';

        // Notify other tabs (admin) that orders have been updated
        try {
          const bcOrders = new BroadcastChannel('spore-orders');
          bcOrders.postMessage({ type: 'orders:updated', orderId: orderRecord?.id || null });
        } catch (e) {
          // ignore if BroadcastChannel isn't available
        }

        showPopupModal({
          title: isPending ? '📋 UPI Payment Submitted' : '🎉 Payment Successful!',
          message: isPending
            ? `${userName}, your UPI payment has been submitted. We will verify and confirm your order within 24 hours.`
            : `${userName}, your payment is confirmed. Your order has been placed successfully.`,
          duration: 1500,
          redirectHash: '#shop',
        });
      } else {
        btn.innerHTML = orig;
        btn.disabled = false;
        showErrorToast(data.error || 'Could not confirm payment. Please contact support.');
      }
    } catch (err) {
      btn.innerHTML = orig;
      btn.disabled = false;
      showErrorToast('Network error. Please try again or contact support.');
    }
  });
  document.getElementById('upi-qr-back-btn')?.addEventListener('click', () => { modal.remove(); showPaymentChoiceModal(rzpDetails, orderRecord); });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function showMockPaymentModal(rzpDetails, orderRecord) {
  // Remove existing if any
  document.getElementById('mock-payment-gateway-modal')?.remove();

  const amount = (rzpDetails.amount / 100).toFixed(2);
  const { orderId } = rzpDetails;

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
      <!-- â”€â”€â”€ HEADER BAR â”€â”€â”€ -->
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

      <!-- â”€â”€â”€ BODY: LEFT TABS + RIGHT PANEL â”€â”€â”€ -->
      <div style="display:flex; flex:1; overflow:hidden; min-height:0;">

        <!-- LEFT METHOD LIST -->
        <div style="
          width:200px; flex-shrink:0; background:#091410;
          border-right:1px solid rgba(56,177,123,0.12);
          overflow-y:auto; padding:8px 0;
        ">
          ${[
      {
        id: 'upi',
        icon: 'fa-mobile-screen-button',
        label: 'UPI',
        badge: 'Recommended',
      },
      {
        id: 'card',
        icon: 'fa-credit-card',
        label: 'Card',
        badge: '',
      },
      {
        id: 'netbank',
        icon: 'fa-building-columns',
        label: 'Net Banking',
        badge: '',
      },
      {
        id: 'wallet',
        icon: 'fa-wallet',
        label: 'Wallets',
        badge: '',
      },
      {
        id: 'emi',
        icon: 'fa-calendar-days',
        label: 'EMI',
        badge: '',
      },
      {
        id: 'cod',
        icon: 'fa-box-open',
        label: 'Cash on Delivery',
        badge: '',
      },
    ]
      .map(
        (m, i) => `
            <button class="pgw-tab-btn" data-tab="${m.id}" style="
              width:100%; text-align:left; background:${i === 0 ? 'rgba(56,177,123,0.12)' : 'transparent'};
              border:none; border-left:3px solid ${i === 0 ? '#38b17b' : 'transparent'};
              padding:12px 14px; cursor:pointer; color:${i === 0 ? '#38b17b' : '#94a3b8'};
              display:flex; align-items:center; gap:10px; transition:all 0.18s;
              font-size:0.85rem; font-family:inherit;
            ">
              <i class="fa-solid ${m.icon}" style="width:16px;text-align:center;"></i>
              <div>
                <div style="font-weight:${i === 0 ? '600' : '500'}">${m.label}</div>
                ${m.badge ? `<div style="font-size:0.65rem;color:#38b17b;margin-top:1px;">${m.badge}</div>` : ''}
              </div>
            </button>
          `,
      )
      .join('')}
          <div style="margin:12px 14px 0;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:0.68rem;color:#475569;display:flex;align-items:center;gap:6px;">
            <i class="fa-solid fa-shield-halved" style="color:#38b17b;"></i> 100% Secure
          </div>
        </div>

        <!-- RIGHT CONTENT PANEL -->
        <div style="flex:1; overflow-y:auto; padding:20px 22px;">

          <!-- ═══ UPI ═══ -->
          <div class="pgw-panel" id="pgw-panel-upi" style="display:block;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">PAY VIA UPI</div>

            <!-- UPI QR Code -->
            <div style="text-align:center;margin-bottom:18px;padding:16px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);border-radius:14px;">
              <div style="font-size:0.72rem;color:#64748b;margin-bottom:10px;letter-spacing:0.06em;font-weight:600;">SCAN TO PAY ₹${amount}</div>
              <div id="pgw-upi-qr-box" style="display:inline-block;background:#fff;padding:10px;border-radius:12px;box-shadow:0 0 0 2px rgba(99,102,241,0.35),0 6px 20px rgba(0,0,0,0.25);"></div>
              <div style="margin-top:10px;font-size:0.75rem;color:#a5b4fc;font-family:monospace;word-break:break-all;">sporekart@ybl</div>
              <div style="margin-top:4px;font-size:0.7rem;color:#475569;">GPay · PhonePe · Paytm · BHIM · Any UPI App</div>
            </div>

            <!-- UPI Apps -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;">
              ${[
      {
        name: 'GPay',
        color: '#4285F4',
        icon: 'fa-google',
        label: 'Google Pay',
      },
      {
        name: 'PhonePe',
        color: '#5F259F',
        icon: 'fa-mobile',
        label: 'PhonePe',
      },
      {
        name: 'Paytm',
        color: '#00BAF2',
        icon: 'fa-p',
        label: 'Paytm',
      },
      {
        name: 'BHIM',
        color: '#138808',
        icon: 'fa-indian-rupee-sign',
        label: 'BHIM',
      },
    ]
      .map(
        (app) => `
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
              `,
      )
      .join('')}
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

          <!-- ═══ CARD ═══ -->
          <div class="pgw-panel" id="pgw-panel-card" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">CREDIT / DEBIT CARD</div>

            <!-- Accepted cards -->
            <div style="display:flex;gap:8px;margin-bottom:16px;">
              ${['VISA', 'MC', 'AMEX', 'RuPay']
      .map(
        (c) => `
                <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 10px;font-size:0.72rem;font-weight:700;color:#94a3b8;">${c}</div>
              `,
      )
      .join('')}
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

          <!-- ═══ NET BANKING ═══ -->
          <div class="pgw-panel" id="pgw-panel-netbank" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">NET BANKING</div>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
              ${[
      { name: 'SBI', color: '#003087' },
      { name: 'HDFC', color: '#004C97' },
      { name: 'ICICI', color: '#B02A30' },
      { name: 'Axis', color: '#800020' },
      { name: 'Kotak', color: '#EE2424' },
      { name: 'PNB', color: '#FF6600' },
    ]
      .map(
        (b) => `
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
              `,
      )
      .join('')}
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

          <!-- ═══ WALLETS ═══ -->
          <div class="pgw-panel" id="pgw-panel-wallet" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">MOBILE WALLETS</div>

            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
              ${[
      {
        name: 'Paytm Wallet',
        bal: '₹2,450.00',
        icon: 'fa-p',
        color: '#00BAF2',
        id: 'paytm',
      },
      {
        name: 'Amazon Pay',
        bal: '₹800.00',
        icon: 'fa-amazon',
        color: '#FF9900',
        id: 'amazon',
      },
      {
        name: 'Mobikwik',
        bal: '₹320.00',
        icon: 'fa-mobile',
        color: '#E8174B',
        id: 'mobikwik',
      },
      {
        name: 'Freecharge',
        bal: '₹150.00',
        icon: 'fa-bolt',
        color: '#E62272',
        id: 'freecharge',
      },
      {
        name: 'Airtel Money',
        bal: '₹1,200.00',
        icon: 'fa-signal',
        color: '#E40000',
        id: 'airtel',
      },
    ]
      .map(
        (w) => `
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
              `,
      )
      .join('')}
            </div>

            <button class="pgw-pay-btn" id="pgw-btn-pay-wallet" style="
              width:100%;padding:14px;background:linear-gradient(135deg,#38b17b,#1a7a52);
              border:none;border-radius:10px;color:#fff;font-size:0.95rem;font-weight:700;
              cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;
            ">
              <i class="fa-solid fa-wallet"></i> Pay ₹${amount} from Wallet
            </button>
          </div>

          <!-- ═══ EMI ═══ -->
          <div class="pgw-panel" id="pgw-panel-emi" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">EMI OPTIONS</div>

            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
              ${[
      { months: 3, rate: 13, bank: 'HDFC / ICICI / SBI' },
      { months: 6, rate: 14, bank: 'All Major Cards' },
      { months: 9, rate: 15, bank: 'HDFC / Axis / Kotak' },
      { months: 12, rate: 15, bank: 'All Major Cards' },
      { months: 18, rate: 16, bank: 'HDFC / ICICI' },
      { months: 24, rate: 16, bank: 'Select Cards' },
    ]
      .map((e, i) => {
        const emi = ((rzpDetails.amount / 100) * (e.rate / 100 / 12))
          / (1 - (1 + e.rate / 100 / 12) ** -e.months);
        return `
                  <label style="
                    display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.04);
                    border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 16px;
                    cursor:pointer;transition:all 0.18s;
                  " class="pgw-emi-row">
                    <input type="radio" name="pgw-emi" value="${e.months}" ${i === 0 ? 'checked' : ''} style="accent-color:#38b17b;">
                    <div style="flex:1;">
                      <div style="font-size:0.88rem;font-weight:600;">${e.months} Months EMI</div>
                      <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${e.bank} · ${e.rate}% p.a.</div>
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:0.95rem;font-weight:700;color:#fbbf24;">₹${emi.toFixed(0)}/mo</div>
                      <div style="font-size:0.7rem;color:#475569;">Total ₹${(emi * e.months).toFixed(0)}</div>
                    </div>
                  </label>
                `;
      })
      .join('')}
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

          <!-- ═══ COD ═══ -->
          <div class="pgw-panel" id="pgw-panel-cod" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">CASH ON DELIVERY</div>

            <div style="background:rgba(56,177,123,0.08);border:1px solid rgba(56,177,123,0.2);border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
              <div style="font-size:2.5rem;margin-bottom:10px;">💵</div>
              <div style="font-size:1.1rem;font-weight:700;color:#e2e8f0;margin-bottom:6px;">Pay ₹${amount} at Delivery</div>
              <div style="font-size:0.82rem;color:#94a3b8;">Keep exact change ready. Our delivery partner will collect cash at your doorstep.</div>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
              ${[
      { icon: 'fa-box-open', text: 'Order confirmed immediately' },
      {
        icon: 'fa-truck-fast',
        text: 'Delivered in 2–5 business days',
      },
      {
        icon: 'fa-hand-holding-dollar',
        text: 'Pay only when you receive',
      },
      { icon: 'fa-rotate-left', text: 'Easy return policy' },
    ]
      .map(
        (f) => `
                <div style="display:flex;align-items:center;gap:10px;font-size:0.82rem;color:#94a3b8;">
                  <i class="fa-solid ${f.icon}" style="color:#38b17b;width:18px;text-align:center;"></i>${f.text}
                </div>
              `,
      )
      .join('')}
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

      <!-- ═══ FOOTER ═══ -->
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
        ">✖ Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(mockModal);

  // Generate UPI QR code inside mock modal's UPI panel
  (function () {
    const upiQrUrl = `upi://pay?pa=sporekart@ybl&pn=Sporekart&am=${amount}&cu=INR&tn=Order%20${orderId}`;
    const qrBox = document.getElementById('pgw-upi-qr-box');
    if (qrBox && window.QRCode) {
      new QRCode(qrBox, { text: upiQrUrl, width: 160, height: 160, colorDark: '#1a3a2a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    }
  }());

  // ── TAB SWITCHING ──
  function switchTab(tabId) {
    mockModal.querySelectorAll('.pgw-tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === tabId;
      btn.style.background = active ? 'rgba(56,177,123,0.12)' : 'transparent';
      btn.style.borderLeft = active
        ? '3px solid #38b17b'
        : '3px solid transparent';
      btn.style.color = active ? '#38b17b' : '#94a3b8';
      btn.querySelector('div').style.fontWeight = active ? '600' : '500';
    });
    mockModal
      .querySelectorAll('.pgw-panel')
      .forEach((p) => (p.style.display = 'none'));
    const panel = document.getElementById(`pgw-panel-${tabId}`);
    if (panel) panel.style.display = 'block';
  }

  mockModal.querySelectorAll('.pgw-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    btn.addEventListener('mouseenter', () => {
      if (!btn.classList.contains('active-tab')) btn.style.background = 'rgba(56,177,123,0.06)';
    });
    btn.addEventListener('mouseleave', () => {
      const isActive = btn.style.borderLeft.includes('#38b17b');
      if (!isActive) btn.style.background = 'transparent';
    });
  });

  // â”€â”€ UPI App buttons â”€â”€
  mockModal.querySelectorAll('.pgw-upi-app-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      mockModal.querySelectorAll('.pgw-upi-app-btn').forEach((b) => {
        b.style.border = '1px solid rgba(255,255,255,0.1)';
        b.style.background = 'rgba(255,255,255,0.04)';
      });
      btn.style.border = '1px solid #38b17b';
      btn.style.background = 'rgba(56,177,123,0.1)';
    });
  });

  // â”€â”€ UPI Verify â”€â”€
  document
    .getElementById('pgw-upi-verify-btn')
    ?.addEventListener('click', () => {
      const upiId = document.getElementById('pgw-upi-id').value.trim();
      if (upiId) {
        const verified = document.getElementById('pgw-upi-verified');
        if (verified) {
          verified.style.display = 'block';
          verified.innerHTML = `<i class="fa-solid fa-circle-check"></i> UPI ID verified â€” ${upiId}`;
        }
      }
    });

  // â”€â”€ Bank highlight â”€â”€
  mockModal.querySelectorAll('.pgw-bank-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      mockModal.querySelectorAll('.pgw-bank-btn').forEach((b) => {
        b.style.border = '1px solid rgba(255,255,255,0.1)';
        b.style.background = 'rgba(255,255,255,0.04)';
      });
      btn.style.border = '1px solid #38b17b';
      btn.style.background = 'rgba(56,177,123,0.1)';
    });
  });

  // â”€â”€ Wallet highlight â”€â”€
  mockModal.querySelectorAll('.pgw-wallet-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      mockModal.querySelectorAll('.pgw-wallet-btn').forEach((b) => {
        b.style.border = '1px solid rgba(255,255,255,0.1)';
        b.style.background = 'rgba(255,255,255,0.04)';
      });
      btn.style.border = '1px solid #38b17b';
      btn.style.background = 'rgba(56,177,123,0.1)';
    });
  });

  // â”€â”€ PAYMENT CONFIRM helper â”€â”€
  async function doPayment(btnId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    // Show processing state
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    await new Promise((r) => setTimeout(r, 1500)); // Simulate network delay

    mockModal.remove();
    const mockPaymentId = `pay_mock_${Math.random().toString(36).substr(2, 9)}`;
    const mockSignature = `sig_mock_${Math.random().toString(36).substr(2, 12)}`;
    await completeOrderPayment(orderId, mockPaymentId, mockSignature);
  }

  // â”€â”€ Wire all pay buttons â”€â”€
  [
    'pgw-btn-pay-upi',
    'pgw-btn-pay-card',
    'pgw-btn-pay-netbank',
    'pgw-btn-pay-wallet',
    'pgw-btn-pay-emi',
    'pgw-btn-pay-cod',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => doPayment(id));
  });

  // â”€â”€ Cancel â”€â”€
  document.getElementById('pgw-btn-cancel')?.addEventListener('click', () => {
    mockModal.remove();
    showSuccessToast('âš ï¸ Payment cancelled. Your cart is still saved.');
  });

  // â”€â”€ Outside click to cancel â”€â”€
  mockModal.addEventListener('click', (e) => {
    if (e.target === mockModal) {
      mockModal.remove();
      showSuccessToast('âš ï¸ Payment cancelled. Your cart is still saved.');
    }
  });
}

async function completeOrderPayment(orderId, paymentId, signature) {
  try {
    const data = await fetchWithAuth('/orders/verify-payment', {
      method: 'POST',
      body: JSON.stringify({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      }),
    });

    if (data) {
      // Clear cart
      clearCart();
      updateCartUI();
      state.activePromo = null;
      state.promoDiscountPct = 0;
      const promoInput = document.getElementById('promo-input');
      if (promoInput) promoInput.value = '';
      const promoMsg = document.getElementById('promo-message');
      if (promoMsg) promoMsg.classList.add('hidden');

      // Refresh shop inventory quantities immediately after payment
      await fetchProducts();
      await loadUser();

      // Auto-save delivery details to user profile after order completion
      if (state.token && state.user) {
        try {
          const deliveryPhone = document.getElementById('checkout-delivery-phone')?.value.trim() || '';
          const deliveryEmail = document.getElementById('checkout-delivery-email')?.value.trim() || state.user?.email || '';
          const addressLine1 = document.getElementById('checkout-address-line1')?.value.trim() || '';
          const addressLine2 = document.getElementById('checkout-address-line2')?.value.trim() || '';
          const landmark = document.getElementById('checkout-landmark')?.value.trim() || '';
          const city = document.getElementById('checkout-city')?.value.trim() || '';
          const stateVal = document.getElementById('checkout-state')?.value.trim() || '';
          const deliveryPincode = document.getElementById('checkout-delivery-pincode')?.value.trim() || '';

          const fullName = document.getElementById('checkout-delivery-name')?.value.trim() || '';
          const profilePayload = {};
          if (fullName) profilePayload.fullName = fullName;
          if (deliveryEmail) profilePayload.email = deliveryEmail;
          if (deliveryPhone) profilePayload.whatsappNumber = deliveryPhone;
          if (addressLine1) profilePayload.address_line1 = addressLine1;
          if (addressLine2) profilePayload.address_line2 = addressLine2;
          if (landmark) profilePayload.landmark = landmark;
          if (city) profilePayload.city = city;
          if (stateVal) profilePayload.state = stateVal;
          if (deliveryPincode) profilePayload.default_pincode = deliveryPincode;
          if (addressLine1 || addressLine2 || landmark || city || stateVal || deliveryPincode) {
            profilePayload.default_address = [addressLine1, addressLine2, landmark, city, stateVal, deliveryPincode ? `Pincode: ${deliveryPincode}` : ''].filter(Boolean).join(', ');
          }

          if (Object.keys(profilePayload).length > 0) {
            const updated = await fetchWithAuth('/auth/me', {
              method: 'PUT',
              body: JSON.stringify(profilePayload),
            });
            // Update local state with saved profile
            const savedUser = {
              ...state.user,
              fullName: updated.fullName || state.user.fullName,
              email: updated.email || state.user.email,
              whatsappNumber: updated.whatsappNumber || state.user.whatsappNumber,
              addressLine1: updated.addressLine1 || state.user.addressLine1,
              addressLine2: updated.addressLine2 || state.user.addressLine2,
              landmark: updated.landmark || state.user.landmark,
              city: updated.city || state.user.city,
              state: updated.state || state.user.state,
              defaultPincode: updated.defaultPincode || state.user.defaultPincode,
              defaultAddress: updated.defaultAddress || state.user.defaultAddress,
            };
            saveUserProfile(savedUser);
          }
        } catch (err) {
          // Silently fail — profile auto-save is best-effort
          console.warn('Auto-save profile after order failed:', err);
        }
      }

      const userName = state.user?.fullName || state.user?.full_name || 'Valued Cultivator';

      // Notify other tabs (admin) that orders have been updated
      try {
        const bcOrders = new BroadcastChannel('spore-orders');
        bcOrders.postMessage({ type: 'orders:updated', orderId: data.order && data.order.id ? data.order.id : null });
      } catch (e) {
        // ignore if BroadcastChannel isn't available
      }

      // Show thank you popup then redirect
      const isAdminOrGrower = state.user && (state.user.role === 'admin' || state.user.role === 'grower');
      showPopupModal({
        title: '🎉 Thank you for your order!',
        message: `${userName}, your order is confirmed. We are updating your shipping status and will notify you soon.`,
        duration: 1000,
        redirectHash: isAdminOrGrower ? `#track-${data.order.id}` : '#shop',
      });
    } else {
      showErrorToast(data.error || 'Payment verification failed.');
    }
  } catch (err) {
    showErrorToast(
      getApiErrorMessage(err)
      || 'Connection error occurred while confirming payment status.',
    );
  }
}

// ==========================================================================
// CULTIVATION ORDER TRACKER & INVOICES
// ==========================================================================
function getStatusBadgeHTML(status) {
  let bg = "#475569";
  let color = "#f1f5f9";
  let label = status;

  switch (status) {
    case "placed":
      bg = "rgba(56,187,123,0.12)";
      color = "#38b17b";
      label = "Placed";
      break;
    case "processing":
      bg = "rgba(59,130,246,0.12)";
      color = "#3b82f6";
      label = "Processing";
      break;
    case "shipped":
      bg = "rgba(139,92,246,0.12)";
      color = "#8b5cf6";
      label = "Shipped";
      break;
    case "in_transit":
      bg = "rgba(245,158,11,0.12)";
      color = "#f59e0b";
      label = "In Transit";
      break;
    case "delivered":
      bg = "rgba(16,185,129,0.12)";
      color = "#10b981";
      label = "Delivered";
      break;
    case "cancelled":
      bg = "rgba(239,68,68,0.12)";
      color = "#ef4444";
      label = "Cancelled";
      break;
    case "CANCEL_REQUESTED":
      bg = "rgba(245,158,11,0.15)";
      color = "#f59e0b";
      label = "Cancellation Requested";
      break;
    case "CANCEL_APPROVED":
      bg = "rgba(16,185,129,0.15)";
      color = "#10b981";
      label = "Cancellation Approved";
      break;
    case "CANCEL_REJECTED":
      bg = "rgba(239,68,68,0.15)";
      color = "#ef4444";
      label = "Cancellation Rejected";
      break;
    case "REFUND_PENDING":
      bg = "rgba(59,130,246,0.15)";
      color = "#3b82f6";
      label = "Refund Pending";
      break;
    case "REFUND_INITIATED":
    case "REFUND_PROCESSING":
      bg = "rgba(139,92,246,0.15)";
      color = "#8b5cf6";
      label = "Refund Processing";
      break;
    case "REFUND_COMPLETED":
      bg = "rgba(16,185,129,0.2)";
      color = "#10b981";
      label = "Refund Successful";
      break;
    case "REFUND_FAILED":
      bg = "rgba(239,68,68,0.2)";
      color = "#ef4444";
      label = "Refund Failed";
      break;
  }

  return `<span class="order-status-badge" style="background:${bg}; color:${color}; padding:2px 8px; border-radius:12px; font-size:0.7rem; font-weight:600; text-transform:uppercase;">${label}</span>`;
}

async function fetchOrders() {
  if (!state.token) return;

  try {
    const res = await fetch(`${API_BASE}/orders/my-orders`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (res.ok) {
      state.orders = await res.json();
      renderOrdersSidebar();
      checkAndShowReviewModal();
      window.dispatchEvent(new CustomEvent('orders:refreshed', { detail: { orders: state.orders } }));
    }
  } catch (err) {
    showErrorToast(getApiErrorMessage(err));
  }
}

function renderOrdersSidebar() {
  const list = document.getElementById('orders-list');

  if (!state.orders.length) {
    list.innerHTML = '<p class="no-orders">No active runs found. Purchase cultures or spawn to activate incubator tracking!</p>';
    return;
  }

  const sorted = [...state.orders].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );

  list.innerHTML = sorted
    .map((order) => {
      const activeClass = state.activeTrackingId === order.id ? 'active' : '';
      const dateFormatted = new Date(order.created_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const refundStates = ["CANCEL_REQUESTED", "CANCEL_APPROVED", "CANCEL_REJECTED", "REFUND_PENDING", "REFUND_INITIATED", "REFUND_PROCESSING", "REFUND_COMPLETED", "REFUND_FAILED"];
      const displayStatus = refundStates.includes(order.status) ? order.status : order.delivery_status;
      const badgeHTML = getStatusBadgeHTML(displayStatus);

      return `
        <div class="order-sidebar-card ${activeClass}" data-id="${order.id}">
          <div class="order-card-header">
            <span class="order-id-lbl">RUN-${order.id.substring(0, 8).toUpperCase()}</span>
            ${badgeHTML}
          </div>
          <div class="order-card-date">${dateFormatted}</div>
          <div class="order-card-total">₹${order.total.toFixed(2)} (${order.items.length} culture${order.items.length > 1 ? "s" : ""})</div>
          ${order.expected_delivery_date && ["shipped", "in_transit"].includes(order.delivery_status) ? `<div class="order-card-delivery">Expected: ${new Date(order.expected_delivery_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${order.delivery_days_text ? " (" + order.delivery_days_text + ")" : ""}</div>` : ""}
          ${(order.delivery_status === "cancelled" || order.status === "cancelled") && order.cancel_reason ? `<div class="order-card-reason">Reason: ${order.cancel_reason}</div>` : ""}
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('.order-sidebar-card').forEach((card) => {
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
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (!res.ok) throw new Error('Order details unavailable');

    const track = await res.json();
    renderTrackingDetails(track);
  } catch (err) {
    console.error('Poll tracking error:', err);
    document.getElementById('tracker-active-view').innerHTML = `
      <p style="color:var(--color-danger); text-align:center; padding: 2rem;">Cultivation logs could not be loaded.</p>
    `;
  }
}

function renderTrackingDetails(track) {
  const container = document.getElementById('tracker-active-view');
  const dateStr = new Date(track.timestamp).toLocaleTimeString();

  const timelineHTML = track.timeline
    .map((checkpoint) => {
      const doneClass = checkpoint.done ? 'done' : '';
      const icon = checkpoint.done
        ? '<i class="fa-solid fa-circle-check" style="color:var(--color-primary);"></i>'
        : '<i class="fa-regular fa-circle" style="color:var(--color-text-muted);"></i>';

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
    })
    .join('');

  const refundStates = ["CANCEL_REQUESTED", "CANCEL_APPROVED", "CANCEL_REJECTED", "REFUND_PENDING", "REFUND_INITIATED", "REFUND_PROCESSING", "REFUND_COMPLETED", "REFUND_FAILED"];
  const displayStatus = refundStates.includes(track.paymentStatus) ? track.paymentStatus : track.deliveryStatus;
  const badgeHTML = getStatusBadgeHTML(displayStatus);

  const canCancel = track.deliveryStatus === "processing" && track.paymentStatus === "paid";
  const cancelReason = track.cancelReason || "";

  container.innerHTML = `
    <div class="tracker-details-header">
      <div>
        <h3>Mycelium Incubator Log</h3>
        <p class="subtitle">Run ID: RUN-${track.orderId.substring(0, 8).toUpperCase()} | Stage: ${badgeHTML}</p>
      </div>
      <span style="font-size:0.75rem; color:var(--color-text-muted);">Sync time: ${dateStr}</span>
    </div>

    <div class="tracker-summary-grid">
      <div class="tracker-payment-card">
        <div class="tracker-payment-header">Payment Details</div>
        <div class="tracker-payment-line"><strong>Method:</strong> ${track.paymentMethod || 'Pending'}</div>
        <div class="tracker-payment-line"><strong>Txn ID:</strong> ${track.paymentId || 'Pending confirmation'}</div>
        <div class="tracker-payment-line"><strong>Status:</strong> ${track.paymentStatus || 'pending'}</div>
      </div>
      <div class="tracker-payment-card">
        <div class="tracker-payment-header">Delivery Summary</div>
        <div class="tracker-payment-line"><strong>Stage:</strong> ${track.deliveryStatus}</div>
        <div class="tracker-payment-line"><strong>Progress:</strong> ${track.progressPercent}%</div>
        <div class="tracker-payment-line"><strong>Updated:</strong> ${dateStr}</div>
      </div>
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

    <div class="tracker-cancel-section">
      ${track.paymentStatus === "CANCEL_REQUESTED"
      ? `
        <div class="tracker-status-box" style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); color:#fbbf24; border-radius:10px; padding:12px; margin-bottom:15px;">
          <i class="fa-solid fa-triangle-exclamation"></i> <strong>Cancellation Requested</strong>: Your cancellation request is pending administrator approval.
        </div>
      `
      : ""
    }
      ${track.paymentStatus === "REFUND_COMPLETED"
      ? `
        <div class="tracker-status-box" style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.2); color:#10b981; border-radius:10px; padding:12px; margin-bottom:15px;">
          <i class="fa-solid fa-circle-check"></i> <strong>Refund Processed</strong>: Refund of transaction was successfully completed. Ref: ${track.transactionId || track.paymentId || "N/A"}.
        </div>
      `
      : ""
    }
      ${track.deliveryStatus === "cancelled" || track.paymentStatus === "cancelled"
      ? `
        <div class="tracker-cancelled-note">
          <strong>Cancellation reason:</strong> ${cancelReason || "Not provided"}
        </div>
      `
      : ""
    }
    </div>

    <div class="tracker-details-actions">
      ${['shipped', 'in_transit', 'delivered'].includes(track.deliveryStatus) ? `
      <button class="btn btn-secondary" onclick="window.viewInvoice('${track.orderId}')">
        <i class="fa-solid fa-file-invoice-dollar"></i> Generate Tax Invoice
      </button>
      ` : ''}
      <button class="btn btn-whatsapp-action" onclick="window.whatsappQuickMessage('${track.orderId}')">
        <i class="fa-brands fa-whatsapp"></i> Update via WhatsApp
      </button>
      ${canCancel ? `<button class="btn btn-cancel" onclick="window.openCancelModal('${track.orderId}')"><i class="fa-solid fa-ban"></i> Cancel order</button>` : ''}
    </div>
  `;

  document.querySelectorAll(".order-sidebar-card").forEach((card) => {
    if (card.getAttribute("data-id") === track.orderId) {
      card.classList.add("active");
      const header = card.querySelector(".order-card-header");
      if (header) {
        // Re-render badge dynamically
        const oldBadge = header.querySelector(".order-status-badge");
        if (oldBadge) oldBadge.remove();
        header.insertAdjacentHTML("beforeend", getStatusBadgeHTML(displayStatus));
      }
    } else {
      card.classList.remove("active");
    }
  });

}

function openCancelModal(orderId) {
  const existing = document.getElementById('cancel-order-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'cancel-order-modal';
  modal.className = 'modal-overlay open';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:10000;padding:18px;';

  modal.innerHTML = `
    <div class="modal-card" style="max-width:460px;">
      <button class="modal-close" id="cancel-modal-close" type="button">&times;</button>
      <h3 style="margin:0 0 8px;font-size:1.2rem;color:#b91c1c;">
        <i class="fa-solid fa-ban"></i> Cancel Order
      </h3>
      <p style="margin:0 0 18px;color:var(--text-mid);font-size:0.92rem;">
        This will stop processing and cannot be undone. Please tell us why you are cancelling.
      </p>
      <div class="input-field">
        <label for="cancel-reason-select">Cancellation reason</label>
        <select id="cancel-reason-select">
          <option value="">Select a reason</option>
          <option value="Delivery cost is high">Delivery cost is high</option>
          <option value="Not interested in product">Not interested in product</option>
          <option value="Not available on the expected delivery date">Not available on the expected delivery date</option>
          <option value="Taking too much time to deliver">Taking too much time to deliver</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="input-field hidden" id="cancel-reason-other-wrap">
        <label for="cancel-reason-other">Please specify your reason</label>
        <textarea id="cancel-reason-other" rows="3" placeholder="Enter your cancellation reason"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
        <button class="btn btn-secondary" id="cancel-modal-keep-btn" type="button">Keep order</button>
        <button class="btn btn-cancel" id="cancel-modal-confirm-btn" type="button">
          <i class="fa-solid fa-ban"></i> Confirm cancellation
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const reasonSelect = modal.querySelector('#cancel-reason-select');
  const otherWrap = modal.querySelector('#cancel-reason-other-wrap');
  const otherInput = modal.querySelector('#cancel-reason-other');

  reasonSelect.addEventListener('change', () => {
    otherWrap.classList.toggle('hidden', reasonSelect.value !== 'Other');
  });

  const closeModal = () => modal.remove();

  modal.querySelector('#cancel-modal-close').addEventListener('click', closeModal);
  modal.querySelector('#cancel-modal-keep-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  modal.querySelector('#cancel-modal-confirm-btn').addEventListener('click', async () => {
    let reason = reasonSelect.value;
    if (!reason) {
      showErrorToast('Please select a cancellation reason.');
      return;
    }
    if (reason === 'Other') {
      reason = otherInput?.value.trim() || '';
      if (!reason) {
        showErrorToast('Please enter your cancellation reason.');
        return;
      }
    }

    modal.remove();

    try {
      await fetchWithAuth(`/orders/${orderId}/request-cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      showSuccessToast("✅ Cancellation request submitted successfully.");
      await fetchOrders();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || "Unable to request cancellation at this time.");
    }
  });
}

window.openCancelModal = openCancelModal;

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
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (!res.ok) throw new Error('Invoice loading failed');

    const inv = await res.json();
    renderInvoicePaper(inv);
  } catch (err) {
    paper.innerHTML = '<p style="color:var(--color-danger); text-align:center; padding:2rem;">Invoice could not be fetched.</p>';
  }
}

function renderInvoicePaper(inv) {
  const paper = document.getElementById('invoice-paper');
  const dateFormatted = new Date(inv.invoiceDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const itemsRows = inv.items
    .map((item, idx) => {
      const rate = item.price;
      const qty = item.quantity;
      const lineDiscount = item.discountAmount;
      const taxableValue = rate * qty - lineDiscount;
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
    })
    .join('');

  const slabs = ['slab5', 'slab12', 'slab18'];
  const gstLedgerHTML = slabs
    .map((slab) => {
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
    })
    .filter((row) => row !== '')
    .join('');

  const activePromoCode = inv.totals.promoCode
    ? `<span style="font-size:0.8rem; font-weight:600; color:#2a9d8f;">(Code ${inv.totals.promoCode} Applied)</span>`
    : '';

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
        <p>Payment Mode: <span>${inv.paymentMethod}</span></p>
        <p>Transaction ID: <span>${inv.paymentId || 'N/A'}</span></p>
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
        <h4>Delivery Address</h4>
        <p>${inv.buyer.address || 'Address not provided'}</p>
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
        <div class="invoice-totals-row">
          <span>Shipping Charge:</span>
          <span>₹${(inv.totals.shippingCharge || 0).toFixed(2)}</span>
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
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;

  const orderNum = `RUN-${order.id.substring(0, 8).toUpperCase()}`;
  const orderItemsStr = order.items
    .map((i) => `${i.name} (x${i.quantity})`)
    .join(', ');

  const text = `Hi, I am tracking my Sporekart Run ${orderNum} [${orderItemsStr}]. Mycelium incubator status is: ${order.delivery_status.toUpperCase()}. Live updates at: http://localhost:3000/#track-${order.id}`;

  const userWhatsapp = state.user ? state.user.whatsappNumber : '';
  const finalWhatsappNumber = userWhatsapp || '918049913822';

  const url = `https://wa.me/${finalWhatsappNumber}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// ==========================================================================
// CATEGORY MANAGEMENT (FETCH + MOBILE NAV)
// ==========================================================================
let _adminCategories = [];

async function fetchCategories() {
  try {
    const response = await fetch(`${API_BASE}/categories`);
    const data = await response.json();
    const categories = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : [];

    _adminCategories = categories;

    const categoryNav = document.getElementById('category-nav');
    if (categoryNav) {
      categoryNav.innerHTML = categories
        .map(
          (cat) => `<button class="cat-btn" data-category="${cat.id}">${cat.name}</button>`,
        )
        .join('');

      document.querySelectorAll('.cat-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document
            .querySelectorAll('.cat-btn')
            .forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          state.activeCategory = btn.dataset.category;
          _shopInventoryPage = 1;
          fetchProducts();
        });
      });
    }

    renderCategoryGrid(categories);
    populateCategoryDropdown(categories);
    renderMobileCategoryNav(categories);
  } catch (error) {
    showErrorToast(getApiErrorMessage(error));
  }
}

function populateCategoryDropdown(categories) {
  const dd = document.getElementById('cat-dropdown-menu');
  if (!dd) return;
  dd.innerHTML = categories
    .map(
      (cat) => `<a href="#" class="cat-dd-item" data-category="${cat.id}"><i class="fa-solid fa-seedling"></i><span>${cat.name}</span></a>`,
    )
    .join('');

  dd.querySelectorAll('.cat-dd-item').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const cat = a.getAttribute('data-category');
      navigateToCategory(cat);
      // close dropdown
      dd.classList.add('hidden');
      dd.setAttribute('aria-hidden', 'true');
    });
  });
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
  const catItems = categories
    .map(
      (cat) => `
    <button class="mob-cat-btn" data-category="${cat.id}" id="mob-cat-${cat.id}">
      <i class="fa-solid fa-seedling"></i>
      <span>${cat.name}</span>
    </button>
  `,
    )
    .join('');

  inner.innerHTML = allItem + catItems;

  // Attach click events
  inner.querySelectorAll('.mob-cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      inner
        .querySelectorAll('.mob-cat-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      navigateToCategory(btn.getAttribute('data-category'));
    });
  });
}

function populateCategorySelects(categories) {
  // Update main product filters row
  const filtersRow = document.getElementById('product-filters-row');
  if (filtersRow) {
    const allBtn = filtersRow.querySelector('[data-category="all"]');
    // Set up 'all' button to reset state.activeCategory
    if (allBtn) {
      allBtn.addEventListener('click', () => {
        state.activeCategory = 'all';
        _shopInventoryPage = 1;
        fetchProducts();
      });
    }
    // Remove existing dynamic category buttons (keep 'all')
    filtersRow
      .querySelectorAll('.cat-btn:not([data-category="all"])')
      .forEach((b) => b.remove());
    categories.forEach((cat) => {
      const btn = document.createElement('button');
      btn.className = 'cat-btn';
      btn.setAttribute('data-category', cat.id);
      btn.innerHTML = `<i class="fa-solid fa-seedling"></i> ${cat.name}`;
      btn.addEventListener('click', () => {
        filtersRow
          .querySelectorAll('.cat-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeCategory = cat.id;
        _shopInventoryPage = 1;
        fetchProducts();
      });
      filtersRow.appendChild(btn);
    });
  }
}

function initThreeJS() {
  const canvas = document.getElementById('hero-three-canvas');
  if (!canvas) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0.1);
  camera.position.z = 3;

  // Spore Cloud 1
  const count = 2000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 20;
    positions[i + 1] = (Math.random() - 0.5) * 20;
    positions[i + 2] = (Math.random() - 0.5) * 20;

    colors[i] = 0.2 + Math.random() * 0.5;
    colors[i + 1] = 0.8 + Math.random() * 0.2;
    colors[i + 2] = 0.4 + Math.random() * 0.3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const sporeCloud1 = new THREE.Points(geometry, material);
  scene.add(sporeCloud1);

  // Spore Cloud 2 (Slower moving)
  const positions2 = new Float32Array(count * 3);
  const colors2 = new Float32Array(count * 3);

  for (let i = 0; i < count * 3; i += 3) {
    positions2[i] = (Math.random() - 0.5) * 25;
    positions2[i + 1] = (Math.random() - 0.5) * 25;
    positions2[i + 2] = (Math.random() - 0.5) * 25;

    colors2[i] = 0.1 + Math.random() * 0.3;
    colors2[i + 1] = 0.6 + Math.random() * 0.4;
    colors2[i + 2] = 0.3 + Math.random() * 0.4;
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
    depthWrite: false,
  });

  const sporeCloud2 = new THREE.Points(geometry2, material2);
  scene.add(sporeCloud2);

  // Central Wireframe Cluster
  const coreGeo = new THREE.IcosahedronGeometry(0.7, 2);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x38b17b,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
  });
  const nucleus = new THREE.Mesh(coreGeo, coreMat);
  scene.add(nucleus);

  // Interactive Drag Control
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  const dragRotation = { x: 0, y: 0 };

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
      y: clientY - previousMousePosition.y,
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
  window.addEventListener(
    'scroll',
    () => {
      scrollTargetY = window.scrollY;
    },
    { passive: true },
  );

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
    document.querySelector('.calc-header'),
    ...document.querySelectorAll('.about-block'),
  ].filter((el) => el !== null);

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -60px 0px',
    threshold: 0.1,
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        obs.unobserve(entry.target);
      }
    });
  }, observerOptions);

  targets.forEach((target) => {
    target.classList.add('reveal-element');
    observer.observe(target);
  });
}

// Placeholder for showSuccessToast (if not defined elsewhere)
// Use shared toast helpers from utils/notify.js

// Window functions for global access
function copyInvoiceLink(token) {
  if (!token) return;
  const invoiceUrl = `${window.location.origin}/api/orders/share/${token}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(invoiceUrl)
      .then(() => showSuccessToast('Invoice share link copied to clipboard.'))
      .catch(() => showErrorToast('Could not copy invoice link.'));
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = invoiceUrl;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showSuccessToast('Invoice share link copied to clipboard.');
  }
}

window.viewInvoice = viewInvoice;
window.whatsappQuickMessage = whatsappQuickMessage;
window.copyInvoiceLink = copyInvoiceLink;
// ==========================================================================
// HOMEPAGE MUSHROOM CAROUSEL
// ==========================================================================
let carouselIndex = 0;
let carouselTimer = null;

function initCarousel() {
  const track = document.getElementById('carousel-track');
  const dotsWrap = document.getElementById('carousel-dots');
  if (!track || !dotsWrap) return;

  const slides = track.querySelectorAll('.carousel-slide');
  if (slides.length === 0) return;

  dotsWrap.innerHTML = '';
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.addEventListener('click', () => {
      carouselIndex = i;
      updateCarousel();
      resetCarouselAutoplay();
    });
    dotsWrap.appendChild(dot);
  });

  updateCarousel();
  startCarouselAutoplay();
}

function carouselGo(direction) {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  const slides = track.querySelectorAll('.carousel-slide');
  if (slides.length === 0) return;
  carouselIndex = (carouselIndex + direction + slides.length) % slides.length;
  updateCarousel();
  resetCarouselAutoplay();
}

function updateCarousel() {
  const track = document.getElementById('carousel-track');
  const dotsWrap = document.getElementById('carousel-dots');
  if (!track) return;
  const slides = track.querySelectorAll('.carousel-slide');
  if (slides.length === 0) return;
  track.style.transform = `translateX(-${carouselIndex * 100}%)`;
  if (dotsWrap) {
    dotsWrap.querySelectorAll('.carousel-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === carouselIndex);
    });
  }
}

function startCarouselAutoplay() {
  stopCarouselAutoplay();
  carouselTimer = setInterval(() => carouselGo(1), 1000);
}

function stopCarouselAutoplay() {
  if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
}

function resetCarouselAutoplay() {
  stopCarouselAutoplay();
  startCarouselAutoplay();
}

// ==========================================================================
// REVIEW MODAL
// ==========================================================================
function checkAndShowReviewModal() {
  if (!state.orders || !state.orders.length) return;
  // Find first delivered order without a rating that hasn't been skipped
  const orderToReview = state.orders.find(o =>
    o.delivery_status === 'delivered' && !o.rating && !localStorage.getItem(`skipped_review_${o.id}`)
  );
  if (orderToReview) {
    openReviewModal(orderToReview.id);
  }
}

window.openReviewModal = function (orderId) {
  const existing = document.getElementById('review-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'review-modal';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:10001;padding:1rem;backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:white;border-radius:12px;padding:2rem;max-width:400px;width:100%;box-shadow:0 10px 25px rgba(0,0,0,0.2);">
      <h3 style="margin-top:0;font-family:var(--font-heading);font-size:1.5rem;color:var(--color-text-dark);">How was your order?</h3>
      <p style="color:#64748b;margin-bottom:1.5rem;font-size:0.95rem;">Rate your experience for Order #${orderId}</p>
      
      <div id="review-stars" style="display:flex;gap:0.5rem;margin-bottom:1.5rem;justify-content:center;font-size:2rem;color:#cbd5e1;cursor:pointer;">
        <i class="fa-solid fa-star" data-val="1"></i>
        <i class="fa-solid fa-star" data-val="2"></i>
        <i class="fa-solid fa-star" data-val="3"></i>
        <i class="fa-solid fa-star" data-val="4"></i>
        <i class="fa-solid fa-star" data-val="5"></i>
      </div>
      
      <div style="margin-bottom:1.5rem;">
        <textarea id="review-desc" placeholder="Tell us more about your experience (optional)" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:0.75rem;font-family:inherit;resize:vertical;min-height:80px;"></textarea>
      </div>
      
      <div style="display:flex;gap:1rem;">
        <button id="btn-skip-review" class="btn btn-secondary" style="flex:1;">Skip</button>
        <button id="btn-submit-review" class="btn btn-primary" style="flex:2;" disabled>Submit Review</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let selectedRating = 0;
  const stars = modal.querySelectorAll('#review-stars i');
  const submitBtn = modal.querySelector('#btn-submit-review');

  stars.forEach(star => {
    star.addEventListener('mouseover', (e) => {
      const val = parseInt(e.target.dataset.val);
      stars.forEach(s => {
        s.style.color = parseInt(s.dataset.val) <= val ? '#fbbf24' : '#cbd5e1';
      });
    });
    star.addEventListener('mouseout', () => {
      stars.forEach(s => {
        s.style.color = parseInt(s.dataset.val) <= selectedRating ? '#fbbf24' : '#cbd5e1';
      });
    });
    star.addEventListener('click', (e) => {
      selectedRating = parseInt(e.target.dataset.val);
      submitBtn.disabled = false;
      stars.forEach(s => {
        s.style.color = parseInt(s.dataset.val) <= selectedRating ? '#fbbf24' : '#cbd5e1';
      });
    });
  });

  modal.querySelector('#btn-skip-review').addEventListener('click', () => {
    localStorage.setItem(`skipped_review_${orderId}`, 'true');
    modal.remove();
  });

  submitBtn.addEventListener('click', async () => {
    const desc = modal.querySelector('#review-desc').value.trim();
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';
    try {
      const res = await fetchWithAuth(`/orders/${orderId}/review`, {
        method: 'POST',
        body: JSON.stringify({ rating: selectedRating, reviewText: desc }),
      });
      showSuccessToast('Thank you for your review!');
      modal.remove();
      fetchOrders();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err));
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Review';
    }
  });
}

// ============================================================
// SUCCESS STORIES DATA & RENDERING
// ============================================================
var SUCCESS_STORIES = [
  {
    id: 'story-1',
    name: 'Ramesh Patil',
    role: 'Farmer',
    headline: 'From 1 tray to 500 trays — mushroom farming changed my life.',
    description: 'Ramesh Patil, a small farmer from Davangere, started with just one tray of oyster mushroom spawn from Sporekart in 2020. With hands-on training and continuous support from the Sporekart team, he now operates 500 trays producing over 200 kg of fresh mushrooms every month. His annual income has tripled, and he now employs 4 people from his village. "Sporekart didn\'t just sell me spawn — they showed me a path to prosperity."',
    image: 'https://i.pravatar.cc/400?img=11',
    badge: 'Beginner to Entrepreneur',
    cta: null,
    ctaText: null,
  },
  {
    id: 'story-2',
    name: 'Anjali Verma',
    role: 'Home Grower',
    headline: 'I turned my balcony into a mini mushroom farm and now supply to local restaurants.',
    description: 'Anjali, a software professional from Bengaluru, started mushroom cultivation as a weekend hobby. She purchased a mushroom grow kit from Sporekart and was amazed by the results. Within 6 months, she scaled up and now supplies fresh oyster mushrooms to 3 local restaurants. "The training videos and WhatsApp support made it so easy. I never imagined my balcony could be this productive!"',
    image: 'https://i.pravatar.cc/400?img=9',
    badge: 'Hobby to Business',
    cta: '#shop-section',
    ctaText: 'Start Your Grow Kit',
  },
  {
    id: 'story-3',
    name: 'Vikram Shetty',
    role: 'Entrepreneur',
    headline: 'Built a mushroom agri-business employing 12 women from my village.',
    description: 'After attending Sporekart\'s advanced training program, Vikram established a full-scale mushroom farm with spawn production unit in Dakshina Kannada. Today, his enterprise produces spawn, grows fresh mushrooms, and provides training to other farmers. He has successfully created employment for 12 women from his village. "The mentorship from Sporekart was invaluable. They helped me with everything from setup to market linkages."',
    image: 'https://i.pravatar.cc/400?img=12',
    badge: 'Startup Success',
    cta: null,
    ctaText: null,
  },
  {
    id: 'story-4',
    name: 'Sunita Devi',
    role: 'Rural Farmer',
    headline: 'Mushroom farming gave me financial independence and respect in my community.',
    description: 'Sunita Devi from rural Karnataka joined Sporekart\'s training program for women farmers. Starting with just 10 spawn bags, she now manages a thriving mushroom farm that brings in a steady monthly income. She has become a role model for other women in her village. "I used to depend on my husband for every expense. Now I manage my own finances and my children\'s education. Mushroom farming set me free."',
    image: 'https://i.pravatar.cc/400?img=5',
    badge: 'Women Empowerment',
    cta: null,
    ctaText: null,
  },
];

function renderSuccessStoryCard(story, target) {
  const card = document.createElement('div');
  card.className = 'success-card';
  card.dataset.storyId = story.id;
  const img = story.image || 'https://i.pravatar.cc/400?img=1';
  card.innerHTML = `
    <div class="success-card-img-wrap">
      <img src="${img}" alt="${story.name}" loading="lazy" />
      <span class="success-card-badge">${story.badge}</span>
    </div>
    <div class="success-card-body">
      <h3 class="success-card-name">${story.name}</h3>
      <span class="success-card-role">${story.role}</span>
      <p class="success-card-headline">"${story.headline}"</p>
    </div>
  `;
  card.addEventListener('click', () => {
    window.location.hash = `#story-${story.id}`;
  });
  target.appendChild(card);
}

let ssCarouselIndex = 0;
let ssCarouselTimer = null;

function renderSuccessCarousel() {
  const track = document.getElementById('success-carousel-track');
  if (!track) return;
  track.innerHTML = '';

  // Render original cards
  SUCCESS_STORIES.forEach(story => renderSuccessStoryCard(story, track));

  // Clone all cards and append for infinite loop
  // This creates: [card1, card2, card3, card4, card1_clone, card2_clone, card3_clone, card4_clone]
  SUCCESS_STORIES.forEach(story => {
    const clone = renderSuccessStoryCardClone(story);
    track.appendChild(clone);
  });

  ssCarouselIndex = 0;
  renderSuccessDots();
  updateCarouselArrows();
  startCarouselAutoScroll();
}

function renderSuccessStoryCardClone(story) {
  const card = document.createElement('div');
  card.className = 'success-card';
  card.dataset.storyId = story.id;
  card.setAttribute('data-clone', 'true');
  const img = story.image || 'https://i.pravatar.cc/400?img=1';
  card.innerHTML = `
    <div class="success-card-img-wrap">
      <img src="${img}" alt="${story.name}" loading="lazy" />
      <span class="success-card-badge">${story.badge}</span>
    </div>
    <div class="success-card-body">
      <h3 class="success-card-name">${story.name}</h3>
      <span class="success-card-role">${story.role}</span>
      <p class="success-card-headline">"${story.headline}"</p>
    </div>
  `;
  card.addEventListener('click', () => {
    window.location.hash = `#story-${story.id}`;
  });
  return card;
}

function renderSuccessDots() {
  const dotsContainer = document.getElementById('success-carousel-dots');
  if (!dotsContainer) return;
  dotsContainer.innerHTML = '';
  for (let i = 0; i < SUCCESS_STORIES.length; i++) {
    const dot = document.createElement('button');
    dot.className = 'success-dot' + (i === 0 ? ' active' : '');
    dot.ariaLabel = `Slide ${i + 1}`;
    dot.addEventListener('click', () => {
      ssCarouselIndex = i;
      updateSSCarousel(false);
      resetSSCarouselAutoplay();
    });
    dotsContainer.appendChild(dot);
  }
}

function updateCarouselDots(activeIndex) {
  const normalizedIndex = activeIndex % SUCCESS_STORIES.length;
  document.querySelectorAll('.success-dot').forEach((d, i) => {
    d.classList.toggle('active', i === normalizedIndex);
  });
}

function updateSSCarousel(instant) {
  const track = document.getElementById('success-carousel-track');
  if (!track) return;
  const cards = track.querySelectorAll('.success-card');
  if (cards.length === 0) return;

  const gap = 20;
  const cardWidth = cards[0].offsetWidth || 320;
  const offset = ssCarouselIndex * (cardWidth + gap);

  if (instant) {
    track.style.transition = 'none';
  } else {
    track.style.transition = 'transform 0.5s ease';
  }
  track.style.transform = `translateX(-${offset}px)`;

  updateCarouselDots(ssCarouselIndex);
}

function updateCarouselArrows() {
  const prev = document.getElementById('success-prev');
  const next = document.getElementById('success-next');
  if (prev) prev.addEventListener('click', () => {
    ssCarouselIndex++;
    if (ssCarouselIndex >= SUCCESS_STORIES.length) {
      // At cloned section, instantly jump back to start
      ssCarouselIndex = 0;
      updateSSCarousel(true);
      // Reset autoplay
      resetSSCarouselAutoplay();
    } else {
      updateSSCarousel(false);
      resetSSCarouselAutoplay();
    }
  });
  if (next) next.addEventListener('click', () => {
    ssCarouselIndex++;
    if (ssCarouselIndex >= SUCCESS_STORIES.length) {
      ssCarouselIndex = 0;
      updateSSCarousel(true);
      resetSSCarouselAutoplay();
    } else {
      updateSSCarousel(false);
      resetSSCarouselAutoplay();
    }
  });
}

function startCarouselAutoScroll() {
  stopSSCarouselAutoplay();
  ssCarouselTimer = setInterval(() => {
    ssCarouselIndex++;
    if (ssCarouselIndex >= SUCCESS_STORIES.length) {
      // We've reached the cloned cards, animate to them first
      updateSSCarousel(false);
      // After the transition completes, instantly jump back to the real cards
      setTimeout(() => {
        ssCarouselIndex = 0;
        updateSSCarousel(true);
      }, 550); // slightly longer than the 0.5s transition
    } else {
      updateSSCarousel(false);
    }
  }, 2000);
}

function stopSSCarouselAutoplay() {
  if (ssCarouselTimer) { clearInterval(ssCarouselTimer); ssCarouselTimer = null; }
}

function resetSSCarouselAutoplay() { stopSSCarouselAutoplay(); startCarouselAutoScroll(); }

function renderStoriesGrid() {
  const grid = document.getElementById('stories-grid');
  if (!grid) return;
  grid.innerHTML = '';
  SUCCESS_STORIES.forEach(story => {
    const card = document.createElement('div');
    card.className = 'success-card';
    card.dataset.storyId = story.id;
    const img = story.image || 'https://i.pravatar.cc/400?img=1';
    card.innerHTML = `
      <div class="success-card-img-wrap">
        <img src="${img}" alt="${story.name}" loading="lazy" />
        <span class="success-card-badge">${story.badge}</span>
      </div>
      <div class="success-card-body">
        <h3 class="success-card-name">${story.name}</h3>
        <span class="success-card-role">${story.role}</span>
        <p class="success-card-headline">"${story.headline}"</p>
      </div>
    `;
    card.addEventListener('click', () => {
      window.location.hash = `#story-${story.id}`;
    });
    grid.appendChild(card);
  });
}

function renderStoryDetail(storyId) {
  const container = document.getElementById('story-detail-content');
  if (!container) return;
  const story = SUCCESS_STORIES.find(s => s.id === storyId);
  if (!story) {
    container.innerHTML = '<p style="text-align:center;padding:60px 0;color:var(--text-soft);">Story not found.</p>';
    return;
  }
  const img = story.image || 'https://i.pravatar.cc/400?img=1';
  container.innerHTML = `
    <div class="story-detail-card">
      <img src="${img}" alt="${story.name}" />
      <div class="story-detail-card-body">
        <span class="story-detail-badge">${story.badge}</span>
        <h2>"${story.headline}"</h2>
        <p class="story-detail-name">${story.name}</p>
        <p class="story-detail-role">${story.role}</p>
        <p class="story-detail-headline">${story.headline}</p>
        <p class="story-detail-description">${story.description}</p>
        ${story.cta ? `<a href="${story.cta}" class="story-detail-cta">${story.ctaText || 'Learn More'} <i class="fa-solid fa-arrow-right"></i></a>` : ''}
      </div>
    </div>
  `;
  document.getElementById('btn-story-back').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.hash = '#shop';
  });
}

// ==========================================================================
// BLOGS RENDERING
// ==========================================================================
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

async function renderBlogsGrid() {
  const list = document.getElementById('blogs-list');
  const pagination = document.getElementById('blogs-pagination');
  if (!list) return;

  list.innerHTML = `
    <div class="blogs-loading">
      <i class="fa-solid fa-spinner fa-spin"></i> Loading blogs...
    </div>
  `;

  try {
    // Fetch all blogs at once so we can reorder client-side with recently read on top
    const result = await blogApi.getBlogs({ page: 1, limit: 1000 });
    _allBlogs = result.blogs || result.data || result || [];

    if (!_allBlogs.length) {
      list.innerHTML = `
        <div class="blogs-empty">
          <i class="fa-solid fa-newspaper"></i>
          <p>No blogs published yet.</p>
        </div>
      `;
      if (pagination) pagination.innerHTML = '';
      return;
    }

    // Reorder: recently read blogs appear at the top, rest follow in original order
    const recentlyRead = _getRecentlyReadBlogs();
    const readSlugs = new Set(recentlyRead.map(item => item.slug));

    // Build the reordered list: recently read first (in most-recently-read order), then unread blogs
    const recentlyReadBlogs = recentlyRead
      .map(item => _allBlogs.find(blog => blog.slug === item.slug))
      .filter(Boolean);
    const unreadBlogs = _allBlogs.filter(blog => !readSlugs.has(blog.slug));
    const renderedBlogs = [...recentlyReadBlogs, ...unreadBlogs];

    // Client-side pagination
    const total = renderedBlogs.length;
    const totalPages = Math.max(1, Math.ceil(total / blogPageSize));
    if (_blogPage > totalPages) _blogPage = totalPages;
    const start = (_blogPage - 1) * blogPageSize;
    const pageBlogs = renderedBlogs.slice(start, start + blogPageSize);

    list.innerHTML = pageBlogs.map(blog => {
      const isRecent = readSlugs.has(blog.slug);
      return `
        <article class="blog-row-card ${isRecent ? 'blog-row-recent' : ''}" data-slug="${blog.slug}">
          <div class="blog-row-left">
            <h3 class="blog-row-title">${blog.title}</h3>
          </div>
          <div class="blog-row-right">
            <div class="blog-row-meta">
              ${isRecent ? '<span class="blog-row-recent-badge"><i class="fa-solid fa-clock-rotate-left"></i> Recently Read</span>' : ''}
              <span class="blog-row-author"><i class="fa-solid fa-user"></i> ${blog.author || 'Admin'}</span>
              <span class="blog-row-date"><i class="fa-solid fa-calendar"></i> ${formatDate(blog.published_at || blog.created_at)}</span>
            </div>
            <a href="#blog-${blog.slug}" class="blog-row-readmore">Read More <i class="fa-solid fa-arrow-right"></i></a>
          </div>
        </article>
      `;
    }).join('');

    // Add click handlers for blog rows
    list.querySelectorAll('.blog-row-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!e.target.closest('.blog-row-readmore')) {
          const slug = card.dataset.slug;
          window.location.hash = `#blog-${slug}`;
        }
      });
    });

    // Render pagination
    if (pagination) {
      pagination.innerHTML = `
        <div class="blogs-pagination-controls">
          <button class="btn btn-secondary" id="blog-page-prev" ${_blogPage === 1 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-left"></i> Previous
          </button>
          <span class="blogs-page-info">Page ${_blogPage} of ${totalPages}</span>
          <button class="btn btn-secondary" id="blog-page-next" ${_blogPage >= totalPages ? 'disabled' : ''}>
            Next <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      `;

      document.getElementById('blog-page-prev')?.addEventListener('click', () => {
        if (_blogPage > 1) {
          _blogPage--;
          renderBlogsGrid();
        }
      });

      document.getElementById('blog-page-next')?.addEventListener('click', () => {
        if (_blogPage < totalPages) {
          _blogPage++;
          renderBlogsGrid();
        }
      });
    }
  } catch (err) {
    list.innerHTML = `
      <div class="blogs-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>Failed to load blogs. Please try again.</p>
      </div>
    `;
    console.error('Failed to fetch blogs:', err);
  }
}

async function renderBlogDetail(slug) {
  const container = document.getElementById('blog-detail-content');
  if (!container) return;

  container.innerHTML = `
    <div class="blog-detail-loading">
      <i class="fa-solid fa-spinner fa-spin"></i> Loading blog...
    </div>
  `;

  try {
    const blog = await blogApi.getBlog(slug);

    // Track this blog as recently read
    _saveRecentlyReadBlog(slug);

    // Update page title for SEO
    document.title = `${blog.title} | Sporekart`;

    // Check if blog is locked
    const isLocked = blog.locked === true;
    const publishedAt = new Date(blog.published_at).getTime();
    const twelveHours = 12 * 60 * 60 * 1000;
    const isLockedByTime = blog.status === 'published' && (Date.now() - publishedAt > twelveHours);

    container.innerHTML = `
      <article class="blog-detail-article">
        <header class="blog-detail-header">
          <span class="blog-detail-category">Blog</span>
          <h1 class="blog-detail-title">${blog.title}</h1>
          <div class="blog-detail-meta">
            <span class="blog-detail-author"><i class="fa-solid fa-user"></i> ${blog.author || 'Admin'}</span>
            <span class="blog-detail-date"><i class="fa-solid fa-calendar"></i> ${formatDate(blog.published_at)}</span>
            ${isLocked || isLockedByTime ? '<span class="blog-detail-locked"><i class="fa-solid fa-lock"></i> Locked</span>' : ''}
          </div>
        </header>

        ${blog.featured_image ? `
          <figure class="blog-detail-featured-image">
            <img src="${blog.featured_image}" alt="${blog.title}" loading="lazy" />
          </figure>
        ` : ''}

        <div class="blog-detail-content">
          ${blog.content}
        </div>

        <footer class="blog-detail-footer">
          <a href="#blogs" class="blog-back-link">
            <i class="fa-solid fa-arrow-left"></i> Back to Blogs
          </a>
        </footer>
      </article>
    `;

    // Add scroll reveal for content
    requestAnimationFrame(() => {
      container.querySelectorAll('.blog-detail-content').forEach(el => {
        el.classList.add('revealed');
      });
    });

  } catch (err) {
    container.innerHTML = `
      <div class="blog-detail-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3>Blog Not Found</h3>
        <p>The blog you're looking for doesn't exist or has been removed.</p>
        <a href="#blogs" class="btn btn-primary">Back to Blogs</a>
      </div>
    `;
    console.error('Failed to fetch blog:', err);
  }
}

