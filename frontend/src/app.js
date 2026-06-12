import {
  state,
  saveAuth,
  clearAuth,
  saveCart,
  saveUserProfile,
} from './utils/state.js';
import { authModal } from './components/AuthModal.js';
import { traineeAuthModal } from './components/TraineeAuthModal.js';
import { profileModal } from './components/ProfileModal.js';
import { authApi } from './api/authApi.js';
import { trainingApi } from './api/trainingApi.js';
import { API_BASE, fetchWithAuth, getApiErrorMessage } from './api/client.js';
import { showErrorToast, showSuccessToast } from './utils/notify.js';

// Attach state to window for existing global functions to work during incremental migration
window.state = state;
// Storefront pagination/sort state
let _shopInventoryPage = 1;
let shopPageSize = 10;

function getShopInventorySortValue() {
  return document.getElementById('shop-inventory-sort')?.value || 'name_asc';
}

function applyShopInventorySort(products) {
  const sortValue = getShopInventorySortValue();
  const [sortKey, sortDirection] = sortValue.split('_');
  const multiplier = sortDirection === 'desc' ? -1 : 1;
  return [...products].sort((a, b) => {
    if (sortKey === 'price') return multiplier * ((a.price || 0) - (b.price || 0));
    if (sortKey === 'stock') return multiplier * ((a.stock || 0) - (b.stock || 0));
    const nameA = String(a.name || '').toLowerCase();
    const nameB = String(b.name || '').toLowerCase();
    return multiplier * nameA.localeCompare(nameB);
  });
}

// Initialize App
function initApp() {
  initEventListeners();
  loadUser();
  fetchProducts();
  fetchCategories(); // Load categories for nav + admin
  fetchShippingSettings();
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
    const esUrl = `${API_BASE}/orders/events?token=${encodeURIComponent(state.token)}`;
    const orderEs = new EventSource(esUrl);
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
    const esUrl = `${API_BASE}/orders/events?token=${encodeURIComponent(state.token)}`;
    orderEs = new EventSource(esUrl);
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

window.addEventListener('auth:changed', () => initOrderSse());

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

function handleRouting() {
  const hash = window.location.hash || '#shop';
  const navShop = document.getElementById('btn-nav-shop');
  const navTrack = document.getElementById('btn-nav-track');
  const navAdmin = document.getElementById('btn-nav-admin');

  const pageShop = document.getElementById('shop-page');
  const pageCheckout = document.getElementById('checkout-page');
  const pageTrack = document.getElementById('tracker-page');
  const pageAdmin = document.getElementById('admin-page');

  const heroSection = document.getElementById('hero-section');

  // Deactivate all nav links & sections
  navShop.classList.remove('active');
  navTrack.classList.remove('active');
  navAdmin.classList.remove('active');

  pageShop.classList.remove('active');
  if (pageCheckout) pageCheckout.classList.remove('active');
  pageTrack.classList.remove('active');
  if (pageAdmin) pageAdmin.classList.remove('active');

  if (hash === '#shop' || hash === '') {
    navShop.classList.add('active');
    pageShop.classList.add('active');
    if (heroSection) heroSection.classList.remove('hidden');
  } else if (hash === '#checkout') {
    if (!state.user) {
      authModal.open('buyer', () => {
        window.location.hash = '#checkout';
      });
      return;
    }

    if (state.user.role === 'grower') {
      if (heroSection) heroSection.classList.remove('hidden');
      window.location.hash = '#shop';
      return;
    }

    if (heroSection) heroSection.classList.add('hidden');
    if (pageCheckout) pageCheckout.classList.add('active');
    renderCheckoutPage();
  } else if (hash.startsWith('#track')) {
    // Access validation for tracking is available to any logged-in user
    if (!state.user) {
      authModal.open('buyer', () => {
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
      // scroll into view for registration
      regSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (hash === '#training-courses') {
      // Access control: must be logged in as trainee
      if (!state.token || !state.user || state.user.role !== 'trainee') {
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
      // load courses on navigation
      renderTrainingCourses();
      return;
    }
    // default: hide both
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
      const dd = document.getElementById('cat-dropdown-menu');
      if (!dd) return;
      dd.classList.toggle('hidden');
      dd.setAttribute('aria-hidden', dd.classList.contains('hidden'));
      // Also ensure shop page is visible
      window.location.hash = '#shop';
    });
  }

  document.getElementById('btn-nav-track').addEventListener('click', (e) => {
    e.preventDefault();
    if (!state.user) {
      authModal.open('buyer', () => {
        window.location.hash = '#track';
      });
    } else {
      window.location.hash = '#track';
    }
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

  document
    .getElementById('hero-shop-btn')
    .addEventListener('click', () => { window.location.hash = '#shop'; });

  // Listen for global auth changes from new modules
  window.addEventListener('auth:changed', () => {
    updateAuthHeaderUI();
    handleRouting();
  });

  // Cart Slide Out Drawer
  document
    .getElementById('btn-open-cart')
    .addEventListener('click', () => { toggleCartDrawer(true); });
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
    searchInput.addEventListener('input', () => {
      _shopInventoryPage = 1;
      filterProducts();
      updateSearchSuggestions(searchInput.value);
    });
    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim()) updateSearchSuggestions(searchInput.value);
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
      filterProducts();
    });
  });

  const shopSortSelect = document.getElementById('shop-inventory-sort');
  if (shopSortSelect) {
    shopSortSelect.addEventListener('change', () => {
      _shopInventoryPage = 1;
      filterProducts();
    });
  }
  const shopPageSizeSelect = document.getElementById('shop-inventory-page-size');
  if (shopPageSizeSelect) {
    shopPageSizeSelect.addEventListener('change', () => {
      shopPageSize = parseInt(shopPageSizeSelect.value, 10) || 10;
      _shopInventoryPage = 1;
      filterProducts();
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
        <button class="btn btn-secondary" id="auth-choice-admin" style="width:100%;">Staff / Admin Login</button>
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
    updateAuthHeaderUI();
    return;
  }

  try {
    const user = await authApi.getMe();
    state.user = user;
    updateAuthHeaderUI();
    try {
      window.dispatchEvent(new CustomEvent('auth:changed', { detail: { token: state.token, user: state.user } }));
    } catch (e) { }
    handleRouting(); // trigger routing refresh for access checks
  } catch (err) {
    showErrorToast(getApiErrorMessage(err));
    logout();
  }
}

// Old auth logic fully replaced by modular AuthModal.js

function logout() {
  clearAuth();
  closeUserProfileDropdown();
  updateAuthHeaderUI();
  window.location.hash = '#shop';
}

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
          <i class="fa-solid fa-circle-user"></i>
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
    } else {
      navAdmin.style.display = 'none';
      if (navAdminEntry) navAdminEntry.style.display = 'inline-flex';
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
async function fetchProducts() {
  try {
    const products = await fetchWithAuth('/products');
    state.products = products;
    renderProducts(state.products);
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

function renderProducts(productsList) {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  if (!productsList || productsList.length === 0) {
    grid.innerHTML = `
      <div class="grid-skeleton">
        <i class="fa-solid fa-magnifying-glass loader-icon"></i>
        <p>No products found.</p>
      </div>
    `;
    return;
  }

  // Apply sorting and pagination
  const sorted = applyShopInventorySort(productsList);
  const totalPages = Math.max(1, Math.ceil(sorted.length / shopPageSize));
  if (_shopInventoryPage > totalPages) _shopInventoryPage = totalPages;
  const start = (_shopInventoryPage - 1) * shopPageSize;
  const pageProducts = sorted.slice(start, start + shopPageSize);

  const html = pageProducts
    .map((prod, idx) => {
      const catLabel = prod.category === 'spawn' ? 'Spawn & Seeds' : 'Mushroom';
      const hasMrp = prod.mrp_price && prod.mrp_price > prod.price;
      const discountPct = hasMrp
        ? Math.round((1 - prod.price / prod.mrp_price) * 100)
        : 0;
      const stockMeta = _getStockMeta(prod.stock);

      return `
        <div class="product-card reveal-element" data-id="${prod.id}" style="transition-delay: ${idx * 0.05}s">
          <div class="product-img-wrapper">
            <img src="${prod.image_url}" alt="${prod.name}" loading="lazy">
            <span class="product-gst-badge">${prod.gst_rate}% GST</span>
            <span class="tag tag-stock tag-stock-${stockMeta.variant}">${stockMeta.label}</span>
            ${hasMrp ? `<span class="product-discount-badge" style="position:absolute;top:10px;right:10px;">${discountPct}% OFF</span>` : ''}
          </div>
          <div class="product-info">
            <span class="product-category-lbl">${catLabel}</span>
            <h3>${prod.name}</h3>
            <p class="product-desc">${prod.description}</p>
            <div class="product-card-footer">
              <div>
                <div class="product-price-wrap">
                  <span class="product-price">${_formatCurrency(prod.price)}</span>
                  ${hasMrp ? `<span class="product-mrp">${_formatCurrency(prod.mrp_price)}</span>` : ''}
                </div>
                <span class="product-free-shipping-badge">Free shipping</span>
              </div>
              <button class="btn-card-add" data-id="${prod.id}">
                <i class="fa-solid fa-cart-plus"></i>
              </button>
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
      if (e.target.closest('.btn-card-add')) return;
      const id = card.getAttribute('data-id');
      openProductDetails(id);
    });
  });

  grid.querySelectorAll('.btn-card-add').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToCart(btn.getAttribute('data-id'));
    });
  });

  // Pagination controls
  const paginationWrap = document.getElementById('product-pagination');
  if (paginationWrap) {
    paginationWrap.innerHTML = `
      <div class="admin-pagination">
        <div class="admin-pagination-info">Showing ${start + 1}–${Math.min(start + pageProducts.length, sorted.length)} of ${sorted.length} products</div>
        <div class="admin-pagination-actions">
          <button type="button" class="btn btn-secondary" id="shop-page-prev" ${_shopInventoryPage === 1 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="admin-pagination-label">Page ${_shopInventoryPage} of ${totalPages}</span>
          <button type="button" class="btn btn-secondary" id="shop-page-next" ${_shopInventoryPage === totalPages ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      </div>
    `;

    const prev = document.getElementById('shop-page-prev');
    const next = document.getElementById('shop-page-next');
    if (prev) prev.addEventListener('click', () => { if (_shopInventoryPage > 1) { _shopInventoryPage -= 1; renderProducts(productsList); } });
    if (next) next.addEventListener('click', () => { if (_shopInventoryPage < totalPages) { _shopInventoryPage += 1; renderProducts(productsList); } });
  }
}

function filterProducts() {
  _shopInventoryPage = 1;
  const query = document.getElementById('shop-search').value.toLowerCase();
  const selectedCat = state.activeCategory || 'all';

  let filtered = state.products;

  if (selectedCat && selectedCat !== 'all') {
    filtered = filtered.filter((p) => p.category === selectedCat);
  }

  if (query.trim() !== '') {
    filtered = filtered.filter(
      (p) => p.name.toLowerCase().includes(query)
        || p.description.toLowerCase().includes(query),
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
  document.querySelectorAll('#product-filters-row .cat-btn').forEach((b) => {
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

  const matches = state.products
    .filter(
      (p) => p.name.toLowerCase().includes(query.toLowerCase())
        || p.description.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 6);

  if (!matches.length) {
    dd.innerHTML = `<div class="suggestions-empty"><i class="fa-solid fa-magnifying-glass"></i> No products found for "${query}"</div>`;
    dd.classList.remove('hidden');
    return;
  }

  dd.innerHTML = matches
    .map((p) => {
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
    })
    .join('');
  dd.classList.remove('hidden');

  // Wire click events
  dd.querySelectorAll('.suggestion-item').forEach((item) => {
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

    body.innerHTML = `
      <div class="detail-img-col">
        <img src="${product.image_url}" alt="${product.name}">
      </div>
      <div class="detail-info-col">
        <span class="product-category-lbl">${product.category}</span>
        <h3>${product.name}</h3>
        <div class="detail-price-wrap">
          <span class="detail-price">₹${product.price.toFixed(2)}</span>
          ${product.mrp_price && product.mrp_price > product.price
        ? `
            <span class="detail-mrp">₹${product.mrp_price.toFixed(2)}</span>
            <span class="detail-discount-badge">${Math.round((1 - product.price / product.mrp_price) * 100)}% OFF</span>
          `
        : ''
      }
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

function addToCart(productId) {
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

  const existing = state.cart.find((item) => item.id === productId);
  let addedItem;

  if (existing) {
    existing.quantity += 1;
    addedItem = existing;
  } else {
    const product = state.products.find((p) => p.id === productId);
    if (!product) return;
    const newItem = {
      id: product.id,
      name: product.name,
      price: product.price,
      image_url: product.image_url,
      gst_rate: product.gst_rate,
      quantity: 1,
    };
    state.cart.push(newItem);
    addedItem = newItem;
  }

  saveCart();
  updateCartUI();
  showAddedToCartPopup(addedItem);
  toggleCartDrawer(true);
}

function showAddedToCartPopup(item) {
  document.getElementById('added-to-cart-popup')?.remove();
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
  setTimeout(() => popup.remove(), 4200);
}

function changeQuantity(productId, delta) {
  const item = state.cart.find((item) => item.id === productId);
  if (!item) return;

  item.quantity += delta;

  if (item.quantity <= 0) {
    state.cart = state.cart.filter((item) => item.id !== productId);
  }

  saveCart();
  updateCartUI();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((item) => item.id !== productId);
  saveCart();
  updateCartUI();
}

function applyPromoCode() {
  const input = document
    .getElementById('promo-input')
    .value.toUpperCase()
    .trim();
  const feedback = document.getElementById('promo-message');

  feedback.classList.add('hidden');

  if (input === 'SPORE10') {
    state.activePromo = 'SPORE10';
    state.promoDiscountPct = 0.1;
    feedback.textContent = 'Code SPORE10 Active (10% Off)!';
    feedback.style.color = 'var(--color-success)';
    feedback.classList.remove('hidden');
  } else if (input === 'SHROOM20') {
    state.activePromo = 'SHROOM20';
    state.promoDiscountPct = 0.2;
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

  const totalCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  countBadge.textContent = totalCount;

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
      (cartItem) => `
      <div class="cart-item">
        <img src="${cartItem.image_url}" alt="${cartItem.name}">
        <div class="cart-item-details">
          <h4>${cartItem.name}</h4>
          <span class="cart-item-price">₹${cartItem.price.toFixed(2)} <span style="font-size:0.75rem; color:var(--color-text-muted);">(${cartItem.gst_rate}% GST)</span></span>
          <div class="cart-item-qty-row">
            <button class="qty-btn" onclick="window.changeQty('${cartItem.id}', -1)">-</button>
            <span class="qty-val">${cartItem.quantity}</span>
            <button class="qty-btn" onclick="window.changeQty('${cartItem.id}', 1)">+</button>
          </div>
          <div class="cart-item-shipping-note">Free shipping</div>
        </div>
        <button class="btn-remove-item" onclick="window.removeCartItem('${cartItem.id}')">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `,
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
    if (!phone) return showError('Please provide a phone number.');
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
  const list = document.getElementById('training-courses-list');
  if (!list) return;
  // Render role-specific plans above the trainings
  const trainingRole = (state.user && state.user.trainingRole)
    || localStorage.getItem('training_role')
    || 'trainee';
  const plansWrap = list.parentElement;
  // Add welcome message at top
  if (!document.getElementById('training-welcome-msg')) {
    const welcomeDiv = document.createElement('div');
    welcomeDiv.id = 'training-welcome-msg';
    welcomeDiv.innerHTML = '<div style="text-align:center;margin-bottom:24px;padding:16px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:8px;color:#fff;"><h3 style="margin:0 0 8px;font-size:1.5rem;">Welcome to Sporekart Training & Courses</h3><p style="margin:0;font-size:0.95rem;">Learn, grow, and build your mushroom business with us</p></div>';
    plansWrap.insertBefore(welcomeDiv, plansWrap.firstChild);
  }

  const plansContainerId = 'training-plans-container';
  let plansContainer = document.getElementById(plansContainerId);
  if (!plansContainer) {
    plansContainer = document.createElement('div');
    plansContainer.id = plansContainerId;
    plansContainer.style.display = 'grid';
    plansContainer.style.gridTemplateColumns = 'repeat(auto-fit,minmax(220px,1fr))';
    plansContainer.style.gap = '12px';
    plansWrap.insertBefore(plansContainer, list);
  }
  // Define plans per role
  const plansByRole = {
    trainee: [
      {
        title: 'Starter',
        price: 'Free',
        desc: 'Intro modules, community access',
      },
      {
        title: 'Pro Trainee',
        price: '₹2,499',
        desc: 'Live workshops + certification',
      },
    ],
    farmer: [
      {
        title: 'Field Ready',
        price: '₹4,999',
        desc: 'On-farm training + supply chain',
      },
      {
        title: 'Scale Up',
        price: '₹14,999',
        desc: 'Business modelling + crop scaling',
      },
    ],
    entrepreneur: [
      {
        title: 'Biz Launch',
        price: '₹9,999',
        desc: 'Market & product strategy',
      },
      {
        title: 'Growth Partner',
        price: '₹29,999',
        desc: 'Mentorship + investor introductions',
      },
    ],
  };
  const plans = plansByRole[trainingRole] || plansByRole.trainee;
  plansContainer.innerHTML = plans
    .map(
      (p) => `
    <div class="plan-card" style="padding:12px;border-radius:8px;border:1px solid #eee;background:#fff;">
      <h4 style="margin:0 0 6px;">${p.title}</h4>
      <div style="font-weight:700;margin-bottom:6px;">${p.price}</div>
      <div style="color:#4b5563;font-size:0.95rem;">${p.desc}</div>
      <div style="margin-top:8px;"><button class="btn btn-primary btn-plan-choose">Choose</button></div>
    </div>
  `,
    )
    .join('');

  plansContainer.querySelectorAll('.btn-plan-choose').forEach((b) => {
    b.addEventListener('click', () => showSuccessToast('Plan selection saved. Admin will contact you.'));
  });
  list.innerHTML = '<div class="grid-skeleton"><i class="fa-solid fa-spinner fa-spin"></i> Loading trainings...</div>';
  try {
    const trainings = await trainingApi.getTrainings();
    const trainingRole = (state.user && state.user.trainingRole)
      || localStorage.getItem('training_role')
      || 'trainee';
    const visibleTrainingsAll = Array.isArray(trainings) ? trainings : [];
    const visibleTrainings = visibleTrainingsAll.filter(
      (t) => !t.allowed_roles
        || t.allowed_roles.length === 0
        || (t.allowed_roles || []).includes(trainingRole),
    );
    if (!Array.isArray(visibleTrainings) || visibleTrainings.length === 0) {
      list.innerHTML = '<div class="grid-skeleton">No trainings available at the moment.</div>';
      return;
    }

    list.innerHTML = visibleTrainings
      .map(
        (t) => `
      <div class="training-card" data-id="${t.id}" style="padding:12px;border-radius:8px;border:1px solid #eee;background:#fff;">
        <img src="${t.image_url || '/images/training_farm.png'}" alt="${t.title}" style="width:100%;height:160px;object-fit:cover;border-radius:6px;margin-bottom:8px;">
        <h4>${t.title}</h4>
        <p style="color:#4b5563;font-size:0.95rem;">${t.description || ''}</p>
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button class="btn btn-primary btn-enroll" data-id="${t.id}">Enroll</button>
          <button class="btn btn-outline btn-shop-from-training">Shop Now</button>
        </div>
      </div>
    `,
      )
      .join('');

    list.querySelectorAll('.btn-enroll').forEach((b) => {
      b.addEventListener('click', async (e) => {
        const id = b.getAttribute('data-id');
        if (!state.user) {
          // Keep buyer login separate: open buyer login modal
          authModal.open('buyer', () => {
            window.location.hash = '#training-courses';
          });
          return;
        }

        try {
          b.disabled = true;
          b.textContent = 'Enrolling…';
          const role = state.user.trainingRole
            || localStorage.getItem('training_role')
            || 'trainee';
          const res = await trainingApi.enroll(id, { role });
          showSuccessToast('Enrolled — admin will contact you.');
        } catch (err) {
          showErrorToast('Enrollment failed. Try again.');
        } finally {
          b.disabled = false;
          b.textContent = 'Enroll';
        }
      });
    });
    // Add Shop Now button handler - requires login as buyer
    list.querySelectorAll('.btn-shop-from-training').forEach((b) => {
      b.addEventListener('click', () => {
        if (!state.user || state.user.role !== 'buyer') {
          authModal.open('buyer', () => {
            window.location.hash = '#shop';
          });
          return;
        }
        window.location.hash = '#shop';
      });
    });
  } catch (err) {
    list.innerHTML = '<div class="grid-skeleton">Failed to load trainings.</div>';
  }
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

  if (!state.user) {
    if (warning) {
      warning.textContent = '⚠️ Please verify your identity to complete checkout.';
      warning.classList.remove('hidden');
    }
    authModal.open('buyer', () => {
      showAddressModal();
    });
    return;
  }

  if (state.user.role === 'grower') {
    if (warning) {
      warning.textContent = '⚠️ Cultivator profiles are read-only. Please create a Buyer account to purchase spawn.';
      warning.classList.remove('hidden');
    }
    return;
  }

  showAddressModal();
}

function showAddressModal() {
  document.getElementById('address-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'address-modal';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.64);z-index:9999;padding:16px;';
  const initialPhone = document.getElementById('checkout-delivery-phone')?.value.trim()
    || state.user?.whatsapp_number
    || state.user?.phone
    || '';
  const initialName = document.getElementById('checkout-delivery-name')?.value.trim()
    || state.user?.fullName
    || '';
  const initialPincode = document.getElementById('checkout-delivery-pincode')?.value.trim() || '';
  const initialAddress = document.getElementById('checkout-delivery-address')?.value.trim() || '';
  modal.innerHTML = `
    <div style="width:100%;max-width:460px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 28px 80px rgba(15,23,42,0.24);">
      <div style="padding:18px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;">
        <h3 style="margin:0;font-size:1.15rem;color:#111;">Delivery details</h3>
        <p style="margin:8px 0 0;color:#475569;line-height:1.5;">Enter phone, pincode and address before payment.</p>
      </div>
      <div style="padding:18px 20px;display:grid;gap:12px;">
        <label style="font-weight:600;color:#334155;">Full name</label>
        <input id="modal-delivery-name" type="text" value="${initialName}" placeholder="Your full name" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;outline:none;">
        <label style="font-weight:600;color:#334155;">Phone</label>
        <input id="modal-delivery-phone" type="tel" value="${initialPhone}" placeholder="10-15 digit phone" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;outline:none;">
        <label style="font-weight:600;color:#334155;">Pincode</label>
        <input id="modal-delivery-pincode" type="text" value="${initialPincode}" placeholder="6-digit pincode" maxlength="6" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;outline:none;">
        <label style="font-weight:600;color:#334155;">Address</label>
        <textarea id="modal-delivery-address" rows="4" placeholder="House no., street, landmark, city" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;outline:none;">${initialAddress}</textarea>
        <div id="modal-address-feedback" style="color:#b91c1c;display:none;font-size:0.95rem;"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="modal-cancel" class="btn btn-secondary" style="flex:1;">Cancel</button>
          <button id="modal-continue" class="btn btn-primary" style="flex:1;">Proceed to Checkout</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal
    .querySelector('#modal-cancel')
    ?.addEventListener('click', () => modal.remove());
  modal
    .querySelector('#modal-continue')
    ?.addEventListener('click', async () => {
      const name = modal.querySelector('#modal-delivery-name')?.value.trim() || '';
      const phone = modal.querySelector('#modal-delivery-phone')?.value.trim() || '';
      const pincode = modal.querySelector('#modal-delivery-pincode')?.value.trim() || '';
      const address = modal.querySelector('#modal-delivery-address')?.value.trim() || '';
      const feedback = modal.querySelector('#modal-address-feedback');
      if (feedback) {
        feedback.style.display = 'none';
        feedback.textContent = '';
      }

      if (
        !phone
        || phone.replace(/\D/g, '').length < 10
        || phone.replace(/\D/g, '').length > 15
      ) {
        if (feedback) {
          feedback.textContent = 'Enter a valid phone number (10-15 digits).';
          feedback.style.display = 'block';
        }
        return;
      }

      if (!/^[0-9]{6}$/.test(pincode)) {
        if (feedback) {
          feedback.textContent = 'Enter a valid 6-digit pincode.';
          feedback.style.display = 'block';
        }
        return;
      }

      if (!address) {
        if (feedback) {
          feedback.textContent = 'Delivery address is required.';
          feedback.style.display = 'block';
        }
        return;
      }

      // Name mandatory
      if (!name) {
        if (feedback) {
          feedback.textContent = 'Full name is required for delivery.';
          feedback.style.display = 'block';
        }
        return;
      }

      modal.remove();
      const phoneInput = document.getElementById('checkout-delivery-phone');
      const pincodeInput = document.getElementById('checkout-delivery-pincode');
      const addressInput = document.getElementById('checkout-delivery-address');
      if (phoneInput) phoneInput.value = phone;
      if (pincodeInput) pincodeInput.value = pincode;
      if (addressInput) addressInput.value = address;

      // Update user basic details with delivery info
      if (!state.user) {
        // create guest profile locally
        const guest = {
          id: `guest_${Date.now()}`,
          fullName: name,
          email: '',
          whatsappNumber: phone,
          role: 'buyer',
          loginMethod: 'guest',
          defaultAddress: address,
          defaultPincode: pincode,
        };
        saveUserProfile(guest);
        window.dispatchEvent(new Event('auth:changed'));
      } else {
        // update local state and attempt server update
        const updated = {
          ...state.user,
          fullName: name,
          whatsappNumber: phone,
          defaultAddress: address,
          defaultPincode: pincode,
        };
        saveUserProfile(updated);
        window.dispatchEvent(new Event('auth:changed'));
        if (state.token) {
          try {
            await fetchWithAuth('/auth/me', {
              method: 'PUT',
              body: JSON.stringify({
                fullName: name,
                whatsappNumber: phone,
                default_address: address,
                default_pincode: pincode,
              }),
            });
          } catch (err) {
            console.warn(
              'Failed to persist delivery details to server:',
              err.message || err,
            );
          }
        }
      }

      window.location.hash = '#checkout';
    });
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

  const lines = state.cart.map((item) => {
    const product = state.products.find((p) => p.id === item.id) || {};
    return `
      <div class="checkout-summary-line">
        <span>${item.quantity}× ${product.name || 'Product'}</span>
        <strong>₹${((product.price || 0) * item.quantity).toFixed(2)}</strong>
      </div>
    `;
  });

  const subtotal = state.cart.reduce((total, item) => {
    const product = state.products.find((p) => p.id === item.id) || {};
    return total + (product.price || 0) * item.quantity;
  }, 0);
  const gst = +(subtotal * 0.05).toFixed(2);
  const discount = state.activePromo ? 50 : 0;
  const shipping = 0;
  const total = subtotal + gst + shipping - discount;

  summaryContainer.innerHTML = `
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

async function handlePaymentContinue() {
  const deliveryPhone = document.getElementById('checkout-delivery-phone')?.value.trim() || '';
  const deliveryAddress = document.getElementById('checkout-delivery-address')?.value.trim() || '';
  const deliveryPincode = document.getElementById('checkout-delivery-pincode')?.value.trim() || '';
  const feedback = document.getElementById('checkout-page-feedback');

  if (feedback) {
    feedback.textContent = '';
    feedback.classList.add('hidden');
  }

  if (
    !deliveryPhone
    || deliveryPhone.replace(/\D/g, '').length < 10
    || deliveryPhone.replace(/\D/g, '').length > 15
  ) {
    if (feedback) {
      feedback.textContent = 'Enter a valid delivery phone number (10-15 digits).';
      feedback.classList.remove('hidden');
    }
    return;
  }

  if (!deliveryPincode || !/^\d{6}$/.test(deliveryPincode)) {
    if (feedback) {
      feedback.textContent = 'Enter a valid 6-digit pincode.';
      feedback.classList.remove('hidden');
    }
    return;
  }

  if (!deliveryAddress) {
    if (feedback) {
      feedback.textContent = 'Delivery address cannot be empty.';
      feedback.classList.remove('hidden');
    }
    return;
  }

  try {
    const data = await fetchWithAuth('/orders/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: state.cart.map((item) => ({
          id: item.id,
          quantity: item.quantity,
        })),
        promoCode: state.activePromo,
        delivery_phone: deliveryPhone,
        delivery_address: deliveryAddress,
        delivery_pincode: deliveryPincode,
      }),
    });

    toggleCartDrawer(false);

    const rzpDetails = data.razorpay;
    const orderRecord = data.order;

    if (
      rzpDetails.keyId.includes('mockKey')
      || rzpDetails.keyId.includes('rzp_test_mock')
    ) {
      showMockPaymentModal(rzpDetails, orderRecord);
    } else {
      const options = {
        key: rzpDetails.keyId,
        amount: rzpDetails.amount,
        currency: rzpDetails.currency,
        name: 'Sporekart Store',
        description: 'Fruiting Spore Seeds Checkout',
        order_id: rzpDetails.orderId,
        async handler(response) {
          await completeOrderPayment(
            response.razorpay_order_id,
            response.razorpay_payment_id,
            response.razorpay_signature,
          );
        },
        prefill: {
          name: state.user.fullName,
          email: state.user.email,
          contact: state.user.whatsappNumber || '',
        },
        theme: {
          color: '#38b17b',
        },
      };

      const rzp = new Razorpay(options);
      rzp.open();
    }
  } catch (err) {
    showErrorToast(getApiErrorMessage(err));
    if (feedback) {
      feedback.textContent = 'Unable to connect to payment service. Please try again later.';
      feedback.classList.remove('hidden');
    }
  }
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

          <!-- â•â• UPI â•â• -->
          <div class="pgw-panel" id="pgw-panel-upi" style="display:block;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">PAY VIA UPI</div>

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

            <div style="text-align:center;color:#475569;font-size:0.78rem;margin-bottom:14px;">â€” or enter UPI ID â€”</div>

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
              <i class="fa-solid fa-circle-check"></i> UPI ID verified â€” Test User
            </div>
            <button class="pgw-pay-btn" id="pgw-btn-pay-upi" style="
              width:100%; padding:14px; background:linear-gradient(135deg,#38b17b,#1a7a52);
              border:none; border-radius:10px; color:#fff; font-size:0.95rem; font-weight:700;
              cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; gap:8px;
            ">
              <i class="fa-solid fa-mobile-screen-button"></i> Pay ₹${amount} via UPI
            </button>
          </div>

          <!-- â•â• CARD â•â• -->
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

          <!-- â•â• NET BANKING â•â• -->
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
              <i class="fa-solid fa-building-columns"></i> Proceed to Bank â€” ₹${amount}
            </button>
          </div>

          <!-- â•â• WALLETS â•â• -->
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

          <!-- â•â• EMI â•â• -->
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
                      <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${e.bank} Â· ${e.rate}% p.a.</div>
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

          <!-- â•â• COD â•â• -->
          <div class="pgw-panel" id="pgw-panel-cod" style="display:none;">
            <div style="font-size:0.8rem;font-weight:600;color:#94a3b8;letter-spacing:0.05em;margin-bottom:14px;">CASH ON DELIVERY</div>

            <div style="background:rgba(56,177,123,0.08);border:1px solid rgba(56,177,123,0.2);border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
              <div style="font-size:2.5rem;margin-bottom:10px;">ðŸ’µ</div>
              <div style="font-size:1.1rem;font-weight:700;color:#e2e8f0;margin-bottom:6px;">Pay ₹${amount} at Delivery</div>
              <div style="font-size:0.82rem;color:#94a3b8;">Keep exact change ready. Our delivery partner will collect cash at your doorstep.</div>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
              ${[
      { icon: 'fa-box-open', text: 'Order confirmed immediately' },
      {
        icon: 'fa-truck-fast',
        text: 'Delivered in 2â€“5 business days',
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
              <i class="fa-solid fa-box-open"></i> Place Order â€” Pay on Delivery
            </button>
          </div>

        </div><!-- end right panel -->
      </div><!-- end body -->

      <!-- â”€â”€â”€ FOOTER â”€â”€â”€ -->
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
        ">âœ• Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(mockModal);

  // â”€â”€ TAB SWITCHING â”€â”€
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
    const res = await fetch(`${API_BASE}/orders/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      }),
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

      // Refresh shop inventory quantities immediately after payment
      await fetchProducts();

      // Show success notification
      showSuccessToast('ðŸŽ‰ Order placed successfully! Payment confirmed.');

      // Notify other tabs (admin) that orders have been updated
      try {
        const bcOrders = new BroadcastChannel('spore-orders');
        bcOrders.postMessage({ type: 'orders:updated', orderId: data.order && data.order.id ? data.order.id : null });
      } catch (e) {
        // ignore if BroadcastChannel isn't available
      }

      // Admin and Growers can track orders; Buyers go back to shop
      if (
        state.user
        && (state.user.role === 'admin' || state.user.role === 'grower')
      ) {
        window.location.hash = `#track-${data.order.id}`;
      } else {
        window.location.hash = '#shop';
      }
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
async function fetchOrders() {
  if (!state.token) return;

  try {
    const res = await fetch(`${API_BASE}/orders/my-orders`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (res.ok) {
      state.orders = await res.json();
      renderOrdersSidebar();
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
      const dateFormatted = new Date(order.created_at).toLocaleDateString(
        'en-IN',
        {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        },
      );

      return `
      <div class="order-sidebar-card ${activeClass}" data-id="${order.id}">
        <div class="order-card-header">
          <span class="order-id-lbl">RUN-${order.id.substring(0, 8).toUpperCase()}</span>
          <span class="order-status-badge ${order.delivery_status}">${order.delivery_status}</span>
        </div>
        <div class="order-card-date">${dateFormatted}</div>
        <div class="order-card-total">₹${order.total.toFixed(2)} (${order.items.length} culture${order.items.length > 1 ? 's' : ''})</div>
        ${order.delivery_status === 'cancelled' && order.cancel_reason ? `<div class="order-card-reason">Reason: ${order.cancel_reason}</div>` : ''}
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

  const canCancel = !['shipped', 'delivered', 'cancelled'].includes(
    track.deliveryStatus,
  );
  const cancelReason = track.cancelReason || '';

  container.innerHTML = `
    <div class="tracker-details-header">
      <div>
        <h3>Mycelium Incubator Log</h3>
        <p class="subtitle">Run ID: RUN-${track.orderId.substring(0, 8).toUpperCase()} | Stage: <span class="order-status-badge ${track.deliveryStatus}">${track.deliveryStatus}</span></p>
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
      ${track.deliveryStatus === 'cancelled'
      ? `
        <div class="tracker-cancelled-note">
          <strong>Cancellation reason:</strong> ${cancelReason || 'Not provided'}
        </div>
      `
      : `
        <div class="input-field">
          <label for="cancel-reason-select">Reason for cancellation</label>
          <select id="cancel-reason-select">
            <option value="">Select reason</option>
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
      `
    }
    </div>

    <div class="tracker-details-actions">
      <button class="btn btn-secondary" onclick="window.viewInvoice('${track.orderId}')">
        <i class="fa-solid fa-file-invoice-dollar"></i> Generate Tax Invoice
      </button>
      <button class="btn btn-whatsapp-action" onclick="window.whatsappQuickMessage('${track.orderId}')">
        <i class="fa-brands fa-whatsapp"></i> Update via WhatsApp
      </button>
      ${canCancel ? `<button class="btn btn-cancel" onclick="window.cancelOrder('${track.orderId}')"><i class="fa-solid fa-ban"></i> Cancel order</button>` : ''}
    </div>
  `;

  document.querySelectorAll('.order-sidebar-card').forEach((card) => {
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

  const reasonSelect = document.getElementById('cancel-reason-select');
  const otherWrap = document.getElementById('cancel-reason-other-wrap');
  if (reasonSelect && otherWrap) {
    reasonSelect.addEventListener('change', () => {
      if (reasonSelect.value === 'Other') {
        otherWrap.classList.remove('hidden');
      } else {
        otherWrap.classList.add('hidden');
      }
    });
  }
}

async function cancelOrder(orderId) {
  const confirmation = confirm(
    'Cancel this order? This will stop processing if it has not shipped yet.',
  );
  if (!confirmation) return;

  try {
    const reasonSelect = document.getElementById('cancel-reason-select');
    const otherInput = document.getElementById('cancel-reason-other');
    let reason = reasonSelect ? reasonSelect.value : '';

    if (!reason) {
      showErrorToast('Please choose a cancellation reason.');
      return;
    }

    if (reason === 'Other') {
      reason = otherInput?.value.trim() || '';
      if (!reason) {
        showErrorToast('Please enter your cancellation reason.');
        return;
      }
    }

    const res = await fetch(`${API_BASE}/orders/${orderId}/cancel`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Unable to cancel order');
    }

    showSuccessToast(
      '✅ Order cancellation request submitted. Refreshing tracking...',
    );
    await pollTrackingData(orderId);
  } catch (err) {
    showErrorToast(
      getApiErrorMessage(err) || 'Unable to cancel order at this time.',
    );
  }
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
          filterProducts(btn.dataset.category);
        });
      });
    }

    renderCategoryGrid(categories);
    populateCategoryDropdown(categories);
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
        filterProducts();
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
  ].filter((el) => el !== null);

  const observerOptions = {
    root: null,
    rootMargin: '0px',
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
window.cancelOrder = cancelOrder;

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
