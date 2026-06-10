import { state, saveAuth, clearAuth } from './utils/state.js';
import { authApi } from './api/authApi.js';
import { API_BASE, fetchWithAuth, getApiErrorMessage } from './api/client.js';
import { trainingApi } from './api/trainingApi.js';
import { showErrorToast, showSuccessToast } from './utils/notify.js';

window.state = state;

let _adminProducts = [];
let _adminCategories = [];
let _adminTrainings = [];
let pendingCategoryEditId = null;
let adminOrdersCache = [];
let _adminInventoryPage = 1;
let adminInventoryPageSize = 10;
let productImagePreviewValid = false;

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
// Training DOM elements
const trainForm = document.getElementById('form-admin-add-training');
const trainEditId = document.getElementById('admin-train-edit-id');
const trainTitle = document.getElementById('admin-train-title');
const trainCategory = document.getElementById('admin-train-category');
const trainDesc = document.getElementById('admin-train-desc');
const trainImage = document.getElementById('admin-train-image');
const trainContent = document.getElementById('admin-train-content');
const trainListWrap = document.getElementById('admin-trainings-list');
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
let bcCategories = null;
try {
  bcCategories = new BroadcastChannel('spore-categories');
} catch (e) {
  bcCategories = null;
}
let bcProducts = null;
try {
  bcProducts = new BroadcastChannel('spore-products');
} catch (e) {
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
  bcOrders = null;
}

// Connect to server-sent events for cross-browser order notifications
let adminEs = null;

function initAdminSse() {
  try {
    if (!state || !state.token) return;
    if (adminEs) return; // already initialized
    const esUrl = `${API_BASE}/orders/events?token=${encodeURIComponent(state.token)}`;
    adminEs = new EventSource(esUrl);
    adminEs.addEventListener('order:updated', (ev) => {
      try {
        const payload = JSON.parse(ev.data || '{}');
        const order = payload.order;
        if (state.user && state.user.role === 'admin') {
          fetchAdminOrders();
          if (order) {
            const status = order.delivery_status || order.status || 'updated';
            showSuccessToast(`Order ${order.id} updated (${status})`);
          } else {
            showSuccessToast('Order update received');
          }
        }
      } catch (e) {
        /* ignore */
      }
    });
    adminEs.addEventListener('error', () => {
      // noop; BroadcastChannel remains as fallback
    });
  } catch (e) {
    /* ignore */
  }
}

window.addEventListener('auth:changed', () => initAdminSse());

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
    fetchAdminTrainings().catch(() => {}),
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
  if (!categoryUid) return '';
  const existingIds = _adminProducts
    .filter(
      (p) => p.category === document.getElementById('admin-prod-category')?.value,
    )
    .map((p) => {
      const regex = new RegExp(`^${escapeRegExp(categoryUid)}-pid-(\\d+)$`);
      const match = String(p.id).match(regex);
      return match ? parseInt(match[1], 10) : 0;
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
  productIdDisplay.value = categoryUid ? generateProductId(categoryUid) : '';
}

function updateCategoryImagePreview() {
  if (!categoryImagePreview) return;
  const file = categoryImageFile?.files?.[0];
  let url = categoryImageUrl?.value.trim();

  // If a local file is selected, preview it (file takes precedence)
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      categoryImagePreview.innerHTML = `<img src="${reader.result}" alt="Preview">`;
    };
    reader.readAsDataURL(file);
    return;
  }

  // If URL is provided, try to preload it and handle errors
  if (url) {
    // Normalize protocol-less URLs (e.g. example.com/image.jpg or //cdn.com/img.png)
    if (url.startsWith('//')) url = `https:${url}`;
    else if (!/^https?:\/\//i.test(url) && url.indexOf('.') !== -1) url = `https://${url}`;

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
      preview.innerHTML = `<img src="${reader.result}" alt="Preview">`;
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
      && url.indexOf('.') !== -1
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

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
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
      const stockClass = p.stock === 0
        ? 'out-stock'
        : p.stock < 20
          ? 'low-stock'
          : 'in-stock';
      const stockLabel = p.stock === 0
        ? 'Out of Stock'
        : p.stock < 20
          ? `Low: ${p.stock}`
          : `${p.stock} units`;
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
                  <span class="price-act">₹${p.price.toFixed(2)}</span>
                  ${p.mrp_price ? `<span class="price-mrp">₹${p.mrp_price.toFixed(2)}</span>` : ''}
                </div>
                <div class="admin-badge-row">
                  <span class="admin-stock-badge ${stockClass}">${stockLabel}</span>
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
                <button class="btn-admin-edit" onclick="window.adminEditProduct('${p.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
                <button class="btn-admin-delete" onclick="window.adminDeleteProduct('${p.id}')"><i class="fa-solid fa-trash"></i></button>
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
  document.getElementById('admin-prod-price').value = product.price;
  document.getElementById('admin-prod-mrp').value = product.mrp_price || '';
  document.getElementById('admin-prod-stock').value = product.stock;
  if (productImageUrl) productImageUrl.value = product.image_url || '';
  if (productImageFile) productImageFile.value = '';

  const preview = document.getElementById('admin-img-preview');
  if (preview) {
    preview.innerHTML = `<img src="${product.image_url}" alt="Preview">`;
    productImagePreviewValid = true;
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
  const price = document.getElementById('admin-prod-price').value;
  const mrp_price = document.getElementById('admin-prod-mrp').value;
  const gst_rate = document.getElementById('admin-prod-gst').value;
  const stock = document.getElementById('admin-prod-stock').value;
  const selectedCategoryUid = document.getElementById('admin-prod-category')?.selectedOptions?.[0]
    ?.dataset?.categoryUid || '';
  let productId = productIdDisplay?.value.trim() || '';
  const productImageUrlValue = productImageUrl?.value.trim() || '';
  const imageFile = productImageFile?.files?.[0];
  let image_url = productImageUrlValue;

  try {
    const expectedPrefix = selectedCategoryUid
      ? `${selectedCategoryUid}-pid-`
      : '';
    if (
      !productId
      || (expectedPrefix && !productId.startsWith(expectedPrefix))
    ) {
      productId = generateProductId(selectedCategoryUid);
      if (productIdDisplay) productIdDisplay.value = productId;
    }

    if (imageFile) {
      image_url = await readFileAsDataUrl(imageFile);
    }

    const numericPrice = parseFloat(price);
    const numericMrp = mrp_price ? parseFloat(mrp_price) : undefined;
    if (numericMrp !== undefined && numericMrp < numericPrice) {
      feedback.textContent = 'MRP must be greater than or equal to the actual price.';
      feedback.classList.remove('hidden');
      return;
    }

    const method = editId ? 'PUT' : 'POST';
    const url = editId
      ? `${API_BASE}/products/${editId}`
      : `${API_BASE}/products`;
    if (!productImagePreviewValid) {
      feedback.textContent = 'Please provide a valid product image preview. Upload a local image file or paste a direct image URL (e.g. ending with .jpg, .png, .webp) that loads successfully, not a Google share page or HTML link.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
      return;
    }
    const body = {
      name,
      category,
      description,
      price: numericPrice,
      mrp_price: numericMrp,
      gst_rate: parseInt(gst_rate, 10),
      stock: parseInt(stock, 10),
      image_url,
    };
    if (!editId) {
      body.id = productId;
    }

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      showSuccessToast(
        editId
          ? '✅ Product updated successfully!'
          : '✅ Product published successfully!',
      );
      resetAdminForm();
      fetchAdminInventory();
      try {
        bcProducts?.postMessage({ type: 'products:updated' });
      } catch (e) {
        /* ignore */
      }
      activateAdminTab('products');
    } else {
      feedback.textContent = data.error || 'Failed to save product.';
      feedback.classList.remove('hidden');
    }
  } catch (err) {
    feedback.textContent = 'Server error.';
    feedback.classList.remove('hidden');
  }
}

async function fetchAdminOrders() {
  const list = document.getElementById('admin-orders-list');
  if (list) list.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading orders...</div>';
  try {
    const orders = await fetchWithAuth('/orders/all-orders');
    if (!Array.isArray(orders)) {
      throw new Error('Invalid orders response');
    }
    if (statOrders) statOrders.textContent = orders.length;
    adminOrdersCache = orders;
    renderAdminOrders(orders);
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

  const statusSteps = ['pending', 'processing', 'shipped', 'delivered'];
  const statusLabels = {
    pending: 'Pending',
    processing: 'Processing',
    shipped: 'Shipped',
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

      const currentStage = statusSteps.indexOf(o.delivery_status || 'pending');
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
        ? `${window.location.origin}/api/orders/share/${o.invoice_token}`
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
          </div>

          <div class="admin-order-card-section admin-order-actions-panel">
            <div class="admin-order-section-title">Shipment status</div>
            ${
  o.delivery_status === 'cancelled'
    ? `
              <div class="admin-order-cancelled-note">
                <div class="admin-order-cancelled-label">Cancelled</div>
                <div class="admin-order-cancelled-subtitle">Cancelled by ${o.cancelled_by === 'admin' ? 'admin' : 'user'}</div>
                <div class="admin-order-cancelled-reason">${o.cancel_reason || 'Reason not provided'}</div>
              </div>
            `
    : `
              <select class="admin-ship-select" onchange="window.adminUpdateShipping('${o.id}', this.value)">
                <option value="pending" ${o.delivery_status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="processing" ${o.delivery_status === 'processing' ? 'selected' : ''}>Processing</option>
                <option value="shipped" ${o.delivery_status === 'shipped' ? 'selected' : ''}>Shipped</option>
                <option value="delivered" ${o.delivery_status === 'delivered' ? 'selected' : ''}>Delivered</option>
              </select>
              <div class="admin-order-cancel-controls">
                <label class="admin-cancel-label" for="admin-cancel-reason-${o.id}">Cancel reason</label>
                <select id="admin-cancel-reason-${o.id}" class="admin-cancel-select" onchange="window.adminToggleCancelReason('${o.id}', this.value)">
                  <option value="">Select a reason</option>
                  <option value="Stock not available">Stock not available</option>
                  <option value="We are not extended our service to your area">We are not extended our service to your area</option>
                  <option value="Invalid pincode">Invalid pincode</option>
                  <option value="Invalid address">Invalid address</option>
                  <option value="Other">Other</option>
                </select>
                <input id="admin-cancel-other-${o.id}" type="text" placeholder="Specify cancel reason" class="admin-cancel-other" style="display:none;">
                <button class="btn btn-danger admin-cancel-btn" onclick="window.adminCancelOrder('${o.id}')">Cancel order</button>
              </div>
            `
}
            <div class="admin-order-summary-block">
              <div><span>Order total</span><strong>₹${o.total.toFixed(2)}</strong></div>
              <div><span>Payment mode</span><strong>${o.payment_method || (o.razorpay_order_id ? 'Razorpay' : 'Pending')}</strong></div>
              <div><span>Transaction</span><strong>${o.transaction_id || o.razorpay_payment_id || 'Pending'}</strong></div>
              <div><span>Customer</span><strong>${customerName}</strong></div>
            </div>
            ${
  invoiceLink
    ? `
              <div class="admin-order-summary-block" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-secondary" onclick="window.open('${invoiceLink}','_blank')">Open Invoice</button>
                <button class="btn btn-secondary" onclick="window.copyInvoiceLink('${o.invoice_token}')">Copy Link</button>
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

async function adminUpdateShipping(orderId, status) {
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ delivery_status: status }),
    });
    if (!res.ok) throw new Error('Failed');
    showSuccessToast(`📦 Shipment status updated to "${status}"`);
    fetchAdminOrders();
  } catch (err) {
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
          <option value="pending">Pending</option>
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
    if (!otherText || !otherText.value.trim()) {
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
      fetchAdminInventory();
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
    if (list) list.innerHTML = '<div class="admin-loading" style="color:#e74c3c;">Failed to load trainings.</div>';
    return [];
  }
}

function renderAdminTrainings() {
  const list = document.getElementById('admin-trainings-list');
  if (!list) return;
  if (!_adminTrainings || !_adminTrainings.length) {
    list.innerHTML = '<div class="admin-loading">No trainings available.</div>';
    return;
  }
  list.innerHTML = _adminTrainings
    .map(
      (t) => `
    <div class="admin-training-row" data-id="${t.id}">
      <div style="display:flex;gap:12px;align-items:center;">
        <img src="${t.image_url || '/images/training_farm.png'}" alt="${t.title}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;">
        <div>
          <strong>${t.title}</strong>
          <div style="font-size:0.9rem;color:#475569">${t.category} · ${t.description || ''}</div>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="btn-admin-edit" onclick="window.adminEditTraining('${t.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn-admin-delete" onclick="window.adminDeleteTraining('${t.id}')"><i class="fa-solid fa-trash"></i></button>
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
  const image_url = (
    document.getElementById('admin-train-image').value || ''
  ).trim();
  const content_url = (
    document.getElementById('admin-train-content').value || ''
  ).trim();
  // collect allowed roles
  const allowed = [];
  if (document.getElementById('admin-train-role-trainee')?.checked) allowed.push('trainee');
  if (document.getElementById('admin-train-role-farmer')?.checked) allowed.push('farmer');
  if (document.getElementById('admin-train-role-entrepreneur')?.checked) allowed.push('entrepreneur');

  if (!title) {
    showErrorToast('Title is required');
    return;
  }

  try {
    if (editId) {
      await trainingApi.updateTraining(editId, {
        title,
        category,
        description,
        image_url,
        content_url,
        allowed_roles: allowed,
      });
      showSuccessToast('Training updated');
    } else {
      await trainingApi.createTraining({
        title,
        category,
        description,
        image_url,
        content_url,
        allowed_roles: allowed,
      });
      showSuccessToast('Training created');
    }
    document.getElementById('admin-train-edit-id').value = '';
    document.getElementById('admin-train-title').value = '';
    document.getElementById('admin-train-desc').value = '';
    document.getElementById('admin-train-image').value = '';
    document.getElementById('admin-train-content').value = '';
    fetchAdminTrainings();
  } catch (err) {
    showErrorToast(getApiErrorMessage(err) || 'Failed to save training');
  }
}

function adminEditTraining(id) {
  const t = _adminTrainings.find((x) => x.id === id);
  if (!t) return;
  document.getElementById('admin-train-edit-id').value = t.id;
  document.getElementById('admin-train-title').value = t.title || '';
  document.getElementById('admin-train-category').value = t.category || '';
  document.getElementById('admin-train-desc').value = t.description || '';
  document.getElementById('admin-train-image').value = t.image_url || '';
  document.getElementById('admin-train-content').value = t.content_url || '';
  // set allowed roles
  const allowed = t.allowed_roles || [];
  document.getElementById('admin-train-role-trainee').checked = allowed.includes('trainee');
  document.getElementById('admin-train-role-farmer').checked = allowed.includes('farmer');
  document.getElementById('admin-train-role-entrepreneur').checked = allowed.includes('entrepreneur');
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
        <button class="btn-admin-edit" onclick="window.adminEditCategory('${cat.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn-admin-delete" onclick="window.adminDeleteCategory('${cat.id}')"><i class="fa-solid fa-trash"></i></button>
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
  const hash = window.location.hash || '';
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
  const id = document
    .getElementById('admin-cat-id')
    .value.trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
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

  // Force auto-generation of category UID for new categories
  if (!editId) {
    categoryId = generateCategoryUid();
    if (categoryUidInput) categoryUidInput.value = categoryId;
  }

  // Client-side uniqueness checks: slug (id), name, and category UID must be unique
  if (_adminCategories && _adminCategories.length) {
    const slugConflict = _adminCategories.some(
      (c) => c.id === id && c.id !== editId,
    );
    const nameConflict = _adminCategories.some(
      (c) => (c.name || '').toLowerCase() === name.toLowerCase() && c.id !== editId,
    );
    const uidConflict = _adminCategories.some(
      (c) => (c.category_id || c.categoryId) === categoryId && c.id !== editId,
    );

    if (slugConflict || nameConflict || uidConflict) {
      const parts = [];
      if (slugConflict) parts.push('Slug already exists');
      if (nameConflict) parts.push('Name already exists');
      if (uidConflict) parts.push('Category UID conflict (regenerating)');

      if (uidConflict) {
        // regenerate UID until unique
        let attempts = 0;
        while (
          _adminCategories.some(
            (c) => (c.category_id || c.categoryId) === categoryId && c.id !== editId,
          )
          && attempts < 20
        ) {
          categoryId = generateCategoryUid();
          attempts += 1;
        }
        if (categoryUidInput) categoryUidInput.value = categoryId;
      }

      if (slugConflict || nameConflict) {
        if (feedback) {
          feedback.textContent = `${parts.join(' · ')}.`;
          feedback.classList.remove('hidden');
          feedback.style.color = 'var(--color-danger)';
        }
        return;
      }
    }
  }
  try {
    const file = categoryImageFile?.files?.[0];
    if (!imageUrl && file) {
      imageUrl = await readFileAsDataUrl(file);
    }

    const method = editId ? 'PUT' : 'POST';
    const url = editId
      ? `${API_BASE}/categories/${editId}`
      : `${API_BASE}/categories`;
    const body = editId
      ? { name, description, image_url: imageUrl }
      : {
        category_id: categoryId,
        id,
        name,
        description,
        image_url: imageUrl,
      };

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      showSuccessToast(
        editId
          ? `✅ Category "${name}" updated!`
          : `✅ Category "${name}" created!`,
      );
      resetAdminCatForm();
      fetchAdminCategories();
      fetchCategories();
      // Notify other tabs (landing page) to refresh categories
      try {
        bcCategories?.postMessage({ type: 'categories:updated' });
      } catch (e) {
        /* ignore */
      }
    } else if (feedback) {
      feedback.textContent = data.error || 'Failed to save category.';
      feedback.classList.remove('hidden');
      feedback.style.color = 'var(--color-danger)';
    }
  } catch (err) {
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
    fetchAdminCategories();
    fetchCategories();
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
      preview.innerHTML = `<img src="${reader.result}" alt="Preview">`;
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
      && url.indexOf('.') !== -1
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
window.copyInvoiceLink = copyInvoiceLink;

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

function initAdminPage() {
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
      const password = document
        .getElementById('admin-auth-password')
        .value.trim();
      try {
        const res = await authApi.adminLogin(email, password);
        if (res && res.token) {
          saveAuth(res.token, res.user);
          showDashboard();
        }
      } catch (err) {
        renderAuthError(err.message || 'Login failed');
      }
    });
  }

  // Logout
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      clearAuth();
      showLoginPanel();
    });
  }
  if (btnViewShop) btnViewShop.addEventListener('click', () => (window.location.href = '/'));
  
  // Admin action menu toggle
  if (adminActionMenuBtn && adminActionMenu) {
    adminActionMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      adminActionMenu.classList.toggle('hidden');
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!adminActionMenuBtn.contains(e.target) && !adminActionMenu.contains(e.target)) {
        adminActionMenu.classList.add('hidden');
      }
    });
  }

  // Product form
  if (productForm) productForm.addEventListener('submit', handleAdminAddProduct);
  if (resetFormBtn) resetFormBtn.addEventListener('click', resetAdminForm);

  // Category handlers
  if (saveCatBtn) saveCatBtn.addEventListener('click', handleAdminSaveCategory);
  if (resetCatBtn) resetCatBtn.addEventListener('click', resetAdminCatForm);

  // Training form
  if (trainForm) trainForm.addEventListener('submit', handleAdminSaveTraining);
  const resetTrainBtn = document.getElementById('btn-admin-reset-train');
  if (resetTrainBtn) {
    resetTrainBtn.addEventListener('click', () => {
      document.getElementById('admin-train-edit-id').value = '';
      document.getElementById('admin-train-title').value = '';
      document.getElementById('admin-train-desc').value = '';
      document.getElementById('admin-train-image').value = '';
      document.getElementById('admin-train-content').value = '';
    });
  }

  // Product/category image preview wiring
  if (productImageBrowse) productImageBrowse.addEventListener('click', () => productImageFile?.click());
  if (categoryImageBrowse) categoryImageBrowse.addEventListener('click', () => categoryImageFile?.click());
  if (productImageFile) productImageFile.addEventListener('change', updateImagePreview);
  if (productImageUrl) {
    productImageUrl.addEventListener('input', () => {
      if (productImageFile?.files?.length) {
        productImageFile.value = '';
      }
      updateImagePreview();
    });
  }
  if (categoryImageFile) categoryImageFile.addEventListener('change', updateCategoryImagePreview);
  if (categoryImageUrl) categoryImageUrl.addEventListener('input', updateCategoryImagePreview);

  const adminSearchProd = document.getElementById('admin-search-prod');
  const adminFilterCat = document.getElementById('admin-filter-cat');
  const adminSortSelect = document.getElementById('admin-inventory-sort');
  const adminPageSizeSelect = document.getElementById('admin-inventory-page-size');
  if (adminSearchProd) {
    adminSearchProd.addEventListener('input', () => {
      _adminInventoryPage = 1;
      renderAdminInventory();
    });
  }
  if (adminFilterCat) {
    adminFilterCat.addEventListener('change', () => {
      _adminInventoryPage = 1;
      renderAdminInventory();
    });
  }
  if (adminSortSelect) {
    adminSortSelect.addEventListener('change', () => {
      _adminInventoryPage = 1;
      renderAdminInventory();
    });
  }
  if (adminPageSizeSelect) {
    adminPageSizeSelect.addEventListener('change', () => {
      const v = parseInt(adminPageSizeSelect.value, 10) || 10;
      adminInventoryPageSize = v;
      _adminInventoryPage = 1;
      renderAdminInventory();
    });
  }

  // Expose globals
  window.adminEditProduct = adminEditProduct;
  window.adminDeleteProduct = adminDeleteProduct;
  window.adminUpdateShipping = adminUpdateShipping;
  window.adminToggleCancelReason = adminToggleCancelReason;
  window.adminCancelOrder = adminCancelOrder;
  window.adminEditCategory = adminEditCategory;
  window.adminDeleteCategory = adminDeleteCategory;
  window.adminEditTraining = adminEditTraining;
  window.adminDeleteTraining = adminDeleteTraining;

  // Initialize UI state
  if (state.token && state.user) {
    showDashboard();
  } else {
    showLoginPanel();
  }
}

initAdminPage();
