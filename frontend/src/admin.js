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
let adminHistoryPage = 1;
let adminHistoryPageSize = 10;
let adminHistorySort = 'date_desc';
let _adminInventoryPage = 1;
let adminInventoryPageSize = 10;
let productImagePreviewValid = false;
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
const resetFormBtn = document.getElementById('btn-admin-reset-form');
const resetCatBtn = document.getElementById('btn-admin-reset-cat');
const saveCatBtn = document.getElementById('btn-admin-save-cat');
const productForm = document.getElementById('form-admin-add-product');
const productIdDisplay = document.getElementById('admin-prod-id-display');
const productImageUrl = document.getElementById('admin-prod-image-url');
const weightPricingContainer = document.getElementById('admin-weight-pricing-container');
const capsuleWeightContainer = document.getElementById('admin-capsule-weight-container');
const btnAddWeightRow = document.getElementById('btn-add-weight-row');
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
const productImageBrowse = document.getElementById('admin-prod-image-browse');
const productImageFile = document.getElementById('admin-prod-image-file');
const categoryUidInput = document.getElementById('admin-cat-uid');
const categoryImageUrl = document.getElementById('admin-cat-image-url');
const categoryImageBrowse = document.getElementById('admin-cat-image-browse');
const categoryImageFile = document.getElementById('admin-cat-image-file');
const categoryImagePreview = document.getElementById('admin-cat-image-preview');
const shippingChargeInput = document.getElementById('admin-shipping-charge');
const saveShippingChargeBtn = document.getElementById(
  'admin-save-shipping-charge',
);
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
    adminEs.addEventListener('error', () => {
      // noop; BroadcastChannel remains as fallback
    });
    // Auto-refresh refunds tab on webhook-driven refund updates
    adminEs.addEventListener('refund:updated', (ev) => {
      try {
        const payload = JSON.parse(ev.data || '{}');
        if (state.user?.role === 'admin') {
          fetchAdminOrders();
          const refundsContent = document.getElementById('admin-content-refunds');
          if (refundsContent?.classList.contains('active')) {
            loadRefundsDashboard();
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
  if (btn) btn.textContent = 'Send OTP';
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
      activateAdminTab('categories');
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
      (p) => p.category === document.getElementById('admin-prod-category')?.value,
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

async function updateProductIdDisplay() {
  const editId = document.getElementById('admin-edit-id')?.value;
  if (editId) return;
  const productCategory = document.getElementById('admin-prod-category');
  if (!productIdDisplay || !productCategory) return;
  const selectedOption = productCategory.selectedOptions?.[0];
  const categoryId = productCategory.value;
  try {
    const res = await fetchWithAuth(`/products/next-id${categoryId ? `?category=${encodeURIComponent(categoryId)}` : ''}`);
    productIdDisplay.value = res.productId;
  } catch {
    // fallback: clear field on error
    productIdDisplay.value = '';
  }
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

function renderUploadPreview(preview, file, url, label) {
  if (!preview) return;

  if (file) {
    const reader = new FileReader();
    preview.dataset.previewValid = 'false';
    reader.onload = () => {
      preview.innerHTML = `<img src="${String(reader.result)}" alt="Preview">`;
      preview.dataset.previewValid = 'true';
      productImagePreviewValid = true;
    };
    reader.onerror = () => {
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Unable to read image file</span>';
      preview.dataset.previewValid = 'false';
      productImagePreviewValid = false;
    };
    reader.readAsDataURL(file);
    return;
  }

  if (url) {
    if (url.startsWith('//')) {
      url = `https:${url}`;
    } else if (
      !/^https?:\/\//i.test(url)
      && !/^data:/i.test(url)
      && !/^blob:/i.test(url)
      && url.includes('.')
    ) {
      url = `https://${url}`;
    }

    preview.innerHTML = '<span style="color:var(--color-primary)">Loading preview...</span>';
    preview.dataset.previewValid = 'false';
    productImagePreviewValid = false;

    const img = new Image();
    let handled = false;
    img.onload = () => {
      if (handled) return;
      handled = true;
      preview.innerHTML = `<img src="${url}" alt="Preview">`;
      preview.dataset.previewValid = 'true';
      productImagePreviewValid = true;
    };
    img.onerror = () => {
      if (handled) return;
      handled = true;
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Failed to load image from URL. Use a direct image URL (jpg, png, webp, or data URL) or upload a local image file.</span>';
      preview.dataset.previewValid = 'false';
      productImagePreviewValid = false;
    };

    try {
      img.src = url;
    } catch (e) {
      console.warn(e);
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Invalid image URL</span>';
      preview.dataset.previewValid = 'false';
      productImagePreviewValid = false;
    }
    return;
  }

  preview.innerHTML = `<i class="fa-solid fa-image"></i><span>${label}</span>`;
  preview.dataset.previewValid = 'false';
  productImagePreviewValid = false;
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
    const ctr = sel.closest('#admin-weight-pricing-container, #admin-capsule-weight-container');
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

function toggleStockField() {
  const rows = weightPricingContainer.querySelectorAll('.admin-weight-pricing-row');
  const hasVariants = rows.length > 0 && Array.from(rows).some(r => r.querySelector('.admin-weight-select')?.value);
  const stockFieldContainer = document.getElementById('admin-prod-stock')?.closest('.admin-pf-field');
  if (stockFieldContainer) {
    stockFieldContainer.style.display = hasVariants ? 'none' : '';
  }
}

function createWeightRow(value) {
  const mode = weightPricingContainer?.dataset.mode;
  const row = document.createElement('div');
  row.className = 'admin-weight-pricing-row';
  row.innerHTML = `
    ${wpwHTML('admin-weight-select', mode)}
    <div class="awp-fields">
      <div class="awp-field">
        <span class="awp-field-icon"><i class="fa-solid fa-rupee-sign"></i></span>
        <input type="number" step="0.01" class="admin-weight-price" placeholder="Price" />
      </div>
      <div class="awp-field">
        <span class="awp-field-icon awp-field-icon-muted"><i class="fa-solid fa-tag"></i></span>
        <input type="number" step="0.01" class="admin-weight-mrp" placeholder="MRP" />
      </div>
      <div class="awp-field awp-field-stock">
        <span class="awp-field-icon"><i class="fa-solid fa-cubes"></i></span>
        <input type="number" class="admin-weight-stock" placeholder="Stock" min="0" />
      </div>
    </div>
    <button type="button" class="btn-weight-remove" title="Remove variant"><i class="fa-solid fa-trash-can"></i></button>
  `;
  wpwAttach(row);
  if (value) {
    wpwSetValue(row, value);
    row.querySelector('.admin-weight-price').value = value.price;
    row.querySelector('.admin-weight-mrp').value = value.mrp_price || '';
    row.querySelector('.admin-weight-stock').value = value.stock ?? '';
  }
  row.querySelector('.btn-weight-remove').addEventListener('click', () => {
    if (weightPricingContainer.querySelectorAll('.admin-weight-pricing-row').length > 1) {
      row.remove();
    }
    toggleStockField();
    updateMainTotalStock();
  });
  return row;
}

function sortWeightVariants(data) {
  return [...data].sort((a, b) => {
    const toBase = (v) => (v.unit === 'kg' || v.unit === 'l') ? v.weight * 1000 : v.weight;
    return toBase(a) - toBase(b);
  });
}

function getWeightPricingData() {
  const rows = weightPricingContainer.querySelectorAll('.admin-weight-pricing-row');
  const data = [];
  rows.forEach(row => {
    const sel = row.querySelector('.admin-weight-select');
    const price = row.querySelector('.admin-weight-price').value;
    const mrp = row.querySelector('.admin-weight-mrp').value;
    const stockVal = row.querySelector('.admin-weight-stock')?.value;
    if (sel.value && price) {
      const match = sel.value.match(/^(\d+)(g|kg|ml|l)$/);
      if (match) {
        data.push({
          weight: parseInt(match[1], 10),
          unit: match[2],
          price: parseFloat(price),
          ...(mrp ? { mrp_price: parseFloat(mrp) } : {}),
          ...(stockVal ? { stock: parseInt(stockVal, 10) } : { stock: 0 }),
        });
      }
    }
  });
  return sortWeightVariants(data);
}

function setWeightPricingData(data) {
  weightPricingContainer.innerHTML = '';
  if (Array.isArray(data) && data.length > 0) {
    const isLitre = data.some(v => v.unit === 'ml' || v.unit === 'l');
    const targetMode = isLitre ? 'litre' : 'weight';
    weightPricingContainer.dataset.mode = targetMode;
    document.querySelectorAll('.pricing-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === targetMode);
    });
    sortWeightVariants(data).forEach(item => weightPricingContainer.appendChild(createWeightRow(item)));
  }
  if (!weightPricingContainer.querySelector('.admin-weight-pricing-row')) {
    weightPricingContainer.appendChild(createWeightRow(null));
  }
  toggleStockField();
  updateMainTotalStock();
}
// -----------------------------
// Helper: product/category helpers
// -----------------------------
function buildProductBody({ name, category, description, gstRate, image_url, productId, editId, weightPricing, stock, image_urls }) {
  const body = {
    name,
    category,
    description,
    gst_rate: Number.parseInt(String(gstRate || 0), 10),
    weight_pricing: weightPricing,
    stock: Math.max(0, stock || 0),
  };
  if (image_url) body.image_url = image_url;
  if (image_urls && image_urls.length > 0) body.image_urls = image_urls;
  if (!editId) body.id = productId;
  return body;
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
    grid.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; padding: 2rem; width:100%;">
        <i class="fa-solid fa-spinner fa-spin loader-icon" style="font-size: 1.5rem;"></i>
      </div>
    `;
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

  // ── Add Product capsule ────────────────────────
  if (_activeCapsule === 'add-product') {
    if (afBar) afBar.style.display = 'none';
    if (capsuleForm) {
      capsuleForm.style.display = 'block';
      populateCapsuleCategorySelect();
    }
    grid.innerHTML = '';
    return;
  }

  // ── Show grid + filter bar, hide inline form ───
  if (afBar) afBar.style.display = '';
  if (capsuleForm) capsuleForm.style.display = 'none';

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

      return `
      <div class="ac-card ${isRecent ? 'ac-card--recent' : ''}" data-id="${p.id}">
        <div class="ac-row" onclick="globalThis.toggleOrderExpand(this)">
          <img class="ac-thumb" src="${p.image_url}" alt="${p.name}">
          <span class="ac-title">${p.name}</span>
          <span class="ac-meta">${categoryName}</span>
          <span class="ac-prod-price">₹${(p.price || 0).toFixed(2)}${p.mrp_price ? ` <span class="ac-mrp-strike">₹${p.mrp_price.toFixed(2)}</span>` : ''}</span>
          <span class="ac-prod-gst">GST ${p.gst_rate}%</span>
          <span class="ac-prod-stock">Stock: ${p.stock ?? 0}</span>
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

function createGallerySlotHTML(index, previewPrefix, galleryName, initialValue) {
  const dataAttr = galleryName ? `data-gallery="${galleryName}"` : '';
  const previewContent = initialValue
    ? `<img src="${initialValue}" alt="Gallery ${index + 1}" />`
    : `<i class="fa-solid fa-image"></i><span>URL #${index + 1}</span>`;
  return `
    <div class="gallery-slot" data-slot="${index}">
      <div class="gallery-preview" id="${previewPrefix}-${index}">
        ${previewContent}
      </div>
      <div class="gallery-input-row">
        <div class="gallery-input-wrap">
          <i class="fa-solid fa-link"></i>
          <input type="url" class="gallery-url-input" ${dataAttr} data-slot="${index}" placeholder="Paste image URL..." value="${initialValue || ''}" />
        </div>
        <button type="button" class="gallery-remove-btn" ${dataAttr} data-slot="${index}" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>`;
}

function wireGalleryInput(input, newIdx, previewPrefix) {
  input.addEventListener('input', () => {
    const preview = document.getElementById(`${previewPrefix}-${newIdx}`);
    const val = input.value.trim();
    if (preview) {
      if (val) {
        preview.innerHTML = `<img src="${val}" alt="Gallery ${newIdx + 1}" onerror="this.parentElement.innerHTML='<i class=\\\\\\'fa-solid fa-image\\\\\\'></i><span>URL #${newIdx + 1}</span>'">`;
      } else {
        preview.innerHTML = `<i class="fa-solid fa-image"></i><span>URL #${newIdx + 1}</span>`;
      }
    }
  });
}

function wireGalleryRemove(rmBtn, newSlot, containerId, previewPrefix, badgeId) {
  rmBtn.style.display = '';
  rmBtn.addEventListener('click', () => {
    const g = document.getElementById(containerId);
    if (g && g.querySelectorAll('.gallery-slot').length <= 1) return;
    newSlot.remove();
    reindexGallerySlots(containerId, previewPrefix);
    updateGalleryCount(containerId, badgeId);
    const g2 = document.getElementById(containerId);
    if (g2 && g2.querySelectorAll('.gallery-slot').length === 1) {
      const lastRm = g2.querySelector('.gallery-remove-btn');
      if (lastRm) lastRm.style.display = 'none';
    }
  });
}

function addGallerySlot(containerId, previewPrefix, galleryName, initialValue) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  const slots = grid.querySelectorAll('.gallery-slot');
  if (slots.length >= 8) return;
  const newIdx = slots.length;
  grid.insertAdjacentHTML('beforeend', createGallerySlotHTML(newIdx, previewPrefix, galleryName, initialValue));
  const newSlot = grid.querySelector(`.gallery-slot[data-slot="${newIdx}"]`);
  const input = newSlot?.querySelector('.gallery-url-input');
  if (input) wireGalleryInput(input, newIdx, previewPrefix);
  const rmBtn = newSlot?.querySelector('.gallery-remove-btn');
  const badgeId = `${galleryName === 'capsule' ? 'capsule-' : ''}gallery-count-badge`;
  if (rmBtn) wireGalleryRemove(rmBtn, newSlot, containerId, previewPrefix, badgeId);
  updateGalleryCount(containerId, badgeId);
  return newSlot;
}

async function handleGalleryFiles(fileInputId, containerId, previewPrefix, galleryName) {
  const fileInput = document.getElementById(fileInputId);
  if (!fileInput || !fileInput.files || !fileInput.files.length) return;
  const badgeId = `${galleryName === 'capsule' ? 'capsule-' : ''}gallery-count-badge`;
  const grid = document.getElementById(containerId);
  // Determine starting slot — fill empty inputs first, then add new slots
  const slots = grid ? [...grid.querySelectorAll('.gallery-slot')] : [];
  let slotIdx = 0;
  const files = [...fileInput.files];
  for (let fi = 0; fi < files.length; fi++) {
    if (slotIdx >= 8) break;
    const file = files[fi];
    let dataUrl;
    try {
      dataUrl = await readFileAsDataUrl(file);
    } catch { continue; }
    // Find next slot without a value
    while (slotIdx < slots.length) {
      const inp = slots[slotIdx].querySelector('.gallery-url-input');
      if (inp && !inp.value.trim()) break;
      slotIdx++;
    }
    if (slotIdx < slots.length) {
      // Fill existing empty slot
      const inp = slots[slotIdx].querySelector('.gallery-url-input');
      const preview = document.getElementById(`${previewPrefix}-${slotIdx}`);
      if (inp) { inp.value = dataUrl; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      slotIdx++;
    } else {
      // Add new slot
      const newSlot = addGallerySlot(containerId, previewPrefix, galleryName, dataUrl);
      if (newSlot) {
        const newInp = newSlot.querySelector('.gallery-url-input');
        if (newInp) newInp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
  // Reset file input so same files can be re-selected
  fileInput.value = '';
  updateGalleryCount(containerId, badgeId);
}

function reindexGallerySlots(containerId, previewPrefix) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.querySelectorAll('.gallery-slot').forEach((slot, i) => {
    slot.dataset.slot = i;
    const preview = slot.querySelector('.gallery-preview');
    if (preview) preview.id = `${previewPrefix}-${i}`;
    const input = slot.querySelector('.gallery-url-input');
    if (input) {
      input.dataset.slot = i;
      // restore preview on reindex
      const val = input.value.trim();
      if (val) {
        preview.innerHTML = `<img src="${val}" alt="Gallery ${i + 1}" onerror="this.parentElement.innerHTML='<i class=\\\\\\'fa-solid fa-image\\\\\\'></i><span>URL #${i + 1}</span>'">`;
      } else {
        preview.innerHTML = `<i class="fa-solid fa-image"></i><span>URL #${i + 1}</span>`;
      }
    }
    const rmBtn = slot.querySelector('.gallery-remove-btn');
    if (rmBtn) rmBtn.dataset.slot = i;
  });
}

function resetGallery(containerId, previewPrefix, badgeId) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = createGallerySlotHTML(0, previewPrefix, '');
  const firstSlot = grid.querySelector('.gallery-slot');
  const firstInput = firstSlot?.querySelector('.gallery-url-input');
  if (firstInput) wireGalleryInput(firstInput, 0, previewPrefix);
  const rmBtn = firstSlot?.querySelector('.gallery-remove-btn');
  if (rmBtn) rmBtn.style.display = 'none';
  if (badgeId) {
    const badge = document.getElementById(badgeId);
    if (badge) badge.textContent = '0 / 3 min';
  }
}

function initGallery(containerId, previewPrefix, badgeId, addBtnId, galleryName) {
  const addBtn = document.getElementById(addBtnId);
  if (addBtn) addBtn.addEventListener('click', () => addGallerySlot(containerId, previewPrefix, galleryName));
  const grid = document.getElementById(containerId);
  if (grid) {
    grid.querySelectorAll('.gallery-slot').forEach((slot) => {
      const input = slot.querySelector('.gallery-url-input');
      const slotIdx = parseInt(slot.dataset.slot, 10);
      if (input) wireGalleryInput(input, slotIdx, previewPrefix);
      const rmBtn = slot.querySelector('.gallery-remove-btn');
      if (rmBtn) wireGalleryRemove(rmBtn, slot, containerId, previewPrefix, badgeId);
    });
  }
  updateGalleryCount(containerId, badgeId);
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

function updateMainTotalStock() {
  const container = document.getElementById('admin-weight-pricing-container');
  const totalEl = document.getElementById('admin-total-stock');
  if (!container || !totalEl) return;
  let total = 0;
  container.querySelectorAll('.admin-weight-stock').forEach(inp => {
    const v = parseInt(inp.value, 10);
    if (Number.isFinite(v) && v > 0) total += v;
  });
  totalEl.textContent = total;
}

// Delegate input events for both stock containers
document.addEventListener('input', (ev) => {
  const target = ev.target;
  if (target.classList.contains('admin-weight-stock')) {
    if (target.closest('#admin-capsule-weight-container')) {
      updateCapsuleTotalStock();
    } else if (target.closest('#admin-weight-pricing-container')) {
      updateMainTotalStock();
    }
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
  // Sync default category from the main form if available
  const mainCat = document.getElementById('admin-prod-category');
  if (mainCat && mainCat.value) sel.value = mainCat.value;
}

function resetCapsuleAddForm() {
  const form = document.getElementById('form-admin-capsule-add');
  if (form) form.reset();
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

  // Ensure MRP is provided and > price for every variant (mandatory by law)
  for (const v of weightPricing) {
    if (v.mrp_price == null || isNaN(v.mrp_price)) {
      const label = `${v.weight}${v.unit}`;
      feedback.textContent = `MRP (Maximum Retail Price) is mandatory for ${label}. Please enter a valid MRP as required by law.`;
      feedback.classList.remove('hidden');
      return;
    }
    if (v.mrp_price <= v.price) {
      const label = `${v.weight}${v.unit}`;
      feedback.textContent = `MRP (₹${v.mrp_price}) for ${label} must be greater than the selling price (₹${v.price}).`;
      feedback.classList.remove('hidden');
      return;
    }
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

  const editId = document.getElementById('admin-capsule-edit-id')?.value || '';
  const isEdit = Boolean(editId);

  const payload = {
    category: categoryId,
    name,
    description: desc,
    gst_rate: gstRate,
    weight_pricing: weightPricing,
    image_urls: galleryUrls,
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
  activateAdminTab('add-product');

  document.getElementById('admin-edit-id').value = product.id;
  if (productIdDisplay) productIdDisplay.value = product.id;
  document.getElementById('admin-prod-name').value = product.name;
  document.getElementById('admin-prod-desc').value = product.description;
  document.getElementById('admin-prod-category').value = product.category;
  document.getElementById('admin-prod-gst').value = String(product.gst_rate);
  const stockField = document.getElementById('admin-prod-stock');
  if (stockField) stockField.value = product.stock ?? 100;
  if (productImageUrl) productImageUrl.value = product.image_url || '';
  if (productImageFile) productImageFile.value = '';

  const preview = document.getElementById('admin-img-preview');
  if (preview) {
    preview.innerHTML = `<img src="${product.image_url}" alt="Preview">`;
    productImagePreviewValid = true;
  }

  // Load weight pricing if available
  setWeightPricingData(product.weight_pricing || null);

  // Load gallery images
  const galleryUrls = product.image_urls || [];
  resetGallery('admin-gallery-grid', 'gallery-preview', 'gallery-count-badge');
  if (galleryUrls.length > 0) {
    const grid = document.getElementById('admin-gallery-grid');
    if (grid) grid.innerHTML = '';
    galleryUrls.forEach((url, i) => {
      // remove any existing slot at this index first
      const grid2 = document.getElementById('admin-gallery-grid');
      if (grid2 && i > 0) {
        const btn = document.getElementById('btn-gallery-add-main');
        if (btn) btn.click();
      } else if (grid2 && i === 0) {
        // fill first slot
        const firstInput = grid2.querySelector('.gallery-url-input');
        if (firstInput) {
          firstInput.value = url;
          firstInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
    // Now fill in values for all slots (they were added via the add button)
    const grid3 = document.getElementById('admin-gallery-grid');
    if (grid3) {
      const inputs = grid3.querySelectorAll('.gallery-url-input');
      inputs.forEach((inp, idx) => {
        if (galleryUrls[idx]) {
          inp.value = galleryUrls[idx];
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }
    updateGalleryCount('admin-gallery-grid', 'gallery-count-badge');
  }

  const label = document.getElementById('admin-submit-label');
  if (label) label.textContent = 'Update Product';
}

async function handleAdminAddProduct(event) {
  event.preventDefault();
  const feedback = document.getElementById('admin-add-feedback');
  feedback.classList.add('hidden');

  const editId = document.getElementById('admin-edit-id').value;
  const name = document.getElementById('admin-prod-name').value.trim();
  const category = document.getElementById('admin-prod-category').value;
  const description = document.getElementById('admin-prod-desc').value.trim();
  const gst_rate = document.getElementById('admin-prod-gst').value;
  const selectedCategoryUid = document.getElementById('admin-prod-category')?.selectedOptions?.[0]?.dataset?.categoryUid || '';
  let productId = productIdDisplay?.value.trim() || '';
  const productImageUrlValue = productImageUrl?.value.trim() || '';
  const imageFile = productImageFile?.files?.[0];
  let image_url = productImageUrlValue;

  try {
    if (!name) {
      feedback.textContent = 'Product name is required.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }
    if (!category) {
      feedback.textContent = 'Please select a category.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }
    if (!description) {
      feedback.textContent = 'Product description is required.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }

    const expectedPrefix = selectedCategoryUid ? `${selectedCategoryUid}-pid-` : '';
    if (!productId || (expectedPrefix && !productId.startsWith(expectedPrefix))) {
      try {
        const res = await fetchWithAuth(`/products/next-id${selectedCategoryUid ? `?category=${encodeURIComponent(document.getElementById('admin-prod-category')?.value || '')}` : ''}`);
        productId = res.productId;
      } catch {
        productId = generateProductId(selectedCategoryUid);
      }
      if (productIdDisplay) productIdDisplay.value = productId;
    }

    if (imageFile) image_url = await readFileAsDataUrl(imageFile);

    if (!productImagePreviewValid) {
      feedback.textContent = 'Please provide a valid product image preview. Upload a local image file or paste a direct image URL (e.g. ending with .jpg, .png, .webp) that loads successfully, not a Google share page or HTML link.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }

    const weightPricing = getWeightPricingData();
    if (!Array.isArray(weightPricing) || weightPricing.length === 0) {
      feedback.textContent = 'Please add at least one weight-based pricing variant.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }

    // Check for duplicate weight variants within this product
    const weightKeys = weightPricing.map(w => `${w.weight}${w.unit}`);
    if (new Set(weightKeys).size !== weightKeys.length) {
      feedback.textContent = 'Duplicate variants are not allowed. Each option can only be added once per product.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }

    // Ensure all variants use the same unit type
    const unitTypes = new Set(weightPricing.map(w => (w.unit === 'g' || w.unit === 'kg') ? 'weight' : 'litre'));
    if (unitTypes.size > 1) {
      feedback.textContent = 'Cannot mix weight (g/kg) and litre (ml/l) units in the same product.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }

    // Helper to convert to base unit for sorting
    function toBaseValue(weight, unit) {
      if (unit === 'kg' || unit === 'l') return weight * 1000;
      return weight; // g or ml
    }

    // Ensure prices increase with quantity
    const sorted = [...weightPricing].sort((a, b) => toBaseValue(a.weight, a.unit) - toBaseValue(b.weight, b.unit));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].price <= sorted[i - 1].price) {
        const prevLabel = variantLabel(sorted[i - 1]);
        const currLabel = variantLabel(sorted[i]);
        feedback.textContent = `Price for ${currLabel} (₹${sorted[i].price}) must be higher than price for ${prevLabel} (₹${sorted[i - 1].price}). Larger quantities must cost more.`;
        feedback.classList.remove('hidden');
        feedback.style.color = 'var(--color-danger)';
        return;
      }
    }

    // Ensure MRP is provided and > price for every variant (mandatory by law)
    for (const v of weightPricing) {
      if (v.mrp_price == null || isNaN(v.mrp_price)) {
        const label = variantLabel(v);
        feedback.textContent = `MRP (Maximum Retail Price) is mandatory for ${label}. Please enter a valid MRP as required by law.`;
        feedback.classList.remove('hidden');
        feedback.style.color = 'var(--color-danger)';
        return;
      }
      if (v.mrp_price <= v.price) {
        const label = variantLabel(v);
        feedback.textContent = `MRP (₹${v.mrp_price}) for ${label} must be greater than the selling price (₹${v.price}).`;
        feedback.classList.remove('hidden');
        feedback.style.color = 'var(--color-danger)';
        return;
      }
    }

    // Check for duplicate product name within the same category
    const nameDup = _adminProducts.find(p =>
      p.name.toLowerCase() === name.toLowerCase() &&
      p.category === category &&
      p.id !== editId
    );
    if (nameDup) {
      const catName = _adminCategories.find(c => c.id === category)?.name || category;
      feedback.textContent = `A product named "${name}" already exists in the "${catName}" category.`;
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_BASE}/products/${editId}` : `${API_BASE}/products`;
    const stock = weightPricing.reduce((sum, v) => sum + (v.stock || 0), 0);

    // Parse gallery URLs from gallery grid
    let image_urls = getGalleryUrls('admin-gallery-grid');

    const body = buildProductBody({ name, category, description, gstRate: gst_rate, image_url, productId, editId, weightPricing, stock, image_urls });

    const { res, data: respData } = await submitJson(url, method, body);
    if (res.ok) {
      showSuccessToast(editId ? '✅ Product updated successfully!' : '✅ Product published successfully!');
      resetAdminForm();
      // Update local cache instead of re-fetching all products
      if (editId) {
        const idx = _adminProducts.findIndex(p => p.id === editId);
        if (idx !== -1) _adminProducts[idx] = { ..._adminProducts[idx], ...body, id: editId };
      } else {
        // Check if product was already added (from next-id flow)
        if (!_adminProducts.some(p => p.id === productId)) {
          _adminProducts.push({ id: productId, ...body });
        }
      }
      renderAdminInventory();
      try {
        bcProducts?.postMessage({ type: 'products:updated' });
      } catch (e) {
        console.warn(e);
      }
    } else {
      feedback.textContent = respData.error || 'Failed to save product.';
      feedback.classList.remove('hidden');
    }
  } catch (err) {
    feedback.textContent = 'Server error.';
    feedback.classList.remove('hidden');
    console.error(err);
  }
}

async function fetchAdminOrders() {
  const list = document.getElementById('admin-orders-list');
  if (list) list.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading orders...</div>';
  try {
    const orders = await fetchWithAuth('/orders/all-orders');
    if (!Array.isArray(orders)) {
      throw new TypeError('Invalid orders response');
    }
    if (statOrders) statOrders.textContent = orders.length;
    adminOrdersCache = orders;

    // Update pending cancellation badge count
    const pendingCancels = orders.filter(o => o.status === 'CANCEL_REQUESTED' || o.delivery_status === 'CANCEL_REQUESTED');
    const badge = document.getElementById('admin-orders-cancel-badge');
    if (badge) {
      if (pendingCancels.length > 0) {
        badge.textContent = pendingCancels.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    updateSectionCounts(orders);
    renderCurrentSection();
    renderAdminHistory();
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

  const statusSteps = ['placed', 'processing', 'shipped', 'in_transit', 'delivered'];
  const statusLabels = {
    placed: 'Placed',
    processing: 'Processing',
    shipped: 'Shipped',
    in_transit: 'In Transit',
    delivered: 'Delivered',
  };

  // Prepend Pending Cancellations section if any exist
  const pendingCancels = orders.filter(o => o.status === 'CANCEL_REQUESTED' || o.delivery_status === 'CANCEL_REQUESTED');
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

      const currentStage = statusSteps.indexOf(o.delivery_status || 'placed');
      const progressSteps = statusSteps
        .map(
          (step, index) => `
      <div class="aoc-pstep ${index <= currentStage ? 'aoc-pstep--active' : ''}" title="${statusLabels[step]}"></div>
      ${index < statusSteps.length - 1 ? `<div class="aoc-pline ${index < currentStage ? 'aoc-pline--fill' : ''}"></div>` : ''}
    `,
        )
        .join('');

      const invoiceLink = o.invoice_token
        ? `${globalThis.location.origin}/api/orders/share/${o.invoice_token}`
        : '';

      const statusEmoji = {
        placed: '📋',
        processing: '⚙️',
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

      function getAdminBadge(status) {
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
        };
        return map[status] || null;
      }

      let badgeHtml;
      if (isCancelRequested) {
        badgeHtml = `<span class="aoc-badge aoc-badge--warning" style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;font-weight:700;">⚠️ Cancel Requested</span>`;
      } else if (isRefundState || isCancelState) {
        const b = getAdminBadge(o.status);
        badgeHtml = b ? `<span class="aoc-badge" style="background:${b.bg};color:${b.color};border:1px solid;font-weight:700;">${b.label}</span>` : '';
      } else {
        badgeHtml = `<span class="aoc-badge aoc-badge--${o.delivery_status === 'cancelled' ? 'cancelled' : o.delivery_status}">
             ${o.delivery_status === 'cancelled' ? '' : statusEmoji[o.delivery_status] || ''} ${o.delivery_status === 'cancelled' ? 'Cancelled' : o.delivery_status}
           </span>`;
      }

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
          : o.delivery_status === 'cancelled' || isRefundState || isCancelState
          ? `
                  <div class="aoc-cancelled-box">
                    <span class="aoc-cancelled-title">${o.status === 'CANCEL_REJECTED' ? 'Cancellation Rejected' : 'Cancelled by ' + (o.cancelled_by === 'admin' ? 'admin' : 'user')}</span>
                    ${o.cancel_reason ? `<span class="aoc-cancelled-why">${o.cancel_reason}</span>` : ''}
                    ${o.refund_status && o.refund_status !== 'none' ? `<span class="aoc-cancelled-why" style="margin-top:6px;color:#8b5cf6;"><strong>Refund:</strong> ${o.refund_status.replace(/_/g, ' ')}${o.total_refunded_amount ? ' — ₹' + Number(o.total_refunded_amount).toFixed(2) : ''}</span>` : ''}
                  </div>
                `
          : `
                  <div class="aoc-status-row">
                    <select class="aoc-ship-select" id="admin-ship-select-${o.id}" onchange="globalThis.onAdminStatusChange('${o.id}', this)">
                      <option value="placed" ${o.delivery_status === 'placed' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 0 ? 'disabled' : ''}>Placed</option>
                      <option value="processing" ${o.delivery_status === 'processing' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 1 ? 'disabled' : ''}>Processing</option>
                      <option value="shipped" ${o.delivery_status === 'shipped' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 2 ? 'disabled' : ''}>Shipped</option>
                      <option value="in_transit" ${o.delivery_status === 'in_transit' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 3 ? 'disabled' : ''}>In Transit</option>
                      <option value="delivered" ${o.delivery_status === 'delivered' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 4 ? 'disabled' : ''}>Delivered</option>
                    </select>
                    <div class="aoc-del-wrap" id="admin-delivery-wrap-${o.id}" style="${['shipped', 'in_transit'].includes(o.delivery_status) ? '' : 'display:none;'}">
                      <select id="admin-delivery-days-${o.id}" class="aoc-days-select" onchange="globalThis.adminUpdateShipping('${o.id}', document.getElementById('admin-ship-select-${o.id}').value)">
                        <option value="">Delivery in</option>
                        ${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d} day${d > 1 ? 's' : ''}" ${o.delivery_days_text === `${d} day${d > 1 ? 's' : ''}` ? 'selected' : ''}>${d} day${d > 1 ? 's' : ''}</option>`).join('')}
                      </select>
                    </div>
                  </div>
                  ${!["shipped", "in_transit", "delivered", "cancelled"].includes(o.delivery_status) && !isRefundState && !isCancelState ? `
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

function updateSectionCounts(orders) {
  const allOrders = orders || adminOrdersCache;
  const countMap = {
    new_orders: allOrders.filter(o => o.status === 'paid' && (o.admin_approval_status || 'pending') === 'pending' && !['CANCEL_REQUESTED','CANCEL_APPROVED','CANCEL_REJECTED','REFUND_PENDING','REFUND_INITIATED','REFUND_PROCESSING','REFUND_COMPLETED','REFUND_FAILED','MANUAL_REFUND_INITIATED','MANUAL_REFUND_COMPLETED'].includes(o.status)).length,
    placed: allOrders.filter(o => o.delivery_status === 'placed' && o.status === 'paid' && o.admin_approval_status === 'approved' && !['CANCEL_REQUESTED','CANCEL_APPROVED','CANCEL_REJECTED','REFUND_PENDING','REFUND_INITIATED','REFUND_PROCESSING','REFUND_COMPLETED','REFUND_FAILED','MANUAL_REFUND_INITIATED','MANUAL_REFUND_COMPLETED'].includes(o.status)).length,
    processing: allOrders.filter(o => o.delivery_status === 'processing' && !['cancelled'].includes(o.delivery_status) && !['CANCEL_REQUESTED','CANCEL_APPROVED','CANCEL_REJECTED','REFUND_PENDING','REFUND_INITIATED','REFUND_PROCESSING','REFUND_COMPLETED','REFUND_FAILED','MANUAL_REFUND_INITIATED','MANUAL_REFUND_COMPLETED'].includes(o.status)).length,
    shipping: allOrders.filter(o => ['shipped','in_transit'].includes(o.delivery_status)).length,
    delivered: allOrders.filter(o => o.delivery_status === 'delivered').length,
    cancel_requests: allOrders.filter(o => o.status === 'CANCEL_REQUESTED' || o.delivery_status === 'CANCEL_REQUESTED').length,
    cancelled: allOrders.filter(o => o.delivery_status === 'cancelled' && !['REFUND_PENDING','REFUND_INITIATED','REFUND_PROCESSING','REFUND_COMPLETED','REFUND_FAILED','MANUAL_REFUND_INITIATED','MANUAL_REFUND_COMPLETED'].includes(o.status)).length,
  };
  Object.entries(countMap).forEach(([key, count]) => {
    const el = document.getElementById(`sec-count-${key}`);
    if (el) {
      el.textContent = count;
      el.classList.toggle('zero', count === 0);
    }
  });
}

function switchSection(section) {
  currentSection = section;
  document.querySelectorAll('.admin-section-pill').forEach(p => p.classList.remove('active'));
  document.querySelector(`.admin-section-pill[data-section="${section}"]`)?.classList.add('active');
  renderCurrentSection();
}

function renderCurrentSection() {
  const orders = adminOrdersCache || [];
  updateSectionCounts(orders);

  const refundStatuses = ['REFUND_PENDING','REFUND_INITIATED','REFUND_PROCESSING','REFUND_COMPLETED','REFUND_FAILED','MANUAL_REFUND_INITIATED','MANUAL_REFUND_COMPLETED'];
  const shippingStatuses = ['shipped','in_transit'];

  const sectionFilters = {
    new_orders: o => o.status === 'paid' && (o.admin_approval_status || 'pending') === 'pending' && !refundStatuses.includes(o.status),
    placed: o => o.delivery_status === 'placed' && o.status === 'paid' && o.admin_approval_status === 'approved' && !refundStatuses.includes(o.status) && o.status !== 'CANCEL_REQUESTED',
    processing: o => o.delivery_status === 'processing' && !refundStatuses.includes(o.status),
    shipping: o => shippingStatuses.includes(o.delivery_status),
    delivered: o => o.delivery_status === 'delivered',
    cancel_requests: o => o.status === 'CANCEL_REQUESTED' || o.delivery_status === 'CANCEL_REQUESTED',
    cancelled: o => o.delivery_status === 'cancelled' && !refundStatuses.includes(o.status),
  };

  const filterFn = sectionFilters[section];
  if (!filterFn) {
    // Fallback for refund sections — use existing refund filter
    renderAdminOrders(orders);
    return;
  }

  const filtered = orders.filter(filterFn);

  if (section === 'new_orders') {
    renderNewOrdersSection(filtered);
  } else if (section === 'cancel_requests') {
    renderCancelRequestsSection(filtered);
  } else {
    renderAdminOrders(filtered);
  }
}

function renderNewOrdersSection(orders) {
  const wrap = document.getElementById('admin-orders-list');
  if (!wrap) return;

  if (!orders.length) {
    wrap.innerHTML = '<div class="admin-loading">No new orders pending approval.</div>';
    return;
  }

  const headerHtml = `
    <div class="admin-section-actions-bar">
      <span class="section-title"><i class="fa-solid fa-sparkles"></i> Pending Approval</span>
      <span class="section-count-badge">${orders.length}</span>
      <span style="font-size:0.78rem;color:#6b7280;margin-left:4px;">Orders awaiting admin review</span>
    </div>
  `;

  const cardsHtml = orders.map(o => {
    const date = new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const customerName = o.customer_name || o.user_email || 'Customer';
    const phone = o.delivery_phone || 'Not specified';
    const address = o.delivery_address || 'Address not provided';
    const orderItems = Array.isArray(o.items) ? o.items : [];
    const itemCount = orderItems.length;
    const items = orderItems.map(it => `${it.name} × ${it.quantity}`).join(', ');

    return `
      <div class="pending-approval-card">
        <div class="pa-info">
          <span class="pa-order-id">#${o.id}</span>
          <span class="pa-meta">${customerName} · ${phone} · ${date}</span>
          <span class="pa-meta" style="font-size:0.75rem;">₹${Number(o.total || 0).toFixed(2)} · ${o.payment_method || 'Razorpay'} · ${itemCount} item${itemCount > 1 ? 's' : ''}</span>
          ${items ? `<span class="pa-meta" style="font-size:0.72rem;color:#9ca3af;">${items}</span>` : ''}
          ${address ? `<span class="pa-meta" style="font-size:0.72rem;color:#9ca3af;">${address}</span>` : ''}
        </div>
        <div class="pa-actions">
          <button class="btn btn-primary" style="background:#1a9650;border:none;padding:8px 16px;font-size:0.8rem;" onclick="globalThis.adminOrderApproveModal('${o.id}')">
            <i class="fa-solid fa-check"></i> Approve
          </button>
          <button class="btn btn-cancel" style="padding:8px 16px;font-size:0.8rem;" onclick="globalThis.adminOrderRejectModal('${o.id}')">
            <i class="fa-solid fa-xmark"></i> Reject
          </button>
          <button class="btn btn-secondary" style="padding:8px 16px;font-size:0.8rem;" onclick="globalThis.adminViewRefundDetails('${o.id}')">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </div>
      </div>
    `;
  }).join('');

  wrap.innerHTML = headerHtml + cardsHtml;
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
      await fetchWithAuth(`/orders/admin/approve/${orderId}`, {
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
      await fetchWithAuth(`/orders/admin/reject/${orderId}`, {
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

// Override renderAdminOrders wrapper to attach audit logs after rendering
const origRenderAdminOrders = window.renderAdminOrders || renderAdminOrders;
/*
function copyInvoiceLink(token) {
  if (!token) return;
  const invoiceUrl = `${globalThis.location.origin}/api/orders/share/${token}`;
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
} */

function onAdminStatusChange(orderId, selectEl) {
  const status = selectEl.value;
  const wrap = document.getElementById(`admin-delivery-wrap-${orderId}`);

  if (status === 'shipped' || status === 'in_transit') {
    if (wrap) {
      wrap.style.display = '';
      const daysSelect = document.getElementById(`admin-delivery-days-${orderId}`);
      if (daysSelect && !daysSelect.value) {
        return;
      }
    }
  } else {
    if (wrap) wrap.style.display = 'none';
  }

  adminUpdateShipping(orderId, status);
}
globalThis.onAdminStatusChange = onAdminStatusChange;

async function adminUpdateShipping(orderId, status) {
  try {
    let delivery_days_text = '';
    if (status === 'shipped' || status === 'in_transit') {
      const input = document.getElementById(`admin-delivery-days-${orderId}`);
      if (input) delivery_days_text = input.value.trim();
    }

    if (status === 'shipped' && !delivery_days_text) {
      showErrorToast('Please select delivery days before marking as shipped.');
      return;
    }

    const body = { delivery_status: status };
    if (delivery_days_text) body.delivery_days_text = delivery_days_text;

    const res = await fetch(`${API_BASE}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed');
    showSuccessToast(`📦 Shipment status updated to "${status}"`);
    if (status === 'delivered') {
      window.location.href = '/';
    } else {
      fetchAdminOrders();
    }
  } catch (err) {
    console.error(err);
    showErrorToast('Failed to update shipping status.');
  }
}

function adminToggleCancelReason(orderId, value) {
  const otherInput = document.getElementById(`admin-cancel-other-${orderId}`);
  if (!otherInput) return;
  otherInput.style.display = value === 'Other' ? 'block' : 'none';
  if (value !== 'Other') {
    otherInput.value = '';
  }
}

function renderAdminFilterValueControl(filterType) {
  const container = document.getElementById('admin-filter-value');
  if (!container) return;

  let html = '';
  switch (filterType) {
    case 'modified_date': {
      const today = new Date().toISOString().split('T')[0];
      html = `<input type="date" id="admin-filter-value-input" class="admin-filter-input" max="${today}">`;
      break;
    }
    case 'year':
      html = `
        <select id="admin-filter-value-input" class="admin-filter-input">
          <option value="">All years</option>
          <option value="2026">2026</option>
          <option value="2025">2025</option>
          <option value="2024">2024</option>
          <option value="2023">2023</option>
        </select>
      `;
      break;
    case 'month':
      html = `
        <select id="admin-filter-value-input" class="admin-filter-input">
          <option value="">All months</option>
          <option value="01">Jan</option>
          <option value="02">Feb</option>
          <option value="03">Mar</option>
          <option value="04">Apr</option>
          <option value="05">May</option>
          <option value="06">Jun</option>
          <option value="07">Jul</option>
          <option value="08">Aug</option>
          <option value="09">Sep</option>
          <option value="10">Oct</option>
          <option value="11">Nov</option>
          <option value="12">Dec</option>
        </select>
      `;
      break;
    case 'order_id':
      html = '<input type="text" id="admin-filter-value-input" class="admin-filter-input" placeholder="Enter order id">';
      break;
    case 'phone':
      html = '<input type="text" id="admin-filter-value-input" class="admin-filter-input" placeholder="Enter phone number">';
      break;
    case 'status':
      html = `
        <select id="admin-filter-value-input" class="admin-filter-input">
          <option value="">All statuses</option>
          <option value="placed">Placed</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
      `;
      break;
    case 'payment_method':
      html = `
        <select id="admin-filter-value-input" class="admin-filter-input">
          <option value="">All payment modes</option>
          <option value="Razorpay">Razorpay</option>
          <option value="Pending">Pending</option>
        </select>
      `;
      break;
    default:
      html = '<span class="admin-filter-hint">Select a filter above to apply</span>';
  }

  container.innerHTML = html;
  const input = document.getElementById('admin-filter-value-input');
  if (input) {
    input.addEventListener(
      input.tagName === 'SELECT' ? 'change' : 'input',
      applyAdminOrderFilters,
    );
  }
}

function getAdminFilterValue() {
  const filterType = document.getElementById('admin-filter-type')?.value || '';
  const valueInput = document.getElementById('admin-filter-value-input');
  const value = valueInput ? valueInput.value.trim() : '';
  return { filterType, value };
}

function applyAdminOrderFilters() {
  const { filterType, value } = getAdminFilterValue();
  if (!filterType) {
    renderAdminOrders(adminOrdersCache);
    return;
  }

  const filtered = adminOrdersCache.filter((order) => {
    const changedAt = new Date(order.updated_at || order.created_at);
    const normalizedValue = value.toLowerCase();

    switch (filterType) {
      case 'modified_date':
        return value
          ? changedAt.toDateString() === new Date(value).toDateString()
          : true;
      case 'year':
        return value ? String(changedAt.getFullYear()) === value : true;
      case 'month':
        return value
          ? String(changedAt.getMonth() + 1).padStart(2, '0') === value
          : true;
      case 'order_id':
        return value ? order.id.toLowerCase().includes(normalizedValue) : true;
      case 'phone':
        return value
          ? (order.delivery_phone || '')
            .replace(/\D/g, '')
            .includes(value.replace(/\D/g, ''))
          : true;
      case 'status':
        return value ? order.delivery_status === value : true;
      case 'payment_method':
        const method = (
          order.payment_method
          || (order.razorpay_order_id ? 'Razorpay' : 'Pending')
          || ''
        ).toLowerCase();
        return value ? method === normalizedValue : true;
      default:
        return true;
    }
  });

  renderAdminOrders(filtered);
}

function clearAdminOrderFilters() {
  const filterType = document.getElementById('admin-filter-type');
  if (filterType) filterType.value = '';
  const valueContainer = document.getElementById('admin-filter-value');
  if (valueContainer) {
    valueContainer.innerHTML = '<span class="admin-filter-hint">Select a filter above to apply</span>';
  }
  renderAdminOrders(adminOrdersCache);
}

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
  /*
    const deliveredOrders = adminOrdersCache.filter(
      (order) => String(order.delivery_status || '').toLowerCase() === 'delivered',
    );
    */

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

async function adminCancelOrder(orderId) {
  const reasonSelect = document.getElementById(
    `admin-cancel-reason-${orderId}`,
  );
  if (!reasonSelect) return;

  let reason = reasonSelect.value;
  if (!reason) {
    showErrorToast('Please select a cancellation reason.');
    return;
  }

  if (reason === 'Other') {
    const otherText = document.getElementById(`admin-cancel-other-${orderId}`);
    if (!otherText?.value?.trim()) {
      showErrorToast('Please specify a cancellation reason.');
      return;
    }
    reason = otherText.value.trim();
  }

  if (!confirm('Cancel this order? This will stop further processing.')) return;

  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/cancel`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || 'Cancellation failed');
    }

    showSuccessToast('❌ Order cancelled successfully.');
    fetchAdminOrders();
  } catch (err) {
    console.error(err);
    showErrorToast(getApiErrorMessage(err) || 'Failed to cancel order.');
  }
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
  if (list) list.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading categories...</div>';
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
  if (list) list.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading trainings...</div>';
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
  if (list) list.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading blogs...</div>';
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
  const select = document.getElementById('admin-prod-category');
  if (!select) return;
  select.innerHTML = categories
    .map(
      (cat) => `
    <option value="${cat.id}" data-category-uid="${cat.category_id || cat.categoryId || ''}">${cat.name}</option>
  `,
    )
    .join('');
  updateProductIdDisplay();

  const filterCat = document.getElementById('admin-filter-cat');
  if (filterCat) {
    filterCat.innerHTML = `<option value="all">All Categories</option>` + categories
      .map((cat) => `<option value="${cat.id}">${cat.name}</option>`)
      .join('');
  }
}

function adminEditCategory(catId) {
  activateAdminTab('categories');
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
      fetchCategories();
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
    window.location.href = '/';
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Unable to delete category.');
  }
}

function resetAdminForm() {
  productForm?.reset();
  document.getElementById('admin-edit-id').value = '';
  if (productIdDisplay) productIdDisplay.value = '';
  if (productImageUrl) productImageUrl.value = '';
  if (productImageFile) productImageFile.value = '';
  productImagePreviewValid = false;
  const stockField = document.getElementById('admin-prod-stock');
  if (stockField) stockField.value = 100;
  const label = document.getElementById('admin-submit-label');
  if (label) label.textContent = 'Publish Product';
  const preview = document.getElementById('admin-img-preview');
  if (preview) preview.innerHTML = '<i class="fa-solid fa-image"></i><span>Image preview</span><small>Upload an image or paste a URL</small>';
  const feedback = document.getElementById('admin-add-feedback');
  if (feedback) feedback.classList.add('hidden');
  updateProductIdDisplay();
  // Reset weight pricing to single empty row
  setWeightPricingData(null);
  updateMainTotalStock();
  resetGallery('admin-gallery-grid', 'gallery-preview', 'gallery-count-badge');
}

function updateImagePreview() {
  const preview = document.getElementById('admin-img-preview');
  if (!preview) return;
  const file = productImageFile?.files?.[0];
  let url = productImageUrl?.value.trim();

  // If a local file is selected, preview it (file takes precedence)
  if (file) {
    const reader = new FileReader();
    preview.dataset.previewValid = 'false';
    reader.onload = () => {
      preview.innerHTML = `<img src="${String(reader.result)}" alt="Preview">`;
      preview.dataset.previewValid = 'true';
      productImagePreviewValid = true;
    };
    reader.onerror = () => {
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Unable to read image file</span>';
      preview.dataset.previewValid = 'false';
      productImagePreviewValid = false;
    };
    reader.readAsDataURL(file);
    return;
  }

  // Handle URL (including data: and protocol-less URLs)
  if (url) {
    if (url.startsWith('//')) url = `https:${url}`;
    else if (
      !/^https?:\/\//i.test(url)
      && !/^data:/i.test(url)
      && !/^blob:/i.test(url)
      && url.includes('.')
    ) url = `https://${url}`;

    preview.innerHTML = '<span style="color:var(--color-primary)">Loading preview...</span>';
    preview.dataset.previewValid = 'false';
    productImagePreviewValid = false;

    const img = new Image();
    let handled = false;
    img.onload = () => {
      if (handled) return;
      handled = true;
      preview.innerHTML = `<img src="${url}" alt="Preview">`;
      preview.dataset.previewValid = 'true';
      productImagePreviewValid = true;
    };
    img.onerror = () => {
      if (handled) return;
      handled = true;
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Failed to load image from URL. Use a direct image URL (jpg, png, webp, or data URL) or upload a local image file.</span>';
      preview.dataset.previewValid = 'false';
      productImagePreviewValid = false;
    };

    try {
      img.src = url;
    } catch (e) {
      preview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Invalid image URL</span>';
      preview.dataset.previewValid = 'false';
      productImagePreviewValid = false;
    }
    return;
  }

  preview.innerHTML = '<i class="fa-solid fa-image"></i><span>Image preview</span>';
  preview.dataset.previewValid = 'false';
  productImagePreviewValid = false;
}

// Using shared toast helpers from ./utils/notify.js

function copyInvoiceLink(token) {
  if (!token) return;
  const invoiceUrl = `${globalThis.location.origin}/api/orders/share/${token}`;
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

  if (tableContainer) tableContainer.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading refund queue...</div>';
  if (auditsContainer) auditsContainer.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading audit trail...</div>';

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
      <div class="input-field" style="margin-bottom:14px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Refund Type</label>
        <select id="admin-approve-refund-type" style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;">
          <option value="auto">Auto Refund (Razorpay) — 3-7 business days</option>
          <option value="manual">Manual Refund (Offline) — Bank / UPI / Cash</option>
        </select>
      </div>
      <div class="input-field" style="margin-bottom:20px;">
        <label style="color:#94a3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;margin-bottom:6px;display:block;">Admin Note (Optional)</label>
        <textarea id="admin-approve-refund-note" rows="2" placeholder="Approval notes (sent to user)..." style="width:100%;padding:10px;border-radius:8px;background:#152e25;border:1px solid rgba(56,177,123,0.3);color:#e2e8f0;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="document.getElementById('admin-approve-refund-modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="admin-approve-refund-confirm" style="background:#38b17b;border:none;">Approve & Refund</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#admin-approve-refund-confirm').addEventListener('click', async () => {
    const adminNote = modal.querySelector('#admin-approve-refund-note').value.trim();
    const refundType = modal.querySelector('#admin-approve-refund-type').value;
    modal.remove();

    try {
      await fetchWithAuth(`/refunds/cancel-requests/${orderId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ adminNote, refundType }),
      });
      showSuccessToast(`✅ Cancellation approved. ${refundType === 'manual' ? 'Manual refund initiated.' : 'Auto refund initiated.'}`);
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
    const [dashData, auditData] = await Promise.all([
      fetchWithAuth(`/refunds/dashboard?search=${encodeURIComponent(orderId)}`),
      fetchWithAuth(`/refunds/audit-logs?orderId=${encodeURIComponent(orderId)}`),
    ]);

    const refund = (dashData.refunds || []).find(r => r.order_id === orderId) || dashData.refunds?.[0];
    if (!refund) throw new Error('Refund record not found.');

    // Fetch the full order for items breakdown
    let orderData = null;
    try {
      const orderRes = await fetchWithAuth(`/orders/${orderId}`, { method: 'GET' });
      orderData = orderRes;
    } catch (e) { /* order fetch is optional */ }

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
        ['Reason', refund.cancel_reason || refund.reason || '-'],
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
        <h3 style="margin:0;font-size:1.15rem;color:#f87171;"><i class="fa-solid fa-ban"></i> Cancel & Refund</h3>
        <button onclick="document.getElementById('admin-direct-cancel-modal').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;">&times;</button>
      </div>
      <p style="margin:0 0 12px;font-size:0.85rem;color:#94a3b8;line-height:1.5;">
        Order #<strong style="color:#f87171;">${orderId}</strong> will be cancelled with auto refund via Razorpay.
      </p>

      <div style="display:flex;gap:10px;margin-bottom:18px;padding:12px 14px;background:rgba(15,23,42,0.6);border-radius:12px;border:1px solid rgba(56,177,123,0.12);">
        <div style="flex:1;text-align:center;">
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(239,68,68,0.15);color:#f87171;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;font-size:0.85rem;"><i class="fa-solid fa-ban"></i></div>
          <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#f87171;">Cancel</div>
          <div style="font-size:0.62rem;color:#64748b;margin-top:2px;">Order stopped</div>
        </div>
        <div style="display:flex;align-items:center;color:#475569;"><i class="fa-solid fa-chevron-right" style="font-size:0.7rem;"></i></div>
        <div style="flex:1;text-align:center;">
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(56,177,123,0.15);color:#38b17b;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;font-size:0.85rem;"><i class="fa-solid fa-rotate"></i></div>
          <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#38b17b;">Auto Refund</div>
          <div style="font-size:0.62rem;color:#64748b;margin-top:2px;">Razorpay → Customer</div>
        </div>
        <div style="display:flex;align-items:center;color:#475569;"><i class="fa-solid fa-chevron-right" style="font-size:0.7rem;"></i></div>
        <div style="flex:1;text-align:center;">
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(245,158,11,0.15);color:#fbbf24;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;font-size:0.85rem;"><i class="fa-solid fa-hand-holding-dollar"></i></div>
          <div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#fbbf24;">Manual (If Fails)</div>
          <div style="font-size:0.62rem;color:#64748b;margin-top:2px;">Bank / UPI / Cash</div>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;color:#94a3b8;margin-bottom:8px;">Refund Process:</div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:#cbd5e1;"><span style="width:18px;height:18px;border-radius:50%;background:rgba(56,177,123,0.2);color:#38b17b;display:flex;align-items:center;justify-content:center;font-size:0.55rem;flex-shrink:0;"><i class="fa-solid fa-check"></i></span> Razorpay auto-refund initiated immediately</div>
          <div style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:#cbd5e1;"><span style="width:18px;height:18px;border-radius:50%;background:rgba(56,177,123,0.2);color:#38b17b;display:flex;align-items:center;justify-content:center;font-size:0.55rem;flex-shrink:0;"><i class="fa-solid fa-check"></i></span> Order items auto-restocked</div>
          <div style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:#94a3b8;"><span style="width:18px;height:18px;border-radius:50%;background:rgba(245,158,11,0.15);color:#fbbf24;display:flex;align-items:center;justify-content:center;font-size:0.55rem;flex-shrink:0;"><i class="fa-solid fa-triangle-exclamation"></i></span> If auto refund fails → <strong style="color:#fbbf24;">Manual Refund</strong> button appears in order card</div>
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
        <button class="btn btn-primary" id="admin-direct-cancel-confirm" style="background:#ef4444;border:none;">Confirm Cancel & Refund</button>
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
      showSuccessToast('✅ Order cancelled by admin. Refund initiated.');
      fetchAdminOrders();
      loadRefundsDashboard();
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Admin cancellation failed.');
    }
  });
}
globalThis.adminDirectCancelModal = adminDirectCancelModal;
globalThis.adminDirectCancel = adminDirectCancelModal;

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
  // Load refund dashboard data when tab is activated
  if (tabName === 'refunds') {
    loadRefundsDashboard();
  }
}

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
      const btn = document.getElementById('admin-auth-btn');
      const sentEl = document.getElementById('admin-auth-otp-sent');

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
          saveAuth(data.token, data.user);
          showDashboard();
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
        if (btn) btn.textContent = 'Verify & Login';

        if (result?.otp && sentEl) {
          sentEl.textContent = `Demo OTP: ${result.otp}`;
          document.getElementById('admin-auth-otp').value = result.otp;
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
    if (btn) btn.textContent = 'Send OTP';
    clearAuthError();
  });

  // Logout
  if (btnLogout) btnLogout.addEventListener('click', () => { clearAuth(); showLoginPanel(); });
  if (btnViewShop) btnViewShop.addEventListener('click', () => (globalThis.location.href = '/'));

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

  // Product form
  if (productForm) productForm.addEventListener('submit', handleAdminAddProduct);
  if (resetFormBtn) resetFormBtn.addEventListener('click', resetAdminForm);
  if (btnAddWeightRow) {
    btnAddWeightRow.addEventListener('click', () => {
      weightPricingContainer.appendChild(createWeightRow(null));
      toggleStockField();
      updateMainTotalStock();
    });
  }

  // Pricing type toggle
  document.querySelectorAll('.pricing-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pricing-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-mode') || 'weight';
      const ctr = btn.closest('.premium-weight-section, .input-field')
        ?.querySelector('#admin-capsule-weight-container, #admin-weight-pricing-container');
      if (!ctr) return;
      ctr.dataset.mode = mode;
      if (ctr.id === 'admin-weight-pricing-container') {
        const existingData = getWeightPricingData();
        ctr.innerHTML = '';
        if (existingData.length > 0) {
          existingData.forEach(item => ctr.appendChild(createWeightRow(item)));
        } else {
          ctr.appendChild(createWeightRow(null));
        }
        toggleStockField();
      }
      if (ctr.id === 'admin-capsule-weight-container') {
        // CSS handles pill visibility via data-mode
      }
    });
  });

  // Toggle stock field when weight select changes in any variant row
  if (weightPricingContainer) {
    weightPricingContainer.addEventListener('change', (e) => {
      if (e.target.classList.contains('admin-weight-select')) {
        toggleStockField();
      }
    });
  }

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
  if (productImageBrowse) productImageBrowse.addEventListener('click', () => productImageFile?.click());
  if (categoryImageBrowse) categoryImageBrowse.addEventListener('click', () => categoryImageFile?.click());
  if (productImageFile) productImageFile.addEventListener('change', updateImagePreview);
  if (productImageUrl) {
    productImageUrl.addEventListener('input', () => {
      if (productImageFile?.files?.length) productImageFile.value = '';
      updateImagePreview();
    });
  }
  // Premium image zone — click to upload, drag-and-drop
  const adminImageZone = document.getElementById('admin-image-zone');
  if (adminImageZone && productImageFile) {
    adminImageZone.addEventListener('click', (e) => {
      if (e.target.closest('#admin-prod-image-browse')) return;
      if (e.target.closest('#admin-prod-image-url')) return;
      productImageFile.click();
    });
    adminImageZone.addEventListener('dragover', (e) => { e.preventDefault(); adminImageZone.classList.add('dragover'); });
    adminImageZone.addEventListener('dragleave', () => { adminImageZone.classList.remove('dragover'); });
    adminImageZone.addEventListener('drop', (e) => {
      e.preventDefault();
      adminImageZone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length) { productImageFile.files = files; productImageFile.dispatchEvent(new Event('change')); }
    });
  }
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

  // Current orders filter bar
  const adminFilterType = document.getElementById('admin-filter-type');
  const adminFilterClear = document.getElementById('admin-filter-clear');
  if (adminFilterType) adminFilterType.addEventListener('change', () => renderAdminFilterValueControl(adminFilterType.value));
  if (adminFilterClear) adminFilterClear.addEventListener('click', clearAdminOrderFilters);

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
        renderAdminOrders(adminOrdersCache || []);
      } else {
        currentSection = status;
        renderCurrentSection();
      }
    });
  });

  // Status constants (shared)
  const ACTIVE_STATUSES = ['placed', 'processing', 'shipped', 'in_transit'];
  const REFUND_STATUSES_ALL = ['REFUND_PENDING', 'REFUND_INITIATED', 'REFUND_PROCESSING', 'REFUND_COMPLETED', 'REFUND_FAILED', 'MANUAL_REFUND_INITIATED', 'MANUAL_REFUND_COMPLETED'];
  const REFUND_STATUSES_AUTO = ['REFUND_PENDING', 'REFUND_INITIATED', 'REFUND_PROCESSING', 'REFUND_COMPLETED', 'REFUND_FAILED'];
  const REFUND_STATUSES_MANUAL = ['MANUAL_REFUND_INITIATED', 'MANUAL_REFUND_COMPLETED'];

  function getActiveOrders() {
    return adminOrdersCache.filter((o) => ACTIVE_STATUSES.includes(o.delivery_status));
  }
  function getRefundOrders(type) {
    const map = { all: REFUND_STATUSES_ALL, auto: REFUND_STATUSES_AUTO, manual: REFUND_STATUSES_MANUAL };
    return adminOrdersCache.filter((o) => (map[type] || REFUND_STATUSES_ALL).includes(o.status));
  }
  globalThis.getActiveOrders = getActiveOrders;
  globalThis.getRefundOrders = getRefundOrders;

  // 12-Section pills
  document.querySelectorAll('.admin-section-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const section = pill.dataset.section;
      if (section) switchSection(section);
    });
  });

  // Refund filter (shown in refund sections only)
  const refundSelect = document.getElementById('ship-refund-filter-select');
  if (refundSelect) {
    refundSelect.addEventListener('change', () => {
      if (currentSection.startsWith('refund_')) {
        renderAdminOrders(getRefundOrders(refundSelect.value));
      }
    });
  }

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
  globalThis.adminUpdateShipping = adminUpdateShipping;
  globalThis.adminToggleCancelReason = adminToggleCancelReason;
  globalThis.adminCancelOrder = adminCancelOrder;
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

    const invoiceUrl = `${globalThis.location.origin}/api/orders/share/${order.invoice_token}`;

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

  // Initialize gallery grids (main form)
  initGallery('admin-gallery-grid', 'gallery-preview', 'gallery-count-badge', 'btn-gallery-add-main', 'main');

  // Gallery upload buttons (main form)
  const uploadMainBtn = document.getElementById('btn-gallery-upload-main');
  const galleryFileMain = document.getElementById('gallery-file-main');
  if (uploadMainBtn && galleryFileMain) {
    uploadMainBtn.addEventListener('click', () => galleryFileMain.click());
    galleryFileMain.addEventListener('change', () => {
      handleGalleryFiles('gallery-file-main', 'admin-gallery-grid', 'gallery-preview', 'main');
    });
  }

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
  const defaultMode = (() => {
    const ab = document.querySelector('.pricing-type-btn.active');
    return ab ? ab.getAttribute('data-mode') || 'weight' : 'weight';
  })();
  [weightPricingContainer, capsuleWeightContainer].forEach(ctr => {
    if (ctr && !ctr.dataset.mode) ctr.dataset.mode = defaultMode;
  });

  // Initialize weight pricing with one empty row (mode must be set first)
  if (weightPricingContainer && !weightPricingContainer.querySelector('.admin-weight-pricing-row')) {
    setWeightPricingData(null);
  }

  // Transform static weight selects into pill widgets
  wpwTransformStatic();
}

async function initAdminPage() {
  setupAdminEventHandlers();
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

initAdminPage();
