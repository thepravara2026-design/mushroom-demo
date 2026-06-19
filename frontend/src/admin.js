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
  } catch (e) {
    console.warn(e);
  }
}

globalThis.addEventListener('auth:changed', () => initAdminSse());

function showLoginPanel() {
  loginPanel.classList.remove('hidden');
  dashboard.classList.add('hidden');
}

function showDashboard() {
  loginPanel.classList.add('hidden');
  dashboard.classList.remove('hidden');

  if (state.user) {
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

function getAdminInventorySortValue() {
  return document.getElementById('admin-inventory-sort')?.value || 'name_asc';
}

function applyAdminInventorySort(products) {
  const sortValue = getAdminInventorySortValue();
  const [sortKey, sortDirection] = sortValue.split('_');
  const sortMultiplier = sortDirection === 'desc' ? -1 : 1;

  return [...products].sort((a, b) => {
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

function updateProductIdDisplay() {
  const editId = document.getElementById('admin-edit-id')?.value;
  if (editId) return;
  const productCategory = document.getElementById('admin-prod-category');
  if (!productIdDisplay || !productCategory) return;
  const selectedOption = productCategory.selectedOptions?.[0];
  const categoryUid = selectedOption?.dataset?.categoryUid || '';
  productIdDisplay.value = generateProductId(categoryUid);
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
// Weight pricing row management
// -----------------------------
function createWeightRow(value) {
  const row = document.createElement('div');
  row.className = 'admin-weight-pricing-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
  row.innerHTML = `
    <select class="admin-weight-select" style="flex:1;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;">
      <option value="">Select weight</option>
      <option value="100g">100 g</option>
      <option value="200g">200 g</option>
      <option value="250g">250 g</option>
      <option value="400g">400 g</option>
      <option value="500g">500 g</option>
      <option value="1kg">1 kg</option>
      <option value="2kg">2 kg</option>
      <option value="5kg">5 kg</option>
    </select>
    <input type="number" step="0.01" class="admin-weight-price" placeholder="Price (₹)" style="flex:1;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;" />
    <input type="number" step="0.01" class="admin-weight-mrp" placeholder="MRP (₹)" style="flex:1;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;" />
    <button type="button" class="btn-weight-remove" style="background:none;border:none;color:#e74c3c;cursor:pointer;padding:4px;"><i class="fa-solid fa-trash-can"></i></button>
  `;
  if (value) {
    const sel = row.querySelector('.admin-weight-select');
    const key = value.unit === 'kg' ? `${value.weight}kg` : `${value.weight}g`;
    if ([...sel.options].some(o => o.value === key)) sel.value = key;
    row.querySelector('.admin-weight-price').value = value.price;
    row.querySelector('.admin-weight-mrp').value = value.mrp_price || '';
  }
  row.querySelector('.btn-weight-remove').addEventListener('click', () => row.remove());
  return row;
}

function getWeightPricingData() {
  const rows = weightPricingContainer.querySelectorAll('.admin-weight-pricing-row');
  const data = [];
  rows.forEach(row => {
    const sel = row.querySelector('.admin-weight-select');
    const price = row.querySelector('.admin-weight-price').value;
    const mrp = row.querySelector('.admin-weight-mrp').value;
    if (sel.value && price) {
      const match = sel.value.match(/^(\d+)(g|kg)$/);
      if (match) {
        data.push({
          weight: parseInt(match[1], 10),
          unit: match[2],
          price: parseFloat(price),
          ...(mrp ? { mrp_price: parseFloat(mrp) } : {}),
        });
      }
    }
  });
  return data;
}

function setWeightPricingData(data) {
  weightPricingContainer.innerHTML = '';
  if (Array.isArray(data)) {
    data.forEach(item => weightPricingContainer.appendChild(createWeightRow(item)));
  }
  if (!weightPricingContainer.querySelector('.admin-weight-pricing-row')) {
    weightPricingContainer.appendChild(createWeightRow(null));
  }
}

// -----------------------------
// Helper: product/category helpers
// -----------------------------
function buildProductBody({ name, category, description, gstRate, image_url, productId, editId, weightPricing }) {
  const body = {
    name,
    category,
    description,
    gst_rate: Number.parseInt(String(gstRate || 0), 10),
    image_url,
    weight_pricing: weightPricing,
  };
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

function renderAdminInventory() {
  const grid = document.getElementById('admin-inventory-grid');
  if (!grid) return;

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
  const totalPages = Math.max(1, Math.ceil(products.length / adminInventoryPageSize));
  if (_adminInventoryPage > totalPages) _adminInventoryPage = totalPages;
  const pageStart = (_adminInventoryPage - 1) * adminInventoryPageSize;
  const pageProducts = products.slice(pageStart, pageStart + adminInventoryPageSize);
  const pageEnd = Math.min(pageStart + pageProducts.length, products.length);

  grid.innerHTML = `
    <div class="admin-product-grid">
      ${pageProducts
      .map((p) => {
        // stock display removed (inventory managed separately)
        const categoryObj = _adminCategories.find((c) => c.id === p.category);
        const categoryName = categoryObj ? categoryObj.name : 'Unknown';
        const categoryId = categoryObj
          ? categoryObj.category_id || categoryObj.categoryId || ''
          : '';
        return `
          <div class="admin-product-card" data-id="${p.id}">
            <div class="admin-card-meta">
              <img src="${p.image_url}" alt="${p.name}">
              <div class="admin-card-title">
                <div class="admin-card-title-head">
                  <h4>${p.name}</h4>
                  <span class="admin-prod-id">ID: ${p.id}</span>
                </div>
                <p>${p.description}</p>
              </div>
            </div>
            <div class="admin-card-body">
              <div class="admin-card-details">
                <div class="admin-price-cell">
                  ${(() => {
                    const hasWp = Array.isArray(p.weight_pricing) && p.weight_pricing.length > 0;
                    if (hasWp) {
                      const first = p.weight_pricing[0];
                      return `<span class="price-act">₹${first.price.toFixed(2)}</span>${first.mrp_price ? `<span class="price-mrp">₹${first.mrp_price.toFixed(2)}</span>` : ''}<span style="font-size:0.7rem;color:#6b7280;display:block;">${p.weight_pricing.length} weight variant(s)</span>`;
                    }
                    return `<span class="price-act">₹${(p.price || 0).toFixed(2)}</span>${p.mrp_price ? `<span class="price-mrp">₹${p.mrp_price.toFixed(2)}</span>` : ''}`;
                  })()}
                </div>
                <div class="admin-badge-row">
                  <span class="admin-gst-badge">GST ${p.gst_rate}%</span>
                </div>
              </div>
              <span class="admin-category-chip">${categoryName}${categoryId ? ` (${categoryId})` : ''}</span>
            </div>
            <div class="admin-card-footer">
              <div class="admin-card-stats">
                <span class="admin-card-tag">${categoryName}</span>
              </div>
              <div class="admin-row-actions">
                  <button class="btn-admin-edit" onclick="globalThis.adminEditProduct('${p.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
                <button class="btn-admin-delete" onclick="globalThis.adminDeleteProduct('${p.id}')"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
          </div>
        `;
      })
      .join('')}
    </div>
    <div class="admin-pagination">
      <div class="admin-pagination-info">Showing ${pageStart + 1}–${pageEnd} of ${products.length} products</div>
      <div class="admin-pagination-actions">
        <button type="button" class="btn btn-secondary" id="admin-page-prev" ${_adminInventoryPage === 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <span class="admin-pagination-label">Page ${_adminInventoryPage} of ${totalPages}</span>
        <button type="button" class="btn btn-secondary" id="admin-page-next" ${_adminInventoryPage === totalPages ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>`;

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
  if (productImageUrl) productImageUrl.value = product.image_url || '';
  if (productImageFile) productImageFile.value = '';

  const preview = document.getElementById('admin-img-preview');
  if (preview) {
    preview.innerHTML = `<img src="${product.image_url}" alt="Preview">`;
    productImagePreviewValid = true;
  }

  // Load weight pricing if available
  setWeightPricingData(product.weight_pricing || null);

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
      productId = generateProductId(selectedCategoryUid);
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
      feedback.textContent = 'Duplicate weight variants are not allowed. Each weight (e.g. 500g, 1kg) can only be added once per product.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }

    // Ensure prices increase with weight (larger weight → higher price)
    const sorted = [...weightPricing].sort((a, b) => {
      const aGrams = a.unit === 'kg' ? a.weight * 1000 : a.weight;
      const bGrams = b.unit === 'kg' ? b.weight * 1000 : b.weight;
      return aGrams - bGrams;
    });
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].price <= sorted[i - 1].price) {
        const prevLabel = sorted[i - 1].unit === 'kg' ? `${sorted[i - 1].weight} kg` : `${sorted[i - 1].weight} g`;
        const currLabel = sorted[i].unit === 'kg' ? `${sorted[i].weight} kg` : `${sorted[i].weight} g`;
        feedback.textContent = `Price for ${currLabel} (₹${sorted[i].price}) must be higher than price for ${prevLabel} (₹${sorted[i - 1].price}). Larger weights must cost more.`;
        feedback.classList.remove('hidden');
        feedback.style.color = 'var(--color-danger)';
        return;
      }
    }

    // Check for duplicate product name across all categories
    const nameDup = _adminProducts.find(p =>
      p.name.toLowerCase() === name.toLowerCase() &&
      p.id !== editId
    );
    if (nameDup) {
      feedback.textContent = `A product with the name "${name}" already exists. Product names must be unique.`;
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_BASE}/products/${editId}` : `${API_BASE}/products`;
    const body = buildProductBody({ name, category, description, gstRate: gst_rate, image_url, productId, editId, weightPricing });

    const { res, data } = await submitJson(url, method, body);
    if (res.ok) {
      showSuccessToast(editId ? '✅ Product updated successfully!' : '✅ Product published successfully!');
      resetAdminForm();
      try {
        bcProducts?.postMessage({ type: 'products:updated' });
      } catch (e) {
        console.warn(e);
      }
      window.location.href = '/';
    } else {
      feedback.textContent = data.error || 'Failed to save product.';
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
    renderAdminOrders(orders);
    renderAdminHistory();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err));
    if (list) list.innerHTML = '<div class="admin-loading" style="color:#e74c3c;"></div>';
  }
}

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

  wrap.innerHTML = orders
    .map((o) => {
      const date = new Date(o.created_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
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
      <details class="admin-order-items">
        <summary>${o.items.length} products</summary>
        <ul>${itemRows}</ul>
      </details>
    `
        : `
      <div class="admin-order-items-single">${itemRows}</div>
    `;

      const currentStage = statusSteps.indexOf(o.delivery_status || 'placed');
      const progressSteps = statusSteps
        .map(
          (step, index) => `
      <div class="admin-progress-step ${step} ${index <= currentStage ? 'active' : ''}">
        <span>${statusLabels[step]}</span>
      </div>
      ${index < statusSteps.length - 1 ? '<div class="admin-progress-connector"></div>' : ''}
    `,
        )
        .join('');
      const invoiceLink = o.invoice_token
        ? `${globalThis.location.origin}/api/orders/share/${o.invoice_token}`
        : '';

      return `
      <div class="admin-order-card">
        <div class="admin-order-card-header">
          <div>
            <div class="admin-order-id">${o.id}</div>
            <div class="admin-order-title">${customerName}</div>
            <div class="admin-order-meta-text">${date} · ${o.items.length} item(s) · ₹${o.total.toFixed(2)}</div>
          </div>
          <div class="admin-order-status-badge-wrap">
            <span class="admin-order-status ${o.delivery_status}">${o.delivery_status}</span>
          </div>
        </div>

        <div class="admin-order-card-grid">
          <div class="admin-order-card-section">
            <div class="admin-order-section-title">Shipping details</div>
            <p><strong>${customerName}</strong></p>
            <p>${phone}</p>
            <p class="admin-order-address">${address}</p>
            ${o.expected_delivery_date ? `<p class="admin-order-delivery-date"><strong>Expected delivery:</strong> ${new Date(o.expected_delivery_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${o.delivery_days_text ? ' (' + o.delivery_days_text + ')' : ''}</p>` : ''}
          </div>

          <div class="admin-order-card-section admin-order-actions-panel">
            <div class="admin-order-section-title">Shipment status</div>
            ${o.delivery_status === 'cancelled'
          ? `
              <div class="admin-order-cancelled-note">
                <div class="admin-order-cancelled-label">Cancelled</div>
                <div class="admin-order-cancelled-subtitle">Cancelled by ${o.cancelled_by === 'admin' ? 'admin' : 'user'}</div>
                <div class="admin-order-cancelled-reason">${o.cancel_reason || 'Reason not provided'}</div>
              </div>
            `
          : `
              <select class="admin-ship-select" onchange="globalThis.adminUpdateShipping('${o.id}', this.value)">
                <option value="placed" ${o.delivery_status === 'placed' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 0 ? 'disabled' : ''}>Placed</option>
                <option value="processing" ${o.delivery_status === 'processing' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 1 ? 'disabled' : ''}>Processing</option>
                <option value="shipped" ${o.delivery_status === 'shipped' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 2 ? 'disabled' : ''}>Shipped</option>
                <option value="in_transit" ${o.delivery_status === 'in_transit' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 3 ? 'disabled' : ''}>In Transit</option>
                <option value="delivered" ${o.delivery_status === 'delivered' ? 'selected' : ''} ${statusSteps.indexOf(o.delivery_status || 'placed') > 4 ? 'disabled' : ''}>Delivered</option>
              </select>
              <div class="admin-delivery-input-wrap" style="margin-top:8px;${['shipped', 'in_transit'].includes(o.delivery_status) ? '' : 'display:none;'}" id="admin-delivery-wrap-${o.id}">
                <label class="admin-cancel-label" for="admin-delivery-days-${o.id}">Expected delivery (days)</label>
                <select id="admin-delivery-days-${o.id}" class="admin-cancel-select" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;">
                  <option value="">Select days</option>
                  ${[1,2,3,4,5,6,7].map(d => `<option value="${d} day${d > 1 ? 's' : ''}" ${o.delivery_days_text === `${d} day${d > 1 ? 's' : ''}` ? 'selected' : ''}>${d} day${d > 1 ? 's' : ''}</option>`).join('')}
                </select>
              </div>
              <div class="admin-order-cancel-controls">
                <label class="admin-cancel-label" for="admin-cancel-reason-${o.id}">Cancel reason</label>
                <select id="admin-cancel-reason-${o.id}" class="admin-cancel-select" onchange="globalThis.adminToggleCancelReason('${o.id}', this.value)">
                  <option value="">Select a reason</option>
                  <option value="Stock not available">Stock not available</option>
                  <option value="We are not extended our service to your area">We are not extended our service to your area</option>
                  <option value="Invalid pincode">Invalid pincode</option>
                  <option value="Invalid address">Invalid address</option>
                  <option value="Other">Other</option>
                </select>
                <input id="admin-cancel-other-${o.id}" type="text" placeholder="Specify cancel reason" class="admin-cancel-other" style="display:none;">
                <button class="btn btn-danger admin-cancel-btn" onclick="globalThis.adminCancelOrder('${o.id}')">Cancel order</button>
              </div>
            `
        }
            <div class="admin-order-summary-block">
              <div><span>Order total</span><strong>₹${o.total.toFixed(2)}</strong></div>
              <div><span>Payment mode</span><strong>${o.payment_method || (o.razorpay_order_id ? 'Razorpay' : 'Pending')}</strong></div>
              <div><span>Transaction</span><strong>${o.transaction_id || o.razorpay_payment_id || 'Pending'}</strong></div>
              <div><span>Customer</span><strong>${customerName}</strong></div>
            </div>
            ${invoiceLink && ['shipped', 'in_transit', 'delivered'].includes(o.delivery_status)
          ? `
              <div class="admin-order-summary-block" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-secondary" onclick="globalThis.open('${invoiceLink}','_blank')">Open Invoice</button>
                <button class="btn btn-secondary" onclick="globalThis.copyInvoiceLink('${o.invoice_token}')">Copy Link</button>
              </div>
            `
          : ''
        }
          </div>
        </div>

        <div class="admin-order-progress-wrap">
          <div class="admin-order-progress-label">Shipment progress</div>
          <div class="admin-order-progress-track">
            ${progressSteps}
          </div>
        </div>

        <div class="admin-order-items-panel">
          <div class="admin-order-section-title">Order items</div>
          ${productDisplay}
        </div>
      </div>
    `;
    })
    .join('');
}
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
    case 'modified_date':
      html = '<input type="date" id="admin-filter-value-input" class="admin-filter-input">';
      break;
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
    case 'date':
      html = '<input type="date" id="admin-history-filter-value-input" class="admin-filter-input">';
      break;
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

      return `
        <div class="admin-order-card">
          <div class="admin-order-card-header">
            <div>
              <div class="admin-order-id">${o.id}</div>
              <div class="admin-order-title">${o.customer_name || o.user_email || 'Customer'}</div>
              <div class="admin-order-meta-text">Delivered: ${delivered} · ${items.length} item${items.length !== 1 ? 's' : ''} · ₹${(o.total || 0).toFixed(2)}</div>
            </div>
            <div class="admin-order-status-badge-wrap">
              <span class="admin-order-status delivered">Delivered</span>
            </div>
          </div>
          <div class="admin-order-card-grid" style="grid-template-columns:1.4fr minmax(240px,1fr); gap:18px;">
            <div class="admin-order-card-section">
              <div class="admin-order-section-title">Delivery details</div>
              <p><strong>Customer ID:</strong> ${customerId}</p>
              <p><strong>Phone:</strong> ${phone}</p>
              <p class="admin-order-address">${o.delivery_address || 'No address provided'}</p>
            </div>
            <div class="admin-order-card-section">
              <div class="admin-order-section-title">Order reference</div>
              <p><strong>Order ID:</strong> ${o.id}</p>
              <p><strong>Payment:</strong> ${o.payment_method || (o.razorpay_order_id ? 'Razorpay' : 'Pending')}</p>
              <p><strong>Txn:</strong> ${o.transaction_id || o.razorpay_payment_id || 'Pending'}</p>
            </div>
          </div>
          <div class="admin-order-items-panel">
            <div class="admin-order-section-title">Items</div>
            <ul style="margin:0;padding-left:18px;">${itemRows}</ul>
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
      showSuccessToast('🗑️ Product successfully deleted.');
      window.location.href = '/';
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
  list.innerHTML = _adminTrainings
    .map(
      (t) => `
    <div class="admin-training-row" data-id="${t.id}">
      <div style="display:flex;gap:12px;align-items:center;flex:1;">
        <img src="${t.image_url || '/images/training_farm.png'}" alt="${t.title}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0;">
        <div style="flex:1;min-width:0;">
          <strong>${t.title}</strong>
          <div style="font-size:0.82rem;color:#475569;display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
            <span>${t.category}</span>
            <span>·</span>
            <span style="font-family:monospace;font-size:0.78rem;color:#6b7280;">${t.training_id || '—'}</span>
            <span>·</span>
            <span>${formatDate(t.start_date)} – ${formatDate(t.end_date)}</span>
            <span>·</span>
            <span><strong>${t.duration_days || '—'}</strong> days</span>
            ${(t.price_strikeout && t.price_actual)
              ? `<span>·</span><span style="text-decoration:line-through;color:#9ca3af;">₹${Number(t.price_strikeout).toLocaleString()}</span><span style="color:var(--color-primary);font-weight:600;">₹${Number(t.price_actual).toLocaleString()}</span>`
              : ''}
          </div>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="btn-admin-edit" onclick="globalThis.adminEditTraining('${t.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn-admin-delete" onclick="globalThis.adminDeleteTraining('${t.id}')"><i class="fa-solid fa-trash"></i></button>
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

  list.innerHTML = `
    <div class="admin-blog-table">
      ${blogs.map(blog => {
    return `
          <div class="admin-blog-row" data-id="${blog.id}">
            <div class="admin-blog-info">
              <div class="admin-blog-thumb">
                ${blog.featured_image
        ? `<img src="${blog.featured_image}" alt="${blog.title}" loading="lazy">`
        : '<i class="fa-solid fa-newspaper"></i>'
      }
              </div>
              <div class="admin-blog-details">
                <h4>${blog.title}</h4>
                <div class="admin-blog-meta-row">
                  <span>${blog.author || 'Admin'}</span>
                  <span>·</span>
                  <span>${formatAdminDate(blog.published_at || blog.created_at)}</span>
                </div>
              </div>
            </div>
            <div class="admin-blog-actions">
              <button class="btn-admin-delete" onclick="globalThis.adminDeleteBlog('${blog.id}')"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        `;
  }).join('')}
    </div>
  `;
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

  list.innerHTML = categories
    .map(
      (cat) => `
    <div class="admin-cat-row" data-id="${cat.id}">
      <div class="admin-cat-info">
        <span class="admin-cat-uid">${cat.category_id || cat.categoryId || 'spore-000000'}</span>
        <span class="admin-cat-slug">${cat.id}</span>
        <strong class="admin-cat-name">${cat.name}</strong>
        <span class="admin-cat-desc">${cat.description || ''}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn-admin-edit" onclick="globalThis.adminEditCategory('${cat.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn-admin-delete" onclick="globalThis.adminDeleteCategory('${cat.id}')"><i class="fa-solid fa-trash"></i></button>
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
}

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
  const label = document.getElementById('admin-submit-label');
  if (label) label.textContent = 'Publish Product';
  const preview = document.getElementById('admin-img-preview');
  if (preview) preview.innerHTML = '<i class="fa-solid fa-image"></i><span>Image preview</span>';
  const feedback = document.getElementById('admin-add-feedback');
  if (feedback) feedback.classList.add('hidden');
  updateProductIdDisplay();
  // Reset weight pricing to single empty row
  setWeightPricingData(null);
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
}

function setupAdminEventHandlers() {
  // Tab clicks
  document.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activateAdminTab(btn.dataset.tab);
    });
  });

  // Login handler
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError();
      const email = document.getElementById('admin-auth-email').value.trim();
      const password = document.getElementById('admin-auth-password').value.trim();
      try {
        const res = await authApi.adminLogin(email, password);
        if (res?.token) {
          saveAuth(res.token, res.user);
          showDashboard();
        }
      } catch (err) {
        renderAuthError(err.message || 'Login failed');
      }
    });
  }

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
  const adminPageSizeSelect = document.getElementById('admin-inventory-page-size');
  if (adminSearchProd) adminSearchProd.addEventListener('input', () => { _adminInventoryPage = 1; renderAdminInventory(); });
  if (adminFilterCat) adminFilterCat.addEventListener('change', () => { _adminInventoryPage = 1; renderAdminInventory(); });
  if (adminSortSelect) adminSortSelect.addEventListener('change', () => { _adminInventoryPage = 1; renderAdminInventory(); });
  if (adminPageSizeSelect) adminPageSizeSelect.addEventListener('change', () => { const v = Number.parseInt(adminPageSizeSelect.value, 10) || 10; adminInventoryPageSize = v; _adminInventoryPage = 1; renderAdminInventory(); });

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
    });
  });

  // Status pills — current orders
  document.querySelectorAll('.ship-status-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.ship-status-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      const status = pill.dataset.status;
      if (status === 'all') {
        renderAdminOrders(adminOrdersCache);
        return;
      }
    const statusMap = {
      placed: ['placed'],
      processing: ['processing'],
      shipped: ['shipped', 'in_transit'],
      delivered: ['delivered'],
      cancelled: ['cancelled'],
    };
      const allowed = statusMap[status] || [status];
      const filtered = adminOrdersCache.filter((o) => allowed.includes(o.delivery_status));
      renderAdminOrders(filtered);
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
  globalThis.copyInvoiceLink = copyInvoiceLink;
  globalThis.renderAdminOrders = renderAdminOrders;

  // Initialize weight pricing with one empty row
  if (weightPricingContainer && !weightPricingContainer.querySelector('.admin-weight-pricing-row')) {
    setWeightPricingData(null);
  }
}

async function initAdminPage() {
  setupAdminEventHandlers();
  // Initialize UI state — only show dashboard if the logged-in user is an admin
  if (state.token && state.user && state.user.role === 'admin') {
    try {
      const user = await authApi.getMe();
      if (user && user.role === 'admin') {
        state.user = user;
        showDashboard();
        return;
      }
    } catch (_err) {
      // Token is invalid/expired — clear and show login
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
