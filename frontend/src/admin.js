import { state, saveAuth, clearAuth } from './utils/state.js';
import { authApi } from './api/authApi.js';
import { API_BASE, fetchWithAuth, getApiErrorMessage } from './api/client.js';
import { trainingApi } from './api/trainingApi.js';
import { blogApi } from './api/blogApi.js';
import { showErrorToast, showSuccessToast } from './utils/notify.js';
import { isValidIndianPhone } from './utils/validation.js';
import { createEventSourceWithAuth } from './utils/auth.js';

globalThis.state = state;

let _adminProducts = [];
let _adminCategories = [];
let _adminTrainings = [];
let _adminBlogs = [];
let pendingCategoryEditId = null;
let adminOrdersCache = [];
let adminShipmentsCache = [];
let adminHistoryPage = 1;
let adminHistoryPageSize = 10;
let adminHistorySort = 'date_desc';
let _adminInventoryPage = 1;
let adminInventoryPageSize = 10;
let trainImagePreviewValid = false;

const loginPanel = document.getElementById('admin-login-panel');
const dashboard = document.getElementById('admin-dashboard');
const dashboardSubtitle = document.getElementById('admin-dash-subtitle');
const statProducts = document.getElementById('admin-stat-products');
const statOrders = document.getElementById('admin-stat-orders');
const loginError = document.getElementById('admin-login-error');
const loginForm = document.getElementById('form-admin-auth');
const btnViewShop = document.getElementById('btn-admin-view-shop');
const btnLogout = document.getElementById('btn-admin-logout');
const adminActionMenuBtn = document.getElementById('admin-action-menu-btn');
const adminActionMenu = document.getElementById('admin-action-menu');
const resetCatBtn = document.getElementById('btn-admin-reset-cat');
const saveCatBtn = document.getElementById('btn-admin-save-cat');
const capsuleWeightContainer = document.getElementById('admin-capsule-weight-container');
// Training DOM elements
const trainForm = document.getElementById('form-admin-add-training');
const trainEditId = document.getElementById('admin-train-edit-id');
const trainTitle = document.getElementById('admin-train-title');
const trainCategory = document.getElementById('admin-train-category');
const trainDesc = document.getElementById('admin-train-desc');
const trainImage = document.getElementById('admin-train-image');
const trainContent = document.getElementById('admin-train-content');
const trainListWrap = document.getElementById('admin-trainings-list');
const trainIdDisplay = document.getElementById('admin-train-id-display');
const trainStartDate = document.getElementById('admin-train-start-date');
const trainEndDate = document.getElementById('admin-train-end-date');
const trainDuration = document.getElementById('admin-train-duration');
const trainPriceStrikeout = document.getElementById('admin-train-price-strikeout');
const trainPriceActual = document.getElementById('admin-train-price-actual');
const trainImageUrl = document.getElementById('admin-train-image-url');
const trainImageBrowse = document.getElementById('admin-train-image-browse');
const trainImageFile = document.getElementById('admin-train-image-file');
const trainImagePreview = document.getElementById('admin-train-img-preview');
const categoryUidInput = document.getElementById('admin-cat-uid');
const categoryImageUrl = document.getElementById('admin-cat-image-url');
const categoryImageBrowse = document.getElementById('admin-cat-image-browse');
const categoryImageFile = document.getElementById('admin-cat-image-file');
const categoryImagePreview = document.getElementById('admin-cat-image-preview');
// Blog DOM elements
const blogModal = document.getElementById('admin-blog-modal');
const blogModalTitle = document.getElementById('admin-blog-modal-title');
const blogModalClose = document.getElementById('admin-blog-modal-close');
const blogForm = document.getElementById('form-admin-blog');
const blogEditId = document.getElementById('admin-blog-edit-id');
const blogTitleInput = document.getElementById('admin-blog-title');
const blogSlugInput = document.getElementById('admin-blog-slug');
const blogAuthorInput = document.getElementById('admin-blog-author');
const blogImageUrl = document.getElementById('admin-blog-image-url');
const blogImageBrowse = document.getElementById('admin-blog-image-browse');
const blogImageFile = document.getElementById('admin-blog-image-file');
const blogImagePreview = document.getElementById('admin-blog-img-preview');
const blogContentInput = document.getElementById('admin-blog-content');
const blogIdInput = document.getElementById('admin-blog-id');
const blogResetBtn = document.getElementById('admin-blog-reset');
const blogSubmitBtn = document.getElementById('admin-blog-submit');
const blogSubmitLabel = document.getElementById('admin-blog-submit-label');
const blogFeedback = document.getElementById('admin-blog-feedback');
const blogFeedbackText = document.getElementById('admin-blog-feedback-text');
const btnCreateBlog = document.getElementById('btn-admin-create-blog');
const blogsListWrap = document.getElementById('admin-blogs-list');
let blogImagePreviewValid = false;
let bcCategories = null;
try {
  bcCategories = new BroadcastChannel('spore-categories');
} catch (e) {
  console.warn(e);
  bcCategories = null;
}
let bcProducts = null;
try {
  bcProducts = new BroadcastChannel('spore-products');
} catch (e) {
  console.warn(e);
  bcProducts = null;
}
let bcOrders = null;
try {
  bcOrders = new BroadcastChannel('spore-orders');
  bcOrders.addEventListener('message', (ev) => {
    if (ev?.data?.type === 'orders:updated') {
      fetchAdminOrders();
      if (ev?.data?.orderId) {
        showSuccessToast(`Order ${ev.data.orderId} updated`);
      } else {
        showSuccessToast('Order update received');
      }
    }
  });
} catch (e) {
  console.warn(e);
  bcOrders = null;
}

// Connect to server-sent events for cross-browser order notifications
let adminEs = null;

function initAdminSse() {
  try {
    if (!state?.token) return;
    if (adminEs) return; // already initialized
    const esUrl = `${API_BASE}/orders/events`;
    adminEs = createEventSourceWithAuth(esUrl, state.token);
    adminEs.addEventListener('order:updated', (ev) => {
      try {
        const payload = JSON.parse(ev.data || '{}');
        const order = payload.order;
        if (state.user?.role === 'admin') {
          fetchAdminOrders();
          if (order) {
            const status = order.delivery_status || order.status || 'updated';
            showSuccessToast(`Order ${order.id} updated (${status})`);
          } else {
            showSuccessToast('Order update received');
          }
        }
      } catch (e) {
        console.warn(e);
      }
    });
    adminEs.addEventListener('return:updated', (ev) => {
      try {
        const payload = JSON.parse(ev.data || '{}');
        if (state.user?.role === 'admin') {
          const returnsPanel = document.getElementById('ship-panel-returns');
          if (returnsPanel?.classList.contains('active')) {
            loadReturnsDashboard();
          }
          const ret = payload.return;
          if (ret) {
            showSuccessToast(`\u{1F504} Return ${ret.status || 'updated'} for order ${(ret.order_id || '').substring(0, 8).toUpperCase()}`);
          }
        }
      } catch (e) {
        console.warn(e);
      }
    });
    adminEs.addEventListener('error', () => {
      // noop; BroadcastChannel remains as fallback
    });
    // Auto-refresh refunds tab on webhook-driven refund updates
    adminEs.addEventListener('refund:updated', (ev) => {
      try {
        const payload = JSON.parse(ev.data || '{}');
        if (state.user?.role === 'admin') {
          fetchAdminOrders();
          const refundsPanel = document.getElementById('ship-panel-refunds');
          if (refundsPanel?.classList.contains('active')) {
            loadRefundsDashboard();
          }
          const returnsPanel = document.getElementById('ship-panel-returns');
          if (returnsPanel?.classList.contains('active')) {
            loadReturnsDashboard();
          }
          const refund = payload.refund;
          if (refund) {
            showSuccessToast(`\u{1F4B0} Refund ${refund.status || 'updated'} for order ${(refund.order_id || '').substring(0, 8).toUpperCase()}`);
          }
        }
      } catch (e) {
        console.warn(e);
      }
    });
  } catch (e) {
    console.warn(e);
  }
}

globalThis.addEventListener('auth:changed', () => initAdminSse());

function showLoginPanel() {
  loginPanel.classList.remove('hidden');
  dashboard.classList.add('hidden');

  // Reset form to initial state (email step)
  const otpField = document.getElementById('admin-auth-otp-field');
  const emailField = document.getElementById('admin-auth-email-field');
  const btn = document.getElementById('admin-auth-btn');
  const sentEl = document.getElementById('admin-auth-otp-sent');
  const emailInput = document.getElementById('admin-auth-email');
  const otpInput = document.getElementById('admin-auth-otp');

  if (otpField) otpField.classList.add('hidden');
  if (emailField) emailField.classList.remove('hidden');
  if (btn) { btn.disabled = false; btn.textContent = 'Send OTP'; }
  if (sentEl) sentEl.textContent = '';
  if (emailInput) emailInput.value = '';
  if (otpInput) otpInput.value = '';
  loginError.classList.add('hidden');
}

function showDashboard() {
  loginPanel.classList.add('hidden');
  dashboard.classList.remove('hidden');

  if (state.user && dashboardSubtitle) {
    dashboardSubtitle.textContent = `Welcome, ${state.user.fullName || state.user.email}`;
  }

  fetchDashboardData().then(() => {
    // Initialize SSE once dashboard data and user context are ready
    initAdminSse();

    if (pendingCategoryEditId) {
      activateAdminTab('products');
      _activeCapsule = 'categories';
      renderAdminInventory();
      adminEditCategory(pendingCategoryEditId);
      pendingCategoryEditId = null;
    }
  });
}

async function fetchDashboardData() {
  // Load core admin data in parallel
  await Promise.all([
    fetchAdminInventory(),
    fetchAdminOrders(),
    fetchAdminCategories(),
    fetchAdminTrainings().catch(() => { }),
    fetchAdminBlogs().catch(() => { }),
  ]);
}

function renderAuthError(message) {
  loginError.textContent = message;
  loginError.classList.remove('hidden');
}

function clearAuthError() {
  loginError.textContent = '';
  loginError.classList.add('hidden');
}
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateCategoryUid() {
  const prefix = 'spore-';
  const randomNumber = String(Math.floor(Math.random() * 900000) + 100000);
  return `${prefix}${randomNumber}`;
}

function generateProductId(categoryUid) {
  // Always generate a unique ID — fallback to a global sequence if no category uid
  if (!categoryUid) {
    const allNumbers = _adminProducts
      .map((p) => {
        const match = /^(?:.*?-pid-)?(\d+)$/.exec(String(p.id));
        return match ? Number.parseInt(match[1], 10) : 0;
      });
    const nextNumber = allNumbers.length ? Math.max(...allNumbers) + 1 : 1;
    return `prod-${String(nextNumber).padStart(5, '0')}`;
  }
  const existingIds = _adminProducts
    .filter(
      (p) => p.category === document.getElementById('admin-capsule-prod-category')?.value,
    )
    .map((p) => {
      const regex = new RegExp(`^${escapeRegExp(categoryUid)}-pid-(\\d+)$`);
      const match = regex.exec(String(p.id));
      return match ? Number.parseInt(match[1], 10) : 0;
    });
  const nextNumber = existingIds.length ? Math.max(...existingIds) + 1 : 1;
  return `${categoryUid}-pid-${String(nextNumber).padStart(5, '0')}`;
}

let _activeCapsule = 'all';

function getAdminInventorySortValue() {
  const sel = document.getElementById('admin-inventory-sort');
  return sel?.value || 'date_desc';
}

function applyAdminInventorySort(products) {
  const sortValue = getAdminInventorySortValue();
  const [sortKey, sortDirection] = sortValue.split('_');
  const sortMultiplier = sortDirection === 'desc' ? -1 : 1;

  return [...products].sort((a, b) => {
    if (sortKey === 'date') {
      return sortMultiplier * (_adminProducts.indexOf(a) - _adminProducts.indexOf(b));
    }
    if (sortKey === 'price') {
      return sortMultiplier * ((a.price || 0) - (b.price || 0));
    }
    if (sortKey === 'stock') {
      return sortMultiplier * ((a.stock || 0) - (b.stock || 0));
    }
    if (sortKey === 'category') {
      const categoryA = String(a.category || '').toLowerCase();
      const categoryB = String(b.category || '').toLowerCase();
      return sortMultiplier * categoryA.localeCompare(categoryB);
    }
    const nameA = String(a.name || '').toLowerCase();
    const nameB = String(b.name || '').toLowerCase();
    return sortMultiplier * nameA.localeCompare(nameB);
  });
}

function updateCategoryImagePreview() {
  if (!categoryImagePreview) return;
  const file = categoryImageFile?.files?.[0];
  let url = categoryImageUrl?.value.trim();

  // If a local file is selected, preview it (file takes precedence)
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      categoryImagePreview.innerHTML = `<img src="${String(reader.result)}" alt="Preview">`;
    };
    reader.readAsDataURL(file);
    return;
  }

  // If URL is provided, try to preload it and handle errors
  if (url) {
    // Normalize protocol-less URLs (e.g. example.com/image.jpg or //cdn.com/img.png)
    if (url.startsWith('//')) url = `https:${url}`;
    else if (!/^https?:\/\//i.test(url) && url.includes('.')) url = `https://${url}`;

    categoryImagePreview.innerHTML = '<span style="color:var(--color-primary)">Loading preview...</span>';

    const img = new Image();
    let handled = false;
    img.onload = () => {
      if (handled) return;
      handled = true;
      categoryImagePreview.innerHTML = `<img src="${url}" alt="Preview">`;
    };
    img.onerror = () => {
      if (handled) return;
      handled = true;
      categoryImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Failed to load image from URL</span>';
    };
    // Start loading
    try {
      img.src = url;
    } catch (e) {
      console.warn(e);
      categoryImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Invalid image URL</span>';
    }
    return;
  }

  // Default placeholder
  categoryImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span>Category image preview</span>';
}

function updateTrainingImagePreview() {
  const preview = trainImagePreview;
  if (!preview) return;
  const file = trainImageFile?.files?.[0];
  let url = trainImageUrl?.value.trim();

  if (file) {
    const reader = new FileReader();
    trainImagePreviewValid = false;
    reader.onload = () => {
      preview.innerHTML = `<img src="${String(reader.result)}" alt="Preview">`;
      preview.dataset.previewValid = 'true';
      trainImagePreviewValid = true;
      const hidden = document.getElementById('admin-train-image');
      if (hidden) hidden.value = String(reader.result);
    };
    reader.onerror = () => {
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Unable to read image file</span>';
      preview.dataset.previewValid = 'false';
      trainImagePreviewValid = false;
    };
    reader.readAsDataURL(file);
    return;
  }

  if (url) {
    if (url.startsWith('//')) url = `https:${url}`;
    else if (!/^https?:\/\//i.test(url) && !/^data:/i.test(url) && !/^blob:/i.test(url) && url.includes('.')) url = `https://${url}`;

    preview.innerHTML = '<span style="color:var(--color-primary)">Loading preview...</span>';
    preview.dataset.previewValid = 'false';
    trainImagePreviewValid = false;

    const img = new Image();
    let handled = false;
    img.onload = () => {
      if (handled) return;
      handled = true;
      preview.innerHTML = `<img src="${url}" alt="Preview">`;
      preview.dataset.previewValid = 'true';
      trainImagePreviewValid = true;
      const hidden = document.getElementById('admin-train-image');
      if (hidden) hidden.value = url;
    };
    img.onerror = () => {
      if (handled) return;
      handled = true;
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Failed to load image</span>';
      preview.dataset.previewValid = 'false';
      trainImagePreviewValid = false;
    };
    try { img.src = url; } catch (e) {
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Invalid image URL</span>';
      preview.dataset.previewValid = 'false';
      trainImagePreviewValid = false;
    }
    return;
  }

  preview.innerHTML = '<i class="fa-solid fa-image"></i><span>Image preview</span>';
  preview.dataset.previewValid = 'false';
  trainImagePreviewValid = false;
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
}

// -----------------------------
// Weight / Litre pricing row management
// -----------------------------
const WEIGHT_OPTIONS = [
  { value: '100g', label: '100g' },
  { value: '200g', label: '200g' },
  { value: '250g', label: '250g' },
  { value: '400g', label: '400g' },
  { value: '500g', label: '500g' },
  { value: '1kg', label: '1kg' },
  { value: '2kg', label: '2kg' },
  { value: '5kg', label: '5kg' },
];

const LITRE_OPTIONS = [
  { value: '10ml', label: '10ml' },
  { value: '20ml', label: '20ml' },
  { value: '50ml', label: '50ml' },
  { value: '100ml', label: '100ml' },
  { value: '200ml', label: '200ml' },
  { value: '500ml', label: '500ml' },
  { value: '1l', label: '1l' },
  { value: '2l', label: '2l' },
  { value: '5l', label: '5l' },
];

// Weight pill widget helpers
function wpwHTML(selectClass, mode) {
  const groups = [];
  if (!mode || mode === 'weight') groups.push({ label: 'Weight', options: WEIGHT_OPTIONS });
  if (!mode || mode === 'litre') groups.push({ label: 'Volume', options: LITRE_OPTIONS });
  const allOpts = [...WEIGHT_OPTIONS, ...LITRE_OPTIONS];
  return `<div class="wpw">
    <select class="${selectClass}" hidden>
      <option value=""></option>
      ${allOpts.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
    </select>
    <div class="wpw-pills">
      ${groups.map(g => `<div class="wpw-g">
        <span class="wpw-gl">${g.label}</span>
        <div class="wpw-r">${g.options.map(o => `<button type="button" class="wpw-p" data-value="${o.value}">${o.label}</button>`).join('')}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

function wpwAttach(root) {
  root.querySelectorAll('.wpw-p').forEach(p => {
    p.addEventListener('click', () => {
      const w = p.closest('.wpw');
      w.querySelectorAll('.wpw-p.active').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      const s = w.querySelector('select');
      s.value = p.dataset.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

function wpwSetValue(root, value) {
  if (!value) return;
  const key = value.unit === 'kg' || value.unit === 'l' ? `${value.weight}${value.unit}` : `${value.weight}${value.unit}`;
  const s = root.querySelector('select');
  if ([...s.options].some(o => o.value === key)) s.value = key;
  const p = root.querySelector(`.wpw-p[data-value="${key}"]`);
  if (p) p.classList.add('active');
}

function wpwTransformStatic() {
  document.querySelectorAll('.admin-weight-select, .admin-capsule-weight-select').forEach(sel => {
    if (sel.closest('.wpw') || sel.hidden) return;
    const ctr = sel.closest('#admin-capsule-weight-container');
    const mode = ctr?.dataset.mode;
    const wrap = document.createElement('div');
    wrap.className = 'wpw';
    sel.parentNode.insertBefore(wrap, sel);
    sel.hidden = true;
    wrap.appendChild(sel);
    const og = sel.querySelectorAll('optgroup');
    const groups = [];
    if (og.length) {
      og.forEach(g => {
        const label = g.label.replace(/[—\s]/g,'').trim() || 'Options';
        if (mode && ((mode === 'weight' && label !== 'Weight') || (mode === 'litre' && label !== 'Volume'))) return;
        const opts = [];
        g.querySelectorAll('option').forEach(o => { if (o.value) opts.push({ value: o.value, label: o.textContent.trim() }); });
        if (opts.length) groups.push({ label, options: opts });
      });
    } else {
      const w = [], v = [];
      sel.querySelectorAll('option').forEach(o => {
        if (!o.value) return;
        const u = (o.value.match(/[a-z]+$/) || [''])[0];
        ((u === 'g' || u === 'kg') ? w : v).push({ value: o.value, label: o.textContent.trim() });
      });
      if (w.length && (!mode || mode === 'weight')) groups.push({ label: 'Weight', options: w });
      if (v.length && (!mode || mode === 'litre')) groups.push({ label: 'Volume', options: v });
    }
    const pd = document.createElement('div');
    pd.className = 'wpw-pills';
    groups.forEach(g => {
      const gd = document.createElement('div');
      gd.className = 'wpw-g';
      const gl = document.createElement('span');
      gl.className = 'wpw-gl';
      gl.textContent = g.label;
      gd.appendChild(gl);
      const gr = document.createElement('div');
      gr.className = 'wpw-r';
      g.options.forEach(o => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wpw-p' + (o.value === sel.value ? ' active' : '');
        b.dataset.value = o.value;
        b.textContent = o.label.replace(/\s+/g, '');
        gr.appendChild(b);
      });
      gd.appendChild(gr);
      pd.appendChild(gd);
    });
    wrap.appendChild(pd);
  });
  wpwAttach(document.body);
}

function getActivePricingMode() {
  const activeBtn = document.querySelector('.pricing-type-btn.active');
  return activeBtn ? activeBtn.getAttribute('data-mode') : 'weight';
}

async function submitJson(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function buildCategoryBody(editId, { categoryId, id, name, description, image_url }) {
  return editId
    ? { name, description, image_url }
    : { category_id: categoryId, id, name, description, image_url };
}


async function fetchAdminInventory() {
  const grid = document.getElementById('admin-inventory-grid');
  if (grid) {
    grid.innerHTML = '<div class="skeleton-table">' + Array(5).fill(`
      <div class="skeleton-row">
        <span class="skeleton skeleton-avatar"></span>
        <div style="flex:1;"><div class="skeleton skeleton-text"></div></div>
        <div style="width:80px;"><div class="skeleton skeleton-text w-50" style="margin-bottom:0;"></div></div>
      </div>
    `).join('') + '</div>';
  }

  try {
    const products = await fetchWithAuth('/products');
    _adminProducts = products;
    if (statProducts) statProducts.textContent = products.length;
    renderAdminInventory();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err));
    if (grid) {
      grid.innerHTML = '<p style="color:#e74c3c; padding:1rem;">Failed to synchronize active inventory directory.</p>';
    }
  }
}

function variantLabel(v) {
  if (v.unit === 'kg') return `${v.weight} kg`;
  if (v.unit === 'l') return `${v.weight} l`;
  if (v.unit === 'ml') return `${v.weight} ml`;
  return `${v.weight} g`;
}

function renderAdminInventory() {
  const grid = document.getElementById('admin-inventory-grid');
  if (!grid) return;

  const afBar = document.querySelector('#admin-content-products .af-bar');
  const capsuleForm = document.getElementById('admin-capsule-add-form');
  const capsuleCategories = document.getElementById('admin-capsule-categories');
  const capsuleInventory = document.getElementById('admin-capsule-inventory');

  // ── Add Product capsule ────────────────────────
  if (_activeCapsule === 'add-product') {
    if (afBar) afBar.style.display = 'none';
    if (capsuleCategories) capsuleCategories.style.display = 'none';
    if (capsuleInventory) capsuleInventory.style.display = 'none';
    if (capsuleForm) {
      capsuleForm.style.display = 'block';
      populateCapsuleCategorySelect();
    }
    grid.innerHTML = '';
    return;
  }

  // ── Categories capsule ─────────────────────────
  if (_activeCapsule === 'categories') {
    if (afBar) afBar.style.display = 'none';
    if (capsuleForm) capsuleForm.style.display = 'none';
    if (capsuleInventory) capsuleInventory.style.display = 'none';
    if (capsuleCategories) capsuleCategories.style.display = 'block';
    grid.innerHTML = '';
    return;
  }

  // ── Bulk Import capsule ────────────────────────
  if (_activeCapsule === 'bulk-import') {
    if (afBar) afBar.style.display = 'none';
    if (capsuleForm) capsuleForm.style.display = 'none';
    if (capsuleCategories) capsuleCategories.style.display = 'none';
    if (capsuleInventory) capsuleInventory.style.display = 'none';
    const bulkPanel = document.getElementById('admin-capsule-bulk-import');
    if (bulkPanel) bulkPanel.style.display = 'block';
    grid.innerHTML = '';
    return;
  }

  // ── Inventory capsule ──────────────────────────
  if (_activeCapsule === 'inventory') {
    if (afBar) afBar.style.display = 'none';
    if (capsuleForm) capsuleForm.style.display = 'none';
    if (capsuleCategories) capsuleCategories.style.display = 'none';
    if (capsuleInventory) capsuleInventory.style.display = 'block';
    grid.innerHTML = '';
    return;
  }

  // ── Show grid + filter bar, hide inline forms ──
  if (afBar) afBar.style.display = '';
  if (capsuleForm) capsuleForm.style.display = 'none';
  if (capsuleCategories) capsuleCategories.style.display = 'none';
  if (capsuleInventory) capsuleInventory.style.display = 'none';

  const query = (
    document.getElementById('admin-search-prod')?.value || ''
  ).toLowerCase();
  const category = document.getElementById('admin-filter-cat')?.value || 'all';

  let products = _adminProducts;
  if (category !== 'all') products = products.filter((p) => p.category === category);
  if (query) products = products.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(query));

  if (!products.length) {
    grid.innerHTML = '<div class="admin-loading">No products found.</div>';
    return;
  }
  products = applyAdminInventorySort(products);

  // Capsule filtering — recently added: last 5 products with all their variants
  if (_activeCapsule === 'recent') {
    products = products.slice(0, 5);
  }

  // Build a flat row list: one row per variant for multi-variant products
  const rows = [];
  products.forEach(p => {
    const hasWp = Array.isArray(p.weight_pricing) && p.weight_pricing.length > 0;
    if (hasWp) {
      p.weight_pricing.forEach((v, vi) => {
        rows.push({ product: p, variant: v, variantIndex: vi });
      });
    } else {
      rows.push({ product: p, variant: null, variantIndex: -1 });
    }
  });

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / adminInventoryPageSize));
  if (_adminInventoryPage > totalPages) _adminInventoryPage = totalPages;
  const pageStart = (_adminInventoryPage - 1) * adminInventoryPageSize;
  const pageRows = rows.slice(pageStart, pageStart + adminInventoryPageSize);
  const pageEnd = Math.min(pageStart + pageRows.length, totalItems);

  const isRecent = _activeCapsule === 'recent';
  const chevHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  grid.innerHTML = pageRows
    .map((r) => {
      const p = r.product;
      const categoryObj = _adminCategories.find((c) => c.id === p.category);
      const categoryName = categoryObj ? categoryObj.name : 'Unknown';
      const isVariant = r.variant !== null;

      if (isVariant) {
        const v = r.variant;
        const vLabel = variantLabel(v);
        const vStock = v.stock ?? 0;
        return `
      <div class="ac-card ${isRecent ? 'ac-card--recent' : ''}" data-id="${p.id}" data-variant="${r.variantIndex}">
        <div class="ac-row">
          <img class="ac-thumb" src="${p.image_url}" alt="${p.name}">
          <span class="ac-title">${p.name} — ${vLabel}</span>
          <span class="ac-meta">${categoryName}</span>
          <span class="ac-prod-price">₹${v.price.toFixed(2)}${v.mrp_price ? ` <span class="ac-mrp-strike">₹${v.mrp_price.toFixed(2)}</span>` : ''}</span>
          <span class="ac-prod-gst">GST ${p.gst_rate}%</span>
          <span class="ac-prod-stock">Stock: ${vStock}</span>
          <div class="ac-actions">
            <button class="ac-btn-edit" onclick="event.stopPropagation();globalThis.adminEditProduct('${p.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
            <button class="ac-btn-del" onclick="event.stopPropagation();globalThis.adminDeleteProduct('${p.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      </div>`;
      }

      const invThreshold = p.low_stock_threshold || 10;
      return `
      <div class="ac-card ${isRecent ? 'ac-card--recent' : ''}" data-id="${p.id}">
        <div class="ac-row" onclick="globalThis.toggleOrderExpand(this)">
          <img class="ac-thumb" src="${p.image_url}" alt="${p.name}">
          <span class="ac-title">${p.name}</span>
          <span class="ac-meta">${categoryName}</span>
          <span class="ac-prod-price">₹${(p.price || 0).toFixed(2)}${p.mrp_price ? ` <span class="ac-mrp-strike">₹${p.mrp_price.toFixed(2)}</span>` : ''}</span>
          <span class="ac-prod-gst">GST ${p.gst_rate}%</span>
          <span class="ac-prod-stock" style="color:${(p.stock || 0) === 0 ? 'var(--color-red, #ef4444)' : (p.stock || 0) <= invThreshold ? 'var(--color-yellow, #f59e0b)' : 'inherit'};">${(p.stock || 0) === 0 ? '🔴 Out of Stock' : (p.stock || 0) <= invThreshold ? `🟡 Low: ${p.stock}` : `✅ Stock: ${p.stock}`}</span>
          <div class="ac-actions">
            <button class="ac-btn-edit" onclick="event.stopPropagation();globalThis.adminEditProduct('${p.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
            <button class="ac-btn-del" onclick="event.stopPropagation();globalThis.adminDeleteProduct('${p.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
          <span class="ac-chev">${chevHtml}</span>
        </div>
        <div class="ac-detail" style="max-height:0;opacity:0;">
          <div class="ac-detail-inner">
            <p><strong>ID:</strong> ${p.id}</p>
            <p>${p.description}</p>
          </div>
        </div>
      </div>`;
    })
    .join('') + (!isRecent ? `
    <div class="admin-pagination" style="margin-top:12px;">
      <div class="admin-pagination-info">Showing ${pageStart + 1}–${pageEnd} of ${totalItems} item${totalItems > 1 ? 's' : ''}</div>
      <div class="admin-pagination-actions">
        <button type="button" class="btn-pagination" id="admin-page-prev" ${_adminInventoryPage === 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <div class="admin-page-jump">
          <input type="text" id="admin-go-to-page" class="admin-go-page-input" inputmode="numeric" placeholder="Go to" />
          <span class="admin-pagination-label">Page ${_adminInventoryPage} of ${totalPages}</span>
        </div>
        <button type="button" class="btn-pagination" id="admin-page-next" ${_adminInventoryPage === totalPages ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        <select id="admin-inventory-page-size" class="pagination-page-size" title="Page size">
          <option value="10"${adminInventoryPageSize === 10 ? ' selected' : ''}>10 / page</option>
          <option value="20"${adminInventoryPageSize === 20 ? ' selected' : ''}>20 / page</option>
          <option value="50"${adminInventoryPageSize === 50 ? ' selected' : ''}>50 / page</option>
        </select>
      </div>
    </div>` : '');

  const goToInput = document.getElementById('admin-go-to-page');
  if (goToInput) goToInput.value = '';

  // ── Capsule pagination event listeners ──
  const prevBtn = document.getElementById('admin-page-prev');
  const nextBtn = document.getElementById('admin-page-next');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (_adminInventoryPage > 1) {
        _adminInventoryPage -= 1;
        renderAdminInventory();
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (_adminInventoryPage < totalPages) {
        _adminInventoryPage += 1;
        renderAdminInventory();
      }
    });
  }
  const pageSizeSelect = document.getElementById('admin-inventory-page-size');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      const v = Number.parseInt(pageSizeSelect.value, 10) || 10;
      adminInventoryPageSize = v;
      _adminInventoryPage = 1;
      renderAdminInventory();
    });
  }
}

/* ── Gallery helpers ─────────────────────────── */
function getGalleryUrlInputs(containerId) {
  const grid = document.getElementById(containerId);
  return grid ? [...grid.querySelectorAll('.gallery-url-input')] : [];
}

function getGalleryUrls(containerId) {
  return getGalleryUrlInputs(containerId)
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

function updateGalleryCount(containerId, badgeId) {
  const urls = getGalleryUrls(containerId);
  const badge = document.getElementById(badgeId);
  if (badge) badge.textContent = `${urls.length} / 3 min`;
}

/* ── Premium Gallery Reset ────────────────────── */
function resetPremiumGallery() {
  const grid = document.getElementById('capsule-gallery-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="premium-gallery-slot" data-slot="0">
      <div class="gallery-placeholder"><i class="fa-regular fa-image"></i><span>#1</span></div>
      <input type="url" class="gallery-url-input gallery-input-hidden" data-slot="0" />
      <button type="button" class="gallery-remove-overlay" data-slot="0" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  const badge = document.getElementById('capsule-gallery-count-badge');
  if (badge) badge.textContent = '0 / 3 min';
}

/* ── Live total stock helpers ─────────────────── */
function updateCapsuleTotalStock() {
  const container = document.getElementById('admin-capsule-weight-container');
  const totalEl = document.getElementById('admin-capsule-total-stock');
  if (!container || !totalEl) return;
  let total = 0;
  container.querySelectorAll('.admin-weight-stock').forEach(inp => {
    const v = parseInt(inp.value, 10);
    if (Number.isFinite(v) && v > 0) total += v;
  });
  totalEl.textContent = total;
}

// Delegate input events for capsule stock container
document.addEventListener('input', (ev) => {
  const target = ev.target;
  if (target.classList.contains('admin-weight-stock') && target.closest('#admin-capsule-weight-container')) {
    updateCapsuleTotalStock();
  }
});

/* ── Capsule add‑product form helpers ──────────── */
function populateCapsuleCategorySelect() {
  const sel = document.getElementById('admin-capsule-prod-category');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select a category</option>';
  (_adminCategories || []).forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });
}

function resetCapsuleAddForm() {
  const form = document.getElementById('form-admin-capsule-add');
  if (form) form.reset();
  // Reset edit mode
  document.getElementById('admin-capsule-edit-id').value = '';
  const titleEl = document.getElementById('capsule-form-title');
  if (titleEl) titleEl.textContent = 'Publish New Product';
  const subEl = document.getElementById('capsule-form-subtitle');
  if (subEl) subEl.textContent = 'Fill in the details below to list a new mushroom product';
  const label = document.getElementById('capsule-submit-label');
  if (label) label.textContent = 'Publish Product';
  const pricingTypeWeight = document.querySelector('.pricing-type-btn[data-mode="weight"]');
  const pricingTypeLitre = document.querySelector('.pricing-type-btn[data-mode="litre"]');
  if (pricingTypeWeight) pricingTypeWeight.classList.add('active');
  if (pricingTypeLitre) pricingTypeLitre.classList.remove('active');
  populateCapsuleCategorySelect();
  const preview = document.getElementById('admin-capsule-img-preview');
  if (preview) {
    preview.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i><span>Drop an image here or click to browse</span><small>Supports JPG, PNG, WebP</small>';
  }
  const zone = document.getElementById('capsule-image-zone');
  if (zone) zone.classList.remove('has-image');
  const overlay = zone?.querySelector('.premium-img-overlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('admin-capsule-edit-id').value = '';
  document.getElementById('capsule-image-url-input').value = '';
  const wc = document.getElementById('admin-capsule-weight-container');
  if (wc) {
    wc.innerHTML = `
      <div class="premium-weight-row">
        ${wpwHTML('admin-capsule-weight-select pw-select')}
        <div class="premium-weight-fields">
          <div class="pw-field">
            <label>Selling Price</label>
            <input type="number" step="0.01" class="admin-capsule-weight-price" placeholder="0.00" />
          </div>
          <div class="pw-field">
            <label>MRP</label>
            <input type="number" step="0.01" class="admin-capsule-weight-mrp" placeholder="0.00" />
          </div>
          <div class="pw-field">
            <label>Stock</label>
            <input type="number" class="admin-capsule-weight-stock admin-weight-stock" placeholder="0" min="0" />
          </div>
        </div>
        <button type="button" class="premium-weight-remove"><i class="fa-solid fa-xmark"></i></button>
      </div>`;
    wpwAttach(wc);
  }
  updateCapsuleTotalStock();
  resetPremiumGallery();
  const fb = document.getElementById('admin-capsule-add-feedback');
  if (fb) { fb.classList.add('hidden'); fb.textContent = ''; }
  // Reset new fields
  const manEl = document.getElementById('admin-capsule-prod-manufacturer');
  if (manEl) manEl.value = 'Shriyap Enterprises, Basavura Village Davangere';
  const sciEl = document.getElementById('admin-capsule-prod-sci-name');
  if (sciEl) sciEl.value = '';
  const shelfEl = document.getElementById('admin-capsule-prod-shelf-life');
  if (shelfEl) shelfEl.value = '';
  const seoTitleEl = document.getElementById('admin-capsule-prod-seo-title');
  if (seoTitleEl) seoTitleEl.value = '';
  const seoSlugEl = document.getElementById('admin-capsule-prod-seo-slug');
  if (seoSlugEl) seoSlugEl.value = '';
}

async function handleCapsuleAddSubmit(e) {
  e.preventDefault();
  const feedback = document.getElementById('admin-capsule-add-feedback');
  if (feedback) { feedback.classList.add('hidden'); feedback.textContent = ''; }

  const categoryId = document.getElementById('admin-capsule-prod-category')?.value;
  const name = document.getElementById('admin-capsule-prod-name')?.value.trim();
  const desc = document.getElementById('admin-capsule-prod-desc')?.value.trim();
  const gstRate = parseFloat(document.getElementById('admin-capsule-prod-gst')?.value || '5');

  if (!categoryId || !name || !desc) {
    if (feedback) { feedback.textContent = 'Please fill in all required fields.'; feedback.classList.remove('hidden'); }
    return;
  }

  // Gather weight rows
  const weightContainer = document.getElementById('admin-capsule-weight-container');
  const weightPricing = [];
  if (weightContainer) {
    weightContainer.querySelectorAll('.premium-weight-row').forEach(row => {
      const w = row.querySelector('.admin-capsule-weight-select')?.value;
      const price = parseFloat(row.querySelector('.admin-capsule-weight-price')?.value);
      const mrp = parseFloat(row.querySelector('.admin-capsule-weight-mrp')?.value);
      const stockVal = row.querySelector('.admin-capsule-weight-stock')?.value;
      if (w && !isNaN(price)) {
        const match = w.match(/^(\d+)(g|kg|ml|l)$/);
        if (match) {
          weightPricing.push({
            weight: parseInt(match[1], 10),
            unit: match[2],
            price,
            mrp_price: isNaN(mrp) ? undefined : mrp,
            stock: stockVal ? parseInt(stockVal, 10) : 0,
          });
        }
      }
    });
  }

  if (!weightPricing.length) {
    if (feedback) { feedback.textContent = 'Add at least one weight variant with a price.'; feedback.classList.remove('hidden'); }
    return;
  }

  // Check for duplicate weight variants within this product
  const weightKeys = weightPricing.map(w => `${w.weight}${w.unit}`);
  if (new Set(weightKeys).size !== weightKeys.length) {
    if (feedback) { feedback.textContent = 'Duplicate variants are not allowed. Each option can only be added once per product.'; feedback.classList.remove('hidden'); }
    return;
  }

  // Ensure all variants use the same unit type
  const unitTypes = new Set(weightPricing.map(w => (w.unit === 'g' || w.unit === 'kg') ? 'weight' : 'litre'));
  if (unitTypes.size > 1) {
    if (feedback) { feedback.textContent = 'Cannot mix weight (g/kg) and litre (ml/l) units in the same product.'; feedback.classList.remove('hidden'); }
    return;
  }

  // Helper to convert to base unit for sorting
  function toBaseValue(weight, unit) {
    if (unit === 'kg' || unit === 'l') return weight * 1000;
    return weight;
  }

  // Ensure prices increase with quantity
  const sorted = [...weightPricing].sort((a, b) => toBaseValue(a.weight, a.unit) - toBaseValue(b.weight, b.unit));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].price <= sorted[i - 1].price) {
      const prevLabel = `${sorted[i - 1].weight}${sorted[i - 1].unit}`;
      const currLabel = `${sorted[i].weight}${sorted[i].unit}`;
      if (feedback) { feedback.textContent = `Price for ${currLabel} (₹${sorted[i].price}) must be higher than price for ${prevLabel} (₹${sorted[i - 1].price}). Larger quantities must cost more.`; feedback.classList.remove('hidden'); }
      return;
    }
  }

  // Ensure MRP is provided and > price for every variant (mandatory by law)
  for (const v of weightPricing) {
    if (v.mrp_price == null || isNaN(v.mrp_price)) {
      const label = `${v.weight}${v.unit}`;
      if (feedback) { feedback.textContent = `MRP (Maximum Retail Price) is mandatory for ${label}. Please enter a valid MRP as required by law.`; feedback.classList.remove('hidden'); }
      return;
    }
    if (v.mrp_price <= v.price) {
      const label = `${v.weight}${v.unit}`;
      if (feedback) { feedback.textContent = `MRP (₹${v.mrp_price}) for ${label} must be greater than the selling price (₹${v.price}).`; feedback.classList.remove('hidden'); }
      return;
    }
  }

  // Check for duplicate product name within the same category
  const editId = document.getElementById('admin-capsule-edit-id')?.value || '';
  const isEdit = Boolean(editId);
  const nameDup = _adminProducts.find(p =>
    p.name.toLowerCase() === name.toLowerCase() &&
    p.category === categoryId &&
    p.id !== editId
  );
  if (nameDup) {
    const catName = _adminCategories.find(c => c.id === categoryId)?.name || categoryId;
    if (feedback) { feedback.textContent = `A product named "${name}" already exists in the "${catName}" category.`; feedback.classList.remove('hidden'); }
    return;
  }

  let imageUrl = document.getElementById('admin-capsule-prod-image-url')?.value.trim() || '';
  const capsuleImageFile = document.querySelector('.admin-capsule-image-file');
  const imageFile = capsuleImageFile?.files?.[0];
  if (imageFile) {
    try {
      imageUrl = await readFileAsDataUrl(imageFile);
    } catch {
      // fall back to URL value if file read fails
    }
  }
  const galleryUrls = getGalleryUrls('capsule-gallery-grid');

  // Product details fields
  const rawHighlights = document.getElementById('admin-capsule-prod-highlights')?.value.trim() || '';
  const highlights = rawHighlights ? rawHighlights.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const storageHandling = document.getElementById('admin-capsule-prod-storage')?.value.trim() || '';
  const warrantyPolicy = document.getElementById('admin-capsule-prod-warranty')?.value.trim() || '';
  const returnPolicy = document.getElementById('admin-capsule-prod-returns')?.value.trim() || '';
  const shippingInfo = document.getElementById('admin-capsule-prod-shipping')?.value.trim() || '';
  const complianceInfo = document.getElementById('admin-capsule-prod-compliance')?.value.trim() || '';
  const manufacturerSupplier = document.getElementById('admin-capsule-prod-manufacturer')?.value.trim() || '';
  const scientificName = document.getElementById('admin-capsule-prod-sci-name')?.value.trim() || '';
  const shelfLife = document.getElementById('admin-capsule-prod-shelf-life')?.value.trim() || '';
  const seoTitle = document.getElementById('admin-capsule-prod-seo-title')?.value.trim() || '';
  const seoSlug = document.getElementById('admin-capsule-prod-seo-slug')?.value.trim() || '';
  const rawCerts = document.getElementById('admin-capsule-prod-certificates')?.value.trim() || '';
  const certificates = rawCerts ? rawCerts.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < line.length - 1) {
      const icon = line.slice(0, colonIdx).trim();
      const label = line.slice(colonIdx + 1).trim();
      return { icon: `fa-solid fa-${icon.replace(/^fa-solid\s+fa-/i, '').replace(/^fa-/i, '')}`, label };
    }
    return { icon: 'fa-solid fa-certificate', label: line };
  }) : [];

  const payload = {
    category: categoryId,
    name,
    description: desc,
    gst_rate: gstRate,
    weight_pricing: weightPricing,
    image_urls: galleryUrls,
    storage_handling: storageHandling,
    warranty_policy: warrantyPolicy,
    return_policy: returnPolicy,
    shipping_info: shippingInfo,
    compliance_info: complianceInfo,
    highlights,
    certificates,
    manufacturer_supplier: manufacturerSupplier || 'Shriyap Enterprises, Basavura Village Davangere',
    scientific_name: scientificName || null,
    shelf_life: shelfLife || null,
    seo_title: seoTitle || null,
    seo_slug: seoSlug || null,
  };
  if (imageUrl) payload.image_url = imageUrl;

  if (isEdit) payload.id = editId;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetchWithAuth(isEdit ? `/products/${editId}` : '/products', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showSuccessToast(isEdit ? 'Product updated successfully' : 'Product added successfully');
    resetCapsuleAddForm();
    // Refresh product list
    _adminProducts = await fetchWithAuth('/products');
    // Switch back to All Products capsule
    document.querySelectorAll('.admin-capsule').forEach(b => b.classList.remove('active'));
    const allBtn = document.querySelector('.admin-capsule[data-capsule="all"]');
    if (allBtn) allBtn.classList.add('active');
    _activeCapsule = 'all';
    _adminInventoryPage = 1;
    renderAdminInventory();
  } catch (err) {
    if (feedback) { feedback.textContent = getApiErrorMessage(err); feedback.classList.remove('hidden'); }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function adminEditProduct(productId) {
  const product = _adminProducts.find((item) => item.id === productId);
  if (!product) return;

  // Stay on Products tab and switch to add-product capsule
  activateAdminTab('products');
  document.querySelectorAll('.admin-capsule').forEach(b => b.classList.remove('active'));
  const addCapsule = document.querySelector('.admin-capsule[data-capsule="add-product"]');
  if (addCapsule) addCapsule.classList.add('active');
  _activeCapsule = 'add-product';
  resetCapsuleAddForm();
  renderAdminInventory();

  // Set edit mode
  document.getElementById('admin-capsule-edit-id').value = product.id;
  document.getElementById('admin-capsule-prod-category').value = product.category;
  document.getElementById('admin-capsule-prod-name').value = product.name;
  document.getElementById('admin-capsule-prod-desc').value = product.description;
  document.getElementById('admin-capsule-prod-gst').value = String(product.gst_rate);
  populateCapsuleCategorySelect();
  if (document.getElementById('admin-capsule-prod-category')) {
    document.getElementById('admin-capsule-prod-category').value = product.category;
  }

  // Update header
  const titleEl = document.getElementById('capsule-form-title');
  if (titleEl) titleEl.textContent = 'Edit Product';
  const subEl = document.getElementById('capsule-form-subtitle');
  if (subEl) subEl.textContent = 'Update the product details below';

  // Update submit button label
  const label = document.getElementById('capsule-submit-label');
  if (label) label.textContent = 'Update Product';

  // Main image
  const capsuleImageUrl = document.getElementById('admin-capsule-prod-image-url');
  if (capsuleImageUrl) capsuleImageUrl.value = product.image_url || '';
  const capsulePreview = document.getElementById('admin-capsule-img-preview');
  if (capsulePreview && product.image_url) {
    capsulePreview.innerHTML = `<img src="${product.image_url}" alt="Preview">`;
  }
  const capsuleZone = document.getElementById('capsule-image-zone');
  if (capsuleZone && product.image_url) capsuleZone.classList.add('has-image');
  const capsuleOverlay = capsuleZone?.querySelector('.premium-img-overlay');
  if (capsuleOverlay && product.image_url) capsuleOverlay.style.display = '';

  // Load weight pricing into capsule form
  const wc = document.getElementById('admin-capsule-weight-container');
  if (wc && product.weight_pricing && product.weight_pricing.length > 0) {
    wc.innerHTML = '';
    product.weight_pricing.forEach((v, i) => {
      const unitLabel = v.unit === 'kg' ? 'kg' : v.unit === 'l' ? 'l' : v.unit === 'ml' ? 'ml' : 'g';
      const optVal = v.unit === 'kg' || v.unit === 'l' ? `${v.weight}${unitLabel}` : `${v.weight}${unitLabel}`;
      const row = document.createElement('div');
      row.className = 'premium-weight-row';
      row.innerHTML = `
        <select class="admin-capsule-weight-select pw-select">
          <option value="">Select weight / volume</option>
          <optgroup label="— Weight —">
            <option value="100g">100 g</option>
            <option value="200g">200 g</option>
            <option value="250g">250 g</option>
            <option value="400g">400 g</option>
            <option value="500g">500 g</option>
            <option value="1kg">1 kg</option>
            <option value="2kg">2 kg</option>
            <option value="5kg">5 kg</option>
          </optgroup>
          <optgroup label="— Volume —">
            <option value="10ml">10 ml</option>
            <option value="20ml">20 ml</option>
            <option value="50ml">50 ml</option>
            <option value="100ml">100 ml</option>
            <option value="200ml">200 ml</option>
            <option value="500ml">500 ml</option>
            <option value="1l">1 l</option>
            <option value="2l">2 l</option>
            <option value="5l">5 l</option>
          </optgroup>
        </select>
        <div class="premium-weight-fields">
          <div class="pw-field">
            <label>Selling Price</label>
            <input type="number" step="0.01" class="admin-capsule-weight-price" value="${v.price}" />
          </div>
          <div class="pw-field">
            <label>MRP</label>
            <input type="number" step="0.01" class="admin-capsule-weight-mrp" value="${v.mrp_price || ''}" />
          </div>
          <div class="pw-field">
            <label>Stock</label>
            <input type="number" class="admin-capsule-weight-stock admin-weight-stock" value="${v.stock || 0}" min="0" />
          </div>
        </div>
        <button type="button" class="premium-weight-remove"><i class="fa-solid fa-xmark"></i></button>`;
      wc.appendChild(row);
      const sel = row.querySelector('.admin-capsule-weight-select');
      if (sel) sel.value = optVal;
    });
    wpwAttach(wc);
    updateCapsuleTotalStock();
    // Set pricing type toggle based on unit
    const unit = product.weight_pricing[0]?.unit;
    if (unit === 'ml' || unit === 'l') {
      const litreBtn = document.querySelector('.pricing-type-btn[data-mode="litre"]');
      const weightBtn = document.querySelector('.pricing-type-btn[data-mode="weight"]');
      if (litreBtn) litreBtn.classList.add('active');
      if (weightBtn) weightBtn.classList.remove('active');
    }
  }

  // Load gallery images into capsule gallery
  const galleryUrls = product.image_urls || [];
  const capsuleGalleryGrid = document.getElementById('capsule-gallery-grid');
  if (capsuleGalleryGrid) {
    capsuleGalleryGrid.innerHTML = '';
    galleryUrls.forEach((url, i) => {
      const slot = document.createElement('div');
      slot.className = 'premium-gallery-slot';
      slot.dataset.slot = i;
      slot.innerHTML = `
        <div class="gallery-placeholder" style="display:none;"><i class="fa-regular fa-image"></i><span>#${i + 1}</span></div>
        <input type="url" class="gallery-url-input gallery-input-hidden" value="${url}" data-slot="${i}" />
        <button type="button" class="gallery-remove-overlay" data-slot="${i}"><i class="fa-solid fa-xmark"></i></button>`;
      capsuleGalleryGrid.appendChild(slot);
    });
  }
  updateGalleryCount('capsule-gallery-grid', 'capsule-gallery-count-badge');

  // Load product details fields
  const highlightsEl = document.getElementById('admin-capsule-prod-highlights');
  if (highlightsEl) highlightsEl.value = (product.highlights || []).join('\n');
  const storageEl = document.getElementById('admin-capsule-prod-storage');
  if (storageEl) storageEl.value = product.storage_handling || '';
  const warrantyEl = document.getElementById('admin-capsule-prod-warranty');
  if (warrantyEl) warrantyEl.value = product.warranty_policy || '';
  const returnsEl = document.getElementById('admin-capsule-prod-returns');
  if (returnsEl) returnsEl.value = product.return_policy || '';
  const shippingEl = document.getElementById('admin-capsule-prod-shipping');
  if (shippingEl) shippingEl.value = product.shipping_info || '';
  const complianceEl = document.getElementById('admin-capsule-prod-compliance');
  if (complianceEl) complianceEl.value = product.compliance_info || '';
  const certsEl = document.getElementById('admin-capsule-prod-certificates');
  if (certsEl) certsEl.value = (product.certificates || []).map(c => {
    const iconPart = c.icon ? c.icon.replace(/^fa-solid\s+fa-/i, '').replace(/^fa-/i, '') : '';
    return iconPart && iconPart !== 'certificate' ? `${iconPart}:${c.label}` : c.label;
  }).join('\n');

  // New fields
  const manEl = document.getElementById('admin-capsule-prod-manufacturer');
  if (manEl) manEl.value = product.manufacturer_supplier || 'Shriyap Enterprises, Basavura Village Davangere';
  const sciEl = document.getElementById('admin-capsule-prod-sci-name');
  if (sciEl) sciEl.value = product.scientific_name || '';
  const shelfEl = document.getElementById('admin-capsule-prod-shelf-life');
  if (shelfEl) shelfEl.value = product.shelf_life || '';
  const seoTitleEl = document.getElementById('admin-capsule-prod-seo-title');
  if (seoTitleEl) seoTitleEl.value = product.seo_title || '';
  const seoSlugEl = document.getElementById('admin-capsule-prod-seo-slug');
  if (seoSlugEl) seoSlugEl.value = product.seo_slug || '';
}



async function fetchAdminOrders() {
  const list = document.getElementById('admin-orders-list');
  if (list) list.innerHTML = '<div class="skeleton-table">' + Array(5).fill(`
    <div class="skeleton-row">
      <span class="skeleton skeleton-avatar"></span>
      <div style="flex:1;">
        <div class="skeleton skeleton-text w-60"></div>
        <div class="skeleton skeleton-text w-40" style="height:0.75rem;"></div>
      </div>
      <div style="width:100px;"><div class="skeleton skeleton-text w-50" style="margin-bottom:0;"></div></div>
    </div>
  `).join('') + '</div>';
  try {
    const orders = await fetchWithAuth('/orders/all-orders');
    if (!Array.isArray(orders)) {
      throw new TypeError('Invalid orders response');
    }
    if (statOrders) statOrders.textContent = orders.length;
    adminOrdersCache = orders;

    // Update nav badge with fresh (placed) orders count
    const refundExclude = ['CANCEL_REQUESTED','CANCEL_APPROVED','CANCEL_REJECTED','REFUND_PENDING','REFUND_INITIATED','REFUND_PROCESSING','REFUND_COMPLETED','REFUND_FAILED','MANUAL_REFUND_INITIATED','MANUAL_REFUND_COMPLETED'];
    const freshOrders = orders.filter(o => o.delivery_status === 'placed' && o.status === 'paid' && o.admin_approval_status === 'approved' && !refundExclude.includes(o.status));
    const badge = document.getElementById('admin-orders-cancel-badge');
    if (badge) {
      if (freshOrders.length > 0) {
        badge.textContent = freshOrders.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    updateSectionCounts(orders);
    renderCurrentSection();
    renderAdminHistory();

    // Also fetch shipments for the Shipments tab and order card enrichment
    try {
      const shipmentData = await fetchWithAuth('/shipping/all');
      if (Array.isArray(shipmentData)) {
        adminShipmentsCache = shipmentData;
      } else {
        adminShipmentsCache = [];
      }
    } catch (e) {
      adminShipmentsCache = [];
    }
  } catch (err) {
    showErrorToast(getApiErrorMessage(err));
    if (list) list.innerHTML = '<div class="admin-loading" style="color:#e74c3c;"></div>';
  }
}

function toggleOrderExpand(rowEl) {
  const card = rowEl.closest('.aoc-card, .ac-card');
  if (!card) return;
  const detail = card.querySelector('.aoc-detail');
  if (!detail) return;
  const isOpen = card.classList.contains('aoc-expanded');
  if (isOpen) {
    card.classList.remove('aoc-expanded');
    detail.style.maxHeight = '0';
    detail.style.opacity = '0';
  } else {
    card.classList.add('aoc-expanded');
    detail.style.maxHeight = detail.scrollHeight + 'px';
    detail.style.opacity = '1';
  }
}
globalThis.toggleOrderExpand = toggleOrderExpand;

function renderAdminOrders(orders) {
  const wrap = document.getElementById('admin-orders-list');
  if (!wrap) return;
  if (!orders.length) {
    wrap.innerHTML = '<div class="admin-loading">No orders found.</div>';
    return;
  }

  // Prepend Pending Cancellations section if any exist (scan full cache, not just filtered list)
  const pendingCancels = (adminOrdersCache || []).filter(o => o.status === 'CANCEL_REQUESTED' || o.delivery_status === 'CANCEL_REQUESTED');
  let pendingSectionHtml = '';
  if (pendingCancels.length > 0) {
    pendingSectionHtml = `
      <div class="admin-pending-cancellations" style="background:#fffbeb;border:1.5px solid #fef3c7;border-radius:12px;padding:16px;margin-bottom:20px;box-shadow:var(--shadow-sm);">
        <h4 style="margin:0 0 12px;color:#d97706;display:flex;align-items:center;gap:8px;font-size:0.95rem;font-weight:700;">
          <i class="fa-solid fa-triangle-exclamation"></i> Pending Cancellation Requests (${pendingCancels.length})
        </h4>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${pendingCancels.map(o => `
            <div style="display:flex;justify-content:space-between;align-items:center;background:#ffffff;border:1px solid #fde68a;border-radius:8px;padding:12px;flex-wrap:wrap;gap:12px;">
              <div>
                <strong style="color:#1f2937;font-size:0.88rem;">Order #${o.id}</strong>
                <span style="color:#4b5563;font-size:0.83rem;margin-left:6px;">by ${o.customer_name || o.user_email || 'Customer'}</span>
                <div style="font-size:0.8rem;color:#6b7280;margin-top:4px;">
                  <strong>Reason:</strong> <span style="font-style:italic;">"${o.cancel_reason || 'No reason provided'}"</span>
                </div>
              </div>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-primary" style="background:#d97706;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminApproveRefundModal('${o.id}')">
                  <i class="fa-solid fa-check"></i> Initiate Refund
                </button>
                <button class="btn btn-cancel" style="padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminRejectRefundModal('${o.id}')">
                  <i class="fa-solid fa-xmark"></i> Reject
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const listHtml = orders
    .map((o) => {
      const date = new Date(o.created_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      });
      const customerName = o.customer_name || o.user_email || 'Customer';
      const phone = o.delivery_phone || 'Not specified';
      const address = o.delivery_address || 'Address not provided';
      const itemRows = Array.isArray(o.items)
        ? o.items
          .map(
            (item) => `
          <li>${item.name} × ${item.quantity}</li>
        `,
          )
          .join('')
        : '';
      const productDisplay = o.items && o.items.length > 1
        ? `
      <details class="aoc-prod-details">
        <summary>${o.items.length} items</summary>
        <ul>${itemRows}</ul>
      </details>
    `
        : `
      <div class="aoc-prod-list">${itemRows}</div>
    `;

      const fulfillmentSteps = ['pending_fulfillment', 'packing_required', 'packed', 'pending_dispatch', 'with_carrier', 'delivered'];
      const fulfillmentLabels = {
        pending_fulfillment: 'Pending',
        packing_required: 'Packing',
        packed: 'Packed',
        pending_dispatch: 'Pending Dispatch',
        with_carrier: 'With Carrier',
        delivered: 'Delivered',
      };
      const currentFulfillmentStage = fulfillmentSteps.indexOf(o.fulfillment_status || 'pending_fulfillment');
      const progressSteps = fulfillmentSteps
        .map(
          (step, index) => `
      <div class="aoc-pstep ${index <= currentFulfillmentStage ? 'aoc-pstep--active' : ''}" title="${fulfillmentLabels[step] || step}"></div>
      ${index < fulfillmentSteps.length - 1 ? `<div class="aoc-pline ${index < currentFulfillmentStage ? 'aoc-pline--fill' : ''}"></div>` : ''}
    `,
        )
        .join('');

      const invoiceLink = o.invoice_token
        ? `${API_BASE}/orders/share/${o.invoice_token}`
        : '';

      const statusEmoji = {
        placed: '📋',
        processing: '⚙️',
        inoculating: '🧪',
        shipped: '📦',
        in_transit: '🚚',
        delivered: '✅',
        cancelled: '❌',
      };

      const manualRefundStatuses = ['MANUAL_REFUND_INITIATED', 'MANUAL_REFUND_COMPLETED'];
      const refundStatuses = ['REFUND_PENDING', 'REFUND_INITIATED', 'REFUND_PROCESSING', 'REFUND_COMPLETED', 'REFUND_FAILED', ...manualRefundStatuses];
      const cancelStatuses = ['CANCEL_REQUESTED', 'CANCEL_APPROVED', 'CANCEL_REJECTED'];
      const isCancelRequested = o.status === 'CANCEL_REQUESTED' || o.delivery_status === 'CANCEL_REQUESTED';
      const isRefundState = refundStatuses.includes(o.status);
      const isCancelState = cancelStatuses.includes(o.status);

      function getAdminBadge(status, refundStatus) {
        const map = {
          'CANCEL_REQUESTED': { bg: '#fffbeb', color: '#d97706', label: '⚠️ Cancel Requested' },
          'CANCEL_APPROVED': { bg: '#ecfdf5', color: '#10b981', label: '✅ Cancel Approved' },
          'CANCEL_REJECTED': { bg: '#fef2f2', color: '#ef4444', label: '❌ Cancel Rejected' },
          'REFUND_PENDING': { bg: '#eff6ff', color: '#3b82f6', label: '🔄 Refund Pending' },
          'REFUND_INITIATED': { bg: '#f5f3ff', color: '#8b5cf6', label: '🔄 Refund Initiated' },
          'REFUND_PROCESSING': { bg: '#f5f3ff', color: '#8b5cf6', label: '🔄 Refund Processing' },
          'REFUND_COMPLETED': { bg: '#ecfdf5', color: '#10b981', label: '✅ Refund Completed' },
          'REFUND_FAILED': { bg: '#fef2f2', color: '#ef4444', label: '❌ Refund Failed' },
          'MANUAL_REFUND_INITIATED': { bg: '#fffbeb', color: '#d97706', label: '🔄 Manual Refund Initiated' },
          'MANUAL_REFUND_COMPLETED': { bg: '#ecfdf5', color: '#10b981', label: '✅ Manual Refund Completed' },
          'admin_pending': { bg: '#fffbeb', color: '#d97706', label: '⚠️ Pending Admin' },
          'admin_rejected': { bg: '#fef2f2', color: '#ef4444', label: '❌ Admin Rejected' },
          'self_cancelled': { bg: '#fef2f2', color: '#ef4444', label: '❌ Self Cancelled' },
          'cancellation_window': { bg: '#fffbeb', color: '#d97706', label: '⏳ Cancel Window' },
          'window_closed': { bg: '#f1f5f9', color: '#64748b', label: '🔒 Window Closed' },
          'return_window': { bg: '#ecfdf5', color: '#10b981', label: '📦 Return Window' },
          'order_created': { bg: '#ecfdf5', color: '#10b981', label: '🆕 Order Created' },
          'payment_verified': { bg: '#eff6ff', color: '#3b82f6', label: '✅ Payment Verified' },
          'approved': { bg: '#ecfdf5', color: '#10b981', label: '✅ Approved' },
        };
        // Handle new manual refund flow (status=cancelled, tracked via refund_status)
        if (status === 'cancelled' && refundStatus) {
          const refundMap = {
            'pending': { bg: '#eff6ff', color: '#3b82f6', label: '🔄 Refund Pending' },
            'initiated': { bg: '#f5f3ff', color: '#8b5cf6', label: '🔄 Refund Initiated' },
            'processing': { bg: '#f5f3ff', color: '#8b5cf6', label: '🔄 Refund Processing' },
            'completed': { bg: '#ecfdf5', color: '#10b981', label: '✅ Refund Completed' },
          };
          return refundMap[refundStatus] || null;
        }
        return map[status] || null;
      }

      let badgeHtml;
      if (isCancelRequested) {
        badgeHtml = `<span class="aoc-badge aoc-badge--warning" style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;font-weight:700;">⚠️ Cancel Requested</span>`;
      } else if (o.status === 'cancelled' && o.refund_status && o.refund_status !== 'none') {
        const b = getAdminBadge(o.status, o.refund_status);
        badgeHtml = b ? `<span class="aoc-badge" style="background:${b.bg};color:${b.color};border:1px solid;font-weight:700;">${b.label}</span>` : '';
      } else if (isRefundState || isCancelState) {
        const b = getAdminBadge(o.status);
        badgeHtml = b ? `<span class="aoc-badge" style="background:${b.bg};color:${b.color};border:1px solid;font-weight:700;">${b.label}</span>` : '';
      } else if (o.status === 'admin_pending') {
        badgeHtml = `<span class="aoc-badge" style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;font-weight:700;">⚠️ Pending Admin</span>`;
      } else if (o.status === 'admin_rejected') {
        badgeHtml = `<span class="aoc-badge" style="background:#fef2f2;color:#ef4444;border:1px solid #fecaca;font-weight:700;">❌ Admin Rejected</span>`;
      } else if (o.status === 'self_cancelled') {
        badgeHtml = `<span class="aoc-badge" style="background:#fef2f2;color:#ef4444;border:1px solid #fecaca;font-weight:700;">❌ Self Cancelled</span>`;
      } else if (o.status === 'cancellation_window') {
        badgeHtml = `<span class="aoc-badge" style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;font-weight:700;">⏳ Cancel Window</span>`;
      } else if (o.status === 'window_closed') {
        badgeHtml = `<span class="aoc-badge" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;">🔒 Window Closed</span>`;
      } else if (o.status === 'return_window') {
        badgeHtml = `<span class="aoc-badge" style="background:#ecfdf5;color:#10b981;border:1px solid #a7f3d0;">📦 Return Window</span>`;
      } else if (o.status === 'order_created') {
        badgeHtml = `<span class="aoc-badge" style="background:#ecfdf5;color:#10b981;border:1px solid #a7f3d0;">🆕 Order Created</span>`;
      } else if (o.status === 'payment_verified') {
        badgeHtml = `<span class="aoc-badge" style="background:#eff6ff;color:#3b82f6;border:1px solid #bfdbfe;">✅ Payment Verified</span>`;
      } else if (o.status === 'approved') {
        badgeHtml = `<span class="aoc-badge" style="background:#ecfdf5;color:#10b981;border:1px solid #a7f3d0;">✅ Approved</span>`;
      } else if (o.status === 'pending_dispatch') {
        badgeHtml = `<span class="aoc-badge" style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;font-weight:700;">⏳ Pending Dispatch</span>`;
      } else {
        badgeHtml = `<span class="aoc-badge aoc-badge--${o.delivery_status === 'cancelled' ? 'cancelled' : o.delivery_status}">
             ${o.delivery_status === 'cancelled' ? '' : statusEmoji[o.delivery_status] || ''} ${o.delivery_status === 'cancelled' ? 'Cancelled' : o.delivery_status}
           </span>`;
      }

      const stageLabel = getFulfillmentStageLabel(o);
      const stagePills = {
        pending:     { label: 'Pending',     icon: 'fa-solid fa-box-open',        bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
        packing:     { label: 'Packing',     icon: 'fa-solid fa-boxes-packing',   bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
        packed:      { label: 'Packed',      icon: 'fa-solid fa-box-check',       bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6' },
        shipping:    { label: 'Shipping',    icon: 'fa-solid fa-truck-fast',      bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
        delivered:   { label: 'Delivered',   icon: 'fa-solid fa-circle-check',    bg: 'rgba(16,185,129,0.12)', color: '#059669' },
      };
      const sp = stagePills[stageLabel];
      const stageBadge = sp ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:0.68rem;font-weight:600;background:${sp.bg};color:${sp.color};border:1px solid ${sp.color}18;white-space:nowrap;letter-spacing:0.2px;"><i class="${sp.icon}" style="font-size:0.6rem;"></i> ${sp.label}</span>` : '';

      const itemCount = Array.isArray(o.items) ? o.items.length : 0;
      return `
      <div class="aoc-card ${o.delivery_status === 'cancelled' || isRefundState ? 'aoc-card--cancelled' : ''}" data-id="${o.id}">
        <div class="aoc-row" onclick="globalThis.toggleOrderExpand(this)">
          <span class="aoc-id">#${o.id}</span>
          <span class="aoc-customer">${customerName}</span>
          <span class="aoc-summary-meta">
            ${date} · ${itemCount} item${itemCount > 1 ? 's' : ''} · ₹${Number(o.total || 0).toFixed(2)}
          </span>
          ${badgeHtml}
          ${stageBadge}
          <span class="aoc-chev">${'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'}</span>
        </div>

        <div class="aoc-detail" style="max-height:0;opacity:0;">
          <div class="aoc-detail-inner">
            <div class="aoc-detail-grid">

              <div class="aoc-detail-col">
                <div class="aoc-dlabel">SHIPPING</div>
                <div class="aoc-ship-info">
                  <span class="aoc-ship-name">${customerName}</span>
                  <span class="aoc-ship-phone">${phone}</span>
                  <span class="aoc-ship-addr">${address}</span>
                  ${o.expected_delivery_date
          ? `<span class="aoc-ship-del"><strong>ETA:</strong> ${new Date(o.expected_delivery_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${o.delivery_days_text ? ' (' + o.delivery_days_text + ')' : ''}</span>`
          : ''}
                  ${(function() {
                    const s = (adminShipmentsCache || []).find(x => x.order_id === o.id || x.id === o.shipment_id);
                    if (!s) return '';
                    const statusLabel = s.status || '';
                    const awb = s.awb_code || '';
                    const courier = s.courier_name || '';
                    const trackUrl = s.tracking_url || '';
                    const labelUrl = s.label_url || '';
                    return `
                      <div class="aoc-shipment-info">
                        ${awb ? `<span class="aoc-ship-line"><span class="aoc-ship-label">AWB:</span> ${awb}${trackUrl ? ` <a href="${trackUrl}" target="_blank" class="aoc-ship-link" title="Track"><i class="fa-solid fa-up-right-from-square"></i></a>` : ''}</span>` : ''}
                        ${courier ? `<span class="aoc-ship-line"><span class="aoc-ship-label">Courier:</span> ${courier}</span>` : ''}
                        ${statusLabel ? `<span class="aoc-ship-line"><span class="aoc-ship-label">Status:</span> <span class="aoc-ship-status ${statusLabel}">${statusLabel.replace(/_/g, ' ')}</span></span>` : ''}
                        ${labelUrl ? `<span class="aoc-ship-line"><a href="${labelUrl}" target="_blank" class="aoc-ship-link"><i class="fa-solid fa-file-lines"></i> Download Label</a></span>` : ''}
                      </div>
                    `;
                  })()}
                </div>

                <div class="aoc-dlabel">ITEMS</div>
                ${productDisplay}
              </div>

              <div class="aoc-detail-col">
                ${isCancelRequested
          ? `
                  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:12px;">
                    <span style="font-weight:700;color:#d97706;display:block;margin-bottom:4px;font-size:0.82rem;">⚠️ CANCELLATION REQUESTED</span>
                    <span style="font-size:0.8rem;color:#4b5563;display:block;margin-bottom:10px;font-style:italic;">"${o.cancel_reason || 'No reason provided'}"</span>
                    <div style="display:flex;gap:8px;">
                      <button class="btn btn-primary" style="background:#d97706;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminApproveRefundModal('${o.id}')">Initiate Refund</button>
                      <button class="btn btn-cancel" style="padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminRejectRefundModal('${o.id}')">Reject</button>
                    </div>
                  </div>
                `
          : o.status === 'REFUND_FAILED'
          ? `
                  <div class="aoc-cancelled-box">
                    <span class="aoc-cancelled-title" style="color:#ef4444;">❌ Auto Refund Failed</span>
                    ${o.cancel_reason ? `<span class="aoc-cancelled-why">${o.cancel_reason}</span>` : ''}
                    <span class="aoc-cancelled-why" style="margin-top:6px;color:#8b5cf6;"><strong>Refund:</strong> auto refund failed</span>
                    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                      <button class="btn btn-primary" style="background:#d97706;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminManualRefundInitiate('${o.id}')">
                        <i class="fa-solid fa-hand-holding-dollar"></i> Manual Refund
                      </button>
                      <button class="btn btn-primary" style="background:#3b82f6;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminViewRefundDetails('${o.id}')">
                        <i class="fa-solid fa-eye"></i> View Details
                      </button>
                    </div>
                  </div>
                `
          : o.status === 'MANUAL_REFUND_INITIATED'
          ? `
                  <div class="aoc-cancelled-box">
                    <span class="aoc-cancelled-title" style="color:#d97706;">🔄 Manual Refund Initiated</span>
                    ${o.cancel_reason ? `<span class="aoc-cancelled-why">${o.cancel_reason}</span>` : ''}
                    <span class="aoc-cancelled-why" style="margin-top:6px;color:#8b5cf6;"><strong>Refund:</strong> manual — pending completion</span>
                    ${o.manual_refund_payment_mode ? `<span class="aoc-cancelled-why" style="margin-top:4px;color:#e2e8f0;font-size:0.78rem;"><strong>Payment Mode:</strong> ${o.manual_refund_payment_mode.replace(/_/g, ' ')}${o.manual_refund_payment_details ? ' — ' + o.manual_refund_payment_details : ''}</span>` : ''}
                    <div style="display:flex;gap:8px;margin-top:12px;">
                      <button class="btn btn-primary" style="background:#10b981;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminManualRefundComplete('${o.id}')">
                        <i class="fa-solid fa-circle-check"></i> Mark Completed
                      </button>
                      <button class="btn btn-primary" style="background:#3b82f6;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminViewRefundDetails('${o.id}')">
                        <i class="fa-solid fa-eye"></i> View Details
                      </button>
                    </div>
                  </div>
                `
          : o.status === 'MANUAL_REFUND_COMPLETED'
          ? `
                  <div class="aoc-cancelled-box">
                    <span class="aoc-cancelled-title" style="color:#10b981;">✅ Manual Refund Completed</span>
                    ${o.cancel_reason ? `<span class="aoc-cancelled-why">${o.cancel_reason}</span>` : ''}
                    <span class="aoc-cancelled-why" style="margin-top:6px;color:#8b5cf6;"><strong>Refund:</strong> manual — completed</span>
                    ${o.manual_refund_payment_mode ? `<span class="aoc-cancelled-why" style="margin-top:4px;color:#e2e8f0;font-size:0.78rem;"><strong>Payment Mode:</strong> ${o.manual_refund_payment_mode.replace(/_/g, ' ')}${o.manual_refund_payment_details ? ' — ' + o.manual_refund_payment_details : ''}</span>` : ''}
                    <div style="display:flex;gap:8px;margin-top:12px;">
                      <button class="btn btn-primary" style="background:#3b82f6;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminViewRefundDetails('${o.id}')">
                        <i class="fa-solid fa-eye"></i> View Details
                      </button>
                    </div>
                  </div>
                `
          : o.delivery_status === 'cancelled' && o.status === 'cancelled' && o.refund_status && o.refund_status !== 'none' && o.refund_status !== 'completed'
          ? `
                  <div class="aoc-cancelled-box">
                    <span class="aoc-cancelled-title" style="color:#d97706;">🔄 Manual Refund: ${o.refund_status.charAt(0).toUpperCase() + o.refund_status.slice(1)}</span>
                    ${o.cancel_reason ? `<span class="aoc-cancelled-why">${o.cancel_reason}</span>` : ''}
                    <span class="aoc-cancelled-why" style="margin-top:6px;color:#8b5cf6;"><strong>Refund Status:</strong> ${o.refund_status.replace(/_/g, ' ')}${o.total_refunded_amount ? ' — ₹' + Number(o.total_refunded_amount).toFixed(2) : ''}</span>
                    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                      ${o.refund_status === 'pending' ? `
                        <button class="btn btn-primary" style="background:#3b82f6;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminProgressRefundStep('${o.id}','initiated')">
                          <i class="fa-solid fa-play"></i> Mark Initiated
                        </button>
                      ` : ''}
                      ${o.refund_status === 'initiated' ? `
                        <button class="btn btn-primary" style="background:#8b5cf6;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminProgressRefundStep('${o.id}','processing')">
                          <i class="fa-solid fa-hourglass-half"></i> Mark Processing
                        </button>
                        <button class="btn btn-primary" style="background:#10b981;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminProgressRefundStep('${o.id}','completed')">
                          <i class="fa-solid fa-circle-check"></i> Mark Completed
                        </button>
                      ` : ''}
                      ${o.refund_status === 'processing' ? `
                        <button class="btn btn-primary" style="background:#10b981;border:none;padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminProgressRefundStep('${o.id}','completed')">
                          <i class="fa-solid fa-circle-check"></i> Mark Completed
                        </button>
                      ` : ''}
                      <button class="btn btn-secondary" style="padding:6px 12px;font-size:0.8rem;" onclick="globalThis.adminViewRefundDetails('${o.id}')">
                        <i class="fa-solid fa-eye"></i> View Details
                      </button>
                    </div>
                  </div>
                `
          : o.status === 'admin_pending'
          ? `
                  <div class="aoc-cancelled-box" style="background:rgba(245,158,11,0.06);border-color:rgba(245,158,11,0.2);">
                    <span class="aoc-cancelled-title" style="color:#d97706;">⚠️ Pending Admin Approval</span>
                    <span class="aoc-cancelled-why" style="color:#94a3b8;">Order requires admin review before fulfillment can begin.</span>
                    <div style="display:flex;gap:8px;margin-top:12px;">
                      <button class="btn btn-primary" style="background:#1a9650;border:none;padding:8px 16px;font-size:0.8rem;" onclick="globalThis.adminOrderApproveModal('${o.id}')">
                        <i class="fa-solid fa-check"></i> Approve
                      </button>
                      <button class="btn btn-cancel" style="padding:8px 16px;font-size:0.8rem;" onclick="globalThis.adminOrderRejectModal('${o.id}')">
                        <i class="fa-solid fa-xmark"></i> Reject
                      </button>
                    </div>
                  </div>
                `
          : o.delivery_status === 'cancelled' || isRefundState || isCancelState
          ? `
                  <div class="aoc-cancelled-box">
                    <span class="aoc-cancelled-title">${o.status === 'CANCEL_REJECTED' ? 'Cancellation Rejected' : 'Cancelled by ' + (o.cancelled_by === 'admin' ? 'admin' : 'user')}</span>
                    ${o.cancel_reason ? `<span class="aoc-cancelled-why">${o.cancel_reason}</span>` : ''}
                    ${o.refund_status && o.refund_status !== 'none' ? `<span class="aoc-cancelled-why" style="margin-top:6px;color:#8b5cf6;"><strong>Refund:</strong> ${o.refund_status.replace(/_/g, ' ')}${o.total_refunded_amount ? ' — ₹' + Number(o.total_refunded_amount).toFixed(2) : ''}</span>` : ''}
                  </div>
                `
          : `
                  <div class="aoc-fulfillment-pipeline">
                    <div class="aoc-fulfillment-label">Fulfillment Pipeline</div>
                    <div class="aoc-fulfillment-buttons">
                      ${(!o.fulfillment_status || o.fulfillment_status === 'pending_fulfillment') ? `
                        <button class="aoc-ful-btn" onclick="globalThis.updateFulfillment('${o.id}','packing_required')" title="Start packing process">
                          <i class="fa-solid fa-box"></i> Start Packing
                        </button>
                      ` : ''}
                      ${o.fulfillment_status === 'packing_required' || o.fulfillment_status === 'packed' ? `
                        <button class="aoc-ful-btn ${o.fulfillment_status === 'packed' ? 'aoc-ful-btn-active' : ''}" onclick="globalThis.updateFulfillment('${o.id}','packed')" title="Mark as packed">
                          <i class="fa-solid fa-box-open"></i> ${o.fulfillment_status === 'packed' ? '✓ Packed' : 'Mark Packed'}
                        </button>
                      ` : ''}
                      ${o.fulfillment_status === 'packed' ? `
                        <button class="aoc-ful-btn aoc-ful-btn-primary" onclick="globalThis.updateFulfillment('${o.id}','ready_to_ship')" title="Create shipment draft with carrier">
                          <i class="fa-solid fa-truck"></i> Create Shipment
                        </button>
                      ` : ''}
                      ${o.fulfillment_status === 'pending_dispatch' ? `
                        <div style="display:flex;flex-direction:column;gap:6px;width:100%;">
                          <div style="font-size:0.75rem;color:var(--color-text-muted);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:6px;padding:8px 10px;">
                            ${(function() {
                              const s = (adminShipmentsCache || []).find(x => x.order_id === o.id || x.id === o.shipment_id);
                              const awb = o.shipment_awb || (s ? s.awb_code : null) || '';
                              const courier = o.shipment_courier || (s ? s.courier_name : null) || '';
                              const labelUrl = o.shipment_label_url || (s ? s.label_url : null) || '';
                              return `<div style="display:flex;gap:12px;flex-wrap:wrap;">
                                ${awb ? `<span><strong>AWB:</strong> ${awb}</span>` : ''}
                                ${courier ? `<span><strong>Courier:</strong> ${courier}</span>` : ''}
                                ${labelUrl ? `<a href="${labelUrl}" target="_blank" style="color:#3b82f6;text-decoration:underline;font-size:0.72rem;"><i class="fa-solid fa-file-lines"></i> Label</a>` : ''}
                              </div>`;
                            })()}
                          </div>
                          <div style="display:flex;gap:6px;">
                            <button class="aoc-ful-btn aoc-ful-btn-primary" onclick="globalThis.confirmDispatch('${o.id}')" title="Confirm and release to carrier — schedules pickup">
                              <i class="fa-solid fa-check-circle"></i> Confirm & Release
                            </button>
                            <button class="aoc-ful-btn" style="color:#ef4444;border-color:#ef4444;" onclick="globalThis.cancelShipmentFromTab('${o.id}')" title="Cancel this shipment draft">
                              <i class="fa-solid fa-ban"></i> Cancel
                            </button>
                          </div>
                        </div>
                      ` : ''}
                      ${o.fulfillment_status === 'with_carrier' ? `
                        <button class="aoc-ful-btn aoc-ful-btn-active" disabled>
                          <i class="fa-solid fa-check-circle"></i> With Carrier
                        </button>
                      ` : ''}
                      ${o.fulfillment_status === 'ready_to_ship' ? `
                        <button class="aoc-ful-btn aoc-ful-btn-primary" onclick="globalThis.updateFulfillment('${o.id}','ready_to_ship')" title="Retry shipment creation">
                          <i class="fa-solid fa-rotate"></i> Retry Shipment
                        </button>
                      ` : ''}
                      ${o.fulfillment_status === 'delivered' ? `
                        <button class="aoc-ful-btn aoc-ful-btn-done" disabled>
                          <i class="fa-solid fa-circle-check"></i> Delivered
                        </button>
                      ` : ''}
                    </div>
                    <div class="aoc-fulfillment-status-text">
                      Current: <strong>${(o.fulfillment_status || 'pending_fulfillment').replace(/_/g, ' ')}</strong>
                    </div>
                  </div>
                  ${!o.delivery_status !== 'cancelled' && !isRefundState && !isCancelState && !["shipped","in_transit","delivered"].includes(o.delivery_status) && o.fulfillment_status !== "with_carrier" ? `
                  <div class="aoc-cancel-controls">
                    <button class="aoc-btn-cancel" style="background:#ef4444;border-color:#ef4444;color:#fff;padding:8px 16px;font-size:0.82rem;" onclick="globalThis.adminDirectCancelModal('${o.id}')">
                      <i class="fa-solid fa-ban"></i> Cancel & Refund
                    </button>
                  </div>` : ''}
                `}

                  <div class="aoc-summary">
                    <div><span>Total</span><strong>₹${Number(o.total || 0).toFixed(2)}</strong></div>
                    <div><span>Payment</span><strong>${o.payment_method || (o.razorpay_order_id ? 'Razorpay' : 'Pending')}</strong></div>
                    <div><span>Transaction</span><strong title="${o.transaction_id || o.razorpay_payment_id || 'Pending'}">${(o.transaction_id || o.razorpay_payment_id || 'Pending').substring(0, 16)}${((o.transaction_id || o.razorpay_payment_id || 'Pending').length > 16) ? '…' : ''}</strong></div>
                    ${o.refund_status && o.refund_status !== 'none' ? `<div><span>Refund</span><strong style="color:#8b5cf6;">${o.refund_status.replace(/_/g, ' ')}${o.total_refunded_amount ? ' — ₹' + Number(o.total_refunded_amount).toFixed(2) : ''}</strong></div>` : ''}
                  </div>

                ${invoiceLink && (function showInvoiceForAdmin(o) {
                  const shippingStatuses = ['shipped', 'in_transit', 'delivered'];
                  if (shippingStatuses.includes(o.delivery_status)) return true;
                  // Cancelled + paid → admin sees invoice
                  if (o.delivery_status === 'cancelled' && (o.status === 'paid' || o.payment_status === 'paid')) return true;
                  return false;
                })(o)
          ? `
                  <div class="aoc-actions">
                    <button class="aoc-btn" onclick="globalThis.open('${invoiceLink}','_blank')" title="View Invoice">📄</button>
                    <button class="aoc-btn" onclick="globalThis.open('${invoiceLink}?download=1','_blank')" title="Download PDF">⬇️</button>
                    <button class="aoc-btn aoc-btn--wa" onclick="globalThis.shareInvoiceWhatsApp('${o.id}')" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>
                    <button class="aoc-btn" onclick="globalThis.copyInvoiceLink('${o.invoice_token}')" title="Copy Link">🔗</button>
                  </div>
                ` : ''
        }
              </div>
            </div>

            <div class="aoc-progress">
              ${progressSteps}
            </div>
          </div>
        </div>
      </div>
    `;
    })
    .join('');

  wrap.innerHTML = pendingSectionHtml + listHtml;
}

/* ── 12-Section Switching ── */
let currentSection = 'all';

function getFulfillmentStageLabel(o) {
  // Status is the source of truth for v3 states
  const v3Labels = {
    'approved': 'pending',
    'packing': 'packing',
    'packed': 'packed',
    'ready_to_ship': 'shipping',
    'with_carrier': 'shipping',
    'out_for_delivery': 'shipping',
    'ndr': 'shipping',
    'delivered': 'delivered',
    'return_window': 'delivered',
    'rto': 'cancelled',
    'self_cancelled': 'cancelled',
    'admin_rejected': 'cancelled',
    'shipment_failed': 'packing',
  };
  if (v3Labels[o.status]) return v3Labels[o.status];

  const fs = o.fulfillment_status || '';
  const ds = o.delivery_status || '';
  if (o.status === 'CANCEL_REQUESTED' || ds === 'CANCEL_REQUESTED') return 'cancel_requests';
  if (['cancelled', 'rejected'].includes(ds)) return 'cancelled';
  if (ds === 'delivered' || fs === 'delivered') return 'delivered';
  if (fs === 'packing_required') return 'packing';
  if (fs === 'packed') return 'packed';
  if (fs === 'pending_dispatch' || fs === 'ready_to_ship' || fs === 'with_carrier' || ['shipped','in_transit'].includes(ds)) return 'shipping';
  if (fs === 'pending_fulfillment' || ds === 'placed' || ds === 'admin_pending') return 'pending';
  return null;
}

function isFreshOrder(o) {
  // Status-based checks take priority
  const terminalStatuses = ['cancelled', 'self_cancelled', 'admin_rejected', 'rto', 'delivered', 'return_window', 'completed',
    'CANCEL_REQUESTED','CANCEL_APPROVED','CANCEL_REJECTED','REFUND_PENDING','REFUND_INITIATED',
    'REFUND_PROCESSING','REFUND_COMPLETED','REFUND_FAILED','MANUAL_REFUND_INITIATED','MANUAL_REFUND_COMPLETED',
    'packing', 'packed', 'pending_dispatch', 'ready_to_ship', 'with_carrier', 'out_for_delivery', 'ndr', 'shipment_failed'];
  if (terminalStatuses.includes(o.status)) return false;

  const fs = o.fulfillment_status || '';
  const ds = o.delivery_status || '';
  if (['cancelled','rejected'].includes(ds)) return false;
  return (fs === '' || fs === 'pending_fulfillment') && (ds === 'placed' || ds === '' || ds === 'admin_pending');
}

function updateSectionCounts(orders) {
  const allOrders = orders || adminOrdersCache;
  const refundExclude = ['CANCEL_REQUESTED','CANCEL_APPROVED','CANCEL_REJECTED','REFUND_PENDING','REFUND_INITIATED','REFUND_PROCESSING','REFUND_COMPLETED','REFUND_FAILED','MANUAL_REFUND_INITIATED','MANUAL_REFUND_COMPLETED'];
  const countMap = {
    all: allOrders.filter(o => isFreshOrder(o)).length,
    pending: allOrders.filter(o => getFulfillmentStageLabel(o) === 'pending' && !refundExclude.includes(o.status)).length,
    packing: allOrders.filter(o => getFulfillmentStageLabel(o) === 'packing').length,
    packed: allOrders.filter(o => getFulfillmentStageLabel(o) === 'packed').length,
    shipping: allOrders.filter(o => getFulfillmentStageLabel(o) === 'shipping').length,
    delivered: allOrders.filter(o => o.delivery_status === 'delivered' || o.status === 'delivered' || o.status === 'return_window').length,
    cancel_requests: allOrders.filter(o => o.status === 'CANCEL_REQUESTED' || o.delivery_status === 'CANCEL_REQUESTED').length,
    cancelled: allOrders.filter(o => ['cancelled', 'rejected'].includes(o.delivery_status) || ['cancelled', 'self_cancelled', 'admin_rejected', 'rto'].includes(o.status)).length,
  };
  Object.entries(countMap).forEach(([key, count]) => {
    const el = document.getElementById(`sec-count-${key}`);
    if (el) {
      el.textContent = count;
      el.classList.toggle('zero', count === 0);
    }
  });
}

function renderCurrentSection() {
  const orders = adminOrdersCache || [];
  updateSectionCounts(orders);

  const sectionFilters = {
    all: o => isFreshOrder(o),
    pending: o => getFulfillmentStageLabel(o) === 'pending',
    packing: o => getFulfillmentStageLabel(o) === 'packing',
    packed: o => getFulfillmentStageLabel(o) === 'packed',
    shipping: o => getFulfillmentStageLabel(o) === 'shipping',
    delivered: o => o.delivery_status === 'delivered' || o.status === 'delivered' || o.status === 'return_window',
    cancel_requests: o => o.status === 'CANCEL_REQUESTED' || o.delivery_status === 'CANCEL_REQUESTED',
    cancelled: o => ['cancelled', 'rejected'].includes(o.delivery_status) || ['cancelled', 'self_cancelled', 'admin_rejected', 'rto'].includes(o.status),
  };

  const filterFn = sectionFilters[currentSection];
  const filtered = orders.filter(filterFn);

  if (currentSection === 'cancel_requests') {
    renderCancelRequestsSection(filtered);
  } else {
    renderAdminOrders(filtered);
  }
}

function renderCancelRequestsSection(orders) {
  // Reuse the existing renderAdminOrders which already has cancel request handling
  renderAdminOrders(orders);
}

/* ── Order Approve Modal (PENDING_APPROVAL) ── */
async function adminOrderApproveModal(orderId) {
  const existing = document.getElementById('admin-order-approve-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-order-approve-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0d1f1a;border:1px solid rgba(56,177,123,0.3);border-radius:16px;max-width:440px;width:100%;padding:28px;color:#e2e8f0;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:1.1rem;color:#38b17b;"><i class="fa-solid fa-circle-check"></i> Approve Order</h3>
        <button onclick="document.getElementById('admin-order-approve-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 16px;font-size:0.88rem;color:#94a3b8;line-height:1.5;">
        Approve Order <strong style="color:#38b17b;">#${orderId}</strong>? The order will move to <strong>Placed</strong> and the customer will be notified.
      </p>
      <div class="input-field" style="margin-bottom:18px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Admin Note (Optional)</label>
        <textarea id="admin-order-approve-note" rows="2" placeholder="Note to customer..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-order-approve-modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="admin-order-approve-confirm" style="background:#38b17b;border:none;">Approve Order</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#admin-order-approve-confirm').addEventListener('click', async () => {
    const adminNote = modal.querySelector('#admin-order-approve-note').value.trim();
    modal.remove();

    try {
      await fetchWithAuth(`/orders/admin/order-approve/${orderId}`, {
        method: 'POST',
        body: JSON.stringify({ adminNote }),
      });
      showSuccessToast('✅ Order approved. Customer notified.');
      fetchAdminOrders();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Failed to approve order.');
    }
  });
}
globalThis.adminOrderApproveModal = adminOrderApproveModal;

/* ── Order Reject Modal (PENDING_APPROVAL) ── */
async function adminOrderRejectModal(orderId) {
  const existing = document.getElementById('admin-order-reject-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-order-reject-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';

  const rejectReasons = [
    { value: 'suspicious_payment', label: 'Suspicious payment' },
    { value: 'address_not_serviceable', label: 'Address not serviceable' },
    { value: 'duplicate_order', label: 'Duplicate order' },
    { value: 'product_out_of_stock', label: 'Product out of stock' },
    { value: 'other', label: 'Other' },
  ];

  modal.innerHTML = `
    <div style="background:#1a0f0f;border:1px solid rgba(239,68,68,0.3);border-radius:16px;max-width:440px;width:100%;padding:28px;color:#e2e8f0;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:1.1rem;color:#ef4444;"><i class="fa-solid fa-ban"></i> Reject Order</h3>
        <button onclick="document.getElementById('admin-order-reject-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 16px;font-size:0.88rem;color:#94a3b8;line-height:1.5;">
        Reject Order <strong style="color:#ef4444;">#${orderId}</strong>? The customer will be notified and inventory will be restored.
      </p>
      <div class="input-field" style="margin-bottom:12px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Reason for Rejection *</label>
        <select id="admin-order-reject-reason" style="width:100%;padding:10px;border-radius:8px;background:#1f1414;border:1px solid rgba(239,68,68,0.3);color:#e2e8f0;">
          <option value="">Select a reason</option>
          ${rejectReasons.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
        </select>
      </div>
      <div class="input-field hidden" id="admin-order-reject-other-wrap" style="margin-bottom:12px;display:none;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Custom Reason</label>
        <textarea id="admin-order-reject-other" rows="2" placeholder="Enter rejection reason..." style="width:100%;padding:10px;border-radius:8px;background:#1f1414;border:1px solid rgba(239,68,68,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div class="input-field" style="margin-bottom:18px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Admin Note (Optional)</label>
        <textarea id="admin-order-reject-note" rows="2" placeholder="Internal note..." style="width:100%;padding:10px;border-radius:8px;background:#1f1414;border:1px solid rgba(239,68,68,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-order-reject-modal').remove()">Cancel</button>
        <button class="btn btn-cancel" id="admin-order-reject-confirm" style="background:#ef4444;border:none;color:#fff;">Reject Order</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const reasonSelect = modal.querySelector('#admin-order-reject-reason');
  const otherWrap = modal.querySelector('#admin-order-reject-other-wrap');
  const otherInput = modal.querySelector('#admin-order-reject-other');

  reasonSelect.addEventListener('change', () => {
    otherWrap.style.display = reasonSelect.value === 'other' ? 'block' : 'none';
  });

  modal.querySelector('#admin-order-reject-confirm').addEventListener('click', async () => {
    let reason = reasonSelect.value;
    if (!reason) {
      showErrorToast('Please select a rejection reason.');
      return;
    }
    if (reason === 'other') {
      reason = otherInput.value.trim();
      if (!reason) {
        showErrorToast('Please enter a custom rejection reason.');
        return;
      }
    }
    const adminNote = modal.querySelector('#admin-order-reject-note').value.trim();
    modal.remove();

    try {
      await fetchWithAuth(`/orders/admin/order-reject/${orderId}`, {
        method: 'POST',
        body: JSON.stringify({ reason, adminNote }),
      });
      showSuccessToast('Order rejected. Customer notified.');
      fetchAdminOrders();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Failed to reject order.');
    }
  });
}
globalThis.adminOrderRejectModal = adminOrderRejectModal;

/* ── Audit Log Viewer ── */
async function adminToggleAuditLog(orderId, btnEl) {
  const container = btnEl.nextElementSibling;
  if (!container) return;

  if (container.classList.contains('open')) {
    container.classList.remove('open');
    btnEl.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Audit Log';
    return;
  }

  btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';

  try {
    const logs = await fetchWithAuth(`/orders/admin/${orderId}/audit-logs`);
    const list = container.querySelector('.admin-audit-log-list') || document.createElement('div');
    list.className = 'admin-audit-log-list';

    if (!logs || !logs.length) {
      list.innerHTML = '<div style="padding:8px;color:#6b7280;font-size:0.8rem;">No audit log entries found.</div>';
    } else {
      list.innerHTML = logs.map(log => {
        const time = log.created_at ? new Date(log.created_at).toLocaleString() : '—';
        const detail = log.metadata ? Object.entries(log.metadata).map(([k,v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '';
        return `
          <div class="admin-audit-log-entry">
            <span class="al-time">${time}</span>
            <span class="al-action">${log.action || '—'}</span>
            <span class="al-by">by ${log.performed_by || 'system'}</span>
            ${detail ? `<span class="al-detail">${detail}</span>` : ''}
          </div>
        `;
      }).join('');
    }

    if (!container.querySelector('.admin-audit-log-list')) {
      container.appendChild(list);
    }

    container.classList.add('open');
    btnEl.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Audit Log';
  } catch (err) {
    showErrorToast('Failed to load audit logs.');
    btnEl.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Audit Log';
  }
}
globalThis.adminToggleAuditLog = adminToggleAuditLog;

/* ── Attach audit log toggles to order cards ── */
function attachAuditLogToggles() {
  document.querySelectorAll('.aoc-card').forEach(card => {
    const orderId = card.dataset.id;
    if (!orderId) return;
    const existingToggle = card.querySelector('.admin-audit-log-wrap');
    if (existingToggle) return;

    const detailInner = card.querySelector('.aoc-detail-inner');
    if (!detailInner) return;

    const wrap = document.createElement('div');
    wrap.className = 'admin-audit-log-wrap';
    wrap.innerHTML = `
      <button class="admin-audit-log-toggle" onclick="globalThis.adminToggleAuditLog('${orderId}', this)">
        <i class="fa-solid fa-clock-rotate-left"></i> Audit Log
      </button>
      <div class="admin-audit-log-container"></div>
    `;
    detailInner.appendChild(wrap);
  });
}

async function updateFulfillment(orderId, fulfillmentStatus) {
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/fulfillment`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ fulfillment_status: fulfillmentStatus }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to update fulfillment');
    }
    const statusLabel = fulfillmentStatus.replace(/_/g, ' ');
    const toastMsg = fulfillmentStatus === 'ready_to_ship'
      ? '✅ Shipment draft created. Review AWB/details, then click "Confirm & Release" to dispatch.'
      : `✅ Fulfillment moved to "${statusLabel}"`;
    showSuccessToast(toastMsg);
    fetchAdminOrders();
  } catch (err) {
    console.error(err);
    showErrorToast(err.message || 'Failed to update fulfillment');
  }
}
globalThis.updateFulfillment = updateFulfillment;

async function confirmDispatch(orderId) {
  if (!confirm(`Confirm and release this shipment to the carrier? Pickup will be scheduled and the order will move to "With Carrier".`)) return;
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/confirm-dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to confirm dispatch');
    }
    showSuccessToast('✅ Shipment confirmed and released to carrier. Pickup scheduled.');
    fetchAdminOrders();
  } catch (err) {
    console.error(err);
    showErrorToast(err.message || 'Failed to confirm dispatch');
  }
}
globalThis.confirmDispatch = confirmDispatch;

function renderAdminHistoryFilterValueControl(filterType) {
  const container = document.getElementById('admin-history-filter-value');
  if (!container) return;

  let html = '';
  switch (filterType) {
    case 'date': {
      const today = new Date().toISOString().split('T')[0];
      html = `<input type="date" id="admin-history-filter-value-input" class="admin-filter-input" max="${today}">`;
      break;
    }
    case 'order_id':
      html = '<input type="text" id="admin-history-filter-value-input" class="admin-filter-input" placeholder="Enter order id">';
      break;
    case 'customer_id':
      html = '<input type="text" id="admin-history-filter-value-input" class="admin-filter-input" placeholder="Enter customer id">';
      break;
    case 'phone':
      html = '<input type="text" id="admin-history-filter-value-input" class="admin-filter-input" placeholder="Enter phone number">';
      break;
    default:
      html = '<span class="admin-filter-hint">Select a filter above to apply</span>';
  }

  container.innerHTML = html;
  const input = document.getElementById('admin-history-filter-value-input');
  if (input) {
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      adminHistoryPage = 1;
      renderAdminHistory();
    });
  }
}

function getAdminHistoryFilterValue() {
  const filterType = document.getElementById('admin-history-filter-type')?.value || '';
  const valueInput = document.getElementById('admin-history-filter-value-input');
  const value = valueInput ? valueInput.value.trim() : '';
  return { filterType, value };
}

function getAdminHistorySortValue() {
  return document.getElementById('admin-history-sort')?.value || 'date_desc';
}

function getAdminHistoryPageSize() {
  return Number(document.getElementById('admin-history-page-size')?.value || 10);
}

function applyAdminHistoryFilters(orders) {
  const { filterType, value } = getAdminHistoryFilterValue();
  const normalizedValue = value.toLowerCase();

  return orders.filter((order) => {
    switch (filterType) {
      case 'date': {
        if (!value) return true;
        const orderDate = new Date(order.delivered_at || order.updated_at || order.created_at);
        return orderDate.toDateString() === new Date(value).toDateString();
      }
      case 'order_id':
        return value ? String(order.id || '').toLowerCase().includes(normalizedValue) : true;
      case 'customer_id':
        return value
          ? String(order.user_id || order.customer_id || '')
            .toLowerCase()
            .includes(normalizedValue)
          : true;
      case 'phone':
        return value
          ? String(order.delivery_phone || '')
            .replace(/\D/g, '')
            .includes(value.replace(/\D/g, ''))
          : true;
      default:
        return true;
    }
  });
}

function sortAdminHistory(orders) {
  const sortValue = getAdminHistorySortValue();
  const [sortKey, sortDir] = sortValue.split('_');
  const multiplier = sortDir === 'desc' ? -1 : 1;

  return [...orders].sort((a, b) => {
    if (sortKey === 'date') {
      const aDate = new Date(a.delivered_at || a.updated_at || a.created_at);
      const bDate = new Date(b.delivered_at || b.updated_at || b.created_at);
      return multiplier * (aDate - bDate);
    }
    if (sortKey === 'order_id') {
      return multiplier * String(a.id || '').localeCompare(String(b.id || ''));
    }
    if (sortKey === 'customer_id') {
      return multiplier * String(a.user_id || a.customer_id || '')
        .localeCompare(String(b.user_id || b.customer_id || ''));
    }
    if (sortKey === 'phone') {
      return multiplier * String(a.delivery_phone || '')
        .localeCompare(String(b.delivery_phone || ''));
    }
    return 0;
  });
}

function renderAdminHistoryPagination(totalPages, currentPage, totalCount) {
  const container = document.getElementById('admin-history-pagination');
  if (!container) return;

  const prevDisabled = currentPage === 1 ? 'disabled' : '';
  const nextDisabled = currentPage === totalPages ? 'disabled' : '';

  container.innerHTML = `
    <div class="admin-pagination-info">Showing page ${currentPage} of ${totalPages} — ${totalCount} delivered orders</div>
    <div class="admin-pagination-actions">
      <button type="button" class="btn btn-secondary" id="admin-history-prev" ${prevDisabled}>
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <span class="admin-pagination-label">Page ${currentPage} of ${totalPages}</span>
      <button type="button" class="btn btn-secondary" id="admin-history-next" ${nextDisabled}>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
  `;

  document.getElementById('admin-history-prev')?.addEventListener('click', () => {
    if (adminHistoryPage > 1) {
      adminHistoryPage -= 1;
      renderAdminHistory();
    }
  });
  document.getElementById('admin-history-next')?.addEventListener('click', () => {
    if (adminHistoryPage < totalPages) {
      adminHistoryPage += 1;
      renderAdminHistory();
    }
  });
}

function renderAdminHistory() {
  const wrap = document.getElementById('admin-history-list');
  if (!wrap) return;

  const selectedStatus = document.getElementById('admin-history-status-filter')?.value || '';
  const deliveredOrders = adminOrdersCache.filter((order) => {
    const s = String(order.delivery_status || '').toLowerCase();
    if (selectedStatus) return s === selectedStatus;
    return s === 'delivered' || s === 'cancelled';
  });

  if (!deliveredOrders.length) {
    wrap.innerHTML = '<div class="admin-loading">No delivered orders found.</div>';
    document.getElementById('admin-history-summary').textContent = '';
    document.getElementById('admin-history-pagination').innerHTML = '';
    return;
  }

  const filteredOrders = applyAdminHistoryFilters(deliveredOrders);
  const sortedOrders = sortAdminHistory(filteredOrders);
  const pageSize = getAdminHistoryPageSize();
  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / pageSize));
  if (adminHistoryPage > totalPages) adminHistoryPage = totalPages;
  const pageStart = (adminHistoryPage - 1) * pageSize;
  const pageOrders = sortedOrders.slice(pageStart, pageStart + pageSize);

  wrap.innerHTML = pageOrders
    .map((o) => {
      const delivered = new Date(o.delivered_at || o.updated_at || o.created_at).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      const customerId = o.user_id || o.customer_id || 'N/A';
      const phone = o.delivery_phone || 'N/A';
      const items = Array.isArray(o.items) ? o.items : [];
      const itemRows = items
        .map((item) => `<li>${item.name || item.product_name || 'Product'} × ${item.quantity || item.qty || 1}</li>`)
        .join('');
      const isDel = o.delivery_status !== 'cancelled';

      return `
        <div class="aoc-card">
          <div class="aoc-row" onclick="globalThis.toggleOrderExpand(this)">
            <span class="aoc-id">#${o.id}</span>
            <span class="aoc-customer">${o.customer_name || o.user_email || 'Customer'}</span>
            <span class="aoc-summary-meta">${delivered} · ${items.length} item${items.length !== 1 ? 's' : ''} · ₹${(o.total || 0).toFixed(2)}</span>
            <span class="aoc-badge aoc-badge--${isDel ? 'delivered' : 'cancelled'}">${isDel ? '✅ Delivered' : '❌ Cancelled'}</span>
            <span class="aoc-chev">${'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'}</span>
          </div>
          <div class="aoc-detail" style="max-height:0;opacity:0;">
            <div class="aoc-detail-inner">
              <div class="aoc-detail-grid">
                <div class="aoc-detail-col">
                  <div class="aoc-dlabel">DELIVERY DETAILS</div>
                  <div class="aoc-ship-info">
                    <span class="aoc-ship-name">Customer ID: ${customerId}</span>
                    <span class="aoc-ship-phone">${phone}</span>
                    <span class="aoc-ship-addr">${o.delivery_address || 'No address'}</span>
                  </div>
                </div>
                <div class="aoc-detail-col">
                  <div class="aoc-dlabel">REFERENCE</div>
                  <div class="aoc-summary">
                    <div><span>Order ID</span><strong>${o.id}</strong></div>
                    <div><span>Payment</span><strong>${o.payment_method || (o.razorpay_order_id ? 'Razorpay' : 'Pending')}</strong></div>
                    <div><span>Transaction</span><strong title="${o.transaction_id || o.razorpay_payment_id || 'Pending'}">${(o.transaction_id || o.razorpay_payment_id || 'Pending').substring(0, 16)}${((o.transaction_id || o.razorpay_payment_id || 'Pending').length > 16) ? '…' : ''}</strong></div>
                  </div>
                </div>
              </div>
              <div class="aoc-dlabel" style="margin-top:6px;">ITEMS</div>
              <ul style="margin:0 0 0 16px;padding:0;">${itemRows}</ul>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  const summary = document.getElementById('admin-history-summary');
  if (summary) {
    summary.textContent = `${filteredOrders.length} delivered order${filteredOrders.length !== 1 ? 's' : ''}`;
  }
  renderAdminHistoryPagination(totalPages, adminHistoryPage, filteredOrders.length);
}

function clearAdminHistoryFilters() {
  const filterType = document.getElementById('admin-history-filter-type');
  if (filterType) filterType.value = '';
  const valueContainer = document.getElementById('admin-history-filter-value');
  if (valueContainer) {
    valueContainer.innerHTML = '<span class="admin-filter-hint">Select a filter above to apply</span>';
  }
  adminHistoryPage = 1;
  renderAdminHistory();
}

async function adminDeleteProduct(productId) {
  if (
    !confirm(
      'Are you sure you want to permanently delete this product from the inventory?',
    )
  ) return;

  try {
    const res = await fetch(`${API_BASE}/products/${productId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (res.ok) {
      _adminProducts = _adminProducts.filter(p => p.id !== productId);
      showSuccessToast('🗑️ Product successfully deleted.');
      renderAdminInventory();
    } else {
      const data = await res.json();
      showErrorToast(data.error || 'Failed to remove item.');
    }
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Server communication error.');
  }
}

async function fetchAdminCategories() {
  const list = document.getElementById('admin-categories-list');
  if (list) list.innerHTML = '<div class="skeleton-table">' + Array(4).fill(`
    <div class="skeleton-row">
      <div style="flex:1;"><div class="skeleton skeleton-text w-50"></div></div>
      <div style="width:60px;"><div class="skeleton skeleton-text w-40" style="margin-bottom:0;"></div></div>
    </div>
  `).join('') + '</div>';
  try {
    const res = await fetch(`${API_BASE}/categories`);
    if (!res.ok) throw new Error('Failed to load categories');
    const response = await res.json();
    // API returns {success: true, data: [...]} - extract the data array
    const categories = Array.isArray(response) ? response : (response.data || []);
    _adminCategories = categories;
    resetAdminCatForm();
    renderAdminCategoriesList(categories);
  } catch (err) {
    console.error(err);
    if (list) list.innerHTML = '<div class="admin-loading" style="color:#e74c3c;">Failed to load categories.</div>';
  }
}

// =====================
// Trainings (Admin)
// =====================
async function fetchAdminTrainings() {
  const list = document.getElementById('admin-trainings-list');
  if (list) list.innerHTML = '<div class="skeleton-table">' + Array(4).fill(`
    <div class="skeleton-row">
      <span class="skeleton skeleton-avatar"></span>
      <div style="flex:1;">
        <div class="skeleton skeleton-text w-60"></div>
        <div class="skeleton skeleton-text w-40" style="height:0.75rem;"></div>
      </div>
    </div>
  `).join('') + '</div>';
  try {
    const trainings = await trainingApi.getTrainings();
    _adminTrainings = trainings || [];
    renderAdminTrainings();
    return trainings;
  } catch (err) {
    console.error(err);
    if (list) list.innerHTML = '<div class="admin-loading" style="color:#e74c3c;">Failed to load trainings.</div>';
    return [];
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderAdminTrainings() {
  const list = document.getElementById('admin-trainings-list');
  if (!list) return;
  if (!_adminTrainings?.length) {
    list.innerHTML = '<div class="admin-loading">No trainings available.</div>';
    return;
  }

  const chevHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  list.innerHTML = _adminTrainings
    .map(
      (t) => `
    <div class="ac-card" data-id="${t.id}">
      <div class="ac-row" onclick="globalThis.toggleOrderExpand(this)">
        <img class="ac-thumb" src="${t.image_url || '/images/training_farm.png'}" alt="${t.title}">
        <span class="ac-title">${t.title}</span>
        <span class="ac-meta">${t.category} · ${formatDate(t.start_date)} – ${formatDate(t.end_date)} · ${t.duration_days || '—'}d</span>
        <span class="ac-train-price">${t.price_actual ? '₹' + Number(t.price_actual).toLocaleString() : ''}</span>
        <div class="ac-actions">
          <button class="ac-btn-edit" onclick="event.stopPropagation();globalThis.adminEditTraining('${t.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
          <button class="ac-btn-del" onclick="event.stopPropagation();globalThis.adminDeleteTraining('${t.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
        <span class="ac-chev">${chevHtml}</span>
      </div>
      <div class="ac-detail" style="max-height:0;opacity:0;">
        <div class="ac-detail-inner">
          <p><strong>ID:</strong> ${t.training_id || '—'}</p>
          <p>${t.description || ''}</p>
          ${t.price_strikeout ? `<p><span style="text-decoration:line-through;color:#9ca3af;">₹${Number(t.price_strikeout).toLocaleString()}</span> <strong style="color:var(--color-primary);">₹${Number(t.price_actual).toLocaleString()}</strong></p>` : ''}
        </div>
      </div>
    </div>
  `,
    )
    .join('');
}

async function handleAdminSaveTraining(event) {
  event.preventDefault();
  const editId = document.getElementById('admin-train-edit-id').value;
  const title = (
    document.getElementById('admin-train-title').value || ''
  ).trim();
  const category = (
    document.getElementById('admin-train-category').value || ''
  ).trim();
  const description = (
    document.getElementById('admin-train-desc').value || ''
  ).trim();
  const hiddenImage = document.getElementById('admin-train-image');
  const image_url = (hiddenImage?.value || '').trim();
  const content_url = (
    document.getElementById('admin-train-content').value || ''
  ).trim();
  const start_date = (
    document.getElementById('admin-train-start-date').value || ''
  ).trim();
  const end_date = (
    document.getElementById('admin-train-end-date').value || ''
  ).trim();
  const price_strikeout = parseFloat(
    (document.getElementById('admin-train-price-strikeout')?.value || '').trim()
  );
  const price_actual = parseFloat(
    (document.getElementById('admin-train-price-actual')?.value || '').trim()
  );
  // collect allowed roles
  const allowed = [];
  if (document.getElementById('admin-train-role-trainee')?.checked) allowed.push('trainee');
  if (document.getElementById('admin-train-role-farmer')?.checked) allowed.push('farmer');
  if (document.getElementById('admin-train-role-entrepreneur')?.checked) allowed.push('entrepreneur');

  if (!title) {
    showErrorToast('Title is required');
    return;
  }

  if (!category) {
    showErrorToast('Category is required');
    return;
  }

  if (!description) {
    showErrorToast('Description is required');
    return;
  }

  if (!start_date || !end_date) {
    showErrorToast('Start date and end date are required');
    return;
  }

  if (isNaN(price_strikeout) || !price_strikeout) {
    showErrorToast('Price (Strikeout) is required and must be a valid number');
    return;
  }

  if (isNaN(price_actual) || !price_actual) {
    showErrorToast('Actual Price is required and must be a valid number');
    return;
  }

  if (price_strikeout < price_actual * 1.1) {
    showErrorToast('Strikeout price must be at least 10% higher than the actual price.');
    return;
  }

  if (!trainImagePreviewValid) {
    showErrorToast('Please provide a valid training image (upload or URL).');
    return;
  }

  if (!allowed.length) {
    showErrorToast('Select at least one allowed role.');
    return;
  }

  // Client-side date validation
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(start_date);
  start.setHours(0, 0, 0, 0);
  if (start < today) {
    showErrorToast('Start date cannot be in the past.');
    return;
  }
  const end = new Date(end_date);
  end.setHours(0, 0, 0, 0);
  if (end < start) {
    showErrorToast('End date must be on or after the start date.');
    return;
  }

  try {
    const payload = {
      title,
      category,
      description,
      image_url,
      content_url,
      allowed_roles: allowed,
      start_date,
      end_date,
      price_strikeout,
      price_actual,
    };
    if (editId) {
      await trainingApi.updateTraining(editId, payload);
      showSuccessToast('Training updated');
    } else {
      await trainingApi.createTraining(payload);
      showSuccessToast('Training created');
    }
    document.getElementById('admin-train-edit-id').value = '';
    document.getElementById('admin-train-title').value = '';
    document.getElementById('admin-train-desc').value = '';
    document.getElementById('admin-train-category').value = '';
    hiddenImage.value = '';
    document.getElementById('admin-train-content').value = '';
    document.getElementById('admin-train-start-date').value = '';
    document.getElementById('admin-train-end-date').value = '';
    document.getElementById('admin-train-duration').value = '';
    document.getElementById('admin-train-id-display').value = '';
    document.getElementById('admin-train-price-strikeout').value = '';
    document.getElementById('admin-train-price-actual').value = '';
    if (trainImageUrl) trainImageUrl.value = '';
    if (trainImageFile) trainImageFile.value = '';
    updateTrainingImagePreview();
    const roleChecks = ['admin-train-role-trainee', 'admin-train-role-farmer', 'admin-train-role-entrepreneur'];
    roleChecks.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    fetchAdminTrainings();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to save training');
  }
}

function calcDuration(startVal, endVal) {
  if (!startVal || !endVal) return '';
  const s = new Date(startVal);
  const e = new Date(endVal);
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  const days = Math.floor((e - s) / (1000 * 60 * 60 * 24)) + 1;
  return days > 0 ? days : '';
}

function adminEditTraining(id) {
  const t = _adminTrainings.find((x) => x.id === id);
  if (!t) return;
  openAdminTrainForm(true);
  document.getElementById('admin-train-edit-id').value = t.id;
  document.getElementById('admin-train-title').value = t.title || '';
  document.getElementById('admin-train-category').value = t.category || '';
  document.getElementById('admin-train-desc').value = t.description || '';
  if (trainImageUrl) trainImageUrl.value = t.image_url || '';
  if (trainImageFile) trainImageFile.value = '';
  const hidden = document.getElementById('admin-train-image');
  if (hidden) hidden.value = t.image_url || '';
  document.getElementById('admin-train-content').value = t.content_url || '';
  document.getElementById('admin-train-id-display').value = t.training_id || '—';
  document.getElementById('admin-train-start-date').value = t.start_date || '';
  document.getElementById('admin-train-end-date').value = t.end_date || '';
  document.getElementById('admin-train-duration').value = t.duration_days ? `${t.duration_days} days` : '';
  document.getElementById('admin-train-price-strikeout').value = t.price_strikeout ?? '';
  document.getElementById('admin-train-price-actual').value = t.price_actual ?? '';
  // set allowed roles
  const allowed = t.allowed_roles || [];
  document.getElementById('admin-train-role-trainee').checked = allowed.includes('trainee');
  document.getElementById('admin-train-role-farmer').checked = allowed.includes('farmer');
  document.getElementById('admin-train-role-entrepreneur').checked = allowed.includes('entrepreneur');
  updateTrainingImagePreview();
}

async function adminDeleteTraining(id) {
  if (!confirm('Delete this training? This action cannot be undone.')) return;
  try {
    await trainingApi.deleteTraining(id);
    showSuccessToast('Training deleted');
    fetchAdminTrainings();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to delete training');
  }
}

// =====================
// Blogs (Admin)
// =====================
async function fetchAdminBlogs() {
  const list = document.getElementById('admin-blogs-list');
  if (list) list.innerHTML = '<div class="skeleton-table">' + Array(4).fill(`
    <div class="skeleton-row">
      <span class="skeleton skeleton-avatar" style="width:36px;height:36px;"></span>
      <div style="flex:1;"><div class="skeleton skeleton-text w-60"></div></div>
      <div style="width:80px;"><div class="skeleton skeleton-text w-50" style="margin-bottom:0;"></div></div>
    </div>
  `).join('') + '</div>';
  try {
    const result = await blogApi.getBlogs({ limit: 100, page: 1, status: 'all' });
    const blogs = result.blogs || result.data || result || [];
    _adminBlogs = blogs;
    renderAdminBlogs(blogs);
    return blogs;
  } catch (err) {
    console.error(err);
    if (list) list.innerHTML = '<div class="admin-loading" style="color:#e74c3c;">Failed to load blogs.</div>';
    return [];
  }
}

function renderAdminBlogs(blogs) {
  const list = document.getElementById('admin-blogs-list');
  if (!list) return;
  if (!blogs?.length) {
    list.innerHTML = '<div class="admin-loading">No blogs yet. Click "Create Blog" to publish your first blog post.</div>';
    return;
  }

  const chevHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  list.innerHTML = blogs.map(blog => `
    <div class="ac-card" data-id="${blog.id}">
      <div class="ac-row" onclick="globalThis.toggleOrderExpand(this)">
        <div class="ac-thumb">
          ${blog.featured_image
      ? `<img src="${blog.featured_image}" alt="${blog.title}" loading="lazy">`
      : '<i class="fa-solid fa-newspaper"></i>'
    }
        </div>
        <span class="ac-title">${blog.title}</span>
        <span class="ac-meta">${blog.author || 'Admin'} · ${formatAdminDate(blog.published_at || blog.created_at)}</span>
        <div class="ac-actions">
          <button class="ac-btn-del" onclick="event.stopPropagation();globalThis.adminDeleteBlog('${blog.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
        <span class="ac-chev">${chevHtml}</span>
      </div>
      <div class="ac-detail" style="max-height:0;opacity:0;">
        <div class="ac-detail-inner">
          ${(blog.content || '').substring(0, 300)}${(blog.content || '').length > 300 ? '…' : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function formatAdminDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function setBlogFeedback(msg) {
  if (blogFeedbackText) blogFeedbackText.textContent = msg;
  else blogFeedback.textContent = msg;
  blogFeedback.classList.remove('hidden');
}

function resetAdminBlogForm() {
  blogEditId.value = '';
  if (blogIdInput) blogIdInput.value = '';
  blogTitleInput.value = '';
  blogSlugInput.value = '';
  blogAuthorInput.value = 'Admin';
  blogImageUrl.value = '';
  blogImageFile.value = '';
  blogContentInput.value = '';
  blogImagePreview.innerHTML = '<div class="blog-image-preview-placeholder"><i class="fa-solid fa-image"></i><span>Featured image preview</span></div>';
  blogImagePreviewValid = false;
  blogFeedback.classList.add('hidden');
  if (blogFeedbackText) blogFeedbackText.textContent = '';
  blogSubmitLabel.textContent = 'Publish Blog';
  blogModalTitle.innerHTML = 'Create New Blog Post';
}

function openAdminBlogModal() {
  resetAdminBlogForm();
  blogModal.classList.remove('hidden');
  blogModal.classList.add('active');
}

function closeAdminBlogModal() {
  blogModal.classList.remove('active');
  blogModal.classList.add('hidden');
}

function updateBlogSlugFromTitle() {
  const title = blogTitleInput.value.trim();
  if (!title) {
    blogSlugInput.value = '';
    return;
  }
  blogSlugInput.value = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function updateBlogImagePreview() {
  if (!blogImagePreview) return;
  const file = blogImageFile?.files?.[0];
  let url = blogImageUrl?.value.trim();

  if (file) {
    const reader = new FileReader();
    blogImagePreviewValid = false;
    reader.onload = () => {
      blogImagePreview.innerHTML = `<img src="${String(reader.result)}" alt="Preview">`;
      blogImagePreviewValid = true;
    };
    reader.onerror = () => {
      blogImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Unable to read image file</span>';
      blogImagePreviewValid = false;
    };
    reader.readAsDataURL(file);
    return;
  }

  if (url) {
    if (url.startsWith('//')) url = `https:${url}`;
    else if (!/^https?:\/\//i.test(url) && url.includes('.')) url = `https://${url}`;

    blogImagePreview.innerHTML = '<span style="color:var(--color-primary)">Loading preview...</span>';
    blogImagePreviewValid = false;

    const img = new Image();
    let handled = false;
    img.onload = () => {
      if (handled) return;
      handled = true;
      blogImagePreview.innerHTML = `<img src="${url}" alt="Preview">`;
      blogImagePreviewValid = true;
    };
    img.onerror = () => {
      if (handled) return;
      handled = true;
      blogImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Failed to load image from URL</span>';
      blogImagePreviewValid = false;
    };
    try { img.src = url; } catch (e) {
      blogImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Invalid image URL</span>';
      blogImagePreviewValid = false;
    }
    return;
  }

  blogImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span>Image preview</span>';
  blogImagePreviewValid = false;
}

async function handleAdminSaveBlog(event) {
  event.preventDefault();
  blogFeedback.classList.add('hidden');

  const editId = blogEditId.value;
  const blogId = blogIdInput?.value.trim() || '';
  const title = blogTitleInput.value.trim();
  const slug = blogSlugInput.value.trim();
  const author = blogAuthorInput.value.trim() || 'Admin';
  const content = blogContentInput.value.trim();
  let featured_image = blogImageUrl.value.trim();
  const imageFile = blogImageFile?.files?.[0];

  if (!title) {
    setBlogFeedback('Blog title is required.');
    return;
  }

  if (!content) {
    setBlogFeedback('Blog content is required.');
    return;
  }

  try {
    if (imageFile) {
      console.log('[BlogUpload] Reading local file as data URL...');
      featured_image = await readFileAsDataUrl(imageFile);
      console.log('[BlogUpload] File read successfully, data URL length:', featured_image?.length);
    }

    if (editId) {
      await blogApi.updateBlog(editId, {
        title,
        content,
        featured_image,
        image_source: featured_image ? 'url' : 'upload',
      });
      showSuccessToast('✅ Blog updated successfully!');
    } else {
      const created = await blogApi.createBlog({
        blog_id: blogId || undefined,
        title,
        content,
        featured_image,
        image_source: featured_image ? 'url' : 'upload',
        author,
      });
      console.log('[BlogUpload] Blog created:', created);
      // Publish the blog immediately using the returned blog ID
      if (created && created.id) {
        await blogApi.publishBlog(created.id);
        console.log('[BlogUpload] Blog published:', created.id);
      }
      showSuccessToast('✅ Blog published successfully!');
    }

    closeAdminBlogModal();
    fetchAdminBlogs();
  } catch (err) {
    setBlogFeedback(err.message || 'Failed to save blog.');
    console.error('[BlogUpload] Error:', err);
  }
}

function adminEditBlog(id) {
  const blog = _adminBlogs.find(b => b.id === id);
  if (!blog) return;

  // Check if blog is locked
  const isLocked = blog.locked === true;
  const publishedAt = new Date(blog.published_at).getTime();
  const twelveHours = 12 * 60 * 60 * 1000;
  const isLockedByTime = blog.status === 'published' && (Date.now() - publishedAt > twelveHours);

  if (isLocked || isLockedByTime) {
    showErrorToast('This blog is locked and cannot be edited.');
    return;
  }

  openAdminBlogModal();

  blogEditId.value = blog.id;
  if (blogIdInput) blogIdInput.value = blog.blog_id || blog.id || '';
  blogTitleInput.value = blog.title;
  blogSlugInput.value = blog.slug;
  blogAuthorInput.value = blog.author || 'Admin';
  blogImageUrl.value = blog.featured_image || '';
  blogContentInput.value = blog.content;
  blogSubmitLabel.textContent = 'Update Blog';
  blogModalTitle.innerHTML = '<i class="fa-solid fa-pen"></i> Edit Blog';

  if (blog.featured_image) {
    blogImagePreview.innerHTML = `<img src="${blog.featured_image}" alt="Preview">`;
    blogImagePreviewValid = true;
  }
}

async function adminDeleteBlog(id) {
  // Create confirmation modal
  const existingConfirm = document.getElementById('admin-blog-confirm-modal');
  if (existingConfirm) existingConfirm.remove();

  const confirmModal = document.createElement('div');
  confirmModal.id = 'admin-blog-confirm-modal';
  confirmModal.className = 'modal-overlay active';
  confirmModal.innerHTML = `
    <div class="modal-content modal-confirm-content">
      <h3><i class="fa-solid fa-triangle-exclamation" style="color:var(--color-danger);"></i> Delete Blog</h3>
      <p>Are you sure you want to delete this blog? This action cannot be undone.</p>
      <div class="modal-confirm-actions">
        <button class="btn btn-secondary" id="btn-confirm-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-delete" style="background:var(--color-danger);">
          <i class="fa-solid fa-trash"></i> Delete
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmModal);

  return new Promise((resolve) => {
    document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
      confirmModal.remove();
      resolve(false);
    });
    document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
      try {
        await blogApi.deleteBlog(id);
        showSuccessToast('✅ Blog deleted successfully!');
        fetchAdminBlogs();
        confirmModal.remove();
        resolve(true);
      } catch (err) {
        showErrorToast(err.message || 'Failed to delete blog.');
        confirmModal.remove();
        resolve(false);
      }
    });
  });
}

function renderAdminCategoriesList(categories) {
  const list = document.getElementById('admin-categories-list');
  if (!list) return;
  if (!categories.length) {
    list.innerHTML = '<div class="admin-loading">No categories found. Add one above.</div>';
    return;
  }

  const chevHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  list.innerHTML = categories
    .map(
      (cat) => `
    <div class="ac-card" data-id="${cat.id}">
      <div class="ac-row" onclick="globalThis.toggleOrderExpand(this)">
        <span class="ac-cat-uid">${cat.category_id || cat.categoryId || 'spore-000000'}</span>
        <span class="ac-id">${cat.id}</span>
        <span class="ac-title">${cat.name}</span>
        <span class="ac-meta">${cat.description || ''}</span>
        <div class="ac-actions">
          <button class="ac-btn-edit" onclick="event.stopPropagation();globalThis.adminEditCategory('${cat.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
          <button class="ac-btn-del" onclick="event.stopPropagation();globalThis.adminDeleteCategory('${cat.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
        <span class="ac-chev">${chevHtml}</span>
      </div>
      <div class="ac-detail" style="max-height:0;opacity:0;">
        <div class="ac-detail-inner">
          <p>${cat.description || 'No description provided.'}</p>
          ${cat.image_url ? `<img src="${cat.image_url}" alt="${cat.name}">` : ''}
        </div>
      </div>
    </div>
  `,
    )
    .join('');

  populateAdminCategorySelect(categories);
}

function populateAdminCategorySelect(categories) {
  const filterCat = document.getElementById('admin-filter-cat');
  if (filterCat) {
    filterCat.innerHTML = `<option value="all">All Categories</option>` + categories
      .map((cat) => `<option value="${cat.id}">${cat.name}</option>`)
      .join('');
  }
}

function adminEditCategory(catId) {
  activateAdminTab('products');
  _activeCapsule = 'categories';
  renderAdminInventory();
  const category = _adminCategories.find((c) => c.id === catId);
  if (!category) return;

  document.getElementById('admin-edit-cat-id').value = category.id;
  const slugInput = document.getElementById('admin-cat-id');
  if (slugInput) {
    slugInput.value = category.id;
    slugInput.disabled = true;
  }
  if (categoryUidInput) {
    categoryUidInput.value = category.category_id || category.categoryId || generateCategoryUid();
  }
  document.getElementById('admin-cat-name').value = category.name;
  document.getElementById('admin-cat-desc').value = category.description || '';
  if (categoryImageUrl) {
    categoryImageUrl.value = category.image_url || '';
  }
  if (categoryImageFile) {
    categoryImageFile.value = '';
  }
  updateCategoryImagePreview();

  const feedback = document.getElementById('admin-cat-feedback');
  if (feedback) {
    feedback.textContent = `Editing: ${category.name}`;
    feedback.classList.remove('hidden');
    feedback.style.color = 'var(--color-primary)';
  }

  openAdminCatForm(true);
}

function toggleAdminCatForm() {
  const collapse = document.getElementById('admin-cat-form-collapse');
  const btn = document.getElementById('btn-toggle-cat-form');
  if (!collapse) return;
  const isOpen = collapse.style.display !== 'none';
  if (isOpen) {
    collapse.style.display = 'none';
    collapse.style.maxHeight = '0';
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-plus"></i> New Category';
      btn.classList.remove('admin-pill-btn--active');
    }
    resetAdminCatForm();
  } else {
    collapse.style.display = '';
    collapse.style.maxHeight = collapse.scrollHeight + 'px';
    collapse.style.opacity = '1';
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-times"></i> Cancel';
      btn.classList.add('admin-pill-btn--active');
    }
  }
}
globalThis.toggleAdminCatForm = toggleAdminCatForm;

function openAdminCatForm(isEdit = false) {
  const collapse = document.getElementById('admin-cat-form-collapse');
  const btn = document.getElementById('btn-toggle-cat-form');
  if (!collapse) return;
  collapse.style.display = '';
  requestAnimationFrame(() => {
    collapse.style.maxHeight = collapse.scrollHeight + 'px';
    collapse.style.opacity = '1';
  });
  if (btn) {
    btn.innerHTML = '<i class="fa-solid fa-times"></i> ' + (isEdit ? 'Editing' : 'Cancel');
    btn.classList.add('admin-pill-btn--active');
  }
}
globalThis.openAdminCatForm = openAdminCatForm;

function toggleAdminTrainForm() {
  const collapse = document.getElementById('admin-train-form-collapse');
  const btn = document.getElementById('btn-toggle-train-form');
  if (!collapse) return;
  const isHidden = collapse.style.display === 'none' || getComputedStyle(collapse).maxHeight === '0px';
  if (!isHidden) {
    collapse.style.maxHeight = '0';
    collapse.style.opacity = '0';
    collapse.style.display = 'none';
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-plus"></i> New Training';
      btn.classList.remove('admin-pill-btn--active');
    }
    const editId = document.getElementById('admin-train-edit-id');
    if (editId) editId.value = '';
    const resetBtn = document.getElementById('btn-admin-reset-train');
    if (resetBtn) resetBtn.click();
  } else {
    collapse.style.display = '';
    requestAnimationFrame(() => {
      collapse.style.maxHeight = collapse.scrollHeight + 'px';
      collapse.style.opacity = '1';
    });
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-times"></i> Cancel';
      btn.classList.add('admin-pill-btn--active');
    }
  }
}
globalThis.toggleAdminTrainForm = toggleAdminTrainForm;

function openAdminTrainForm(isEdit = false) {
  const collapse = document.getElementById('admin-train-form-collapse');
  const btn = document.getElementById('btn-toggle-train-form');
  if (!collapse) return;
  collapse.style.display = '';
  requestAnimationFrame(() => {
    collapse.style.maxHeight = collapse.scrollHeight + 'px';
    collapse.style.opacity = '1';
  });
  if (btn) {
    btn.innerHTML = '<i class="fa-solid fa-times"></i> ' + (isEdit ? 'Editing' : 'Cancel');
    btn.classList.add('admin-pill-btn--active');
  }
}
globalThis.openAdminTrainForm = openAdminTrainForm;

function parseAdminHashEdit() {
  const hash = globalThis.location.hash || '';
  if (!hash.startsWith('#categories')) return;
  const queryStart = hash.indexOf('?');
  if (queryStart === -1) return;
  const params = new URLSearchParams(hash.slice(queryStart));
  const editId = params.get('edit');
  if (editId) {
    pendingCategoryEditId = editId;
  }
}

function resetAdminCatForm() {
  document.getElementById('admin-edit-cat-id').value = '';
  const slugInput = document.getElementById('admin-cat-id');
  if (slugInput) {
    slugInput.value = '';
    slugInput.disabled = false;
  }
  if (categoryUidInput) {
    categoryUidInput.value = generateCategoryUid();
  }
  document.getElementById('admin-cat-name').value = '';
  document.getElementById('admin-cat-desc').value = '';
  if (categoryImageUrl) categoryImageUrl.value = '';
  if (categoryImageFile) categoryImageFile.value = '';
  if (categoryImagePreview) {
    categoryImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span>Category image preview</span>';
  }
  const feedback = document.getElementById('admin-cat-feedback');
  if (feedback) {
    feedback.classList.add('hidden');
    feedback.textContent = '';
  }
}

async function handleAdminSaveCategory() {
  const feedback = document.getElementById('admin-cat-feedback');
  const editId = document.getElementById('admin-edit-cat-id').value;
  const id = document.getElementById('admin-cat-id').value.trim().toLowerCase().replace(/\s+/g, '-');
  let categoryId = categoryUidInput?.value.trim() || generateCategoryUid();
  const name = document.getElementById('admin-cat-name').value.trim();
  const description = document.getElementById('admin-cat-desc').value.trim();
  let imageUrl = categoryImageUrl?.value.trim() || '';

  if (!name) {
    if (feedback) {
      feedback.textContent = 'Category name is required.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
    }
    return;
  }

  if (!editId && !id) {
    if (feedback) {
      feedback.textContent = 'Category slug is required for new categories.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
    }
    return;
  }

  if (!editId) {
    categoryId = generateCategoryUid();
    if (categoryUidInput) categoryUidInput.value = categoryId;
  }

  // Uniqueness checks
  if (_adminCategories?.length) {
    const slugConflict = _adminCategories.some((c) => c.id === id && c.id !== editId);
    const nameConflict = _adminCategories.some((c) => (c.name || '').toLowerCase() === name.toLowerCase() && c.id !== editId);
    const uidConflict = _adminCategories.some((c) => (c.category_id || c.categoryId) === categoryId && c.id !== editId);

    if (uidConflict) {
      let attempts = 0;
      while (_adminCategories.some((c) => (c.category_id || c.categoryId) === categoryId && c.id !== editId) && attempts < 20) {
        categoryId = generateCategoryUid();
        attempts += 1;
      }
      if (categoryUidInput) categoryUidInput.value = categoryId;
    }

    if (slugConflict || nameConflict) {
      if (feedback) {
        const parts = [];
        if (slugConflict) parts.push('Slug already exists');
        if (nameConflict) parts.push('Name already exists');
        feedback.textContent = `${parts.join(' · ')}.`;
        feedback.classList.remove('hidden');
        feedback.style.color = 'var(--color-danger)';
      }
      return;
    }
  }

  try {
    const file = categoryImageFile?.files?.[0];
    if (!imageUrl && file) imageUrl = await readFileAsDataUrl(file);

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_BASE}/categories/${editId}` : `${API_BASE}/categories`;
    const body = buildCategoryBody(editId, { categoryId, id, name, description, image_url: imageUrl });

    const { res, data } = await submitJson(url, method, body);
    if (res.ok) {
      showSuccessToast(editId ? `✅ Category "${name}" updated!` : `✅ Category "${name}" created!`);
      resetAdminCatForm();
      fetchAdminCategories();
      fetchAdminCategories();
      try {
        bcCategories?.postMessage({ type: 'categories:updated' });
      } catch (e) {
        console.warn(e);
      }
    } else if (feedback) {
      feedback.textContent = data.error || 'Failed to save category.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
    }
  } catch (err) {
    console.error(err);
    if (feedback) {
      feedback.textContent = err.message || 'Server error.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
    }
  }
}

async function adminDeleteCategory(catId) {
  if (!confirm('Delete this category permanently?')) return;

  try {
    const res = await fetch(`${API_BASE}/categories/${catId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete category.');
    }

    showSuccessToast('✅ Category removed successfully.');
    globalThis.location.hash = '#shop';
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Unable to delete category.');
  }
}



// Using shared toast helpers from ./utils/notify.js

function copyInvoiceLink(token) {
  if (!token) return;
  const invoiceUrl = `${API_BASE}/orders/share/${token}`;
  if (navigator.clipboard?.writeText) {
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
globalThis.copyInvoiceLink = copyInvoiceLink;

// ==========================================================================
// REFUNDS & CANCELLATIONS ADMIN DASHBOARD
// ==========================================================================

let _refundsDashboardData = null;

function getRefundStatusBadge(status) {
  const map = {
    initiated: { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6', label: 'Initiated' },
    processing: { bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6', label: 'Processing' },
    processed: { bg: 'rgba(16,185,129,0.18)', color: '#10b981', label: 'Processed' },
    failed: { bg: 'rgba(239,68,68,0.18)', color: '#ef4444', label: 'Failed' },
    pending: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: 'Pending' },
    manual_initiated: { bg: 'rgba(245,158,11,0.15)', color: '#d97706', label: 'Manual Initiated' },
    manual_completed: { bg: 'rgba(16,185,129,0.18)', color: '#10b981', label: 'Manual Completed' },
  };
  const s = map[status] || { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', label: status || 'Unknown' };
  return `<span style="background:${s.bg};color:${s.color};padding:2px 10px;border-radius:20px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">${s.label}</span>`;
}

function getOrderStatusBadge(status) {
  const map = {
    CANCEL_REQUESTED: { color: '#f59e0b', label: 'Cancel Requested' },
    CANCEL_APPROVED: { color: '#10b981', label: 'Cancel Approved' },
    CANCEL_REJECTED: { color: '#ef4444', label: 'Cancel Rejected' },
    REFUND_PENDING: { color: '#3b82f6', label: 'Refund Pending' },
    REFUND_INITIATED: { color: '#8b5cf6', label: 'Refund Initiated' },
    REFUND_PROCESSING: { color: '#8b5cf6', label: 'Refund Processing' },
    REFUND_COMPLETED: { color: '#10b981', label: 'Refund Done' },
    REFUND_FAILED: { color: '#ef4444', label: 'Refund Failed' },
    MANUAL_REFUND_INITIATED: { color: '#d97706', label: 'Manual Refund Initiated' },
    MANUAL_REFUND_COMPLETED: { color: '#10b981', label: 'Manual Refund Completed' },
  };
  const s = map[status] || { color: '#94a3b8', label: status || '-' };
  return `<span style="color:${s.color};font-size:0.72rem;font-weight:600;">${s.label}</span>`;
}

async function loadRefundsDashboard() {
  const tableContainer = document.getElementById('admin-refunds-table-container');
  const auditsContainer = document.getElementById('admin-refund-audits-container');

  if (tableContainer) tableContainer.innerHTML = '<div class="skeleton-table">' + Array(3).fill(`
    <div class="skeleton-row">
      <div style="flex:1;"><div class="skeleton skeleton-text w-50"></div></div>
      <div style="width:100px;"><div class="skeleton skeleton-text w-50" style="margin-bottom:0;"></div></div>
      <div style="width:80px;"><div class="skeleton skeleton-text w-60" style="margin-bottom:0;"></div></div>
    </div>
  `).join('') + '</div>';
  if (auditsContainer) auditsContainer.innerHTML = '<div class="skeleton-table">' + Array(3).fill(`
    <div class="skeleton-row">
      <div style="flex:1;"><div class="skeleton skeleton-text w-40"></div></div>
      <div style="width:120px;"><div class="skeleton skeleton-text w-50" style="margin-bottom:0;"></div></div>
    </div>
  `).join('') + '</div>';

  try {
    const searchVal = document.getElementById('admin-refunds-search')?.value?.trim() || '';
    const statusVal = document.getElementById('admin-refunds-filter-status')?.value || '';

    const params = new URLSearchParams();
    if (searchVal) params.set('search', searchVal);
    if (statusVal) params.set('status', statusVal);

    const [dashRes, auditRes] = await Promise.all([
      fetchWithAuth(`/refunds/dashboard?${params.toString()}`),
      fetchWithAuth('/refunds/audit-logs'),
    ]);

    _refundsDashboardData = dashRes;
    renderRefundStats(dashRes.stats || {});
    renderRefundQueue(dashRes.refunds || []);
    renderAuditLogs(auditRes || []);
  } catch (err) {
    const errMsg = getApiErrorMessage(err) || 'Failed to load refunds dashboard.';
    if (tableContainer) tableContainer.innerHTML = `<p style="color:#ef4444;padding:1rem;">${errMsg}</p>`;
    if (auditsContainer) auditsContainer.innerHTML = `<p style="color:#ef4444;padding:1rem;">${errMsg}</p>`;
  }
}

function renderRefundStats(stats) {
  const el = (id) => document.getElementById(id);
  if (el('admin-refund-stat-total')) el('admin-refund-stat-total').textContent = `\u20b9${Number(stats.totalRefunded || 0).toFixed(2)}`;
  if (el('admin-refund-stat-pending')) el('admin-refund-stat-pending').textContent = stats.pendingCount || 0;
  if (el('admin-refund-stat-failed')) el('admin-refund-stat-failed').textContent = stats.failedCount || 0;
  if (el('admin-refund-stat-count')) el('admin-refund-stat-count').textContent = stats.totalCount || 0;
}

function renderRefundQueue(refunds) {
  const container = document.getElementById('admin-refunds-table-container');
  if (!container) return;

  if (!refunds.length) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#475569;"><i class="fa-solid fa-check-circle" style="font-size:2rem;color:#38b17b;display:block;margin-bottom:12px;"></i>No refunds matching your filters.</div>`;
    return;
  }

  const rows = refunds.map(r => {
    const created = r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
    const processed = r.processed_at ? new Date(r.processed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-';
    const isRetryable = r.refund_status === 'failed' || r.status === 'failed';
    const isPending = (r.refund_status === 'initiated' || r.status === 'initiated');
    const orderId = r.order_id || '-';
    const shortOrder = orderId.length > 8 ? `RUN-${orderId.substring(0, 8).toUpperCase()}` : orderId;

    return `
      <tr style="border-bottom:1px solid rgba(56,177,123,0.06);transition:background 0.15s;" onmouseenter="this.style.background='rgba(56,177,123,0.03)'" onmouseleave="this.style.background='transparent'">
        <td style="padding:12px 8px;font-size:0.78rem;color:#94a3b8;">${created}</td>
        <td style="padding:12px 8px;">
          <div style="font-size:0.8rem;font-weight:600;color:#e2e8f0;">${shortOrder}</div>
          <div style="font-size:0.68rem;color:#475569;margin-top:2px;">${(r.user_name || '') + (r.user_email ? ' — ' + r.user_email : '')}</div>
        </td>
        <td style="padding:12px 8px;">
          <div style="font-size:0.72rem;color:#94a3b8;font-family:monospace;">${(r.razorpay_payment_id || '-').substring(0, 18)}</div>
          <div style="font-size:0.68rem;color:#475569;">${r.razorpay_refund_id ? '↳ ' + r.razorpay_refund_id.substring(0, 16) : 'Refund ID pending'}</div>
        </td>
        <td style="padding:12px 8px;font-size:0.9rem;font-weight:700;color:#38b17b;">\u20b9${Number(r.refund_amount || 0).toFixed(2)}</td>
        <td style="padding:12px 8px;">${getRefundStatusBadge(r.refund_status || r.status)}</td>
        <td style="padding:12px 8px;font-size:0.72rem;color:#64748b;">${processed}</td>
        <td style="padding:12px 8px;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${isPending ? `<button class="btn btn-secondary" style="font-size:0.7rem;padding:4px 10px;" onclick="adminApproveRefund('${r.order_id}')"><i class="fa-solid fa-circle-check"></i> Approve</button>` : ''}
            ${isRetryable ? `<button class="btn btn-primary" style="font-size:0.7rem;padding:4px 10px;" onclick="adminRetryRefund('${r.order_id}')"><i class="fa-solid fa-rotate-right"></i> Retry</button>` : ''}
            ${['paid', 'REFUND_INITIATED', 'REFUND_PROCESSING'].includes(r.order_status) ? `<button class="btn btn-secondary" style="font-size:0.7rem;padding:4px 10px;" onclick="adminPartialRefundModal('${r.order_id}')"><i class="fa-solid fa-hand-holding-dollar"></i> Partial</button>` : ''}
            <button class="btn btn-secondary" style="font-size:0.7rem;padding:4px 10px;" onclick="adminViewRefundDetails('${r.order_id}')"><i class="fa-solid fa-eye"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(56,177,123,0.12);">
            <th style="padding:10px 8px;text-align:left;font-size:0.72rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Date</th>
            <th style="padding:10px 8px;text-align:left;font-size:0.72rem;color:#64748b;font-weight:600;text-transform:uppercase;">Order / Customer</th>
            <th style="padding:10px 8px;text-align:left;font-size:0.72rem;color:#64748b;font-weight:600;text-transform:uppercase;">Transaction IDs</th>
            <th style="padding:10px 8px;text-align:left;font-size:0.72rem;color:#64748b;font-weight:600;text-transform:uppercase;">Amount</th>
            <th style="padding:10px 8px;text-align:left;font-size:0.72rem;color:#64748b;font-weight:600;text-transform:uppercase;">Status</th>
            <th style="padding:10px 8px;text-align:left;font-size:0.72rem;color:#64748b;font-weight:600;text-transform:uppercase;">Processed</th>
            <th style="padding:10px 8px;text-align:left;font-size:0.72rem;color:#64748b;font-weight:600;text-transform:uppercase;">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderAuditLogs(logs) {
  const container = document.getElementById('admin-refund-audits-container');
  if (!container) return;

  if (!logs.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:#475569;">No audit log entries found.</div>`;
    return;
  }

  const iconMap = {
    CANCEL_REQUESTED: { icon: 'fa-ban', color: '#f59e0b' },
    CANCEL_APPROVED: { icon: 'fa-check-circle', color: '#10b981' },
    CANCEL_REJECTED: { icon: 'fa-times-circle', color: '#ef4444' },
    REFUND_INITIATED: { icon: 'fa-rotate-right', color: '#8b5cf6' },
    REFUND_COMPLETED: { icon: 'fa-circle-check', color: '#10b981' },
    REFUND_FAILED: { icon: 'fa-triangle-exclamation', color: '#ef4444' },
    MANUAL_REFUND_INITIATED: { icon: 'fa-hand-holding-dollar', color: '#d97706' },
    MANUAL_REFUND_COMPLETED: { icon: 'fa-circle-check', color: '#10b981' },
    ADMIN_CANCELLED: { icon: 'fa-user-slash', color: '#ef4444' },
    REFUND_RETRIED: { icon: 'fa-arrow-rotate-right', color: '#3b82f6' },
  };

  const entries = logs.slice(0, 50).map(log => {
    const ts = log.created_at ? new Date(log.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const icon = iconMap[log.action] || { icon: 'fa-circle-info', color: '#94a3b8' };
    const actor = log.actor_role === 'admin' ? `<span style="color:#38b17b;font-size:0.68rem;font-weight:700;">ADMIN</span>` : `<span style="color:#94a3b8;font-size:0.68rem;">CUSTOMER</span>`;
    const shortOrder = log.order_id ? `RUN-${log.order_id.substring(0, 8).toUpperCase()}` : '-';

    return `
      <div style="display:flex;align-items:flex-start;gap:14px;padding:12px 4px;border-bottom:1px solid rgba(56,177,123,0.05);">
        <div style="width:32px;height:32px;border-radius:50%;background:rgba(${icon.color.replace('#', '').match(/../g).map(h => parseInt(h, 16)).join(',')},0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;">
          <i class="fa-solid ${icon.icon}" style="color:${icon.color};font-size:0.75rem;"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
            ${actor}
            <span style="font-size:0.78rem;font-weight:600;color:#e2e8f0;">${(log.action || '').replace(/_/g, ' ')}</span>
            <span style="font-size:0.7rem;color:#475569;">• ${shortOrder}</span>
          </div>
          ${log.notes ? `<div style="font-size:0.73rem;color:#94a3b8;margin-bottom:3px;">${log.notes}</div>` : ''}
          ${log.meta ? `<div style="font-size:0.68rem;color:#475569;font-family:monospace;">${typeof log.meta === 'object' ? JSON.stringify(log.meta).substring(0, 80) : String(log.meta).substring(0, 80)}</div>` : ''}
        </div>
        <div style="font-size:0.68rem;color:#475569;white-space:nowrap;flex-shrink:0;">${ts}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div style="max-height:420px;overflow-y:auto;">${entries}</div>`;
}

async function adminApproveRefundModal(orderId) {
  const existing = document.getElementById('admin-approve-refund-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-approve-refund-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0d1f1a;border:1px solid rgba(56,177,123,0.3);border-radius:16px;max-width:480px;width:100%;padding:28px;color:#e2e8f0;box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;font-size:1.15rem;color:#38b17b;"><i class="fa-solid fa-circle-check"></i> Approve Cancellation & Refund</h3>
        <button onclick="document.getElementById('admin-approve-refund-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 16px;font-size:0.88rem;color:#94a3b8;line-height:1.5;">
        You are approving the cancellation request for Order #<strong style="color:#38b17b;">${orderId}</strong>.
      </p>
      <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);border-radius:10px;padding:12px;margin-bottom:16px;font-size:0.8rem;color:#f59e0b;">
        <i class="fa-solid fa-hand-holding-dollar"></i> <strong>Manual Refund Only</strong> — No auto-refund. Admin must process refund manually via order card steps: Initiated → Processing → Completed.
      </div>
      <div class="input-field" style="margin-bottom:20px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Admin Note (Optional)</label>
        <textarea id="admin-approve-refund-note" rows="2" placeholder="Approval notes (sent to user)..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-approve-refund-modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="admin-approve-refund-confirm" style="background:#38b17b;border:none;">Approve & Cancel Order</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#admin-approve-refund-confirm').addEventListener('click', async () => {
    const adminNote = modal.querySelector('#admin-approve-refund-note').value.trim();
    modal.remove();

    try {
      await fetchWithAuth(`/refunds/cancel-requests/${orderId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ adminNote }),
      });
      showSuccessToast(`✅ Cancellation approved. Manual refund tracking started — use the order card to progress refund steps.`);
      fetchAdminOrders();
      loadRefundsDashboard();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Failed to approve cancellation.');
    }
  });
}
globalThis.adminApproveRefundModal = adminApproveRefundModal;
globalThis.adminApproveRefund = adminApproveRefundModal;

async function adminRejectRefundModal(orderId) {
  const existing = document.getElementById('admin-reject-refund-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-reject-refund-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0d1f1a;border:1px solid rgba(239,68,68,0.3);border-radius:16px;max-width:480px;width:100%;padding:28px;color:#e2e8f0;box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;font-size:1.15rem;color:#f87171;"><i class="fa-solid fa-ban"></i> Reject Cancellation Request</h3>
        <button onclick="document.getElementById('admin-reject-refund-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 16px;font-size:0.88rem;color:#94a3b8;line-height:1.5;">
        You are rejecting the cancellation request for Order #<strong style="color:#f87171;">${orderId}</strong>. The order will remain active.
      </p>
      <div class="input-field" style="margin-bottom:20px;">
        <label style="color:#f87171;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Rejection Reason *</label>
        <textarea id="admin-reject-refund-reason" rows="3" placeholder="Explain why cancellation is rejected..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-reject-refund-modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="admin-reject-refund-confirm" style="background:#ef4444;border:none;">Reject Request</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#admin-reject-refund-confirm').addEventListener('click', async () => {
    const reason = modal.querySelector('#admin-reject-refund-reason').value.trim();
    if (!reason) { showErrorToast('Rejection reason is required.'); return; }
    modal.remove();

    try {
      await fetchWithAuth(`/refunds/cancel-requests/${orderId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      showSuccessToast('Cancellation request rejected.');
      fetchAdminOrders();
      loadRefundsDashboard();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Failed to reject cancellation.');
    }
  });
}
globalThis.adminRejectRefundModal = adminRejectRefundModal;
globalThis.adminRejectRefund = adminRejectRefundModal;

async function adminRetryRefund(orderId) {
  try {
    await fetchWithAuth(`/refunds/retry/${orderId}`, { method: 'POST' });
    showSuccessToast('\u2705 Refund retry initiated.');
    loadRefundsDashboard();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to retry refund.');
  }
}
globalThis.adminRetryRefund = adminRetryRefund;

function adminManualRefundInitiate(orderId) {
  const existing = document.getElementById('admin-manual-refund-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-manual-refund-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0d1f1a;border:1px solid rgba(56,177,123,0.3);border-radius:16px;max-width:480px;width:100%;padding:28px;color:#e2e8f0;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;font-size:1.15rem;color:#d97706;"><i class="fa-solid fa-hand-holding-dollar"></i> Manual Refund</h3>
        <button onclick="document.getElementById('admin-manual-refund-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 16px;font-size:0.88rem;color:#94a3b8;line-height:1.5;">
        Initiate manual refund for Order #<strong style="color:#38b17b;">${orderId}</strong>. Select the payment mode used for the offline refund.
      </p>
      <div class="input-field" style="margin-bottom:14px;">
        <label style="color:#f59e0b;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Payment Mode *</label>
        <select id="manual-refund-payment-mode" style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;">
          <option value="">— Select payment mode —</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="upi">UPI</option>
          <option value="cash">Cash</option>
          <option value="cheque">Cheque</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="input-field" style="margin-bottom:14px;">
        <label style="color:#e2e8f0;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Payment Details / Reference</label>
        <input type="text" id="manual-refund-payment-details" placeholder="e.g. UTR number, cheque no, bank ref..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;" />
      </div>
      <div class="input-field" style="margin-bottom:20px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Admin Note (Optional)</label>
        <textarea id="manual-refund-admin-note" rows="2" placeholder="Internal notes..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-manual-refund-modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="admin-manual-refund-confirm" style="background:#d97706;border:none;color:#0d1f1a;font-weight:700;">Initiate Manual Refund</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#admin-manual-refund-confirm').addEventListener('click', async () => {
    const paymentMode = modal.querySelector('#manual-refund-payment-mode').value;
    const paymentDetails = modal.querySelector('#manual-refund-payment-details').value.trim();
    const adminNote = modal.querySelector('#manual-refund-admin-note').value.trim();

    if (!paymentMode) { showErrorToast('Please select a payment mode.'); return; }

    modal.remove();

    try {
      const result = await fetchWithAuth(`/refunds/manual-refund/${orderId}/initiate`, {
        method: 'POST',
        body: JSON.stringify({ paymentMode, paymentDetails, adminNote }),
      });
      showSuccessToast('✅ Manual refund initiated. Complete the refund offline and mark as completed.');
      loadRefundsDashboard();
      fetchAdminOrders();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Failed to initiate manual refund.');
    }
  });
}
globalThis.adminManualRefundInitiate = adminManualRefundInitiate;

function adminManualRefundComplete(orderId) {
  const existing = document.getElementById('admin-manual-refund-complete-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-manual-refund-complete-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0d1f1a;border:1px solid rgba(56,177,123,0.3);border-radius:16px;max-width:440px;width:100%;padding:28px;color:#e2e8f0;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;font-size:1.15rem;color:#10b981;"><i class="fa-solid fa-circle-check"></i> Complete Manual Refund</h3>
        <button onclick="document.getElementById('admin-manual-refund-complete-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 16px;font-size:0.88rem;color:#94a3b8;line-height:1.5;">
        Confirm that the manual refund for Order #<strong style="color:#38b17b;">${orderId}</strong> has been processed offline.
      </p>
      <div class="input-field" style="margin-bottom:20px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Admin Note (Optional)</label>
        <textarea id="manual-refund-complete-note" rows="2" placeholder="Completion notes..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-manual-refund-complete-modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="admin-manual-refund-complete-confirm" style="background:#10b981;border:none;color:#0d1f1a;font-weight:700;">Confirm Completion</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#admin-manual-refund-complete-confirm').addEventListener('click', async () => {
    const adminNote = modal.querySelector('#manual-refund-complete-note').value.trim();
    modal.remove();

    try {
      await fetchWithAuth(`/refunds/manual-refund/${orderId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ adminNote }),
      });
      showSuccessToast('✅ Manual refund marked as completed.');
      loadRefundsDashboard();
      fetchAdminOrders();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Failed to complete manual refund.');
    }
  });
}
globalThis.adminManualRefundComplete = adminManualRefundComplete;

/**
 * Admin: Progress manual refund step (initiated → processing → completed)
 */
async function adminProgressRefundStep(orderId, step) {
  try {
    const result = await fetchWithAuth(`/refunds/manual-refund/${orderId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ step }),
    });
    const stepLabels = { initiated: 'Initiated', processing: 'Processing', completed: 'Completed' };
    showSuccessToast(`✅ Manual refund marked as "${stepLabels[step] || step}".`);
    fetchAdminOrders();
    loadRefundsDashboard();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to update refund step.');
  }
}
globalThis.adminProgressRefundStep = adminProgressRefundStep;

async function adminPartialRefundModal(orderId) {
  const existing = document.getElementById('admin-partial-refund-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-partial-refund-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0d1f1a;border:1px solid rgba(56,177,123,0.3);border-radius:16px;max-width:480px;width:100%;padding:28px;color:#e2e8f0;box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;font-size:1.15rem;color:#f59e0b;"><i class="fa-solid fa-hand-holding-dollar"></i> Partial Refund</h3>
        <button onclick="document.getElementById('admin-partial-refund-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 16px;font-size:0.88rem;color:#94a3b8;line-height:1.5;">
        Process a partial refund for Order #<strong style="color:#38b17b;">${orderId}</strong>. Enter the amount to refund.
      </p>
      <div class="input-field" style="margin-bottom:14px;">
        <label style="color:#f59e0b;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Refund Amount (₹) *</label>
        <input type="number" id="admin-partial-refund-amount" min="1" step="0.01" placeholder="Enter amount" style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;" />
      </div>
      <div class="input-field" style="margin-bottom:14px;">
        <label style="color:#e2e8f0;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Reason *</label>
        <textarea id="admin-partial-refund-reason" rows="2" placeholder="Reason for partial refund" style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div class="input-field" style="margin-bottom:20px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Admin Note (Optional)</label>
        <textarea id="admin-partial-refund-note" rows="2" placeholder="Internal notes..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-partial-refund-modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="admin-partial-refund-confirm" style="background:#f59e0b;border:none;color:#0d1f1a;font-weight:700;">Process Refund</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#admin-partial-refund-confirm').addEventListener('click', async () => {
    const refundAmount = parseFloat(modal.querySelector('#admin-partial-refund-amount').value);
    const reason = modal.querySelector('#admin-partial-refund-reason').value.trim();
    const adminNote = modal.querySelector('#admin-partial-refund-note').value.trim();

    if (!refundAmount || refundAmount <= 0) { showErrorToast('Enter a valid refund amount.'); return; }
    if (!reason) { showErrorToast('Reason is required.'); return; }

    modal.remove();

    try {
      await fetchWithAuth(`/refunds/partial-refund/${orderId}`, {
        method: 'POST',
        body: JSON.stringify({ refundAmount, reason, adminNote }),
      });
      showSuccessToast(`✅ Partial refund of ₹${refundAmount.toFixed(2)} initiated.`);
      loadRefundsDashboard();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Partial refund failed.');
    }
  });
}
globalThis.adminPartialRefundModal = adminPartialRefundModal;

async function adminViewRefundDetails(orderId) {
  const existing = document.getElementById('admin-refund-detail-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-refund-detail-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0d1f1a;border:1px solid rgba(56,177,123,0.2);border-radius:16px;max-width:720px;width:100%;max-height:85vh;overflow-y:auto;padding:28px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;font-size:1.1rem;color:#e2e8f0;"><i class="fa-solid fa-hand-holding-dollar" style="color:#38b17b;"></i> Refund Details</h3>
        <button onclick="document.getElementById('admin-refund-detail-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.2rem;">&times;</button>
      </div>
      <div id="admin-refund-detail-body" style="text-align:center;padding:24px;"><i class="fa-solid fa-spinner fa-spin" style="color:#38b17b;font-size:1.5rem;"></i></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  try {
    // Fetch order data FIRST so we can fallback even without refunds-table row
    let orderData = null;
    try {
      const orderRes = await fetchWithAuth(`/orders/${orderId}`, { method: 'GET' });
      orderData = orderRes;
    } catch (e) { /* order fetch is optional */ }

    const [dashData, auditData] = await Promise.all([
      fetchWithAuth(`/refunds/dashboard?search=${encodeURIComponent(orderId)}`),
      fetchWithAuth(`/refunds/audit-logs?orderId=${encodeURIComponent(orderId)}`),
    ]);

    let refund = (dashData.refunds || []).find(r => r.order_id === orderId) || dashData.refunds?.[0];

    // Fallback: build a minimal refund object from order data
    if (!refund && orderData) {
      refund = {
        order_id: orderId,
        user_id: orderData.user_id,
        user_email: orderData.user_email || '-',
        user_name: orderData.user_name || orderData.shipping_name || '-',
        refund_amount: orderData.total || 0,
        order_total: orderData.total || 0,
        order_status: orderData.status || 'cancelled',
        order_cancel_reason: orderData.cancel_reason || '',
        refund_status: orderData.refund_status || 'pending',
        razorpay_payment_id: orderData.razorpay_payment_id || null,
        razorpay_refund_id: null,
        created_at: orderData.cancelled_at || orderData.created_at,
        processed_at: null,
        cancel_reason: orderData.cancel_reason || '',
        reason: orderData.cancel_reason || '',
        refund_reason: orderData.cancel_reason || ''
      };
    }

    if (!refund) throw new Error('Refund record not found.');

    const body = document.getElementById('admin-refund-detail-body');

    // Build items breakdown if available
    let itemsHtml = '';
    if (orderData?.items && orderData.items.length) {
      itemsHtml = `
        <div style="margin-top:16px;">
          <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Order Items</div>
          <div style="background:rgba(56,177,123,0.04);border:1px solid rgba(56,177,123,0.08);border-radius:8px;padding:8px 12px;">
            ${orderData.items.map(item => `
              <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.83rem;border-bottom:1px solid rgba(56,177,123,0.06);">
                <span style="color:#e2e8f0;">${item.name} × ${item.quantity}</span>
                <span style="color:#94a3b8;">₹${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            `).join('')}
            <div style="display:flex;justify-content:space-between;padding:6px 0 0;font-size:0.85rem;font-weight:700;color:#38b17b;">
              <span>Total</span>
              <span>₹${Number(orderData.total || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      `;
    }

    // Build timeline from audit logs
    let timelineHtml = '';
    if (auditData && auditData.length) {
      const orderAudits = auditData.filter(l => l.order_id === orderId).slice(0, 20);
      if (orderAudits.length) {
        timelineHtml = `
          <div style="margin-top:16px;">
            <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Refund Timeline</div>
            <div style="max-height:200px;overflow-y:auto;background:rgba(56,177,123,0.02);border:1px solid rgba(56,177,123,0.08);border-radius:8px;padding:8px;">
              ${orderAudits.map(log => `
                <div style="display:flex;gap:8px;padding:6px 4px;border-bottom:1px solid rgba(56,177,123,0.04);font-size:0.78rem;">
                  <span style="color:#64748b;white-space:nowrap;">${log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                  <span style="color:#e2e8f0;font-weight:600;">${(log.action || '').replace(/_/g, ' ')}</span>
                  <span style="color:#64748b;">by ${log.actor_role === 'admin' ? 'Admin' : log.performed_by ? (log.performed_by === 'SYSTEM' ? 'System' : log.performed_by.substring(0, 8)) : '-'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    }

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${[
        ['Order ID', `<a href="#" onclick="event.preventDefault();document.getElementById('admin-refund-detail-modal').remove();window.open('/admin.html#order-${refund.order_id}', '_blank');" style="color:#38b17b;text-decoration:underline;">RUN-${(refund.order_id || '').substring(0, 8).toUpperCase()}</a>`],
        ['Customer', refund.user_name || refund.user_email || '-'],
        ['Email', refund.user_email || '-'],
        ['Refund Amount', `\u20b9${Number(refund.refund_amount || 0).toFixed(2)}`],
        ['Order Total', `\u20b9${Number(refund.order_total || 0).toFixed(2)}`],
        ['Refund Status', refund.refund_status || refund.status || '-'],
        ['Order Status', refund.order_status || '-'],
        ['Payment ID', `<span style="font-family:monospace;font-size:0.75rem;">${(refund.razorpay_payment_id || '-').substring(0, 20)}</span>`],
        ['Refund ID', refund.razorpay_refund_id ? `<span style="font-family:monospace;font-size:0.75rem;">${refund.razorpay_refund_id.substring(0, 20)}</span>` : '<span style="color:#f59e0b;">Pending</span>'],
        ['Initiated At', refund.created_at ? new Date(refund.created_at).toLocaleString('en-IN') : '-'],
        ['Processed At', refund.processed_at ? new Date(refund.processed_at).toLocaleString('en-IN') : '-'],
        ['Reason', refund.cancel_reason || refund.reason || refund.order_cancel_reason || refund.refund_reason || '-'],
      ].map(([label, val]) => `
          <div style="background:rgba(56,177,123,0.04);border:1px solid rgba(56,177,123,0.08);border-radius:8px;padding:10px;">
            <div style="font-size:0.68rem;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:4px;">${label}</div>
            <div style="font-size:0.83rem;color:#e2e8f0;word-break:break-all;">${val}</div>
          </div>
        `).join('')}
      </div>
      ${itemsHtml}
      ${timelineHtml}
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap;">
        ${(refund.refund_status === 'failed' || refund.status === 'failed') ? `<button class="btn btn-primary" onclick="adminRetryRefund('${orderId}');document.getElementById('admin-refund-detail-modal').remove();"><i class="fa-solid fa-rotate-right"></i> Retry Refund</button>` : ''}
        ${(refund.order_status === 'CANCEL_REQUESTED') ? `<button class="btn btn-primary" onclick="adminApproveRefund('${orderId}');document.getElementById('admin-refund-detail-modal').remove();"><i class="fa-solid fa-check"></i> Approve</button><button class="btn btn-cancel" onclick="adminRejectRefund('${orderId}');document.getElementById('admin-refund-detail-modal').remove();"><i class="fa-solid fa-xmark"></i> Reject</button>` : ''}
        ${['paid', 'REFUND_INITIATED', 'REFUND_PROCESSING'].includes(refund.order_status) ? `<button class="btn btn-secondary" onclick="adminPartialRefundModal('${orderId}');document.getElementById('admin-refund-detail-modal').remove();"><i class="fa-solid fa-hand-holding-dollar"></i> Partial Refund</button>` : ''}
        <button class="btn btn-secondary" onclick="document.getElementById('admin-refund-detail-modal').remove();">Close</button>
      </div>
    `;
  } catch (err) {
    const body = document.getElementById('admin-refund-detail-body');
    if (body) body.innerHTML = `<p style="color:#ef4444;">Error: ${getApiErrorMessage(err)}</p>`;
  }
}
globalThis.adminViewRefundDetails = adminViewRefundDetails;

async function adminDirectCancelModal(orderId) {
  const existing = document.getElementById('admin-direct-cancel-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-direct-cancel-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
    <div style="background:#0d1f1a;border:1px solid rgba(239,68,68,0.3);border-radius:16px;max-width:520px;width:100%;padding:28px;color:#e2e8f0;box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;font-size:1.15rem;color:#f87171;"><i class="fa-solid fa-ban"></i> Cancel Order</h3>
        <button onclick="document.getElementById('admin-direct-cancel-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 12px;font-size:0.85rem;color:#94a3b8;line-height:1.5;">
        Order #<strong style="color:#f87171;">${orderId}</strong> will be cancelled. Refund must be processed manually by the admin through the order card.
      </p>

      <div style="margin-bottom:16px;">
        <div style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;color:#94a3b8;margin-bottom:8px;">Manual Refund Process:</div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:#cbd5e1;"><span style="width:18px;height:18px;border-radius:50%;background:rgba(56,177,123,0.2);color:#38b17b;display:flex;align-items:center;justify-content:center;font-size:0.55rem;flex-shrink:0;"><i class="fa-solid fa-check"></i></span> Order cancelled — items auto-restocked</div>
          <div style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:#cbd5e1;"><span style="width:18px;height:18px;border-radius:50%;background:rgba(56,177,123,0.2);color:#38b17b;display:flex;align-items:center;justify-content:center;font-size:0.55rem;flex-shrink:0;"><i class="fa-solid fa-check"></i></span> No auto-refund — admin processes refund manually</div>
          <div style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:#94a3b8;"><span style="width:18px;height:18px;border-radius:50%;background:rgba(245,158,11,0.15);color:#fbbf24;display:flex;align-items:center;justify-content:center;font-size:0.55rem;flex-shrink:0;"><i class="fa-solid fa-hand-holding-dollar"></i></span> After cancel → use <strong style="color:#fbbf24;">Manual Refund steps</strong> in order card to progress: Initiated → Processing → Completed</div>
        </div>
      </div>

      <div class="input-field" style="margin-bottom:14px;">
        <label style="color:#f87171;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Cancellation Reason *</label>
        <select id="admin-direct-cancel-reason" style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;">
          <option value="">Select a reason</option>
          <option value="Stock not available">Stock not available</option>
          <option value="Area not serviceable">Area not serviceable</option>
          <option value="Invalid shipping address">Invalid shipping address</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="input-field" id="admin-direct-cancel-other-wrap" style="margin-bottom:14px;display:none;">
        <label style="color:#f87171;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Please specify reason *</label>
        <input type="text" id="admin-direct-cancel-other" placeholder="Enter reason" style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;" />
      </div>
      <div class="input-field" style="margin-bottom:20px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Admin Note (Optional)</label>
        <textarea id="admin-direct-cancel-note" rows="2" placeholder="Internal notes..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-direct-cancel-modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="admin-direct-cancel-confirm" style="background:#ef4444;border:none;">Confirm Cancellation</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const reasonSelect = modal.querySelector('#admin-direct-cancel-reason');
  const otherWrap = modal.querySelector('#admin-direct-cancel-other-wrap');
  const otherInput = modal.querySelector('#admin-direct-cancel-other');

  reasonSelect.addEventListener('change', () => {
    otherWrap.style.display = reasonSelect.value === 'Other' ? 'block' : 'none';
  });

  modal.querySelector('#admin-direct-cancel-confirm').addEventListener('click', async () => {
    let reason = reasonSelect.value;
    if (!reason) { showErrorToast('Please select a cancellation reason.'); return; }
    if (reason === 'Other') {
      reason = otherInput.value.trim();
      if (!reason) { showErrorToast('Please enter the cancellation reason.'); return; }
    }
    const adminNote = modal.querySelector('#admin-direct-cancel-note').value.trim();

    modal.remove();

    try {
      await fetchWithAuth(`/refunds/admin-cancel/${orderId}`, {
        method: 'POST',
        body: JSON.stringify({ reason, adminNote }),
      });
      showSuccessToast('✅ Order cancelled. Manual refund tracking started — progress via order card.');
      fetchAdminOrders();
      loadRefundsDashboard();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Admin cancellation failed.');
    }
  });
}
globalThis.adminDirectCancelModal = adminDirectCancelModal;
globalThis.adminDirectCancel = adminDirectCancelModal;

/* ── Returns Tab ── */

async function loadReturnsDashboard() {
  const container = document.getElementById('admin-returns-table-container');
  if (!container) return;

  const search = (document.getElementById('admin-returns-search')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('admin-returns-filter-status')?.value || '';

  container.innerHTML = '<div class="skeleton-table">' + Array(4).fill(`
    <div class="skeleton-row">
      <div style="flex:1;"><div class="skeleton skeleton-text w-50"></div></div>
      <div style="width:100px;"><div class="skeleton skeleton-text w-40" style="margin-bottom:0;"></div></div>
      <div style="width:80px;"><div class="skeleton skeleton-text w-50" style="margin-bottom:0;"></div></div>
    </div>
  `).join('') + '</div>';

  try {
    const res = await fetchWithAuth('/returns/admin/all');
    let returns = Array.isArray(res.returns) ? res.returns :
                  Array.isArray(res.data) ? res.data :
                  Array.isArray(res) ? res : [];

    let pending = 0, approved = 0, warehouse = 0;

    if (search) {
      returns = returns.filter(r =>
        (r.id || '').toLowerCase().includes(search) ||
        (r.order_id || '').toLowerCase().includes(search) ||
        (r.user_email || r.email || '').toLowerCase().includes(search) ||
        (r.user_phone || r.phone || '').toLowerCase().includes(search)
      );
    }
    if (statusFilter) {
      returns = returns.filter(r => r.status === statusFilter);
    }

    returns.forEach(r => {
      if (r.status === 'requested') pending++;
      if (r.status === 'approved' || r.status === 'pickup_scheduled' || r.status === 'pickup_completed') approved++;
      if (r.status === 'warehouse_received' || r.status === 'qc_passed' || r.status === 'qc_failed') warehouse++;
    });
    document.getElementById('admin-return-stat-pending').textContent = pending;
    document.getElementById('admin-return-stat-approved').textContent = approved;
    document.getElementById('admin-return-stat-warehouse').textContent = warehouse;
    document.getElementById('admin-return-stat-total').textContent = returns.length;

    if (!returns.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fa-solid fa-rotate-left" style="font-size:2rem;margin-bottom:12px;"></i><p>No returns found.</p></div>';
      return;
    }

    container.innerHTML = `<div class="refund-table-wrap" style="overflow-x:auto;"><table class="refund-table">
      <thead>
        <tr>
          <th>Return ID</th>
          <th>Order ID</th>
          <th>Customer</th>
          <th>Type</th>
          <th>Reason</th>
          <th>Status</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${returns.map(r => renderReturnRow(r)).join('')}
      </tbody>
    </table></div>`;
  } catch (err) {
    container.innerHTML = `<div class="admin-error">${getApiErrorMessage(err) || 'Failed to load returns'}</div>`;
  }
}
globalThis.loadReturnsDashboard = loadReturnsDashboard;

function renderReturnRow(r) {
  const statusBadge = getReturnAdminBadge(r.status);
  const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const customerName = r.user_name || r.user_email || r.email || '—';
  const typeIcon = r.type === 'replacement' ? 'fa-box' : r.type === 'exchange' ? 'fa-arrows-rotate' : 'fa-money-bill-wave';

  let actions = '';
  if (r.status === 'requested') {
    actions = `<div style="display:flex;gap:6px;">
      <button class="btn btn-sm btn-primary" onclick="adminApproveReturn('${r.id}')">Approve</button>
      <button class="btn btn-sm btn-danger" onclick="adminRejectReturn('${r.id}')" style="background:#dc2626;">Reject</button>
    </div>`;
  } else if (r.status === 'approved') {
    actions = `<button class="btn btn-sm btn-secondary" onclick="adminSchedulePickup('${r.id}')">Schedule Pickup</button>`;
  } else if (r.status === 'pickup_completed' || r.status === 'warehouse_received') {
    actions = `<button class="btn btn-sm btn-secondary" onclick="adminPerformQC('${r.id}')">Perform QC</button>`;
  }

  return `<tr>
    <td style="font-family:monospace;font-size:0.8rem;">${r.id.substring(0, 8)}</td>
    <td style="font-family:monospace;font-size:0.8rem;">${r.order_id.substring(0, 8)}</td>
    <td>${customerName}</td>
    <td><i class="fa-solid ${typeIcon}"></i> ${r.type || 'refund'}</td>
    <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.reason || '—'}</td>
    <td>${statusBadge}</td>
    <td style="font-size:0.8rem;white-space:nowrap;">${dateStr}</td>
    <td>${actions || '<span style="color:#94a3b8;font-size:0.8rem;">—</span>'}</td>
  </tr>`;
}

function getReturnAdminBadge(status) {
  const map = {
    requested:          '<span class="admin-badge" style="background:#f59e0b20;color:#f59e0b;">Requested</span>',
    approved:           '<span class="admin-badge" style="background:#3b82f620;color:#3b82f6;">Approved</span>',
    rejected:           '<span class="admin-badge" style="background:#ef444420;color:#ef4444;">Rejected</span>',
    pickup_scheduled:   '<span class="admin-badge" style="background:#8b5cf620;color:#8b5cf6;">Pickup Scheduled</span>',
    pickup_completed:   '<span class="admin-badge" style="background:#8b5cf620;color:#8b5cf6;">Pickup Done</span>',
    warehouse_received: '<span class="admin-badge" style="background:#06b6d420;color:#06b6d4;">Warehouse Received</span>',
    qc_passed:          '<span class="admin-badge" style="background:#10b98120;color:#10b981;">QC Passed</span>',
    qc_failed:          '<span class="admin-badge" style="background:#ef444420;color:#ef4444;">QC Failed</span>',
    refund_pending:     '<span class="admin-badge" style="background:#f59e0b20;color:#f59e0b;">Refund Pending</span>',
    refund_completed:   '<span class="admin-badge" style="background:#10b98120;color:#10b981;">Refunded</span>',
    replacement_created:'<span class="admin-badge" style="background:#3b82f620;color:#3b82f6;">Replacement Created</span>',
    closed:             '<span class="admin-badge" style="background:#64748b20;color:#64748b;">Closed</span>',
  };
  return map[status] || `<span class="admin-badge" style="background:#64748b20;color:#64748b;">${status}</span>`;
}
globalThis.getReturnAdminBadge = getReturnAdminBadge;

async function adminApproveReturn(returnId) {
  try {
    const res = await fetchWithAuth(`/returns/admin/${returnId}/approve`, { method: 'POST' });
    showSuccessToast(res.message || 'Return approved.');
    searchAndFilterReturns();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to approve return.');
  }
}
globalThis.adminApproveReturn = adminApproveReturn;

async function adminRejectReturn(returnId) {
  const reason = prompt('Enter rejection reason:');
  if (!reason || !reason.trim()) return;
  try {
    const res = await fetchWithAuth(`/returns/admin/${returnId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason.trim() }),
    });
    showSuccessToast(res.message || 'Return rejected.');
    searchAndFilterReturns();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to reject return.');
  }
}
globalThis.adminRejectReturn = adminRejectReturn;

async function adminSchedulePickup(returnId) {
  const date = prompt('Pickup date (YYYY-MM-DD):');
  if (!date) return;
  const timeSlot = prompt('Time slot (e.g., 10:00-14:00):', '10:00-14:00') || '10:00-14:00';
  try {
    const res = await fetchWithAuth(`/returns/admin/${returnId}/schedule-pickup`, {
      method: 'POST',
      body: JSON.stringify({ pickupDate: date, timeSlot }),
    });
    showSuccessToast(res.message || 'Pickup scheduled.');
    searchAndFilterReturns();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to schedule pickup.');
  }
}
globalThis.adminSchedulePickup = adminSchedulePickup;

async function adminPerformQC(returnId) {
  const result = prompt('QC result (pass/fail):');
  if (!result || !['pass', 'fail'].includes(result.toLowerCase())) {
    showErrorToast('Enter "pass" or "fail".');
    return;
  }
  const comments = prompt('QC comments (optional):') || '';
  try {
    const res = await fetchWithAuth(`/returns/admin/${returnId}/qc`, {
      method: 'POST',
      body: JSON.stringify({ result: result.toLowerCase(), comments }),
    });
    showSuccessToast(res.message || 'QC recorded.');
    searchAndFilterReturns();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to record QC.');
  }
}
globalThis.adminPerformQC = adminPerformQC;

function searchAndFilterReturns() {
  loadReturnsDashboard();
}
globalThis.searchAndFilterReturns = searchAndFilterReturns;

// Wire up search/filter listeners for returns
document.addEventListener('DOMContentLoaded', () => {
  const searchEl = document.getElementById('admin-returns-search');
  const filterEl = document.getElementById('admin-returns-filter-status');
  if (searchEl) searchEl.addEventListener('input', debounce(() => searchAndFilterReturns(), 400));
  if (filterEl) filterEl.addEventListener('change', () => searchAndFilterReturns());
});

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ── Shipments Tab ── */
async function loadShipmentsTab() {
  const container = document.getElementById('admin-shipments-table-container');
  if (!container) return;
  container.innerHTML = '<div class="skeleton-table">' + Array(4).fill(`
    <div class="skeleton-row">
      <span class="skeleton skeleton-avatar" style="width:32px;height:32px;"></span>
      <div style="flex:1;"><div class="skeleton skeleton-text w-40"></div></div>
      <div style="width:80px;"><div class="skeleton skeleton-text w-50" style="margin-bottom:0;"></div></div>
    </div>
  `).join('') + '</div>';

  try {
    let shipments = adminShipmentsCache;
    if (!shipments.length) {
      const orders = adminOrdersCache;
      shipments = orders.map(o => ({
        order_id: o.id,
        awb_code: o.shipment_awb || (o.shipment ? o.shipment.awb_code : null) || null,
        courier_name: o.shipment_courier || (o.shipment ? o.shipment.courier_name : null) || null,
        status: o.shipment_status || (o.shipment ? o.shipment.status : null) || o.delivery_status,
        tracking_url: o.shipment_tracking_url || (o.shipment ? o.shipment.tracking_url : null) || null,
        label_url: o.shipment_label_url || (o.shipment ? o.shipment.label_url : null) || null,
        shipped_at: o.shipped_at || null,
        delivered_at: o.delivered_at || null,
        customer_name: o.customer_name || '',
      })).filter(s => s.awb_code || !['placed', 'processing', 'inoculating'].includes(s.status));
    }

    const searchVal = (document.getElementById('admin-shipments-search')?.value || '').toLowerCase();
    const filterVal = document.getElementById('admin-shipments-filter-status')?.value || '';

    let filtered = shipments;
    if (searchVal) {
      filtered = filtered.filter(s =>
        s.order_id.toLowerCase().includes(searchVal) ||
        (s.awb_code || '').toLowerCase().includes(searchVal) ||
        (s.courier_name || '').toLowerCase().includes(searchVal)
      );
    }
    if (filterVal) {
      filtered = filtered.filter(s => s.status === filterVal);
    }

    // Update stats
    document.getElementById('admin-shipment-stat-total').textContent = shipments.length;
    document.getElementById('admin-shipment-stat-pending').textContent = shipments.filter(s => ['pending', 'pickup_scheduled'].includes(s.status)).length;
    document.getElementById('admin-shipment-stat-transit').textContent = shipments.filter(s => ['shipped', 'in_transit', 'out_for_delivery'].includes(s.status)).length;
    document.getElementById('admin-shipment-stat-delivered').textContent = shipments.filter(s => s.status === 'delivered').length;
    document.getElementById('admin-shipment-stat-ndr').textContent = shipments.filter(s => s.status === 'ndr').length;

    if (!filtered.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-box-open" style="font-size:2rem;display:block;margin-bottom:12px;opacity:0.4;"></i>No shipments found.</div>';
      return;
    }

    const statusColors = {
      pending: '#f59e0b',
      pickup_scheduled: '#3b82f6',
      picked_up: '#8b5cf6',
      shipped: '#10b981',
      in_transit: '#3b82f6',
      out_for_delivery: '#8b5cf6',
      delivered: '#10b981',
      cancelled: '#ef4444',
      returned: '#ef4444',
      ndr: '#dc2626',
    };

    const rows = filtered.map(s => `
      <tr>
        <td><strong>#${s.order_id}</strong></td>
        <td>${s.customer_name || '—'}</td>
        <td>${s.awb_code ? `<code class="aoc-ship-awb">${s.awb_code}</code>` : '<span style="color:#94a3b8;">—</span>'}</td>
        <td>${s.courier_name || '<span style="color:#94a3b8;">—</span>'}</td>
        <td><span class="aoc-ship-status ${s.status}" style="background:${statusColors[s.status] || '#64748b'}20;color:${statusColors[s.status] || '#64748b'};border:1px solid ${statusColors[s.status] || '#64748b'}30;border-radius:999px;padding:2px 10px;font-size:0.78rem;font-weight:600;white-space:nowrap;">${(s.status || 'unknown').replace(/_/g, ' ')}</span></td>
        <td>${s.shipped_at ? new Date(s.shipped_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</td>
        <td>
          <div style="display:flex;gap:6px;">
            ${s.tracking_url ? `<a href="${s.tracking_url}" target="_blank" class="aoc-btn" title="Track"><i class="fa-solid fa-location-dot"></i></a>` : ''}
            ${s.label_url ? `<a href="${s.label_url}" target="_blank" class="aoc-btn" title="Label"><i class="fa-solid fa-file-lines"></i></a>` : ''}
            ${s.status && s.status !== 'cancelled' && s.status !== 'delivered' ? `
              <button class="aoc-btn" style="color:#ef4444;" onclick="globalThis.cancelShipmentFromTab('${s.order_id}')" title="Cancel Shipment">
                <i class="fa-solid fa-ban"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="admin-shipments-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>AWB</th>
              <th>Courier</th>
              <th>Status</th>
              <th>Shipped</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="admin-loading" style="color:#e74c3c;">Failed to load shipments.</div>`;
  }
}

// Cancel shipment from the Shipments tab
async function cancelShipmentFromTab(orderId) {
  if (!confirm(`Cancel shipment for order #${orderId}? This cannot be undone.`)) return;
  try {
    const res = await fetchWithAuth(`/shipping/cancel/${orderId}`, { method: 'POST' });
    showSuccessToast(`✅ Shipment cancelled for order #${orderId}`);
    fetchAdminOrders(); // refresh cache
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to cancel shipment');
  }
}
globalThis.cancelShipmentFromTab = cancelShipmentFromTab;

// Refresh shipments cache
async function refreshShipmentsCache() {
  try {
    const data = await fetchWithAuth('/shipping/all');
    if (Array.isArray(data)) adminShipmentsCache = data;
  } catch (e) { /* ignore */ }
}
globalThis.refreshShipmentsCache = refreshShipmentsCache;

// ── Inventory Tab (Phase 4) ──────────────────────────────────────────────
async function loadInventoryTab() {
  const container = document.getElementById('admin-inventory-list');
  if (!container) return;
  container.innerHTML = '<div class="skeleton-table">' + Array(5).fill(`
    <div class="skeleton-row">
      <span class="skeleton skeleton-avatar" style="width:32px;height:32px;"></span>
      <div style="flex:1;"><div class="skeleton skeleton-text w-60"></div></div>
      <div style="width:60px;"><div class="skeleton skeleton-text w-50" style="margin-bottom:0;"></div></div>
      <div style="width:80px;"><div class="skeleton skeleton-text w-40" style="margin-bottom:0;"></div></div>
    </div>
  `).join('') + '</div>';
  try {
    const data = await fetchWithAuth('/products');
    const products = Array.isArray(data) ? data : (data?.products || []);
    if (!Array.isArray(products) || products.length === 0) { container.innerHTML = '<div class="admin-error">Failed to load products</div>'; return; }

    const filter = document.getElementById('admin-inv-filter')?.value || '';
    const search = (document.getElementById('admin-inv-search')?.value || '').toLowerCase();

    let filtered = products;
    if (filter === 'low') filtered = filtered.filter(p => {
      const threshold = p.low_stock_threshold || 10;
      return (p.stock || 0) > 0 && (p.stock || 0) <= threshold;
    });
    if (filter === 'out') filtered = filtered.filter(p => (p.stock || 0) <= 0);
    if (filter === 'notify') filtered = filtered.filter(p => (p.stock || 0) <= 0);
    if (search) filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(search));

    const lowCount = products.filter(p => {
      const threshold = p.low_stock_threshold || 10;
      return (p.stock || 0) > 0 && (p.stock || 0) <= threshold;
    }).length;
    const oosCount = products.filter(p => (p.stock || 0) <= 0).length;

    document.getElementById('admin-inv-stat-low').textContent = lowCount;
    document.getElementById('admin-inv-stat-oos').textContent = oosCount;

    if (filtered.length === 0) {
      container.innerHTML = '<div class="admin-empty">No products match the current filter.</div>';
      return;
    }

    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">
      ${filtered.map(p => {
        const threshold = p.low_stock_threshold || 10;
        const available = (p.stock || 0) - (p.reserved_quantity || 0);
        const stockStatus = (p.stock || 0) <= 0 ? '🔴 Out of Stock'
          : (p.stock || 0) <= threshold ? '🟡 Low Stock'
          : '✅ In Stock';
        return `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--color-bg-secondary,#1a2332);border-radius:10px;border:1px solid var(--color-border,#334155);">
            <img src="${p.image_url || ''}" alt="${p.name}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;" />
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:0.9rem;color:#f1f5f9;">${p.name}</div>
              <div style="font-size:0.78rem;color:#94a3b8;">ID: ${p.id}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.78rem;color:#94a3b8;">${stockStatus}</div>
              <div style="font-size:0.85rem;color:#f1f5f9;">Stock: ${p.stock || 0} <span style="color:#94a3b8;">| Reserved: ${p.reserved_quantity || 0}</span></div>
              <div style="font-size:0.78rem;color:#64748b;">Available: ${available}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>`;
  } catch (err) {
    container.innerHTML = `<div class="admin-error">${err.message}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   BULK IMPORT
   ═══════════════════════════════════════════════════════════════ */
let _bulkImportFile = null;

function renderBulkImportTab() {
  const entitySelect = document.getElementById('bulk-import-entity');
  const dropzone = document.getElementById('bulk-import-dropzone');
  const fileInput = document.getElementById('bulk-import-file-input');
  const uploadBtn = document.getElementById('bulk-import-upload-btn');
  const downloadBtn = document.getElementById('bulk-import-download-template');
  const progress = document.getElementById('bulk-import-progress');
  const progressFill = document.getElementById('bulk-import-progress-fill');
  const progressLabel = document.getElementById('bulk-import-progress-label');
  const feedback = document.getElementById('bulk-import-feedback');
  const results = document.getElementById('bulk-import-results');
  const resultsBody = document.getElementById('bulk-import-results-body');

  // Reset state
  _bulkImportFile = null;
  if (fileInput) fileInput.value = '';
  if (dropzone) {
    dropzone.classList.remove('file-selected');
    const inner = dropzone.querySelector('.bulk-import-dropzone-inner');
    if (inner) {
      const fileName = inner.querySelector('.file-selected-name');
      if (fileName) fileName.remove();
      inner.querySelector('i').style.display = '';
      inner.querySelector('.bulk-import-drop-text').style.display = '';
      inner.querySelector('small').style.display = '';
    }
  }
  if (uploadBtn) uploadBtn.disabled = true;
  if (progress) progress.classList.add('hidden');
  if (feedback) feedback.classList.add('hidden');
  if (results) results.classList.add('hidden');

  // ── Dropzone click ──
  if (dropzone) {
    dropzone.onclick = () => fileInput?.click();
  }

  // ── File input change ──
  if (fileInput) {
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      if (file) setBulkFile(file, dropzone, fileInput, uploadBtn);
    };
  }

  // ── Drag and drop ──
  if (dropzone) {
    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); };
    dropzone.ondragleave = () => dropzone.classList.remove('drag-over');
    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file) {
        if (fileInput) fileInput.files = e.dataTransfer.files;
        setBulkFile(file, dropzone, fileInput, uploadBtn);
      }
    };
  }

  // ── Upload button ──
  if (uploadBtn) {
    uploadBtn.onclick = () => handleBulkUpload(uploadBtn, progress, progressFill, progressLabel, feedback, results, resultsBody);
  }

  // ── Download template ──
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      const entity = entitySelect?.value;
      if (!entity) {
        if (feedback) { feedback.textContent = 'Please select an entity type first.'; feedback.className = 'bulk-import-feedback error'; feedback.classList.remove('hidden'); }
        return;
      }
      window.open(`${API_BASE}/bulk-import/template/${entity}`, '_blank');
    };
  }
}

function setBulkFile(file, dropzone, fileInput, uploadBtn) {
  if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.csv')) {
    if (fileInput) fileInput.value = '';
    alert('Only .xlsx and .csv files are supported.');
    return;
  }
  _bulkImportFile = file;
  if (dropzone) {
    dropzone.classList.add('file-selected');
    const inner = dropzone.querySelector('.bulk-import-dropzone-inner');
    if (inner) {
      inner.querySelector('i').style.display = 'none';
      inner.querySelector('.bulk-import-drop-text').style.display = 'none';
      inner.querySelector('small').style.display = 'none';
      const existing = inner.querySelector('.file-selected-name');
      if (existing) existing.remove();
      const nameEl = document.createElement('div');
      nameEl.className = 'file-selected-name';
      nameEl.innerHTML = `<i class="fa-solid fa-file-circle-check"></i> ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      inner.appendChild(nameEl);
    }
  }
  if (uploadBtn) uploadBtn.disabled = false;
}

async function handleBulkUpload(uploadBtn, progress, progressFill, progressLabel, feedback, results, resultsBody) {
  if (!_bulkImportFile) return;
  const entitySelect = document.getElementById('bulk-import-entity');
  const entity = entitySelect?.value;
  if (!entity) {
    if (feedback) { feedback.textContent = 'Please select an entity type.'; feedback.className = 'bulk-import-feedback error'; feedback.classList.remove('hidden'); }
    return;
  }

  if (uploadBtn) uploadBtn.disabled = true;
  if (progress) progress.classList.remove('hidden');
  if (progressFill) progressFill.style.width = '30%';
  if (progressLabel) progressLabel.textContent = 'Uploading...';
  if (feedback) feedback.classList.add('hidden');
  if (results) results.classList.add('hidden');

  try {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', _bulkImportFile);

    if (progressFill) progressFill.style.width = '60%';
    if (progressLabel) progressLabel.textContent = 'Importing...';

    const res = await fetch(`${API_BASE}/bulk-import/${entity}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (progressFill) progressFill.style.width = '90%';
    if (progressLabel) progressLabel.textContent = 'Finalizing...';

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || data.message || 'Import failed');
    }

    if (progressFill) progressFill.style.width = '100%';
    if (progressLabel) progressLabel.textContent = 'Done!';

    // Render results
    renderBulkResults(data, feedback, results, resultsBody);
  } catch (err) {
    if (feedback) {
      feedback.textContent = err.message;
      feedback.className = 'bulk-import-feedback error';
      feedback.classList.remove('hidden');
    }
  } finally {
    if (uploadBtn) uploadBtn.disabled = false;
    setTimeout(() => {
      if (progress) progress.classList.add('hidden');
      if (progressFill) progressFill.style.width = '0%';
    }, 2000);
  }
}

function renderBulkResults(data, feedback, results, resultsBody) {
  const total = data.total || 0;
  const successCount = data.success?.length || 0;
  const errors = data.errors || [];

  if (feedback) {
    if (errors.length === 0) {
      feedback.textContent = `✅ All ${successCount} records imported successfully.`;
      feedback.className = 'bulk-import-feedback success';
    } else {
      feedback.textContent = `⚠ Imported ${successCount}/${total} records. ${errors.length} error(s) found.`;
      feedback.className = 'bulk-import-feedback error';
    }
    feedback.classList.remove('hidden');
  }

  // Stats
  const statTotal = document.getElementById('bi-stat-total');
  const statSuccess = document.getElementById('bi-stat-success');
  const statFailed = document.getElementById('bi-stat-failed');
  if (statTotal) statTotal.textContent = total;
  if (statSuccess) statSuccess.textContent = successCount;
  if (statFailed) statFailed.textContent = errors.length;

  // Rows
  if (resultsBody) {
    if (errors.length === 0 && successCount > 0) {
      resultsBody.innerHTML = `<div class="bulk-import-success-row"><i class="fa-solid fa-check-circle"></i> All ${successCount} records created/updated successfully.</div>`;
    } else {
      resultsBody.innerHTML = errors.map((e, i) => `
        <div class="bulk-import-error-row">
          <span class="bulk-err-row-num">Row ${e.row || '?'}</span>
          <span class="bulk-err-row-msg">${e.message || 'Unknown error'}</span>
          <button class="bulk-err-row-toggle" data-target="bi-err-detail-${i}" type="button">Details</button>
        </div>
        <div class="bulk-import-error-detail" id="bi-err-detail-${i}">${e.data ? JSON.stringify(e.data, null, 2) : ''}</div>
      `).join('');
    }

    // Toggle detail
    resultsBody.querySelectorAll('.bulk-err-row-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.getAttribute('data-target'));
        if (target) {
          target.classList.toggle('open');
          btn.textContent = target.classList.contains('open') ? 'Hide' : 'Details';
        }
      });
    });
  }

  if (results) results.classList.remove('hidden');
}

// Wire up shipments search/filter
document.addEventListener('input', (e) => {
  if (e.target.id === 'admin-shipments-search' || e.target.id === 'admin-shipments-filter-status') {
    loadShipmentsTab();
  }
  if (e.target.id === 'admin-inv-search' || e.target.id === 'admin-inv-filter') {
    loadInventoryTab();
  }
});

function activateAdminTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.admin-tab-content').forEach((content) => {
    content.classList.toggle(
      'active',
      content.id === `admin-content-${tabName}`,
    );
  });
  // Route returns tab to Orders & Shipping with Returns sub-tab active
  if (tabName === 'returns') {
    document.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === 'orders');
    });
    document.querySelectorAll('.admin-tab-content').forEach((content) => {
      content.classList.toggle('active', content.id === 'admin-content-orders');
    });
    // Activate returns sub-tab
    document.querySelectorAll('.ship-tab').forEach((t) => t.classList.remove('active'));
    const returnsTab = document.querySelector('.ship-tab[data-ship-tab="returns"]');
    if (returnsTab) returnsTab.classList.add('active');
    document.querySelectorAll('.ship-panel').forEach((p) => p.classList.remove('active'));
    const panel = document.getElementById('ship-panel-returns');
    if (panel) panel.classList.add('active');
    loadReturnsDashboard();
    return;
  }
  if (tabName === 'analytics') {
    loadAnalyticsTab();
  }
  if (tabName === 'communication') {
    loadCommunicationTab();
  }
  if (tabName === 'training-ops') {
    loadTrainingOpsTab();
  }
  if (tabName === 'security') {
    loadSecurityTab();
  }
}

/* ── Analytics Tab ── */

async function loadAnalyticsTab() {
  const startDate = document.getElementById('admin-analytics-start')?.value;
  const endDate = document.getElementById('admin-analytics-end')?.value;
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  try {
    const [metricsRes, funnelRes, recoveryRes, eventsRes, topProductsRes] = await Promise.all([
      fetchWithAuth(`/analytics/dashboard?${params}`),
      fetchWithAuth(`/analytics/funnel?${params}`),
      fetchWithAuth(`/analytics/recovery?${params}`),
      fetchWithAuth(`/analytics/events?${params}`),
      fetchWithAuth(`/analytics/top-products?${params}`),
    ]);

    renderAnalyticsStats(metricsRes);
    renderFunnel(funnelRes);
    renderDropOff(funnelRes);
    renderTopProducts(topProductsRes.products || []);
    renderRatesRates(metricsRes, recoveryRes);
    renderEvents(eventsRes.events || []);
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to load analytics');
  }
}
globalThis.loadAnalyticsTab = loadAnalyticsTab;

function renderAnalyticsStats(m) {
  setText('analytics-stat-orders', m.totalOrders ?? 0);
  setText('analytics-stat-revenue', '\u20b9' + Number(m.totalRevenue || 0).toFixed(2));
  setText('analytics-stat-aov', '\u20b9' + Number(m.averageOrderValue || 0).toFixed(2));
  setText('analytics-stat-conversion', (m.conversionRate ?? 0).toFixed(1) + '%');
  setText('analytics-stat-pageviews', m.totalPageViews ?? 0);
  setText('analytics-stat-abandonment', (m.abandonmentRate ?? 0).toFixed(1) + '%');
}

function renderFunnel(funnel) {
  const container = document.getElementById('analytics-funnel-container');
  if (!container) return;
  const stages = funnel.stages || [];
  if (!stages.length) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">No funnel data yet</p>';
    return;
  }
  const maxCount = Math.max(...stages.map(s => s.count), 1);
  container.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px;">' + stages.map(s => {
    const pct = (s.count / maxCount) * 100;
    const label = s.stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div style="display:flex;align-items:center;gap:10px;">
      <span style="min-width:130px;font-size:0.8rem;color:#94a3b8;text-align:right;">${label}</span>
      <div style="flex:1;background:#1a2e22;border-radius:6px;height:28px;overflow:hidden;position:relative;">
        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#38b17b,#2d8c63);border-radius:6px;transition:width 0.5s ease;"></div>
      </div>
      <span style="min-width:40px;font-size:0.82rem;color:#e2e8f0;font-weight:600;">${s.count}</span>
    </div>`;
  }).join('') + '</div>';
}

function renderDropOff(funnel) {
  const container = document.getElementById('analytics-dropoff-container');
  if (!container) return;
  const rates = funnel.dropOffRates || [];
  if (!rates.length) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">No drop-off data yet</p>';
    return;
  }
  container.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr style="color:#64748b;text-align:left;"><th style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.1);">Stage</th><th style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.1);">Entered</th><th style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.1);">Converted</th><th style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.1);">Drop-off</th></tr></thead><tbody>' + rates.map(r => {
    const fromLabel = r.from.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const toLabel = r.to.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const color = r.dropOffRate > 50 ? '#ef4444' : r.dropOffRate > 25 ? '#f59e0b' : '#10b981';
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#e2e8f0;">${fromLabel} \u2192 ${toLabel}</td>
      <td style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.06);">${r.entered}</td>
      <td style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.06);">${r.converted}</td>
      <td style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:${color};font-weight:600;">${r.dropOffRate}%</td>
    </tr>`;
  }).join('') + '</tbody></table>';
}

function renderTopProducts(products) {
  const container = document.getElementById('analytics-top-products-container');
  if (!container) return;
  if (!products.length) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">No product data yet</p>';
    return;
  }
  container.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr style="color:#64748b;text-align:left;"><th style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.1);">#</th><th style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.1);">Product</th><th style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.1);">Sold</th><th style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.1);">Revenue</th></tr></thead><tbody>' + products.slice(0, 10).map((p, i) => `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#64748b;">${i + 1}</td>
    <td style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#e2e8f0;">${p.name || p.productId}</td>
    <td style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.06);">${p.quantity}</td>
    <td style="padding:6px 8px;border-bottom:1px solid rgba(56,177,123,0.06);">\u20b9${Number(p.revenue || 0).toFixed(2)}</td>
  </tr>`).join('') + '</tbody></table>';
}

function renderRatesRates(metrics, recovery) {
  const container = document.getElementById('analytics-rates-container');
  if (!container) return;
  container.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    <div style="background:#1a2e22;border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Abandoned Carts</div>
      <div style="font-size:1.3rem;font-weight:700;color:#f59e0b;">${recovery.abandoned ?? metrics.abandonedCarts ?? 0}</div>
    </div>
    <div style="background:#1a2e22;border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Recovered</div>
      <div style="font-size:1.3rem;font-weight:700;color:#10b981;">${recovery.recovered ?? metrics.recoveredCarts ?? 0}</div>
    </div>
    <div style="background:#1a2e22;border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Cancellation Rate</div>
      <div style="font-size:1.3rem;font-weight:700;color:#e2e8f0;">${(metrics.cancellationRate ?? 0).toFixed(1)}%</div>
    </div>
    <div style="background:#1a2e22;border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Return Rate</div>
      <div style="font-size:1.3rem;font-weight:700;color:#e2e8f0;">${(metrics.returnRate ?? 0).toFixed(1)}%</div>
    </div>
  </div>`;
}

function renderEvents(events) {
  const container = document.getElementById('analytics-events-container');
  if (!container) return;
  if (!events.length) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">No events recorded yet</p>';
    return;
  }
  const recent = events.slice(-100).reverse();
  container.innerHTML = '<div style="max-height:320px;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr style="color:#64748b;text-align:left;position:sticky;top:0;background:#0f1c16;"><th style="padding:6px 8px;">Event</th><th style="padding:6px 8px;">Page</th><th style="padding:6px 8px;">Session</th><th style="padding:6px 8px;">Time</th></tr></thead><tbody>' + recent.map(e => {
    const time = e.created_at ? new Date(e.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
    const label = (e.event_type || '').replace(/_/g, ' ');
    return `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#e2e8f0;">${label}</td>
      <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#64748b;">${e.page || '\u2014'}</td>
      <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#64748b;font-family:monospace;">${(e.session_id || '').substring(0, 8)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#64748b;">${time}</td>
    </tr>`;
  }).join('') + '</tbody></table></div>';
}

/* ── Communication Management Tab ── */

let _commTemplatesVisible = false;

async function loadCommunicationTab() {
  try {
    const [healthRes, logsRes, statsRes] = await Promise.all([
      fetchWithAuth('/communication/health'),
      fetchWithAuth('/communication/logs'),
      fetchWithAuth('/communication/stats'),
    ]);

    if (healthRes?.success) {
      renderCommProvider(healthRes.data);
    }
    if (logsRes?.success) {
      renderCommLogs(logsRes.data);
    }
    if (statsRes?.success) {
      renderCommStats(statsRes.data);
    }

    loadCommTemplates();
    checkCommDevMode();

    const channelFilter = document.getElementById('comm-filter-channel');
    const statusFilter = document.getElementById('comm-filter-status');
    const searchInput = document.getElementById('comm-search');

    if (channelFilter) channelFilter.onchange = loadCommunicationTab;
    if (statusFilter) statusFilter.onchange = loadCommunicationTab;
    if (searchInput) {
      const handler = () => loadCommunicationTab();
      searchInput.onkeyup = (e) => { if (e.key === 'Enter') handler(); };
    }
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to load communication data');
  }
}
globalThis.loadCommunicationTab = loadCommunicationTab;

function renderCommProvider(health) {
  const badge = document.getElementById('comm-provider-badge');
  if (badge) {
    const provider = health?.provider?.provider || 'mock';
    const mode = health?.provider?.mode || 'mock';
    badge.textContent = `Provider: ${provider} (${mode})`;
    badge.style.background = provider === 'msg91' ? '#1e3a5f' : '#2d6a4f';
    badge.style.color = provider === 'msg91' ? '#93c5fd' : '#bbf7d0';
  }
}

function renderCommStats(stats) {
  const logs = stats?.logs || {};
  const queue = stats?.queue || {};

  setText('comm-stat-total', logs.total ?? 0);
  setText('comm-stat-sent', logs.sent ?? 0);
  setText('comm-stat-delivered', logs.delivered ?? 0);
  setText('comm-stat-failed', logs.failed ?? 0);
  setText('comm-stat-queued', (logs.queued ?? 0) + (queue.queued ?? 0));

  const channelStats = logs.byChannel || {};
  const channelContainer = document.getElementById('comm-channel-stats');
  if (channelContainer) {
    channelContainer.innerHTML = Object.entries(channelStats).map(([ch, count]) =>
      `<div style="background:#1a2e22;border-radius:8px;padding:12px 16px;text-align:center;flex:1;min-width:80px;">
        <div style="font-size:0.7rem;color:#64748b;text-transform:uppercase;">${ch}</div>
        <div style="font-size:1.2rem;font-weight:700;color:#e2e8f0;margin-top:4px;">${count}</div>
      </div>`
    ).join('');
  }

  const queueContainer = document.getElementById('comm-queue-status');
  if (queueContainer) {
    if (!queue || queue.total === 0) {
      queueContainer.innerHTML = '<span style="color:#94a3b8;">No queued jobs</span>';
    } else {
      queueContainer.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;">
        <span style="color:#94a3b8;">Total Jobs: <strong style="color:#e2e8f0;">${queue.total}</strong></span>
        <span style="color:#94a3b8;">Queued: <strong style="color:#f59e0b;">${queue.queued}</strong></span>
        <span style="color:#94a3b8;">Processing: <strong style="color:#3b82f6;">${queue.processing}</strong></span>
        <span style="color:#94a3b8;">Completed: <strong style="color:#10b981;">${queue.completed}</strong></span>
        <span style="color:#94a3b8;">Failed: <strong style="color:#ef4444;">${queue.failed}</strong></span>
      </div>`;
    }
  }

  const failBadge = document.getElementById('admin-comm-fail-badge');
  if (failBadge) {
    const failed = (logs.failed ?? 0) + (queue.failed ?? 0);
    failBadge.classList.toggle('hidden', failed === 0);
    if (failed > 0) failBadge.textContent = failed > 99 ? '99+' : failed;
  }
}

function renderCommLogs(data) {
  const container = document.getElementById('comm-message-list');
  if (!container) return;
  const logs = data?.logs || [];
  if (!logs.length) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">No messages yet. Send a test message to see logs here.</p>';
    return;
  }

  const channelFilter = document.getElementById('comm-filter-channel')?.value || '';
  const statusFilter = document.getElementById('comm-filter-status')?.value || '';
  const searchQuery = document.getElementById('comm-search')?.value?.toLowerCase() || '';

  let filtered = logs;
  if (channelFilter) filtered = filtered.filter(l => l.channel === channelFilter);
  if (statusFilter) filtered = filtered.filter(l => l.status === statusFilter);
  if (searchQuery) filtered = filtered.filter(l => l.recipient?.toLowerCase().includes(searchQuery));

  container.innerHTML = `<div style="max-height:400px;overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
      <thead><tr style="color:#64748b;text-align:left;position:sticky;top:0;background:#0f1c16;">
        <th style="padding:6px 8px;">ID</th>
        <th style="padding:6px 8px;">Recipient</th>
        <th style="padding:6px 8px;">Channel</th>
        <th style="padding:6px 8px;">Type</th>
        <th style="padding:6px 8px;">Status</th>
        <th style="padding:6px 8px;">Provider</th>
        <th style="padding:6px 8px;">Time</th>
        <th style="padding:6px 8px;">Error</th>
      </tr></thead><tbody>
      ${filtered.map(l => {
        const statusColor = l.status === 'delivered' ? '#10b981' : l.status === 'sent' ? '#3b82f6' : l.status === 'failed' ? '#ef4444' : '#f59e0b';
        return `<tr>
          <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#64748b;font-family:monospace;font-size:0.7rem;">${(l.id || '').substring(0, 16)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#e2e8f0;">${l.recipient || '-'}</td>
          <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);"><span class="badge badge-info" style="background:#1e3a5f;color:#93c5fd;">${l.channel}</span></td>
          <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#94a3b8;">${l.type || '-'}</td>
          <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);"><span style="color:${statusColor};font-weight:600;">${l.status}</span></td>
          <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#64748b;">${l.provider || '-'}</td>
          <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#64748b;font-size:0.7rem;">${l.createdAt ? new Date(l.createdAt).toLocaleTimeString() : ''}</td>
          <td style="padding:4px 8px;border-bottom:1px solid rgba(56,177,123,0.06);color:#ef4444;font-size:0.7rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${l.error || ''}</td>
        </tr>`;
      }).join('')}
      </tbody></table>
  </div>`;
  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">No messages match the current filters.</p>';
  }
}

async function loadCommTemplates() {
  try {
    const res = await fetchWithAuth('/communication/templates');
    const container = document.getElementById('comm-templates-container');
    if (!container) return;
    if (!res?.success) {
      container.innerHTML = '<span style="color:#94a3b8;">Failed to load templates</span>';
      return;
    }
    const templates = res.data || {};
    let html = '';
    for (const [channel, tpls] of Object.entries(templates)) {
      html += `<div style="margin-bottom:12px;">
        <h4 style="color:#e2e8f0;margin:0 0 6px;font-size:0.85rem;text-transform:capitalize;">${channel}</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">`;
      for (const [name, content] of Object.entries(tpls)) {
        const preview = typeof content === 'object' ? content.subject || JSON.stringify(content).substring(0, 60) : String(content).substring(0, 60);
        html += `<span style="background:#1a2e22;border-radius:4px;padding:3px 8px;font-size:0.7rem;color:#94a3b8;">
          <strong style="color:#e2e8f0;">${name}</strong>: ${preview}...
        </span>`;
      }
      html += `</div></div>`;
    }
    container.innerHTML = html;
  } catch (err) {
    console.warn('Failed to load templates:', err);
  }
}

function checkCommDevMode() {
  const section = document.getElementById('comm-otp-dev-section');
  if (section) {
    section.style.display = ''; 
  }
}

async function lookupDevOtp() {
  const identifier = document.getElementById('comm-dev-otp-identifier')?.value?.trim();
  const resultEl = document.getElementById('comm-dev-otp-result');
  if (!identifier || !resultEl) return;

  try {
    const res = await fetchWithAuth(`/communication/dev-otp/${encodeURIComponent(identifier)}`);
    if (res?.success) {
      resultEl.textContent = `OTP: ${res.data?.otp || 'No active OTP'}`;
      resultEl.style.color = '#f59e0b';
    } else {
      resultEl.textContent = 'Error: ' + (getApiErrorMessage(res) || 'Lookup failed');
      resultEl.style.color = '#ef4444';
    }
  } catch (err) {
    resultEl.textContent = 'Error: ' + (err.message || 'Lookup failed');
    resultEl.style.color = '#ef4444';
  }
}
globalThis.lookupDevOtp = lookupDevOtp;

function toggleCommTemplates() {
  _commTemplatesVisible = !_commTemplatesVisible;
  const container = document.getElementById('comm-templates-container');
  if (container) {
    container.style.display = _commTemplatesVisible ? 'block' : 'none';
  }
}
globalThis.toggleCommTemplates = toggleCommTemplates;

async function retryAllFailedComm() {
  if (!confirm('Retry all failed communication messages?')) return;
  try {
    const res = await fetchWithAuth('/communication/retry-all', { method: 'POST' });
    if (res?.success) {
      showSuccessToast(`Retrying ${res.data?.retried || 0} failed messages`);
      loadCommunicationTab();
    } else {
      showErrorToast(getApiErrorMessage(res) || 'Failed to retry');
    }
  } catch (err) {
    showErrorToast(err.message || 'Failed to retry');
  }
}
globalThis.retryAllFailedComm = retryAllFailedComm;

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// Wire up analytics date filter on load
document.addEventListener('DOMContentLoaded', () => {
  const startEl = document.getElementById('admin-analytics-start');
  const endEl = document.getElementById('admin-analytics-end');
  if (startEl) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    startEl.value = d.toISOString().split('T')[0];
  }
  if (endEl) {
    endEl.value = new Date().toISOString().split('T')[0];
  }
});

function setupAdminEventHandlers() {
  // Tab clicks
  document.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activateAdminTab(btn.dataset.tab);
    });
  });

  // Login handler — OTP two-step flow
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError();

      const email = document.getElementById('admin-auth-email').value.trim();
      const otpField = document.getElementById('admin-auth-otp-field');
      const emailField = document.getElementById('admin-auth-email-field');
      const faField = document.getElementById('admin-auth-2fa-field');
      const btn = document.getElementById('admin-auth-btn');
      const sentEl = document.getElementById('admin-auth-otp-sent');

      // Step 3: Verify 2FA code
      if (faField && !faField.classList.contains('hidden')) {
        const code2fa = document.getElementById('admin-auth-2fa').value.trim();
        if (!/^\d{6}$/.test(code2fa)) {
          renderAuthError('Enter a valid 6-digit code from your authenticator app');
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
        try {
          await authApi.adminVerify2fa(code2fa);
          const rawUser = sessionStorage.getItem('_2fa_user');
          if (rawUser) {
            try { state.user = JSON.parse(rawUser); } catch (_) {}
            sessionStorage.removeItem('_2fa_user');
          }
          showDashboard();
        } catch (err) {
          renderAuthError(err.message || '2FA verification failed');
          if (btn) { btn.disabled = false; btn.textContent = 'Verify Code'; }
        }
        return;
      }

      // Step 2: Verify OTP
      if (otpField && !otpField.classList.contains('hidden')) {
        const otpCode = document.getElementById('admin-auth-otp').value.trim();
        if (!/^\d{6}$/.test(otpCode)) {
          renderAuthError('Enter a valid 6-digit OTP');
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
        try {
          const data = await authApi.adminVerifyOtp(email, otpCode);
          if (data.requires2fa) {
            saveAuth(data.token, null);
            sessionStorage.setItem('_2fa_user', JSON.stringify(data.user));
            if (emailField) emailField.classList.add('hidden');
            if (otpField) otpField.classList.add('hidden');
            if (faField) faField.classList.remove('hidden');
            if (btn) { btn.disabled = false; btn.textContent = 'Verify Code'; }
            document.getElementById('admin-auth-2fa')?.focus();
          } else {
            saveAuth(data.token, data.user);
            showDashboard();
          }
        } catch (err) {
          renderAuthError(err.message || 'OTP verification failed');
          if (btn) { btn.disabled = false; btn.textContent = 'Verify & Login'; }
        }
        return;
      }

      // Step 1: Send OTP
      if (btn) { btn.disabled = true; btn.textContent = 'Sending OTP…'; }
      try {
        const result = await authApi.adminLogin(email);
        clearAuthError();

        if (emailField) emailField.classList.add('hidden');
        if (otpField) otpField.classList.remove('hidden');
        if (btn) { btn.disabled = false; btn.textContent = 'Verify & Login'; }

        if (result?.otp && sentEl) {
          sentEl.textContent = `Demo OTP: ${result.otp}`;
          document.getElementById('admin-auth-otp').value = result.otp;
          // Auto-submit OTP verification
          setTimeout(() => {
            loginForm.dispatchEvent(new Event('submit'));
          }, 300);
        } else if (sentEl) {
          sentEl.textContent = 'OTP sent to registered mobile';
        }
      } catch (err) {
        renderAuthError(err.message || 'Failed to send OTP');
        if (btn) { btn.disabled = false; btn.textContent = 'Send OTP'; }
      }
    });
  }

  // Change email button
  document.getElementById('admin-auth-change-email')?.addEventListener('click', () => {
    const otpField = document.getElementById('admin-auth-otp-field');
    const emailField = document.getElementById('admin-auth-email-field');
    const btn = document.getElementById('admin-auth-btn');
    if (otpField) otpField.classList.add('hidden');
    if (emailField) emailField.classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Send OTP'; }
    clearAuthError();
  });

  // Back to OTP from 2FA step
  document.getElementById('admin-auth-back-otp')?.addEventListener('click', () => {
    const otpField = document.getElementById('admin-auth-otp-field');
    const faField = document.getElementById('admin-auth-2fa-field');
    const btn = document.getElementById('admin-auth-btn');
    if (faField) faField.classList.add('hidden');
    if (otpField) otpField.classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Verify & Login'; }
    sessionStorage.removeItem('_2fa_user');
    clearAuthError();
  });

  // Logout
  if (btnLogout) btnLogout.addEventListener('click', () => { clearAuth(); showLoginPanel(); });
  if (btnViewShop) btnViewShop.addEventListener('click', () => (globalThis.location.hash = '#shop'));

  // Admin action menu toggle
  if (adminActionMenuBtn && adminActionMenu) {
    adminActionMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      adminActionMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!adminActionMenuBtn.contains(e.target) && !adminActionMenu.contains(e.target)) {
        adminActionMenu.classList.add('hidden');
      }
    });
  }

  // Pricing type toggle (capsule form only — CSS handles pill visibility)
  document.querySelectorAll('.pricing-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pricing-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-mode') || 'weight';
      const ctr = btn.closest('.premium-weight-section')
        ?.querySelector('#admin-capsule-weight-container');
      if (ctr) ctr.dataset.mode = mode;
    });
  });

  // Category handlers
  if (saveCatBtn) saveCatBtn.addEventListener('click', handleAdminSaveCategory);
  if (resetCatBtn) resetCatBtn.addEventListener('click', resetAdminCatForm);

  // Blog event handlers
  if (btnCreateBlog) btnCreateBlog.addEventListener('click', openAdminBlogModal);
  if (blogModalClose) blogModalClose.addEventListener('click', closeAdminBlogModal);
  if (blogForm) blogForm.addEventListener('submit', handleAdminSaveBlog);
  if (blogResetBtn) blogResetBtn.addEventListener('click', resetAdminBlogForm);
  if (blogTitleInput) blogTitleInput.addEventListener('input', updateBlogSlugFromTitle);
  if (blogImageBrowse) blogImageBrowse.addEventListener('click', () => blogImageFile?.click());
  if (blogImageFile) blogImageFile.addEventListener('change', updateBlogImagePreview);
  if (blogImageUrl) {
    blogImageUrl.addEventListener('input', () => {
      if (blogImageFile?.files?.length) blogImageFile.value = '';
      updateBlogImagePreview();
    });
  }

  // Close blog modal on outside click
  if (blogModal) {
    blogModal.addEventListener('click', (e) => {
      if (e.target === blogModal) closeAdminBlogModal();
    });
  }

  // Training form
  if (trainForm) trainForm.addEventListener('submit', handleAdminSaveTraining);
  const resetTrainBtn = document.getElementById('btn-admin-reset-train');
  if (resetTrainBtn) {
    resetTrainBtn.addEventListener('click', () => {
      document.getElementById('admin-train-edit-id').value = '';
      document.getElementById('admin-train-title').value = '';
      document.getElementById('admin-train-desc').value = '';
      document.getElementById('admin-train-category').value = '';
      const hiddenImg = document.getElementById('admin-train-image');
      if (hiddenImg) hiddenImg.value = '';
      if (trainImageUrl) trainImageUrl.value = '';
      if (trainImageFile) trainImageFile.value = '';
      updateTrainingImagePreview();
      document.getElementById('admin-train-content').value = '';
      document.getElementById('admin-train-start-date').value = '';
      document.getElementById('admin-train-end-date').value = '';
      document.getElementById('admin-train-duration').value = '';
      document.getElementById('admin-train-id-display').value = '';
      document.getElementById('admin-train-price-strikeout').value = '';
      document.getElementById('admin-train-price-actual').value = '';
      ['admin-train-role-trainee', 'admin-train-role-farmer', 'admin-train-role-entrepreneur'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });
    });
  }

  // Auto-calculate duration on date change
  function updateDuration() {
    const s = document.getElementById('admin-train-start-date')?.value;
    const e = document.getElementById('admin-train-end-date')?.value;
    const d = document.getElementById('admin-train-duration');
    if (d) {
      const days = calcDuration(s, e);
      d.value = days ? `${days} days` : '';
    }
  }
  document.getElementById('admin-train-start-date')?.addEventListener('change', updateDuration);
  document.getElementById('admin-train-end-date')?.addEventListener('change', updateDuration);

  // Product/category image preview wiring
  if (categoryImageBrowse) categoryImageBrowse.addEventListener('click', () => categoryImageFile?.click());
  if (categoryImageFile) categoryImageFile.addEventListener('change', updateCategoryImagePreview);
  if (categoryImageUrl) categoryImageUrl.addEventListener('input', updateCategoryImagePreview);

  // Training image preview wiring
  if (trainImageBrowse) trainImageBrowse.addEventListener('click', () => trainImageFile?.click());
  if (trainImageFile) {
    trainImageFile.addEventListener('change', () => {
      if (trainImageUrl) trainImageUrl.value = '';
      updateTrainingImagePreview();
    });
  }
  if (trainImageUrl) {
    trainImageUrl.addEventListener('input', () => {
      if (trainImageFile?.files?.length) trainImageFile.value = '';
      updateTrainingImagePreview();
    });
  }

  const adminSearchProd = document.getElementById('admin-search-prod');
  const adminFilterCat = document.getElementById('admin-filter-cat');
  const adminSortSelect = document.getElementById('admin-inventory-sort');
  const adminGoToPage = document.getElementById('admin-go-to-page');
  const afSearchClear = document.getElementById('af-search-clear');
  let searchDebounce = null;
  if (adminSearchProd) {
    adminSearchProd.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      if (afSearchClear) {
        afSearchClear.classList.toggle('visible', adminSearchProd.value.length > 0);
      }
      searchDebounce = setTimeout(() => { _adminInventoryPage = 1; renderAdminInventory(); }, 250);
    });
  }
  if (afSearchClear) {
    afSearchClear.addEventListener('click', () => {
      if (adminSearchProd) {
        adminSearchProd.value = '';
        adminSearchProd.focus();
        afSearchClear.classList.remove('visible');
        _adminInventoryPage = 1;
        renderAdminInventory();
      }
    });
  }
  if (adminFilterCat) adminFilterCat.addEventListener('change', () => { _adminInventoryPage = 1; renderAdminInventory(); });
  if (adminSortSelect) {
    adminSortSelect.addEventListener('change', () => {
      if (_activeCapsule === 'recent' && adminSortSelect.value !== 'date_desc') {
        _activeCapsule = 'all';
        document.querySelectorAll('.admin-capsule').forEach(b => b.classList.toggle('active', b.getAttribute('data-capsule') === 'all'));
      }
      _adminInventoryPage = 1;
      renderAdminInventory();
    });
  }
  if (adminGoToPage) {
    adminGoToPage.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = parseInt(adminGoToPage.value, 10);
        if (Number.isFinite(v) && v >= 1) {
          _adminInventoryPage = v;
          renderAdminInventory();
        }
      }
    });
    // Allow admin to select-all on focus for quick replacement
    adminGoToPage.addEventListener('focus', () => adminGoToPage.select());
  }

  // Capsule switching
  const adminCapsules = document.querySelectorAll('.admin-capsule');
  adminCapsules.forEach(btn => {
    btn.addEventListener('click', () => {
      adminCapsules.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeCapsule = btn.getAttribute('data-capsule');
      if (_activeCapsule === 'recent' && adminSortSelect) {
        adminSortSelect.value = 'date_desc';
      }
      if (_activeCapsule === 'add-product') {
        resetCapsuleAddForm();
      }
      if (_activeCapsule === 'categories') {
        fetchAdminCategories();
      }
      if (_activeCapsule === 'inventory') {
        loadInventoryTab();
      }
      if (_activeCapsule === 'bulk-import') {
        renderBulkImportTab();
      }
      _adminInventoryPage = 1;
      renderAdminInventory();
    });
  });

  // Capsule add-product form submit / reset
  const capsuleForm = document.getElementById('form-admin-capsule-add');
  if (capsuleForm) {
    capsuleForm.addEventListener('submit', handleCapsuleAddSubmit);
  }
  const capsuleResetBtn = document.querySelector('.btn-capsule-reset-form');
  if (capsuleResetBtn) {
    capsuleResetBtn.addEventListener('click', resetCapsuleAddForm);
  }

  // Capsule add-weight row
  const capsuleAddWeight = document.querySelector('.btn-premium-add-weight');
  if (capsuleAddWeight) {
    capsuleAddWeight.addEventListener('click', () => {
      const wc = document.getElementById('admin-capsule-weight-container');
      if (!wc) return;
      const row = document.createElement('div');
      row.className = 'premium-weight-row';
      row.innerHTML = `
        ${wpwHTML('admin-capsule-weight-select pw-select')}
        <div class="premium-weight-fields">
          <div class="pw-field">
            <label>Selling Price</label>
            <input type="number" step="0.01" class="admin-capsule-weight-price" placeholder="0.00" />
          </div>
          <div class="pw-field">
            <label>MRP</label>
            <input type="number" step="0.01" class="admin-capsule-weight-mrp" placeholder="0.00" />
          </div>
          <div class="pw-field">
            <label>Stock</label>
            <input type="number" class="admin-capsule-weight-stock admin-weight-stock" placeholder="0" min="0" />
          </div>
        </div>
        <button type="button" class="premium-weight-remove"><i class="fa-solid fa-xmark"></i></button>
      `;
      wc.appendChild(row);
      wpwAttach(row);
      row.querySelector('.premium-weight-remove').addEventListener('click', () => {
        if (wc.querySelectorAll('.premium-weight-row').length > 1) {
          row.remove();
          updateCapsuleTotalStock();
        }
      });
      updateCapsuleTotalStock();
    });
  }
  // Delegate remove for existing weight rows
  document.addEventListener('click', (ev) => {
    const rm = ev.target.closest('.premium-weight-remove');
    if (rm && rm.closest('#admin-capsule-weight-container')) {
      const wc = document.getElementById('admin-capsule-weight-container');
      if (wc && wc.querySelectorAll('.premium-weight-row').length > 1) {
        rm.closest('.premium-weight-row').remove();
        updateCapsuleTotalStock();
      }
    }
  });

  // Capsule image zone - click & drag/drop
  const capsuleImageZone = document.getElementById('capsule-image-zone');
  const capsuleImageFile = document.querySelector('.admin-capsule-image-file');
  if (capsuleImageZone && capsuleImageFile) {
    capsuleImageZone.addEventListener('click', (e) => {
      if (e.target.closest('.premium-img-overlay')) return;
      capsuleImageFile.click();
    });
    capsuleImageZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      capsuleImageZone.classList.add('dragover');
    });
    capsuleImageZone.addEventListener('dragleave', () => {
      capsuleImageZone.classList.remove('dragover');
    });
    capsuleImageZone.addEventListener('drop', (e) => {
      e.preventDefault();
      capsuleImageZone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length) {
        capsuleImageFile.files = files;
        capsuleImageFile.dispatchEvent(new Event('change'));
      }
    });
    capsuleImageFile.addEventListener('change', () => {
      const file = capsuleImageFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev2) => {
        const preview = document.getElementById('admin-capsule-img-preview');
        if (preview) {
          preview.innerHTML = `<img src="${ev2.target.result}" alt="Preview">`;
        }
        capsuleImageZone.classList.add('has-image');
        const overlay = capsuleImageZone.querySelector('.premium-img-overlay');
        if (overlay) overlay.style.display = 'flex';
        const urlInput = document.getElementById('admin-capsule-prod-image-url');
        if (urlInput) urlInput.value = ev2.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Capsule URL apply button
  const capsuleUrlInput = document.getElementById('capsule-image-url-input');
  const capsuleApplyBtn = document.getElementById('capsule-apply-url-btn');
  if (capsuleUrlInput && capsuleApplyBtn) {
    function applyImageUrl() {
      const url = capsuleUrlInput.value.trim();
      if (!url) return;
      const preview = document.getElementById('admin-capsule-img-preview');
      if (preview) {
        preview.innerHTML = `<img src="${url}" alt="Preview" onerror="this.parentElement.innerHTML='<i class=\\\\\\'fa-solid fa-cloud-arrow-up\\\\\\'></i><span>Invalid image URL</span><small>Try again</small>'">`;
      }
      capsuleImageZone?.classList.add('has-image');
      const overlay = capsuleImageZone?.querySelector('.premium-img-overlay');
      if (overlay) overlay.style.display = 'flex';
      const urlInputHidden = document.getElementById('admin-capsule-prod-image-url');
      if (urlInputHidden) urlInputHidden.value = url;
    }
    capsuleApplyBtn.addEventListener('click', applyImageUrl);
    capsuleUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyImageUrl();
    });
  }

  // Capsule image change/remove buttons
  document.addEventListener('click', (ev) => {
    const changeBtn = ev.target.closest('.capsule-image-change');
    if (changeBtn && capsuleImageFile) {
      capsuleImageFile.click();
    }
    const removeBtn = ev.target.closest('.capsule-image-remove');
    if (removeBtn) {
      const zone = document.getElementById('capsule-image-zone');
      const preview = document.getElementById('admin-capsule-img-preview');
      if (preview) {
        preview.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i><span>Drop an image here or click to browse</span><small>Supports JPG, PNG, WebP</small>';
      }
      zone?.classList.remove('has-image');
      const overlay = zone?.querySelector('.premium-img-overlay');
      if (overlay) overlay.style.display = 'none';
      const urlInput = document.getElementById('admin-capsule-prod-image-url');
      if (urlInput) urlInput.value = '';
      document.getElementById('capsule-image-url-input').value = '';
      if (capsuleImageFile) capsuleImageFile.value = '';
    }
  });

  // Mobile filter toggle
  const filterToggle = document.getElementById('admin-filter-toggle');
  const filterDropdowns = document.getElementById('admin-filter-dropdowns');
  if (filterToggle && filterDropdowns) {
    filterToggle.addEventListener('click', () => {
      filterDropdowns.classList.toggle('open');
      filterToggle.classList.toggle('open');
    });
  }

  // Close mobile filter dropdowns when selecting an option
  if (filterDropdowns) {
    filterDropdowns.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', () => {
        if (window.innerWidth <= 640) {
          filterDropdowns.classList.remove('open');
          filterToggle?.classList.remove('open');
        }
      });
    });
  }

  const adminHistoryFilterType = document.getElementById('admin-history-filter-type');
  const adminHistorySort = document.getElementById('admin-history-sort');
  const adminHistoryPageSize = document.getElementById('admin-history-page-size');
  const adminHistoryClear = document.getElementById('admin-history-clear');

  if (adminHistoryFilterType) adminHistoryFilterType.addEventListener('change', () => { adminHistoryPage = 1; renderAdminHistoryFilterValueControl(adminHistoryFilterType.value); renderAdminHistory(); });
  if (adminHistorySort) adminHistorySort.addEventListener('change', () => { adminHistoryPage = 1; renderAdminHistory(); });
  if (adminHistoryPageSize) adminHistoryPageSize.addEventListener('change', () => { adminHistoryPage = 1; renderAdminHistory(); });
  if (adminHistoryClear) adminHistoryClear.addEventListener('click', clearAdminHistoryFilters);

  // changes to ordershipment page modifications-pravara
  // Shipping sub-tabs
  document.querySelectorAll('.ship-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ship-tab').forEach((t) => t.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.shipTab;
      document.querySelectorAll('.ship-panel').forEach((p) => p.classList.remove('active'));
      const panel = document.getElementById(`ship-panel-${target}`);
      if (panel) panel.classList.add('active');
      if (target === 'shipments') loadShipmentsTab();
      if (target === 'refunds') loadRefundsDashboard();
      if (target === 'returns') loadReturnsDashboard();
    });
  });

  // Status pill filter buttons
  document.querySelectorAll('.ship-status-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ship-status-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const status = btn.dataset.status;
      if (status === 'all') {
        currentSection = 'all';
        renderCurrentSection();
      } else {
        currentSection = status;
        renderCurrentSection();
      }
    });
  });

  // Recent orders status dropdown-pravara
  const historyStatusFilter = document.getElementById('admin-history-status-filter');
  if (historyStatusFilter) {
    historyStatusFilter.addEventListener('change', () => {
      adminHistoryPage = 1;
      renderAdminHistory();
    });
  }
  // Expose globals
  globalThis.adminEditProduct = adminEditProduct;
  globalThis.adminDeleteProduct = adminDeleteProduct;
  globalThis.adminEditCategory = adminEditCategory;
  globalThis.adminDeleteCategory = adminDeleteCategory;
  globalThis.adminEditTraining = adminEditTraining;
  globalThis.adminDeleteTraining = adminDeleteTraining;
  globalThis.adminEditBlog = adminEditBlog;
  globalThis.adminDeleteBlog = adminDeleteBlog;
  globalThis.fetchAdminBlogs = fetchAdminBlogs;
  globalThis.loadRefundsDashboard = loadRefundsDashboard;

  // Refunds dashboard filter & search controls
  const refundsSearch = document.getElementById('admin-refunds-search');
  const refundsStatusFilter = document.getElementById('admin-refunds-filter-status');
  const refundsRefreshBtn = document.getElementById('admin-refunds-refresh-btn');

  let refundsSearchDebounce = null;
  if (refundsSearch) {
    refundsSearch.addEventListener('input', () => {
      clearTimeout(refundsSearchDebounce);
      refundsSearchDebounce = setTimeout(() => loadRefundsDashboard(), 380);
    });
  }
  if (refundsStatusFilter) {
    refundsStatusFilter.addEventListener('change', () => loadRefundsDashboard());
  }
  if (refundsRefreshBtn) {
    refundsRefreshBtn.addEventListener('click', () => loadRefundsDashboard());
  }

  globalThis.copyInvoiceLink = copyInvoiceLink;

  function shareInvoiceWhatsApp(orderId) {
    const order = adminOrdersCache.find((o) => o.id === orderId);
    if (!order) {
      showErrorToast('Order not found.');
      return;
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const itemsList = items
      .map((item) => `• ${item.name} × ${item.quantity}`)
      .join('\n');

    const deliveryDate = order.expected_delivery_date
      ? `Expected delivery: ${new Date(order.expected_delivery_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${order.delivery_days_text ? ` (${order.delivery_days_text})` : ''}`
      : '';

    const invoiceUrl = `${API_BASE}/orders/share/${order.invoice_token}`;

    const lines = [
      `🧾 *Invoice from Sporekart*`,
      ``,
      `Order: ${order.id}`,
      `Date: ${new Date(order.created_at).toLocaleDateString('en-IN')}`,
      `Customer: ${order.customer_name || order.user_email || 'Customer'}`,
      `Total: ₹${Number(order.total || 0).toFixed(2)}`,
      `Status: ${order.delivery_status}`,
      ``,
      `*Items:*`,
      itemsList || `-`,
    ];

    if (deliveryDate) {
      lines.push(``);
      lines.push(deliveryDate);
    }

    lines.push(``);
    lines.push(`View full invoice:`);
    lines.push(invoiceUrl);
    lines.push(``);
    lines.push(`Thank you for shopping with Sporekart! 🍄`);

    const text = encodeURIComponent(lines.join('\n'));
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }
  globalThis.shareInvoiceWhatsApp = shareInvoiceWhatsApp;
  globalThis.renderAdminOrders = renderAdminOrders;

  // Premium capsule gallery
  const uploadCapsuleBtn = document.getElementById('btn-gallery-upload-capsule');
  const galleryFileCapsule = document.getElementById('gallery-file-capsule');
  const capsuleGalleryGrid = document.getElementById('capsule-gallery-grid');

  function updatePremiumGalleryCount() {
    const filled = capsuleGalleryGrid ? capsuleGalleryGrid.querySelectorAll('.premium-gallery-slot img').length : 0;
    const badge = document.getElementById('capsule-gallery-count-badge');
    if (badge) badge.textContent = `${filled} / 3 min`;
  }

  function wirePremiumGallerySlot(slot) {
    const slotIdx = parseInt(slot.dataset.slot, 10);
    const placeholder = slot.querySelector('.gallery-placeholder');
    const hiddenInput = slot.querySelector('.gallery-url-input');
    const removeBtn = slot.querySelector('.gallery-remove-overlay');

    if (hiddenInput) {
      hiddenInput.addEventListener('input', () => {
        const val = hiddenInput.value.trim();
        if (val && placeholder) {
          placeholder.innerHTML = `<img src="${val}" alt="Gallery ${slotIdx + 1}" />`;
          slot.classList.add('has-image');
          removeBtn.style.display = 'flex';
        } else if (placeholder) {
          placeholder.innerHTML = `<i class="fa-regular fa-image"></i><span>#${slotIdx + 1}</span>`;
          slot.classList.remove('has-image');
          removeBtn.style.display = 'none';
        }
        updatePremiumGalleryCount();
      });
    }
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (capsuleGalleryGrid && capsuleGalleryGrid.querySelectorAll('.premium-gallery-slot').length <= 1) return;
        slot.remove();
        reindexPremiumGallerySlots();
        updatePremiumGalleryCount();
      });
    }
  }

  function reindexPremiumGallerySlots() {
    if (!capsuleGalleryGrid) return;
    capsuleGalleryGrid.querySelectorAll('.premium-gallery-slot').forEach((s, i) => {
      s.dataset.slot = i;
      const placeholder = s.querySelector('.gallery-placeholder');
      const input = s.querySelector('.gallery-url-input');
      if (input) input.dataset.slot = i;
      const rmBtn = s.querySelector('.gallery-remove-overlay');
      if (rmBtn) rmBtn.dataset.slot = i;
      if (placeholder && !placeholder.querySelector('img')) {
        placeholder.innerHTML = `<i class="fa-regular fa-image"></i><span>#${i + 1}</span>`;
      }
      if (i === 0 && capsuleGalleryGrid.querySelectorAll('.premium-gallery-slot').length === 1) {
        if (rmBtn) rmBtn.style.display = 'none';
      }
    });
  }

  if (uploadCapsuleBtn && galleryFileCapsule) {
    uploadCapsuleBtn.addEventListener('click', () => galleryFileCapsule.click());
    galleryFileCapsule.addEventListener('change', async () => {
      const files = [...galleryFileCapsule.files];
      if (!capsuleGalleryGrid) return;
      let slots = [...capsuleGalleryGrid.querySelectorAll('.premium-gallery-slot')];
      let slotIdx = 0;
      for (const file of files) {
        if (slotIdx >= 8) break;
        let dataUrl;
        try { dataUrl = await readFileAsDataUrl(file); } catch { continue; }
        while (slotIdx < slots.length) {
          const inp = slots[slotIdx]?.querySelector('.gallery-url-input');
          if (inp && !inp.value.trim()) break;
          slotIdx++;
        }
        if (slotIdx < slots.length) {
          const inp = slots[slotIdx].querySelector('.gallery-url-input');
          if (inp) { inp.value = dataUrl; inp.dispatchEvent(new Event('input', { bubbles: true })); }
          slotIdx++;
        } else {
          const newSlot = addPremiumGallerySlot(dataUrl);
          if (newSlot) slotIdx++;
        }
      }
      galleryFileCapsule.value = '';
      updatePremiumGalleryCount();
    });
  }

  // Add gallery slot button
  const addGallerySlotBtn = document.getElementById('btn-gallery-add-capsule');
  function addPremiumGallerySlot(initialValue) {
    if (!capsuleGalleryGrid) return null;
    const slots = capsuleGalleryGrid.querySelectorAll('.premium-gallery-slot');
    if (slots.length >= 8) return null;
    const idx = slots.length;
    const div = document.createElement('div');
    div.className = 'premium-gallery-slot';
    div.dataset.slot = idx;
    if (initialValue) div.classList.add('has-image');
    const imgHtml = initialValue
      ? `<img src="${initialValue}" alt="Gallery ${idx + 1}" />`
      : `<i class="fa-regular fa-image"></i><span>#${idx + 1}</span>`;
    div.innerHTML = `
      <div class="gallery-placeholder">${imgHtml}</div>
      <input type="url" class="gallery-url-input gallery-input-hidden" data-slot="${idx}" value="${initialValue || ''}" />
      <button type="button" class="gallery-remove-overlay" data-slot="${idx}" style="${initialValue ? 'display:flex' : 'display:none'}"><i class="fa-solid fa-xmark"></i></button>
    `;
    capsuleGalleryGrid.appendChild(div);
    wirePremiumGallerySlot(div);
    updatePremiumGalleryCount();
    return div;
  }
  if (addGallerySlotBtn) {
    addGallerySlotBtn.addEventListener('click', () => addPremiumGallerySlot());
  }

  // Wire existing capsule gallery slots
  if (capsuleGalleryGrid) {
    capsuleGalleryGrid.querySelectorAll('.premium-gallery-slot').forEach(wirePremiumGallerySlot);
    updatePremiumGalleryCount();
  }

  // Ensure both containers have a default mode
  // Set default mode on capsule weight container
  if (capsuleWeightContainer && !capsuleWeightContainer.dataset.mode) {
    const ab = document.querySelector('.pricing-type-btn.active');
    capsuleWeightContainer.dataset.mode = ab ? ab.getAttribute('data-mode') || 'weight' : 'weight';
  }

  // Transform static weight selects into pill widgets
  wpwTransformStatic();

  // Wire 2FA Security handlers
  wireSecurityHandlers();
}

/* ── Training Ops Tab ── */

async function loadTrainingOpsTab() {
  const container = document.getElementById('training-ops-container');
  if (!container) return;

  container.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading Training Ops…</div>';

  try {
    // Ensure trainings list is populated for the batch form dropdown
    if (!_adminTrainings || !_adminTrainings.length) {
      await fetchAdminTrainings();
    }

    const [dashboard, allBatches, allEnrollments, actionLogs] = await Promise.all([
      trainingApi.getAdminDashboard(),
      trainingApi.getAllBatches(),
      trainingApi.getAllEnrollments().then(r => r?.v2 || []),
      trainingApi.getActionLogs(),
    ]);

    const stats = dashboard || {};
    const batches = Array.isArray(allBatches) ? allBatches : [];
    const enrollments = Array.isArray(allEnrollments) ? allEnrollments : [];
    const logs = Array.isArray(actionLogs) ? actionLogs : [];

    // Group batches by training_id for accordion
    const batchBuckets = { _orphan: [] };
    for (const b of batches) {
      const key = b.training_id || '_orphan';
      if (!batchBuckets[key]) batchBuckets[key] = [];
      batchBuckets[key].push(b);
    }
    const orphanBatches = batchBuckets._orphan;

    function batchStatusStyle(status) {
      const m = { upcoming: ['#d4edda','#155724'], active: ['#cce5ff','#004085'], completed: ['#f8d7da','#721c24'], cancelled: ['#f8d7da','#721c24'] };
      const s = m[status] || ['#e2e8f0','#475569'];
      return `background:${s[0]};color:${s[1]};`;
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:20px;">
        <div class="admin-stat-chip" style="flex-direction:column;padding:12px;">
          <span style="font-size:1.4rem;font-weight:700;color:#2d6a4f;">${stats.upcoming_batches || 0}</span>
          <span style="font-size:0.75rem;color:#666;">Upcoming</span>
        </div>
        <div class="admin-stat-chip" style="flex-direction:column;padding:12px;">
          <span style="font-size:1.4rem;font-weight:700;color:#2d6a4f;">${stats.active_enrollments || 0}</span>
          <span style="font-size:0.75rem;color:#666;">Enrolled</span>
        </div>
        <div class="admin-stat-chip" style="flex-direction:column;padding:12px;">
          <span style="font-size:1.4rem;font-weight:700;color:#2d6a4f;">₹${Number(stats.total_revenue || 0).toLocaleString()}</span>
          <span style="font-size:0.75rem;color:#666;">Revenue</span>
        </div>
        <div class="admin-stat-chip" style="flex-direction:column;padding:12px;">
          <span style="font-size:1.4rem;font-weight:700;color:${stats.pending_refunds > 0 ? '#dc3545' : '#2d6a4f'};">${stats.pending_refunds || 0}</span>
          <span style="font-size:0.75rem;color:#666;">Pending Refunds</span>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:1.1rem;color:#1e293b;"><i class="fa-solid fa-book-open" style="margin-right:8px;color:#6366f1;"></i>Courses &amp; Batches</h3>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-primary" id="btn-new-batch" style="font-size:0.78rem;padding:4px 12px;"><i class="fa-solid fa-plus"></i> Batch</button>
          <button class="btn btn-secondary" id="btn-new-course" style="font-size:0.78rem;padding:4px 12px;"><i class="fa-solid fa-plus"></i> Course</button>
        </div>
      </div>

      <div id="training-ops-batch-form" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:14px;">
        <div style="font-weight:600;margin-bottom:10px;color:#1e293b;font-size:0.9rem;" id="tob-form-title">New Batch</div>
        <input type="hidden" id="tob-edit-id" value="" />
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="input-field">
            <label style="font-size:0.78rem;">Training Course *</label>
            <select id="tob-training-id" style="font-size:0.82rem;">
              <option value="">Select training...</option>
              ${(_adminTrainings || []).map(t => `<option value="${t.id}">${t.title}</option>`).join('')}
            </select>
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Batch Title *</label>
            <input type="text" id="tob-title" style="font-size:0.82rem;" placeholder="e.g. March Batch" />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Start Date *</label>
            <input type="date" id="tob-start-date" style="font-size:0.82rem;" />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">End Date *</label>
            <input type="date" id="tob-end-date" style="font-size:0.82rem;" />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Capacity *</label>
            <input type="number" id="tob-capacity" min="1" style="font-size:0.82rem;" placeholder="e.g. 20" />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Actual Price (₹) *</label>
            <input type="number" id="tob-price-actual" min="0" step="0.01" style="font-size:0.82rem;" placeholder="e.g. 999" />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Strikeout (₹)</label>
            <input type="number" id="tob-price-strikeout" min="0" step="0.01" style="font-size:0.82rem;" placeholder="e.g. 1999" />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Instructor</label>
            <input type="text" id="tob-instructor" style="font-size:0.82rem;" placeholder="Name" />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Location</label>
            <input type="text" id="tob-location" style="font-size:0.82rem;" placeholder="Venue" />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Meeting Link</label>
            <input type="url" id="tob-meeting-link" style="font-size:0.82rem;" placeholder="https://..." />
          </div>
          <div class="input-field">
            <label style="font-size:0.78rem;">Cancel Cutoff (days)</label>
            <input type="number" id="tob-cancel-cutoff" min="0" value="3" style="font-size:0.82rem;" />
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button type="button" class="btn btn-primary" id="tob-save-btn" style="font-size:0.82rem;padding:5px 14px;"><i class="fa-solid fa-save"></i> Save Batch</button>
          <button type="button" class="btn btn-secondary" id="tob-cancel-btn" style="font-size:0.82rem;padding:5px 14px;">Cancel</button>
        </div>
      </div>

      <div style="margin-bottom:16px;" id="training-ops-accordion">
        ${(!_adminTrainings || !_adminTrainings.length) && (!orphanBatches || !orphanBatches.length)
          ? '<div class="admin-loading" style="padding:20px;text-align:center;color:#94a3b8;">No courses or batches yet. Click <strong>+ Course</strong> to get started.</div>'
          : [
            ..._adminTrainings.map((t, ci) => {
              const courseBatches = batchBuckets[t.id] || [];
              const batchCount = courseBatches.length;
              const statusCounts = { upcoming: 0, active: 0, completed: 0, cancelled: 0 };
              for (const bb of courseBatches) { if (statusCounts[bb.status] !== undefined) statusCounts[bb.status]++; }
              const summary = Object.entries(statusCounts).filter(([,c]) => c > 0).map(([k,c]) => `${c} ${k}`).join(', ');
              const chevSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
              return `
                <div class="toc-panel" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;overflow:hidden;background:#fff;">
                  <div class="toc-panel-header" data-index="${ci}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                    <img src="${t.image_url || '/images/training_farm.png'}" alt="" style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0;" />
                    <div style="flex:1;min-width:0;">
                      <div style="font-weight:600;font-size:0.88rem;color:#1e293b;">${t.title}</div>
                      <div style="font-size:0.72rem;color:#64748b;margin-top:1px;">${t.category || ''}${summary ? ' · ' + summary : ''}</div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;">
                      <span style="font-size:0.72rem;color:#64748b;background:#e2e8f0;border-radius:10px;padding:1px 8px;">${batchCount}</span>
                      <button class="btn btn-secondary btn-ops-course-edit" data-id="${t.id}" style="font-size:0.7rem;padding:2px 8px;border:none;background:transparent;color:#6366f1;cursor:pointer;" title="Edit course"><i class="fa-solid fa-pen"></i></button>
                      <button class="btn btn-secondary btn-ops-course-del" data-id="${t.id}" style="font-size:0.7rem;padding:2px 8px;border:none;background:transparent;color:#dc3545;cursor:pointer;" title="Delete course"><i class="fa-solid fa-trash"></i></button>
                      <span class="toc-chev" style="color:#94a3b8;transition:transform 0.2s;">${chevSvg}</span>
                    </div>
                  </div>
                  <div class="toc-panel-body" style="max-height:0;overflow:hidden;transition:max-height 0.25s ease;">
                    <div style="padding:8px 14px 12px;">
                      ${courseBatches.length === 0
                        ? '<div style="font-size:0.78rem;color:#94a3b8;padding:8px 0;text-align:center;">No batches for this course.</div>'
                        : courseBatches.map(b => `
                          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;margin-bottom:4px;background:#f8fafc;border-radius:6px;border:1px solid #f1f5f9;">
                            <div style="flex:1;min-width:0;">
                              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <span style="font-weight:500;font-size:0.82rem;color:#1e293b;">${b.title || 'Untitled'}</span>
                                <span class="admin-badge" style="${batchStatusStyle(b.status)}padding:1px 8px;border-radius:10px;font-size:0.68rem;">${b.status}</span>
                              </div>
                              <div style="font-size:0.72rem;color:#64748b;margin-top:2px;">
                                ${b.start_date ? new Date(b.start_date).toLocaleDateString('en-IN', {day:'numeric',month:'short'}) : '—'}${b.end_date ? ' – '+new Date(b.end_date).toLocaleDateString('en-IN', {day:'numeric',month:'short'}) : ''} &middot;
                                ${b.seats_taken || 0}/${b.capacity || 0} seats &middot;
                                ₹${Number(b.price_actual || 0).toLocaleString()}
                                ${b.instructor ? ' &middot; '+b.instructor : ''}
                              </div>
                            </div>
                            <div style="display:flex;gap:4px;flex-shrink:0;">
                              <button class="btn btn-secondary btn-ops-edit" data-id="${b.id}" style="font-size:0.68rem;padding:2px 8px;"><i class="fa-solid fa-pen"></i></button>
                              <button class="btn btn-secondary btn-ops-clone" data-id="${b.id}" style="font-size:0.68rem;padding:2px 8px;"><i class="fa-solid fa-copy"></i></button>
                              <button class="btn btn-secondary btn-ops-force-cancel" data-id="${b.id}" style="font-size:0.68rem;padding:2px 8px;color:#dc3545;"><i class="fa-solid fa-ban"></i></button>
                            </div>
                          </div>
                        `).join('')}
                      <button class="btn btn-secondary btn-ops-add-batch-to-course" data-course-id="${t.id}" style="font-size:0.72rem;padding:4px 12px;margin-top:6px;width:100%;border:1px dashed #cbd5e1;background:transparent;color:#6366f1;"><i class="fa-solid fa-plus"></i> Add Batch</button>
                    </div>
                  </div>
                </div>
              `;
            }),
            (orphanBatches && orphanBatches.length > 0
              ? `<div class="toc-panel" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;overflow:hidden;background:#fff;">
                  <div class="toc-panel-header" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none;background:#fef9ef;border-bottom:1px solid #fde68a;">
                    <div style="width:36px;height:36px;border-radius:6px;background:#fef3c7;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1rem;">📦</div>
                    <div style="flex:1;min-width:0;">
                      <div style="font-weight:600;font-size:0.88rem;color:#92400e;">Uncategorized</div>
                      <div style="font-size:0.72rem;color:#a16207;">${orphanBatches.length} batch(es) without a course</div>
                    </div>
                    <span class="toc-chev" style="color:#a16207;transition:transform 0.2s;">${'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'}</span>
                  </div>
                  <div class="toc-panel-body" style="max-height:0;overflow:hidden;transition:max-height 0.25s ease;">
                    <div style="padding:8px 14px 12px;">
                      ${orphanBatches.map(b => `
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;margin-bottom:4px;background:#fffbeb;border-radius:6px;border:1px solid #fde68a;">
                          <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                              <span style="font-weight:500;font-size:0.82rem;color:#1e293b;">${b.title || 'Untitled'}</span>
                              <span class="admin-badge" style="${batchStatusStyle(b.status)}padding:1px 8px;border-radius:10px;font-size:0.68rem;">${b.status}</span>
                            </div>
                            <div style="font-size:0.72rem;color:#64748b;margin-top:2px;">
                              ${b.start_date ? new Date(b.start_date).toLocaleDateString('en-IN', {day:'numeric',month:'short'}) : '—'}${b.end_date ? ' – '+new Date(b.end_date).toLocaleDateString('en-IN', {day:'numeric',month:'short'}) : ''} &middot;
                              ${b.seats_taken || 0}/${b.capacity || 0} seats &middot;
                              ₹${Number(b.price_actual || 0).toLocaleString()}
                            </div>
                          </div>
                          <div style="display:flex;gap:4px;flex-shrink:0;">
                            <button class="btn btn-secondary btn-ops-edit" data-id="${b.id}" style="font-size:0.68rem;padding:2px 8px;"><i class="fa-solid fa-pen"></i></button>
                            <button class="btn btn-secondary btn-ops-clone" data-id="${b.id}" style="font-size:0.68rem;padding:2px 8px;"><i class="fa-solid fa-copy"></i></button>
                            <button class="btn btn-secondary btn-ops-force-cancel" data-id="${b.id}" style="font-size:0.68rem;padding:2px 8px;color:#dc3545;"><i class="fa-solid fa-ban"></i></button>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                </div>`
              : ''
            )
          ].join('')}
      </div>

      <div class="admin-section-header"><h3><i class="fa-solid fa-users"></i> Enrollments / Roster (${enrollments.length})</h3></div>
      <div style="margin-bottom:20px;" id="training-ops-roster">
        ${enrollments.length === 0 ? '<div class="admin-loading">No enrollments.</div>' : enrollments.map(e => {
          const user = e.user || {};
          const enrolledDate = e.created_at ? new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
          return `
          <div class="admin-card" style="padding:10px;margin-bottom:4px;font-size:0.82rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <strong style="color:#1e293b;">${user.full_name || e.user_id || '—'}</strong>
                  <span style="font-size:0.7rem;color:#64748b;">${user.email || ''}${user.phone ? ' · ' + user.phone : ''}</span>
                </div>
                <div style="font-size:0.72rem;color:#64748b;margin-top:2px;">
                  ${e.batch?.title || '—'} &middot; Enrolled ${enrolledDate}
                  <span class="admin-badge" style="background:${e.status === 'confirmed' ? '#d4edda' : e.status === 'pending_payment' ? '#fff3cd' : '#f8d7da'};color:${e.status === 'confirmed' ? '#155724' : e.status === 'pending_payment' ? '#856404' : '#721c24'};padding:1px 8px;border-radius:10px;font-size:0.68rem;margin-left:4px;">${e.status}</span>
                </div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
                ${e.status === 'confirmed' ? `
                  <select class="btn-ops-attendance" data-id="${e.id}" style="font-size:0.72rem;padding:2px 6px;">
                    <option value="">—</option>
                    <option value="present" ${e.attendance === 'present' ? 'selected' : ''}>Present</option>
                    <option value="no_show" ${e.attendance === 'no_show' ? 'selected' : ''}>No Show</option>
                  </select>
                  <button class="btn btn-secondary btn-ops-manual-refund" data-id="${e.id}" style="font-size:0.72rem;padding:2px 10px;color:#dc3545;">Refund</button>
                ` : ''}
              </div>
            </div>
          </div>
        `}).join('')}
      </div>

      <div class="admin-section-header"><h3><i class="fa-solid fa-clock-rotate-left"></i> Audit Logs</h3></div>
      <div style="max-height:300px;overflow-y:auto;margin-bottom:20px;">
        ${logs.length === 0 ? '<div class="admin-loading">No action logs.</div>' : logs.map(l => `
          <div style="font-size:0.8rem;padding:6px 0;border-bottom:1px solid #eee;display:flex;gap:12px;">
            <span style="color:#999;white-space:nowrap;">${l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</span>
            <span class="admin-badge" style="background:#e0e7ff;color:#3730a3;padding:1px 8px;border-radius:10px;">${l.action || ''}</span>
            <span style="color:#666;">${l.target_type || ''} ${l.target_id || ''}</span>
            <span style="color:#999;">${l.reason || ''}</span>
          </div>
        `).join('')}
      </div>
    `;

    // Wire new batch button
    const newBatchBtn = document.getElementById('btn-new-batch');
    const batchForm = document.getElementById('training-ops-batch-form');
    const tobCancelBtn = document.getElementById('tob-cancel-btn');
    const tobSaveBtn = document.getElementById('tob-save-btn');

    function showBatchForm(batchData) {
      if (!batchForm) return;
      batchForm.style.display = '';
      document.getElementById('tob-edit-id').value = batchData ? batchData.id : '';
      document.getElementById('tob-form-title').textContent = batchData ? 'Edit Batch' : 'New Batch';
      document.getElementById('tob-training-id').value = batchData ? batchData.training_id : '';
      document.getElementById('tob-title').value = batchData ? batchData.title : '';
      document.getElementById('tob-start-date').value = batchData ? (batchData.start_date || '').slice(0, 10) : '';
      document.getElementById('tob-end-date').value = batchData ? (batchData.end_date || '').slice(0, 10) : '';
      document.getElementById('tob-capacity').value = batchData ? batchData.capacity : '';
      document.getElementById('tob-price-actual').value = batchData ? batchData.price_actual : '';
      document.getElementById('tob-price-strikeout').value = batchData ? batchData.price_strikeout || '' : '';
      document.getElementById('tob-instructor').value = batchData ? batchData.instructor || '' : '';
      document.getElementById('tob-location').value = batchData ? batchData.location || '' : '';
      document.getElementById('tob-meeting-link').value = batchData ? batchData.meeting_link || '' : '';
      document.getElementById('tob-cancel-cutoff').value = batchData ? batchData.cancellation_cutoff_days || 3 : 3;
    }

    function hideBatchForm() {
      if (!batchForm) return;
      batchForm.style.display = 'none';
    }

    if (newBatchBtn) {
      newBatchBtn.addEventListener('click', () => showBatchForm(null));
    }
    if (tobCancelBtn) {
      tobCancelBtn.addEventListener('click', hideBatchForm);
    }
    if (tobSaveBtn) {
      tobSaveBtn.addEventListener('click', async () => {
        const editId = document.getElementById('tob-edit-id').value;
        const training_id = document.getElementById('tob-training-id').value;
        const title = (document.getElementById('tob-title').value || '').trim();
        const start_date = document.getElementById('tob-start-date').value;
        const end_date = document.getElementById('tob-end-date').value;
        const capacity = parseInt(document.getElementById('tob-capacity').value, 10);
        const price_actual = parseFloat(document.getElementById('tob-price-actual').value);
        const price_strikeout = parseFloat(document.getElementById('tob-price-strikeout').value) || undefined;
        const instructor = (document.getElementById('tob-instructor').value || '').trim() || undefined;
        const location = (document.getElementById('tob-location').value || '').trim() || undefined;
        const meeting_link = (document.getElementById('tob-meeting-link').value || '').trim() || undefined;
        const cancellation_cutoff_days = parseInt(document.getElementById('tob-cancel-cutoff').value, 10) || undefined;

        if (!training_id) { showErrorToast('Please select a training course.'); return; }
        if (!title) { showErrorToast('Batch title is required.'); return; }
        if (!start_date || !end_date) { showErrorToast('Start and end dates are required.'); return; }
        if (!capacity || capacity < 1) { showErrorToast('Capacity must be at least 1.'); return; }
        if (isNaN(price_actual) || price_actual < 0) { showErrorToast('Valid actual price is required.'); return; }

        tobSaveBtn.disabled = true;
        tobSaveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
        try {
          const payload = { training_id, title, start_date, end_date, capacity, price_actual, price_strikeout, instructor, location, meeting_link, cancellation_cutoff_days };
          if (editId) {
            await trainingApi.updateBatch(editId, payload);
            showSuccessToast('Batch updated!');
          } else {
            await trainingApi.createBatch(payload);
            showSuccessToast('Batch created!');
          }
          hideBatchForm();
          loadTrainingOpsTab();
        } catch (err) {
          showErrorToast(err.message);
          tobSaveBtn.disabled = false;
          tobSaveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Save Batch';
        }
      });
    }

    // Wire edit buttons
    container.querySelectorAll('.btn-ops-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const b = batches.find(x => x.id === id);
        if (b) showBatchForm(b);
      });
    });

    // Wire clone buttons
    container.querySelectorAll('.btn-ops-clone').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
          await trainingApi.cloneBatch(id, { shift_days: 30 });
          showSuccessToast('Batch cloned!');
          loadTrainingOpsTab();
        } catch (err) {
          showErrorToast(err.message);
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-copy"></i> Clone';
        }
      });
    });

    // Wire force cancel buttons
    container.querySelectorAll('.btn-ops-force-cancel').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Force-cancel this batch? This will refund all confirmed registrations. This cannot be undone.')) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
          const result = await trainingApi.forceCancelBatch(id, { reason: 'Admin force-cancel via console' });
          showSuccessToast(`Batch cancelled. ${result.enrollments_affected || 0} enrollments affected.`);
          loadTrainingOpsTab();
        } catch (err) {
          showErrorToast(err.message);
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-ban"></i> Force Cancel';
        }
      });
    });

    // Wire attendance selects
    container.querySelectorAll('.btn-ops-attendance').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await trainingApi.markAttendance(sel.dataset.id, { attendance: sel.value });
          showSuccessToast('Attendance marked!');
        } catch (err) {
          showErrorToast(err.message);
        }
      });
    });

    // Wire manual refund buttons
    container.querySelectorAll('.btn-ops-manual-refund').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const reason = prompt('Reason for manual refund (required, min 10 chars):');
        if (!reason) return;
        if (!confirm(`Issue manual refund for enrollment ${id}?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
          await trainingApi.manualRefund(id, { reason });
          showSuccessToast('Manual refund processed!');
          loadTrainingOpsTab();
        } catch (err) {
          showErrorToast(err.message);
          btn.disabled = false;
          btn.innerHTML = 'Refund';
        }
      });
    });

    // Wire accordion toggle
    container.querySelectorAll('.toc-panel-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const body = header.nextElementSibling;
        const chev = header.querySelector('.toc-chev');
        if (!body) return;
        const isOpen = body.style.maxHeight && body.style.maxHeight !== '0px';
        body.style.maxHeight = isOpen ? '0' : body.scrollHeight + 'px';
        if (chev) chev.style.transform = isOpen ? '' : 'rotate(90deg)';
      });
    });
    // Open first panel by default
    const firstHeader = container.querySelector('.toc-panel-header');
    if (firstHeader) {
      const firstBody = firstHeader.nextElementSibling;
      if (firstBody) {
        firstBody.style.maxHeight = firstBody.scrollHeight + 'px';
        const chev = firstHeader.querySelector('.toc-chev');
        if (chev) chev.style.transform = 'rotate(90deg)';
      }
    }

    // Wire "Add Batch to Course" buttons
    container.querySelectorAll('.btn-ops-add-batch-to-course').forEach(btn => {
      btn.addEventListener('click', () => {
        const courseId = btn.dataset.courseId;
        showBatchForm(null);
        const trainingSelect = document.getElementById('tob-training-id');
        if (trainingSelect && courseId) trainingSelect.value = courseId;
      });
    });

    // Wire course buttons
    const newCourseBtn = document.getElementById('btn-new-course');
    if (newCourseBtn) {
      newCourseBtn.addEventListener('click', () => {
        const editId = document.getElementById('admin-train-edit-id');
        if (editId) editId.value = '';
        const resetBtn = document.getElementById('btn-admin-reset-train');
        if (resetBtn) resetBtn.click();
        toggleAdminTrainForm();
      });
    }
    container.querySelectorAll('.btn-ops-course-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const t = _adminTrainings.find(x => x.id === id);
        if (t) globalThis.adminEditTraining(t.id);
      });
    });
    container.querySelectorAll('.btn-ops-course-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        globalThis.adminDeleteTraining(id);
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="admin-loading" style="color:#e74c3c;">Failed to load Training Ops: ${err.message}</div>`;
  }
}

globalThis.loadTrainingOpsTab = loadTrainingOpsTab;

/* ── Security Tab (2FA) ── */

async function loadSecurityTab() {
  const notSetup = document.getElementById('security-2fa-not-setup');
  const setupQr = document.getElementById('security-2fa-setup-qr');
  const enabledDiv = document.getElementById('security-2fa-enabled');
  const loading = document.getElementById('security-loading');
  const setupErr = document.getElementById('security-setup-error');
  const disableErr = document.getElementById('security-disable-error');

  const resetUi = () => {
    [notSetup, setupQr, enabledDiv].forEach(el => el?.classList.add('hidden'));
    if (loading) loading.classList.remove('hidden');
    if (setupErr) setupErr.classList.add('hidden');
    if (disableErr) disableErr.classList.add('hidden');
    if (setupErr) setupErr.textContent = '';
    if (disableErr) disableErr.textContent = '';
  };
  resetUi();

  try {
    const res = await authApi.adminGet2faStatus();
    if (!res?.success) throw new Error('Failed to get 2FA status');

    if (loading) loading.classList.add('hidden');
    const { enabled } = res.data;

    if (enabled) {
      if (enabledDiv) enabledDiv.classList.remove('hidden');
    } else {
      if (notSetup) notSetup.classList.remove('hidden');
    }
  } catch (err) {
    if (loading) loading.textContent = 'Failed to load security settings: ' + (err.message || 'Unknown error');
  }
}

function wireSecurityHandlers() {
  const enableBtn = document.getElementById('btn-security-enable-2fa');
  const verifyBtn = document.getElementById('btn-security-verify-setup');
  const cancelBtn = document.getElementById('btn-security-cancel-setup');
  const disableBtn = document.getElementById('btn-security-disable-2fa');
  const notSetup = document.getElementById('security-2fa-not-setup');
  const setupQr = document.getElementById('security-2fa-setup-qr');
  const enabledDiv = document.getElementById('security-2fa-enabled');
  const loading = document.getElementById('security-loading');
  const setupErr = document.getElementById('security-setup-error');
  const disableErr = document.getElementById('security-disable-error');

  // Enable 2FA: Generate QR code
  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      enableBtn.disabled = true;
      enableBtn.textContent = 'Generating…';
      try {
        const res = await authApi.adminSetup2fa();
        if (!res?.success) throw new Error(res?.error || 'Failed to setup 2FA');
        const qrImg = document.getElementById('security-qr-image');
        const secretKey = document.getElementById('security-secret-key');
        if (qrImg) qrImg.src = res.data.qr_code;
        if (secretKey) secretKey.textContent = res.data.secret;
        if (notSetup) notSetup.classList.add('hidden');
        if (setupQr) setupQr.classList.remove('hidden');
      } catch (err) {
        if (setupErr) {
          setupErr.textContent = err.message || 'Failed to generate QR code';
          setupErr.classList.remove('hidden');
        }
      } finally {
        enableBtn.disabled = false;
        enableBtn.textContent = '<i class="fa-solid fa-qrcode"></i> Enable Two-Step Verification';
      }
    });
  }

  // Verify setup code
  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      const code = document.getElementById('security-setup-code')?.value?.trim();
      if (!code || !/^\d{6}$/.test(code)) {
        if (setupErr) {
          setupErr.textContent = 'Enter a valid 6-digit code';
          setupErr.classList.remove('hidden');
        }
        return;
      }
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying…';
      try {
        const res = await authApi.adminVerifySetup2fa(code);
        if (!res?.success) throw new Error(res?.error || 'Invalid code');
        if (setupQr) setupQr.classList.add('hidden');
        if (enabledDiv) enabledDiv.classList.remove('hidden');
        showSuccessToast('Two-step verification enabled successfully');
      } catch (err) {
        if (setupErr) {
          setupErr.textContent = err.message || 'Verification failed';
          setupErr.classList.remove('hidden');
        }
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = '<i class="fa-solid fa-check"></i> Verify & Enable';
      }
    });
  }

  // Cancel setup
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (setupQr) setupQr.classList.add('hidden');
      if (loading) loading.classList.add('hidden');
      if (notSetup) notSetup.classList.remove('hidden');
      document.getElementById('security-setup-code').value = '';
      if (setupErr) setupErr.classList.add('hidden');
    });
  }

  // Disable 2FA
  if (disableBtn) {
    disableBtn.addEventListener('click', async () => {
      const code = document.getElementById('security-disable-code')?.value?.trim();
      if (!code || !/^\d{6}$/.test(code)) {
        if (disableErr) {
          disableErr.textContent = 'Enter your current 6-digit code to disable 2FA';
          disableErr.classList.remove('hidden');
        }
        return;
      }
      disableBtn.disabled = true;
      disableBtn.textContent = 'Disabling…';
      try {
        const res = await authApi.adminDisable2fa(code);
        if (!res?.success) throw new Error(res?.error || 'Failed to disable 2FA');
        if (enabledDiv) enabledDiv.classList.add('hidden');
        if (loading) loading.classList.add('hidden');
        if (notSetup) notSetup.classList.remove('hidden');
        document.getElementById('security-disable-code').value = '';
        showSuccessToast('Two-step verification disabled');
      } catch (err) {
        if (disableErr) {
          disableErr.textContent = err.message || 'Failed to disable';
          disableErr.classList.remove('hidden');
        }
      } finally {
        disableBtn.disabled = false;
        disableBtn.textContent = '<i class="fa-solid fa-xmark"></i> Disable 2FA';
      }
    });
  }
}

async function initAdminPage(alreadyVerified = false) {
  setupAdminEventHandlers();
  // When called from the SPA route guard, alreadyVerified is true —
  // skip the redundant authApi.getMe() call and just show the dashboard.
  if (alreadyVerified) {
    showDashboard();
    return;
  }
  // Initialize UI state — only show dashboard if the logged-in user is an admin
  if (state.token && state.user && state.user.role === 'admin') {
    const tokenAtStart = state.token;
    try {
      const user = await authApi.getMe();
      if (state.token !== tokenAtStart) return;
      if (user && user.role === 'admin') {
        state.user = user;
        showDashboard();
        return;
      }
    } catch (_err) {
      if (state.token !== tokenAtStart) return;
    }
    clearAuth();
    showLoginPanel();
  } else {
    // If a non-admin user is logged in, clear their auth so the admin login works cleanly
    if (state.token && state.user && state.user.role !== 'admin') {
      clearAuth();
    }
    showLoginPanel();
  }
}

export default initAdminPage;
