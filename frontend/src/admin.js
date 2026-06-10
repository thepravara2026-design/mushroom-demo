import { state, saveAuth, clearAuth } from './utils/state.js';
import { authApi } from './api/authApi.js';
import { API_BASE, fetchWithAuth } from './api/client.js';

window.state = state;

let _adminProducts = [];
let _adminCategories = [];
let pendingCategoryEditId = null;
let adminOrdersCache = [];

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
const productImageBrowse = document.getElementById('admin-prod-image-browse');
const productImageFile = document.getElementById('admin-prod-image-file');
const categoryUidInput = document.getElementById('admin-cat-uid');
const categoryImageUrl = document.getElementById('admin-cat-image-url');
const categoryImageBrowse = document.getElementById('admin-cat-image-browse');
const categoryImageFile = document.getElementById('admin-cat-image-file');
const categoryImagePreview = document.getElementById('admin-cat-image-preview');
const shippingChargeInput = document.getElementById('admin-shipping-charge');
const saveShippingChargeBtn = document.getElementById('admin-save-shipping-charge');
let bcCategories = null;
try { bcCategories = new BroadcastChannel('spore-categories'); } catch(e) { bcCategories = null; }

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
    if (pendingCategoryEditId) {
      activateAdminTab('categories');
      adminEditCategory(pendingCategoryEditId);
      pendingCategoryEditId = null;
    }
  });
}

function renderAuthError(message) {
  loginError.textContent = message;
  loginError.classList.remove('hidden');
}

function clearAuthError() {
  loginError.textContent = '';
  loginError.classList.add('hidden');
}

function closeAdminActionMenu() {
  adminActionMenu?.classList.add('hidden');
}

function toggleAdminActionMenu(event) {
  event.stopPropagation();
  adminActionMenu?.classList.toggle('hidden');
}

function handleAdminViewShop() {
  window.location.href = '/';
}

function bindAdminEvents() {
  loginForm?.addEventListener('submit', handleAdminLogin);
  btnViewShop?.addEventListener('click', handleAdminViewShop);
  btnLogout?.addEventListener('click', handleAdminLogout);
  adminActionMenuBtn?.addEventListener('click', toggleAdminActionMenu);
  document.addEventListener('click', (event) => {
    const isInsideMenu = event.target.closest?.('#admin-action-menu') || event.target.closest?.('#admin-action-menu-btn');
    if (!isInsideMenu) closeAdminActionMenu();
  });
  resetFormBtn?.addEventListener('click', resetAdminForm);
  resetCatBtn?.addEventListener('click', resetAdminCatForm);
  saveCatBtn?.addEventListener('click', handleAdminSaveCategory);
  categoryImageUrl?.addEventListener('input', updateCategoryImagePreview);
  categoryImageBrowse?.addEventListener('click', () => {
    categoryImageFile?.click();
  });
  categoryImageFile?.addEventListener('change', () => {
    updateCategoryImagePreview();
  });
  productImageUrl?.addEventListener('input', updateImagePreview);
  productImageBrowse?.addEventListener('click', () => {
    productImageFile?.click();
  });
  productImageFile?.addEventListener('change', () => {
    updateImagePreview();
  });
  document.getElementById('admin-prod-category')?.addEventListener('change', updateProductIdDisplay);
  productForm?.addEventListener('submit', handleAdminAddProduct);
  saveShippingChargeBtn?.addEventListener('click', handleAdminSaveShippingCharge);

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activateAdminTab(tab.dataset.tab);
      if (tab.dataset.tab === 'orders') {
        fetchAdminOrders();
      }
    });
  });

  document.getElementById('admin-search-prod')?.addEventListener('input', renderAdminInventory);
  document.getElementById('admin-filter-cat')?.addEventListener('change', renderAdminInventory);
  document.getElementById('admin-filter-type')?.addEventListener('change', event => {
    renderAdminFilterValueControl(event.target.value);
    applyAdminOrderFilters();
  });
  document.getElementById('admin-filter-clear')?.addEventListener('click', clearAdminOrderFilters);
}

async function initAdminPage() {
  bindAdminEvents();
  parseAdminHashEdit();

  if (state.token && state.user?.role === 'admin') {
    showDashboard();
    return;
  }

  if (state.token) {
    try {
      const user = await authApi.getMe();
      state.user = user;
      if (user.role === 'admin') {
        showDashboard();
        return;
      }
    } catch (err) {
      clearAuth();
    }
  }

  showLoginPanel();
}

async function handleAdminLogin(event) {
  event.preventDefault();
  clearAuthError();

  const email = document.getElementById('admin-auth-email').value.trim();
  const password = document.getElementById('admin-auth-password').value;

  if (!email || !password) {
    renderAuthError('Please provide both email and password.');
    return;
  }

  try {
    const data = await authApi.adminLogin(email, password);
    saveAuth(data.token, data.user);
    if (data.user.role !== 'admin') {
      renderAuthError('You are not authorized for admin access.');
      clearAuth();
      return;
    }
    clearAuthError();
    state.user = data.user;
    showDashboard();
  } catch (err) {
    renderAuthError(err.message || 'Login failed.');
  }
}

function handleAdminLogout() {
  clearAuth();
  window.location.href = '/';
}

function activateAdminTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
  document.querySelectorAll('.admin-tab-content').forEach(content => content.classList.toggle('active', content.id === `admin-content-${tabName}`));
}

async function fetchDashboardData() {
  await Promise.all([fetchCategories(), fetchAdminInventory(), fetchAdminOrders(), fetchAdminCategories(), fetchShippingSettings()]);
}

async function fetchShippingSettings() {
  try {
    const res = await fetch(`${API_BASE}/orders/shipping-settings`);
    if (!res.ok) throw new Error('Unable to load shipping settings');
    const data = await res.json();
    if (shippingChargeInput) {
      shippingChargeInput.value = Number(data.shipping_charge || 0).toFixed(0);
    }
  } catch (error) {
    console.warn('Shipping settings fetch failed:', error);
  }
}

async function handleAdminSaveShippingCharge() {
  if (!shippingChargeInput) return;
  const charge = Number(shippingChargeInput.value);
  if (Number.isNaN(charge) || charge < 0) {
    alert('Please enter a valid non-negative shipping charge.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/orders/shipping-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ shipping_charge: charge })
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Unable to save shipping charge');
    }

    const data = await res.json();
    alert(`Shipping charge updated to ₹${Number(data.shipping_charge || 0).toFixed(0)}.`);
  } catch (err) {
    console.error('Save shipping charge failed:', err);
    alert(err.message || 'Failed to save shipping charge.');
  }
}

async function fetchCategories() {
  try {
    const res = await fetch(`${API_BASE}/categories`);
    if (!res.ok) throw new Error('Failed to load categories');
    const categories = await res.json();
    _adminCategories = categories;
    populateCategorySelects(categories);
  } catch (err) {
    console.error('Admin categories fetch failed', err);
  }
}

function populateCategorySelects(categories) {
  const filterSelect = document.getElementById('admin-filter-cat');
  if (filterSelect) {
    filterSelect.innerHTML = `<option value="all">All Categories</option>` + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  const productCategory = document.getElementById('admin-prod-category');
  if (productCategory) {
    productCategory.innerHTML = `<option value="">Select category</option>` + categories
      .map(c => `<option value="${c.id}" data-category-uid="${c.category_id || c.categoryId || ''}">${c.name}</option>`)
      .join('');
    updateProductIdDisplay();
  }
}

function generateCategoryUid() {
  const existingIds = _adminCategories
    .map(c => c.category_id || c.categoryId)
    .filter(Boolean)
    .map(uid => {
      const match = String(uid).match(/^spore-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });
  const maxValue = existingIds.length ? Math.max(...existingIds) : 0;
  return `spore-${String(maxValue + 1).padStart(6, '0')}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateProductId(categoryUid) {
  if (!categoryUid) return '';
  const existingIds = _adminProducts
    .filter(p => p.category === document.getElementById('admin-prod-category')?.value)
    .map(p => {
      const regex = new RegExp(`^${escapeRegExp(categoryUid)}-pid-(\\d+)$`);
      const match = String(p.id).match(regex);
      return match ? parseInt(match[1], 10) : 0;
    });
  const nextNumber = existingIds.length ? Math.max(...existingIds) + 1 : 1;
  return `${categoryUid}-pid-${String(nextNumber).padStart(5, '0')}`;
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
    if (url.startsWith('//')) url = 'https:' + url;
    else if (!/^https?:\/\//i.test(url) && url.indexOf('.') !== -1) url = 'https://' + url;

    const img = new Image();
    let handled = false;
    img.onload = () => {
      if (handled) return; handled = true;
      categoryImagePreview.innerHTML = `<img src="${url}" alt="Preview">`;
    };
    img.onerror = () => {
      if (handled) return; handled = true;
      categoryImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Failed to load image from URL</span>';
    };
    // Start loading
    try { img.src = url; }
    catch (e) {
      categoryImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span style="color:var(--color-danger)">Invalid image URL</span>';
    }
    return;
  }

  // Default placeholder
  categoryImagePreview.innerHTML = '<i class="fa-solid fa-image"></i><span>Category image preview</span>';
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
    console.error('Admin inventory fetch error:', err);
    if (grid) {
      grid.innerHTML = `<p style="color:#e74c3c; padding:1rem;">Failed to synchronize active inventory directory.</p>`;
    }
  }
}

function renderAdminInventory() {
  const grid = document.getElementById('admin-inventory-grid');
  if (!grid) return;

  const query = (document.getElementById('admin-search-prod')?.value || '').toLowerCase();
  const category = document.getElementById('admin-filter-cat')?.value || 'all';

  let products = _adminProducts;
  if (category !== 'all') products = products.filter(p => p.category === category);
  if (query) products = products.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(query));

  if (!products.length) {
    grid.innerHTML = '<div class="admin-loading">No products found.</div>';
    return;
  }

  grid.innerHTML = `
    <div class="admin-product-grid">
      ${products.map(p => {
        const stockClass = p.stock === 0 ? 'out-stock' : p.stock < 20 ? 'low-stock' : 'in-stock';
        const stockLabel = p.stock === 0 ? 'Out of Stock' : p.stock < 20 ? `Low: ${p.stock}` : `${p.stock} units`;
        const categoryObj = _adminCategories.find(c => c.id === p.category);
        const categoryName = categoryObj ? categoryObj.name : 'Unknown';
        const categoryId = categoryObj ? (categoryObj.category_id || categoryObj.categoryId || '') : '';
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
      }).join('')}
    </div>
  `;
}

function adminEditProduct(productId) {
  const product = _adminProducts.find(item => item.id === productId);
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
  if (preview) preview.innerHTML = `<img src="${product.image_url}" alt="Preview">`;

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
  const selectedCategoryUid = document.getElementById('admin-prod-category')?.selectedOptions?.[0]?.dataset?.categoryUid || '';
  let productId = productIdDisplay?.value.trim() || '';
  const productImageUrlValue = productImageUrl?.value.trim() || '';
  const imageFile = productImageFile?.files?.[0];
  let image_url = productImageUrlValue;

  try {
    const expectedPrefix = selectedCategoryUid ? `${selectedCategoryUid}-pid-` : '';
    if (!productId || (expectedPrefix && !productId.startsWith(expectedPrefix))) {
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
    const url = editId ? `${API_BASE}/products/${editId}` : `${API_BASE}/products`;
    const body = {
      name,
      category,
      description,
      price: numericPrice,
      mrp_price: numericMrp,
      gst_rate: parseInt(gst_rate, 10),
      stock: parseInt(stock, 10),
      image_url
    };
    if (!editId) {
      body.id = productId;
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      showSuccessToast(editId ? '✅ Product updated successfully!' : '✅ Product published successfully!');
      resetAdminForm();
      fetchAdminInventory();
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
  if (list) list.innerHTML = `<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading orders...</div>`;
  try {
    const res = await fetch(`${API_BASE}/orders/all-orders`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Failed to load orders');
    const orders = await res.json();
    if (statOrders) statOrders.textContent = orders.length;
    adminOrdersCache = orders;
    renderAdminOrders(orders);
  } catch (err) {
    console.error('Fetch admin orders error:', err);
    if (list) list.innerHTML = '<div class="admin-loading" style="color:#e74c3c;"><i class="fa-solid fa-triangle-exclamation"></i> Could not load orders.</div>';
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
    delivered: 'Delivered'
  };

  wrap.innerHTML = orders.map(o => {
    const date = new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const customerName = o.customer_name || o.user_email || 'Customer';
    const phone = o.delivery_phone || 'Not specified';
    const address = o.delivery_address || 'Address not provided';
    const itemRows = Array.isArray(o.items) ? o.items.map(item => `
          <li>${item.name} × ${item.quantity}</li>
        `).join('') : '';
    const productDisplay = o.items && o.items.length > 1 ? `
      <details class="admin-order-items">
        <summary>${o.items.length} products</summary>
        <ul>${itemRows}</ul>
      </details>
    ` : `
      <div class="admin-order-items-single">${itemRows}</div>
    `;

    const currentStage = statusSteps.indexOf(o.delivery_status || 'pending');
    const progressSteps = statusSteps.map((step, index) => `
      <div class="admin-progress-step ${step} ${index <= currentStage ? 'active' : ''}">
        <span>${statusLabels[step]}</span>
      </div>
      ${index < statusSteps.length - 1 ? '<div class="admin-progress-connector"></div>' : ''}
    `).join('');
    const invoiceLink = o.invoice_token ? `${window.location.origin}/api/orders/share/${o.invoice_token}` : '';

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
            ${o.delivery_status === 'cancelled' ? `
              <div class="admin-order-cancelled-note">
                <div class="admin-order-cancelled-label">Cancelled</div>
                <div class="admin-order-cancelled-reason">${o.cancel_reason || 'Reason not provided'}</div>
              </div>
            ` : `
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
            `}
            <div class="admin-order-summary-block">
              <div><span>Order total</span><strong>₹${o.total.toFixed(2)}</strong></div>
              <div><span>Payment mode</span><strong>${o.payment_method || (o.razorpay_order_id ? 'Razorpay' : 'Pending')}</strong></div>
              <div><span>Transaction</span><strong>${o.transaction_id || o.razorpay_payment_id || 'Pending'}</strong></div>
              <div><span>Customer</span><strong>${customerName}</strong></div>
            </div>
            ${invoiceLink ? `
              <div class="admin-order-summary-block" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-secondary" onclick="window.open('${invoiceLink}','_blank')">Open Invoice</button>
                <button class="btn btn-secondary" onclick="window.copyInvoiceLink('${o.invoice_token}')">Copy Link</button>
              </div>
            ` : ''}
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
  }).join('');
}

async function adminUpdateShipping(orderId, status) {
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ delivery_status: status })
    });
    if (!res.ok) throw new Error('Failed');
    showSuccessToast(`📦 Shipment status updated to "${status}"`);
    fetchAdminOrders();
  } catch (err) {
    alert('Failed to update shipping status.');
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
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', applyAdminOrderFilters);
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

  const filtered = adminOrdersCache.filter(order => {
    const changedAt = new Date(order.updated_at || order.created_at);
    const normalizedValue = value.toLowerCase();

    switch (filterType) {
      case 'modified_date':
        return value ? changedAt.toDateString() === new Date(value).toDateString() : true;
      case 'year':
        return value ? String(changedAt.getFullYear()) === value : true;
      case 'month':
        return value ? String(changedAt.getMonth() + 1).padStart(2, '0') === value : true;
      case 'order_id':
        return value ? order.id.toLowerCase().includes(normalizedValue) : true;
      case 'phone':
        return value ? (order.delivery_phone || '').replace(/\D/g, '').includes(value.replace(/\D/g, '')) : true;
      case 'status':
        return value ? order.delivery_status === value : true;
      case 'payment_method':
        const method = (order.payment_method || (order.razorpay_order_id ? 'Razorpay' : 'Pending') || '').toLowerCase();
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
  const reasonSelect = document.getElementById(`admin-cancel-reason-${orderId}`);
  if (!reasonSelect) return;

  let reason = reasonSelect.value;
  if (!reason) {
    alert('Please select a cancellation reason.');
    return;
  }

  if (reason === 'Other') {
    const otherText = document.getElementById(`admin-cancel-other-${orderId}`);
    if (!otherText || !otherText.value.trim()) {
      alert('Please specify a cancellation reason.');
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
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ reason })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || 'Cancellation failed');
    }

    showSuccessToast('❌ Order cancelled successfully.');
    fetchAdminOrders();
  } catch (err) {
    alert(err.message || 'Failed to cancel order.');
  }
}

async function adminDeleteProduct(productId) {
  if (!confirm('Are you sure you want to permanently delete this product from the inventory?')) return;

  try {
    const res = await fetch(`${API_BASE}/products/${productId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (res.ok) {
      showSuccessToast('🗑️ Product successfully deleted.');
      fetchAdminInventory();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to remove item.');
    }
  } catch (err) {
    console.error('Admin delete product error:', err);
    alert('Server communication error.');
  }
}

async function fetchAdminCategories() {
  const list = document.getElementById('admin-categories-list');
  if (list) list.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading categories...</div>';
  try {
    const res = await fetch(`${API_BASE}/categories`);
    if (!res.ok) throw new Error('Failed to load categories');
    const categories = await res.json();
    _adminCategories = categories;
    resetAdminCatForm();
    renderAdminCategoriesList(categories);
  } catch (err) {
    if (list) list.innerHTML = '<div class="admin-loading" style="color:#e74c3c;">Failed to load categories.</div>';
  }
}

function renderAdminCategoriesList(categories) {
  const list = document.getElementById('admin-categories-list');
  if (!list) return;
  if (!categories.length) {
    list.innerHTML = '<div class="admin-loading">No categories found. Add one above.</div>';
    return;
  }

  list.innerHTML = categories.map(cat => `
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
  `).join('');
}

function adminEditCategory(catId) {
  activateAdminTab('categories');
  const category = _adminCategories.find(c => c.id === catId);
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

  // Force auto-generation of category UID for new categories
  if (!editId) {
    categoryId = generateCategoryUid();
    if (categoryUidInput) categoryUidInput.value = categoryId;
  }

  // Client-side uniqueness checks: slug (id), name, and category UID must be unique
  if (_adminCategories && _adminCategories.length) {
    const slugConflict = _adminCategories.some(c => c.id === id && c.id !== editId);
    const nameConflict = _adminCategories.some(c => (c.name || '').toLowerCase() === name.toLowerCase() && c.id !== editId);
    const uidConflict = _adminCategories.some(c => ((c.category_id || c.categoryId) === categoryId) && c.id !== editId);

    if (slugConflict || nameConflict || uidConflict) {
      const parts = [];
      if (slugConflict) parts.push('Slug already exists');
      if (nameConflict) parts.push('Name already exists');
      if (uidConflict) parts.push('Category UID conflict (regenerating)');

      if (uidConflict) {
        // regenerate UID until unique
        let attempts = 0;
        while ((_adminCategories.some(c => ((c.category_id || c.categoryId) === categoryId) && c.id !== editId)) && attempts < 20) {
          categoryId = generateCategoryUid();
          attempts += 1;
        }
        if (categoryUidInput) categoryUidInput.value = categoryId;
      }

      if (slugConflict || nameConflict) {
        if (feedback) {
          feedback.textContent = parts.join(' · ') + '.';
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
    const url = editId ? `${API_BASE}/categories/${editId}` : `${API_BASE}/categories`;
    const body = editId
      ? { name, description, image_url: imageUrl }
      : { category_id: categoryId, id, name, description, image_url: imageUrl };

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
      fetchCategories();
      // Notify other tabs (landing page) to refresh categories
      try { bcCategories?.postMessage({ type: 'categories:updated' }); } catch (e) { /* ignore */ }
    } else {
      if (feedback) {
        feedback.textContent = data.error || 'Failed to save category.';
        feedback.classList.remove('hidden');
        feedback.style.color = 'var(--color-danger)';
      }
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
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete category.');
    }

    showSuccessToast('✅ Category removed successfully.');
    fetchAdminCategories();
    fetchCategories();
  } catch (err) {
    alert(err.message || 'Unable to delete category.');
  }
}

function resetAdminForm() {
  productForm?.reset();
  document.getElementById('admin-edit-id').value = '';
  if (productIdDisplay) productIdDisplay.value = '';
  if (productImageUrl) productImageUrl.value = '';
  if (productImageFile) productImageFile.value = '';
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
  const file = productImageFile?.files?.[0];
  const url = productImageUrl?.value.trim();
  renderUploadPreview(preview, file, url, 'Image preview');
}

function showSuccessToast(message) {
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

  if (!document.getElementById('toast-keyframes')) {
    const style = document.createElement('style');
    style.id = 'toast-keyframes';
    style.textContent = `@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(20px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

window.adminEditProduct = adminEditProduct;
window.adminDeleteProduct = adminDeleteProduct;
window.adminUpdateShipping = adminUpdateShipping;
window.adminToggleCancelReason = adminToggleCancelReason;
window.adminCancelOrder = adminCancelOrder;
window.adminEditCategory = adminEditCategory;
window.adminDeleteCategory = adminDeleteCategory;

function copyInvoiceLink(token) {
  if (!token) return;
  const invoiceUrl = `${window.location.origin}/api/orders/share/${token}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(invoiceUrl)
      .then(() => alert('Invoice share link copied to clipboard.'))
      .catch(() => alert('Could not copy invoice link.'));
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = invoiceUrl;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    alert('Invoice share link copied to clipboard.');
  }
}
window.copyInvoiceLink = copyInvoiceLink;

initAdminPage();
