import { state, saveUserProfile, deleteUserProfile, saveCart } from '../utils/state.js';
import { fetchWithAuth, API_BASE, getApiErrorMessage } from '../api/client.js';
import { showErrorToast, showSuccessToast, showConfirmModal } from '../utils/notify.js';
import { isValidIndianPhone, isValidEmail, isValidPincode, getFieldError } from '../utils/validation.js';
import { locationApi } from '../api/locationApi.js';

let _pmStatesCache = [];
let _pmCitiesCache = {};

async function _pmLoadStates() {
  try {
    _pmStatesCache = await locationApi.getStates();
  } catch {
    _pmStatesCache = [];
  }
}

async function _pmLoadCities(state) {
  if (!state) return [];
  if (_pmCitiesCache[state]) return _pmCitiesCache[state];
  try {
    const cities = await locationApi.getCities(state);
    _pmCitiesCache[state] = cities;
    return cities;
  } catch {
    return [];
  }
}

function _resizeImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

class ProfileModal {
  constructor() {
    this.modal = null;
  }

  async open(initialTab = 'details') {
    this.close();
    this.initialTab = initialTab;
    this.modal = document.createElement('div');
    this.modal.className = 'modal-overlay open';
    this.modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:10000;padding:18px;';
    const u = state.user || {};
    this.modal.innerHTML = `
      <div class="pm-card">
        <div class="pm-head">
          <div class="pm-head-left">
            <div class="pm-avatar-sm">
              <img id="pm-avatar-img" src="${u.avatarUrl || '/images/default_avatar.png'}" onerror="this.src='/images/default_avatar.png'" />
            </div>
            <div>
              <div class="pm-head-name">${u.fullName || 'My Account'}</div>
              <div class="pm-head-sub">${u.email || u.whatsappNumber || 'Manage your profile'}</div>
            </div>
          </div>
          <div class="pm-head-right">
            <button id="btn-profile-close" class="pm-btn pm-btn-sm pm-btn-ghost"><i class="fa-solid fa-store"></i> Shop</button>
            <button id="btn-profile-logout" class="pm-btn pm-btn-sm pm-btn-ghost" title="Logout"><i class="fa-solid fa-right-from-bracket"></i></button>
          </div>
        </div>
        <div id="profile-main"></div>
      </div>
    `;

    document.body.appendChild(this.modal);

    // close when clicking outside the card
    this._overlayClickHandler = (ev) => {
      if (!this.modal) return;
      const card = this.modal.querySelector('.pm-card');
      if (card && !card.contains(ev.target)) this.close();
    };
    this.modal.addEventListener('click', this._overlayClickHandler);

    // close on ESC
    this._escHandler = (ev) => {
      if (ev.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this._escHandler);

    document
      .getElementById('btn-profile-close')
      ?.addEventListener('click', () => this.close());
    document
      .getElementById('btn-profile-logout')
      ?.addEventListener('click', () => this.logout());
    document
      .getElementById('btn-profile-logout')
      ?.addEventListener('click', () => this.logout());

    this.renderProfile();
    this.renderOrders();
    this.startPollingOrders();
    this._addOrdersListener();
  }

  close() {
    // cleanup listeners first
    if (this._overlayClickHandler && this.modal) this.modal.removeEventListener('click', this._overlayClickHandler);
    if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
    this.stopPollingOrders();
    this._removeOrdersListener();
    if (this.modal && this.modal.parentElement) this.modal.parentElement.removeChild(this.modal);
    this.modal = null;
  }

  _addOrdersListener() {
    this._removeOrdersListener();
    this._ordersRefreshHandler = () => {
      if (!this.modal) return;
      if (this.activeTab === 'orders' || this.activeTab === 'recent') {
        this.renderOrders(true);
      }
    };
    window.addEventListener('orders:refreshed', this._ordersRefreshHandler);
  }

  _removeOrdersListener() {
    if (this._ordersRefreshHandler) {
      window.removeEventListener('orders:refreshed', this._ordersRefreshHandler);
      this._ordersRefreshHandler = null;
    }
  }

  startPollingOrders() {
    this.stopPollingOrders();
    this._pollInterval = setInterval(() => this.renderOrders(true), 8000);
  }

  stopPollingOrders() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  logout() {
    // Use existing global logout if available
    if (window.logout) window.logout();
    else {
      deleteUserProfile();
      window.dispatchEvent(new Event('auth:changed'));
    }
    this.close();
  }

  async renderProfile() {
    const container = this.modal.querySelector('#profile-main');

    let tabsContainer = this.modal.querySelector('.pm-tabs');
    if (!tabsContainer) {
      tabsContainer = document.createElement('div');
      tabsContainer.className = 'pm-tabs';
      tabsContainer.innerHTML = `
        <button class="pm-tab active" data-tab="details"><i class="fa-solid fa-user"></i> Details</button>
        <button class="pm-tab" data-tab="orders"><i class="fa-solid fa-box"></i> Orders</button>
        <button class="pm-tab" data-tab="recent"><i class="fa-solid fa-clock-rotate-left"></i> Recent</button>
        <button class="pm-tab" data-tab="quick_actions"><i class="fa-solid fa-bolt"></i> Actions</button>
      `;
      container.parentNode.insertBefore(tabsContainer, container);

      tabsContainer.querySelectorAll('.pm-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          tabsContainer.querySelectorAll('.pm-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.activeTab = btn.dataset.tab;
          this.renderTabContent();
        });
      });
      this.activeTab = this.initialTab || 'details';

      const activeBtn = tabsContainer.querySelector(`[data-tab="${this.activeTab}"]`);
      if (activeBtn) {
        tabsContainer.querySelectorAll('.pm-tab').forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
      }
    }
    this.renderTabContent();
  }

  renderTabContent() {
    const container = this.modal.querySelector('#profile-main');
    const user = state.user || {};
    const loginMethod = user.loginMethod || (user.whatsappNumber ? 'phone' : user.email ? 'email' : 'guest');

    if (this.activeTab === 'details') {
      container.innerHTML = `
        <section class="pm-section">
          <div class="pm-user-card">
            <div class="pm-user-card-avatar">
              <div class="pm-avatar-wrap" onclick="document.getElementById('avatar-upload').click()">
                <img id="profile-avatar-img" src="${user.avatarUrl || '/images/default_avatar.png'}" onerror="this.src='/images/default_avatar.png'">
                <div class="pm-avatar-overlay"><i class="fa-solid fa-camera"></i></div>
              </div>
              <input type="file" id="avatar-upload" accept="image/*" style="display:none" onchange="window.profileModal.handleAvatarChange(event)">
            </div>
            <div class="pm-user-card-info">
              <h3>Welcome back, ${user.fullName || 'Sporekart user'}</h3>
              <div class="pm-user-card-meta">
                <span><i class="fa-solid fa-envelope"></i> ${user.email || 'No email'}</span>
                <span class="pm-dot">·</span>
                <span><i class="fa-solid fa-phone"></i> ${user.whatsappNumber || 'No phone'}</span>
                <span class="pm-dot">·</span>
                <span class="pm-role-badge">${(user.role || 'buyer').toUpperCase()}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="pm-section">
          <div class="pm-section-head">
            <i class="fa-solid fa-pen-to-square pm-section-icon"></i>
            <h4>Personal Information</h4>
          </div>
          <div class="pm-grid-2">
            <div class="pm-field">
              <label>Full name <i class="fa-solid fa-lock" style="font-size:0.6rem;color:#94a3b8;margin-left:4px;"></i></label>
              <div class="pm-static-value"><i class="fa-solid fa-user"></i> ${user.fullName || '—'}</div>
            </div>
            <div class="pm-field">
              <label>Email <i class="fa-solid fa-lock" style="font-size:0.6rem;color:#94a3b8;margin-left:4px;"></i></label>
              <div class="pm-static-value"><i class="fa-solid fa-envelope"></i> ${user.email || '—'}</div>
            </div>
            <div class="pm-field">
              <label>Phone <i class="fa-solid fa-lock" style="font-size:0.6rem;color:#94a3b8;margin-left:4px;"></i></label>
              <div class="pm-static-value"><i class="fa-solid fa-phone"></i> ${user.whatsappNumber || '—'}</div>
            </div>
            <div class="pm-field">
              <label>Role</label>
              <div class="pm-static-value"><span class="pm-role-badge" style="font-size:0.78rem;">${(user.role || 'buyer').toUpperCase()}</span></div>
            </div>
          </div>
        </section>

        <section class="pm-section">
          <div class="pm-section-head">
            <i class="fa-solid fa-location-dot pm-section-icon"></i>
            <h4>Delivery Address</h4>
          </div>
          <div class="pm-grid-2">
            <div class="pm-field pm-field-full">
              <label>Address Line 1 <span class="pm-req">*</span></label>
              <input id="profile-address-line1" value="${user.addressLine1 || ''}" class="pm-input" placeholder="House/Flat No, Building, Street">
            </div>
            <div class="pm-field pm-field-full">
              <label>Address Line 2 <span class="pm-req">*</span></label>
              <input id="profile-address-line2" value="${user.addressLine2 || ''}" class="pm-input" placeholder="Area, Sector, Locality">
            </div>
            <div class="pm-field">
              <label>Landmark <span class="pm-req">*</span></label>
              <input id="profile-landmark" value="${user.landmark || ''}" class="pm-input" placeholder="Near XYZ">
            </div>
            <div class="pm-field">
              <label>Pincode <span class="pm-req">*</span></label>
              <input id="profile-pincode" value="${user.defaultPincode || ''}" class="pm-input">
            </div>
            <div class="pm-field">
              <label>State <span class="pm-req">*</span></label>
              <select id="profile-state" class="pm-input"></select>
            </div>
            <div class="pm-field">
              <label>City <span class="pm-req">*</span></label>
              <select id="profile-city" class="pm-input"></select>
            </div>
          </div>
          <div class="pm-form-actions">
            <button id="btn-save-profile" class="pm-btn pm-btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
          </div>
        </section>

        <section class="pm-section">
          <div class="pm-section-head">
            <i class="fa-solid fa-cart-shopping pm-section-icon"></i>
            <h4>Current Cart</h4>
          </div>
          <div id="profile-cart" class="pm-cart"></div>
        </section>
      `;
      this.modal.querySelector('#btn-save-profile')?.addEventListener('click', () => this.saveProfile());
      this.renderCart();
      this.initAddressDropdownsAndPincode();
    } else if (this.activeTab === 'orders') {
      container.innerHTML = `
        <section class="pm-section">
          <div class="pm-section-head">
            <i class="fa-solid fa-box-open pm-section-icon"></i>
            <h4>Active Orders</h4>
          </div>
          <div id="profile-active-orders" class="pm-orders-list"></div>
        </section>
      `;
      this.renderOrdersList('#profile-active-orders', false);
    } else if (this.activeTab === 'recent') {
      container.innerHTML = `
        <section class="pm-section">
          <div class="pm-section-head">
            <i class="fa-solid fa-clock-rotate-left pm-section-icon"></i>
            <h4>Recent Orders</h4>
          </div>
          <div id="profile-recent-orders" class="pm-orders-list"></div>
        </section>
      `;
      this.renderOrdersList('#profile-recent-orders', true);
    } else if (this.activeTab === 'quick_actions') {
      container.innerHTML = `
        <section class="pm-section">
          <div class="pm-section-head">
            <i class="fa-solid fa-bolt pm-section-icon"></i>
            <h4>Quick Actions</h4>
          </div>
          <div class="pm-actions-grid">
            <button id="tab-btn-view-orders" class="pm-action-btn"><i class="fa-solid fa-arrows-rotate"></i> <span>Refresh Orders</span></button>
            <button id="tab-btn-clear-local" class="pm-action-btn"><i class="fa-solid fa-broom"></i> <span>Clear Local Profile</span></button>
            <button id="tab-btn-delete-account" class="pm-action-btn pm-action-btn-danger"><i class="fa-solid fa-trash-can"></i> <span>Delete Account</span></button>
          </div>
        </section>
      `;

      this.modal.querySelector('#tab-btn-view-orders')?.addEventListener('click', () => this.renderOrders(true));
      this.modal.querySelector('#tab-btn-clear-local')?.addEventListener('click', () => {
        deleteUserProfile();
        window.dispatchEvent(new Event('auth:changed'));
        this.close();
      });
      this.modal.querySelector('#tab-btn-delete-account')?.addEventListener('click', () => this.handleDelete());
    }
  }

  // (intentionally removed duplicate; implemented below)

  renderCart() {
    const el = this.modal.querySelector('#profile-cart');
    if (!el) return;
    if (!state.cart || !state.cart.length) {
      el.innerHTML = '<div class="pm-cart-empty">No items in cart.</div>';
      return;
    }
    el.innerHTML = state.cart
      .map(
        (i) => `<div class="pm-cart-item"><img src="${i.image_url || '/images/product_fresh.png'}"><div><div class="pm-cart-item-name">${i.name}</div><div class="pm-cart-item-price">₹${(i.price || 0).toFixed(2)} × ${i.quantity}</div></div></div>`,
      )
      .join('');
  }

  async renderOrders(forceRefresh = false) {
    try {
      let orders = state.orders || [];
      if (state.token && (forceRefresh || !orders.length)) {
        // fetch user's orders from API
        orders = await fetchWithAuth('/orders/my-orders');
        state.orders = orders;
      }
      if (this.activeTab === 'orders' || this.activeTab === 'recent') {
        this.renderTabContent();
      }
    } catch (err) {
      console.error(err);
    }
  }

  renderOrdersList(selector, isRecent) {
    const el = this.modal.querySelector(selector);
    if (!el) return;

    let orders = state.orders || [];

    let filteredOrders = orders.filter(o => {
      const status = o.delivery_status || o.status || 'pending';
      const isCompleted = ['delivered', 'cancelled'].includes(status);
      return isRecent ? isCompleted : !isCompleted;
    });

    if (!filteredOrders.length) {
      el.innerHTML = `<div>No ${isRecent ? 'recent' : 'active'} orders.</div>`;
      return;
    }

    el.innerHTML = filteredOrders
      .slice(0, 15)
      .map((o) => this.renderOrderCard(o, isRecent))
      .join('');
  }

  renderOrderCard(o, isRecent = false) {
    const placed = new Date(
      o.created_at || o.createdAt || o.orderedAt || Date.now(),
    ).toLocaleString();
    const status = o.delivery_status || o.status || 'pending';
    const totalValue = o.total != null ? o.total : (o.order_total != null ? o.order_total : (o.amount || 0));
    const total = Number(totalValue).toFixed(2);
    const trackingHtml = this.renderTrackingTimeline(o);
    const shareLink = o.invoice_token
      ? `${window.location.origin}/api/orders/share/${o.invoice_token}`
      : '';
    const cancelNote = o.delivery_status === 'cancelled' && o.cancel_reason
      ? `<div class="pm-cancel-note"><strong>Cancellation reason:</strong> ${o.cancel_reason}</div>`
      : '';
    const terminalStates = ['CANCEL_REQUESTED', 'CANCEL_APPROVED', 'CANCEL_REJECTED', 'cancelled', 'refunded'];
    const canCancelAlloweDelivery = ['placed', 'processing', 'paid', 'inoculating', 'pending', 'pending_upi_verification'];
    const canCancel = canCancelAlloweDelivery.includes(status) &&
      !terminalStates.includes(o.status) &&
      !o.status.startsWith('REFUND_');

    const refundStates = ['CANCEL_REQUESTED', 'CANCEL_APPROVED', 'CANCEL_REJECTED', 'REFUND_PENDING', 'REFUND_INITIATED', 'REFUND_PROCESSING', 'REFUND_COMPLETED', 'REFUND_FAILED', 'MANUAL_REFUND_INITIATED', 'MANUAL_REFUND_COMPLETED'];
    const isRefundOrder = refundStates.includes(o.status) || (o.status === 'cancelled' && o.refund_status && o.refund_status !== 'none');

    let refundPill = '';
    if (o.status === 'CANCEL_REQUESTED') {
      refundPill = `<div class="pm-refund-pill warning"><i class="fa-solid fa-clock"></i> Cancellation pending admin approval — For queries: <a href="mailto:support@sporekart.com" style="color:#d97706;text-decoration:underline;">support@sporekart.com</a></div>`;
    } else if (o.status === 'CANCEL_APPROVED') {
      refundPill = `<div class="pm-refund-pill info"><i class="fa-solid fa-check-circle"></i> Cancellation approved — manual refund tracking started</div>`;
    } else if (o.status === 'REFUND_PENDING') {
      refundPill = `<div class="pm-refund-pill info"><i class="fa-solid fa-hourglass-half"></i> Refund pending — For queries: <a href="mailto:support@sporekart.com" style="color:#3b82f6;text-decoration:underline;">support@sporekart.com</a></div>`;
    } else if (o.status === 'REFUND_INITIATED' || o.status === 'REFUND_PROCESSING') {
      refundPill = `<div class="pm-refund-pill info"><i class="fa-solid fa-arrows-rotate fa-spin"></i> Refund in progress</div>`;
    } else if (o.status === 'REFUND_COMPLETED' || o.status === 'refunded') {
      refundPill = `<div class="pm-refund-pill success"><i class="fa-solid fa-circle-check"></i> Refund processed</div>`;
    } else if (o.status === 'REFUND_FAILED') {
      refundPill = `<div class="pm-refund-pill danger"><i class="fa-solid fa-circle-exclamation"></i> Refund failed — Contact <a href="mailto:support@sporekart.com" style="color:#ef4444;text-decoration:underline;">support@sporekart.com</a></div>`;
    } else if (o.status === 'CANCEL_REJECTED') {
      refundPill = `<div class="pm-refund-pill danger"><i class="fa-solid fa-circle-xmark"></i> Cancellation request rejected</div>`;
    } else if (o.status === 'MANUAL_REFUND_INITIATED') {
      refundPill = `<div class="pm-refund-pill info"><i class="fa-solid fa-hourglass-half"></i> Manual refund initiated — processing offline</div>`;
    } else if (o.status === 'MANUAL_REFUND_COMPLETED') {
      refundPill = `<div class="pm-refund-pill success"><i class="fa-solid fa-circle-check"></i> Manual refund completed</div>`;
    } else if (o.status === 'cancelled' && o.refund_status) {
      const refundLabel = o.refund_status.charAt(0).toUpperCase() + o.refund_status.slice(1);
      const refundIcon = o.refund_status === 'completed' ? 'fa-circle-check' : 'fa-hourglass-half';
      const pillClass = o.refund_status === 'completed' ? 'success' : o.refund_status === 'failed' ? 'danger' : 'info';
      refundPill = `<div class="pm-refund-pill ${pillClass}"><i class="fa-solid ${refundIcon}"></i> Refund: ${refundLabel} — Contact <a href="mailto:support@sporekart.com" style="color:inherit;text-decoration:underline;">support@sporekart.com</a> / +91 80 4991 3800</div>`;
    }

    let refundTimelineHtml = '';
    if (isRefundOrder) {
      refundTimelineHtml = this.renderRefundTimeline(o);
    }

    const items = Array.isArray(o.items) ? o.items : [];
    const itemsHtmlV2 = items.length
      ? `<div class="pm-order-items">${items
        .map((item) => `<div class="pm-order-item"><span>${item.name || item.product_name || 'Product'} × ${item.quantity || item.qty || 1}</span></div>`)
        .join('')}</div>`
      : '';

    const rs = o.refund_status;
    const barColor = o.status === 'CANCEL_REQUESTED' || o.status === 'CANCEL_APPROVED' || o.status === 'REFUND_PENDING' || o.status === 'REFUND_INITIATED' || o.status === 'REFUND_PROCESSING' || o.status === 'MANUAL_REFUND_INITIATED' ? '#f59e0b'
      : o.status === 'REFUND_COMPLETED' || o.status === 'refunded' || o.status === 'MANUAL_REFUND_COMPLETED' ? '#10b981'
      : o.status === 'REFUND_FAILED' || o.status === 'CANCEL_REJECTED' ? '#ef4444'
      : o.status === 'cancelled' && rs === 'completed' ? '#10b981'
      : o.status === 'cancelled' && rs ? '#f59e0b'
      : o.status === 'cancelled' ? '#6b7280'
      : o.status === 'delivered' ? '#059669'
      : o.status === 'shipped' || o.status === 'in_transit' ? '#3b82f6'
      : o.status === 'processing' || o.status === 'paid' ? '#8b5cf6'
      : '#d1d5db';

    return `<div class="pm-order pm-order-premium" style="border-left:4px solid ${barColor};">
      <div class="pm-order-top">
        <div class="pm-order-id">#${o.id || o.orderId}</div>
        <span class="pm-order-badge ${status}">${status}</span>
        <div class="pm-order-total">₹${total}</div>
      </div>
      <div class="pm-order-meta">
        <i class="fa-regular fa-calendar"></i> ${placed}
        <span class="pm-dot">·</span>
        ${items.length} item${items.length !== 1 ? 's' : ''}
        ${o.fulfillment_status && !['cancelled','delivered'].includes(o.delivery_status) ? `<span class="pm-dot">·</span> <span class="pm-order-fulfillment">${o.fulfillment_status.replace(/_/g, ' ')}</span>` : ''}
        ${o.expected_delivery_date && ['shipped', 'in_transit'].includes(o.delivery_status) ? `<span class="pm-dot">·</span> <span class="pm-order-eta">Expected ${new Date(o.expected_delivery_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${o.delivery_days_text ? ' (' + o.delivery_days_text + ')' : ''}</span>` : ''}
      </div>
      ${itemsHtmlV2}
      ${trackingHtml}
      ${refundPill}
      ${refundTimelineHtml}
      ${cancelNote}
      <div class="pm-order-actions">
        ${['shipped', 'in_transit', 'delivered'].includes(status) ? `
          <button class="pm-action-btn-sm" onclick="window.viewInvoice('${o.id}')"><i class="fa-solid fa-file-invoice"></i> Invoice</button>
          ${shareLink ? `<button class="pm-action-btn-sm" data-share-url="${shareLink}" onclick="window.open(this.dataset.shareUrl,'_blank')"><i class="fa-solid fa-share-nodes"></i> Share</button><button class="pm-action-btn-sm" onclick="window.copyInvoiceLink('${o.invoice_token}')"><i class="fa-solid fa-link"></i> Copy</button>` : ''}
        ` : ''}
        ${canCancel ? `<button class="pm-action-btn-sm pm-action-btn-danger" onclick="window.cancelOrderFromProfile('${o.id}')"><i class="fa-solid fa-ban"></i> Cancel</button>` : ''}
        ${status === 'delivered' && !o.rating ? `<button class="pm-action-btn-sm pm-action-btn-primary" onclick="window.openReviewModal('${o.id}')"><i class="fa-solid fa-star"></i> Review</button>` : ''}
        ${isRecent ? `<button class="pm-action-btn-sm pm-action-btn-primary" onclick="window.orderAgainFromProfile('${o.id}')"><i class="fa-solid fa-rotate-right"></i> Reorder</button>` : ''}
      </div>
    </div>`;
  }

  renderRefundTimeline(o) {
    const steps = [];

    // Handle new manual refund flow (status=cancelled, tracked via refund_status)
    if (o.status === 'cancelled' && o.refund_status && o.refund_status !== 'none') {
      steps.push({ label: 'Cancellation Approved', done: true });
      steps.push({ label: 'Refund Pending', done: true });
      if (o.refund_status === 'initiated' || o.refund_status === 'processing' || o.refund_status === 'completed') {
        steps.push({ label: 'Refund Initiated', done: true });
      }
      if (o.refund_status === 'processing' || o.refund_status === 'completed') {
        steps.push({ label: 'Refund Processing', done: true });
      }
      if (o.refund_status === 'completed') {
        steps.push({ label: 'Refund Completed', done: true });
      }
      return this._buildTimelineHtml(steps);
    }

    if (o.status === 'CANCEL_REQUESTED' || o.status === 'CANCEL_APPROVED' || o.status === 'CANCEL_REJECTED' || o.status.startsWith('REFUND_') || o.status.startsWith('MANUAL_REFUND_')) {
      steps.push({ label: 'Cancellation Requested', done: o.status !== 'CANCEL_REJECTED' });
    }
    if (o.status === 'CANCEL_APPROVED' || o.status.startsWith('REFUND_') || o.status.startsWith('MANUAL_REFUND_')) {
      steps.push({ label: 'Cancellation Approved', done: true });
    }
    if (o.status === 'REFUND_PENDING') {
      steps.push({ label: 'Refund Pending', done: true });
    }
    if (o.status === 'REFUND_INITIATED' || o.status === 'REFUND_PROCESSING') {
      steps.push({ label: 'Refund Pending', done: true });
      steps.push({ label: 'Refund In Progress', done: true });
    }
    if (o.status === 'REFUND_COMPLETED' || o.status === 'refunded') {
      steps.push({ label: 'Refund Pending', done: true });
      steps.push({ label: 'Refund In Progress', done: true });
      steps.push({ label: 'Refund Completed', done: true });
    }
    if (o.status === 'MANUAL_REFUND_INITIATED') {
      steps.push({ label: 'Manual Refund Initiated', done: true });
    }
    if (o.status === 'MANUAL_REFUND_COMPLETED') {
      steps.push({ label: 'Manual Refund Initiated', done: true });
      steps.push({ label: 'Manual Refund Completed', done: true });
    }
    if (o.status === 'REFUND_FAILED') {
      steps.push({ label: 'Refund Failed', done: false });
    }
    if (o.status === 'CANCEL_REJECTED') {
      steps.push({ label: 'Cancellation Rejected', done: false });
    }

    if (!steps.length) return '';

    return this._buildTimelineHtml(steps);
  }

  _buildTimelineHtml(steps) {
    const lines = steps.map(s => `
      <div class="pm-timeline-row ${s.done ? 'pm-timeline-done' : ''}">
        <div class="pm-timeline-dot ${s.done ? 'done' : 'pending'}"></div>
        <div class="pm-timeline-label">${s.label}</div>
      </div>
    `).join('');

    return `
      <div class="pm-refund-progress">
        <div class="pm-refund-progress-title"><i class="fa-solid fa-rotate-left"></i> Refund Progress</div>
        <div class="pm-timeline">${lines}</div>
      </div>
    `;
  }

  renderTrackingTimeline(o) {
    const status = o.delivery_status || o.status || 'pending';
    const updatedAt = o.updated_at || o.updatedAt || null;
    const createdAt = o.created_at || o.createdAt || null;
    const deliveredAt = o.delivered_at || o.deliveredAt || null;
    const cancelledAt = o.cancelled_at || o.cancelledAt || null;
    const lines = [];
    if (createdAt) {
      lines.push({
        label: 'Order placed',
        time: new Date(createdAt).toLocaleString(),
        done: true,
      });
    }
    if (status === 'pending' || status === 'placed') {
      lines.push({
        label: 'Payment & processing',
        time: updatedAt ? new Date(updatedAt).toLocaleString() : '',
        done: status !== 'pending',
      });
    }
    if (status === 'paid' || status === 'processing' || status === 'CANCEL_REQUESTED' || status.startsWith('REFUND_') || status === 'CANCEL_APPROVED' || status === 'CANCEL_REJECTED') {
      lines.push({
        label: 'Payment confirmed',
        time: updatedAt ? new Date(updatedAt).toLocaleString() : '',
        done: true,
      });
    }
    if (status === 'CANCEL_REQUESTED') {
      lines.push({
        label: 'Cancellation requested',
        time: updatedAt ? new Date(updatedAt).toLocaleString() : '',
        done: true,
      });
    }
    if (status === 'CANCEL_REJECTED') {
      lines.push({
        label: 'Cancellation rejected',
        time: updatedAt ? new Date(updatedAt).toLocaleString() : '',
        done: true,
      });
    }
    if (status === 'shipped' || status === 'in_transit') {
      lines.push({
        label: 'Shipped',
        time: updatedAt ? new Date(updatedAt).toLocaleString() : '',
        done: ['shipped', 'in_transit'].includes(status),
      });
    }
    if (o.expected_delivery_date && (status === 'shipped' || status === 'in_transit')) {
      lines.push({
        label: 'Expected delivery',
        time: new Date(o.expected_delivery_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + (o.delivery_days_text ? ` (${o.delivery_days_text})` : ''),
        done: false,
      });
    }
    if (status === 'delivered') {
      lines.push({
        label: 'Delivered',
        time: deliveredAt
          ? new Date(deliveredAt).toLocaleString()
          : updatedAt
            ? new Date(updatedAt).toLocaleString()
            : '',
        done: true,
      });
    }
    if (status === 'cancelled' || status === 'CANCEL_APPROVED' || status === 'refunded' || status.startsWith('REFUND_') || status === 'MANUAL_REFUND_INITIATED' || status === 'MANUAL_REFUND_COMPLETED') {
      lines.push({
        label: status === 'REFUND_COMPLETED' || status === 'refunded' || status === 'MANUAL_REFUND_COMPLETED' ? 'Refund completed' : status.startsWith('REFUND_') || status === 'MANUAL_REFUND_INITIATED' ? 'Refund processing' : 'Cancelled',
        time: cancelledAt
          ? new Date(cancelledAt).toLocaleString()
          : updatedAt
            ? new Date(updatedAt).toLocaleString()
            : '',
        done: status === 'REFUND_COMPLETED' || status === 'refunded' || status === 'MANUAL_REFUND_COMPLETED',
      });
    }

    const html = `<div class="pm-timeline">${lines.map((l) => `<div class="pm-timeline-row ${l.done ? 'pm-timeline-done' : ''}"><div class="pm-timeline-dot ${l.done ? 'done' : 'pending'}"></div><div class="pm-timeline-label">${l.label}</div><div class="pm-timeline-time">${l.time || '—'}</div></div>`).join('')}</div>`;
    return html;
  }

  async handleAvatarChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showErrorToast('Image size should be less than 2MB');
      return;
    }

    try {
      const resizedBase64 = await _resizeImage(file, 300, 300);
      document.getElementById('profile-avatar-img').src = resizedBase64;
      this.tempAvatarData = resizedBase64;
    } catch (err) {
      showErrorToast('Failed to process image.');
    }
  }

  async initAddressDropdownsAndPincode() {
    const stateSelect = this.modal.querySelector('#profile-state');
    const citySelect = this.modal.querySelector('#profile-city');
    const pincodeInput = this.modal.querySelector('#profile-pincode');
    if (!stateSelect || !citySelect || !pincodeInput) return;

    await _pmLoadStates();

    stateSelect.innerHTML = '<option value="">Select State</option>';
    _pmStatesCache.forEach(state => {
      const opt = document.createElement('option');
      opt.value = state;
      opt.textContent = state;
      stateSelect.appendChild(opt);
    });

    const updateCities = async (stateVal, defaultCity = '') => {
      citySelect.innerHTML = '<option value="">Select City</option>';
      if (!stateVal) return;
      const cities = await _pmLoadCities(stateVal);
      cities.forEach(city => {
        const opt = document.createElement('option');
        opt.value = city;
        opt.textContent = city;
        citySelect.appendChild(opt);
      });
      if (defaultCity) {
        citySelect.value = defaultCity;
      }
    };

    stateSelect.addEventListener('change', (e) => {
      updateCities(e.target.value);
    });

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
            if (fetchedState) {
              if (!_pmStatesCache.includes(fetchedState) && !stateSelect.querySelector(`option[value="${CSS.escape(fetchedState)}"]`)) {
                const opt = document.createElement('option');
                opt.value = fetchedState;
                opt.textContent = fetchedState;
                stateSelect.appendChild(opt);
              }
              stateSelect.value = fetchedState;
              updateCities(fetchedState, fetchedCity);
            }
          }
        } catch (err) {
          console.error('Failed to fetch pincode details', err);
        }
      }
    });

    const user = state.user || {};
    if (user.state) {
      stateSelect.value = user.state;
      updateCities(user.state, user.city);
    }
  }

  saveProfile() {
    const addressLine1 = this.modal.querySelector('#profile-address-line1')?.value.trim() || '';
    const addressLine2 = this.modal.querySelector('#profile-address-line2')?.value.trim() || '';
    const landmark = this.modal.querySelector('#profile-landmark')?.value.trim() || '';
    const city = this.modal.querySelector('#profile-city')?.value.trim() || '';
    const stateVal = this.modal.querySelector('#profile-state')?.value.trim() || '';
    const pincodeVal = this.modal.querySelector('#profile-pincode')?.value.trim() || '';

    if (!addressLine1 || !addressLine2 || !landmark || !city || !stateVal || !pincodeVal) {
      showErrorToast('All address fields (Line 1, Line 2, Landmark, Pincode, City, State) are mandatory.');
      return;
    }
    if (!isValidPincode(pincodeVal)) {
      showErrorToast('Enter a valid 6-digit pincode.');
      return;
    }

    const addressParts = [addressLine1, addressLine2, landmark, city, stateVal, pincodeVal ? 'Pincode: ' + pincodeVal : ''].filter(Boolean);
    const addressVal = addressParts.join(', ');

    const user = { ...(state.user || {}) };
    if (this.tempAvatarData) {
      user.avatarUrl = this.tempAvatarData;
    }

    // If authenticated, persist to server
    if (state.token) {
      (async () => {
        try {
          const payload = {
            address_line1: addressLine1,
            address_line2: addressLine2,
            landmark: landmark,
            city: city,
            state: stateVal,
          };
          if (this.tempAvatarData) payload.avatar_url = this.tempAvatarData;
          if (typeof pincodeVal === 'string') payload.default_pincode = pincodeVal;
          if (typeof addressVal === 'string') payload.default_address = addressVal;

          const updated = await fetchWithAuth('/auth/me', {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          // server returns updated user
          const savedUser = {
            ...user,
            id: updated.id,
            email: updated.email,
            fullName: updated.fullName,
            whatsappNumber: updated.whatsappNumber,
            role: updated.role,
            loginMethod: updated.loginMethod || user.loginMethod,
            avatarUrl: updated.avatarUrl || user.avatarUrl,
            addressLine1: updated.addressLine1 || user.addressLine1 || addressLine1,
            addressLine2: updated.addressLine2 || user.addressLine2 || addressLine2,
            landmark: updated.landmark || user.landmark || landmark,
            city: updated.city || user.city || city,
            state: updated.state || user.state || stateVal,
            defaultAddress:
              updated.defaultAddress || addressVal || user.defaultAddress || '',
            defaultPincode:
              updated.defaultPincode || pincodeVal || user.defaultPincode || '',
          };
          saveUserProfile(savedUser);
          window.dispatchEvent(new Event('auth:changed'));
          showSuccessToast('Profile saved.');
        } catch (err) {
          showErrorToast(getApiErrorMessage(err) || 'Failed to save profile.');
        }
      })();
      return;
    }

    // unauthenticated fallback: save local address fields
    user.defaultPincode = pincodeVal;
    user.defaultAddress = addressVal;
    user.addressLine1 = addressLine1;
    user.addressLine2 = addressLine2;
    user.landmark = landmark;
    user.city = city;
    user.state = stateVal;

    saveUserProfile(user);
    window.dispatchEvent(new Event('auth:changed'));
    showSuccessToast('Profile saved locally.');
  }

  async cancelOrder(orderId) {
    const order = (state.orders || []).find((o) => String(o.id) === String(orderId));
    const status = order?.delivery_status || order?.status || 'unknown';

    const cancellableStatuses = ['pending', 'placed', 'processing', 'paid', 'inoculating', 'pending_upi_verification', 'pending_approval'];
    if (!cancellableStatuses.includes(status)) {
      showErrorToast('Order can be cancelled only when the order is in placed or processing stage.');
      return;
    }

    const existing = document.getElementById('cancel-order-modal');
    if (existing) existing.remove();

    const cancelReasons = [
      { value: 'ordered_by_mistake', label: 'Ordered by mistake' },
      { value: 'wrong_address', label: 'Wrong address' },
      { value: 'found_cheaper', label: 'Found cheaper elsewhere' },
      { value: 'delivery_too_long', label: 'Delivery taking too long' },
      { value: 'need_different_product', label: 'Need different product' },
      { value: 'duplicate_order', label: 'Duplicate order' },
      { value: 'other', label: 'Other' },
    ];

    const modal = document.createElement('div');
    modal.id = 'cancel-order-modal';
    modal.className = 'modal-overlay open';
    modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:10000;padding:18px;';

    modal.innerHTML = `
      <div class="modal-card" style="max-width:480px;">
        <button class="modal-close" id="cancel-modal-close" type="button">&times;</button>
        <h3 style="margin:0 0 8px;font-size:1.2rem;color:#b91c1c;">
          <i class="fa-solid fa-ban"></i> Cancel Order #${orderId.substring(0, 8)}
        </h3>
        <p style="margin:0 0 18px;color:var(--text-mid);font-size:0.92rem;">
          This will request a cancellation. An administrator will review your request and process any applicable refund.
        </p>
        <div class="input-field">
          <label for="cancel-reason-select">Reason for cancellation</label>
          <select id="cancel-reason-select" style="width:100%;padding:10px;border-radius:8px;border:1px solid #d1d5db;">
            <option value="">Select a reason</option>
            ${cancelReasons.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
          </select>
        </div>
        <div class="input-field hidden" id="cancel-reason-other-wrap" style="display:none;margin-top:12px;">
          <label for="cancel-reason-other">Additional details (optional)</label>
          <textarea id="cancel-reason-other" rows="3" placeholder="Please provide more information..." style="width:100%;padding:10px;border-radius:8px;border:1px solid #d1d5db;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
          <button class="btn btn-secondary" id="cancel-modal-keep-btn" type="button">Keep order</button>
          <button class="btn btn-cancel" id="cancel-modal-confirm-btn" type="button">
            <i class="fa-solid fa-ban"></i> Request Cancellation
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const reasonSelect = modal.querySelector('#cancel-reason-select');
    const otherWrap = modal.querySelector('#cancel-reason-other-wrap');
    const otherInput = modal.querySelector('#cancel-reason-other');

    reasonSelect.addEventListener('change', () => {
      otherWrap.style.display = reasonSelect.value === 'other' ? 'block' : 'none';
    });

    const closeModal = () => modal.remove();

    modal.querySelector('#cancel-modal-close').addEventListener('click', closeModal);
    modal.querySelector('#cancel-modal-keep-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#cancel-modal-confirm-btn').addEventListener('click', async () => {
      const reasonVal = reasonSelect.value;
      if (!reasonVal) {
        showErrorToast('Please select a cancellation reason.');
        return;
      }

      let reasonLabel = cancelReasons.find(r => r.value === reasonVal)?.label || reasonVal;
      let reasonText = '';
      if (reasonVal === 'other') {
        reasonText = otherInput?.value.trim() || '';
        if (!reasonText) {
          showErrorToast('Please provide details for your cancellation reason.');
          return;
        }
        reasonLabel = reasonText;
      }

      // Confirmation popup — step 2
      modal.remove();

      const confirmModal = document.createElement('div');
      confirmModal.id = 'cancel-confirm-modal';
      confirmModal.className = 'modal-overlay open';
      confirmModal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:10001;padding:18px;';

      confirmModal.innerHTML = `
        <div class="modal-card" style="max-width:420px;text-align:center;">
          <div style="margin-bottom:16px;font-size:2.5rem;">⚠️</div>
          <h3 style="margin:0 0 8px;font-size:1.1rem;color:#d97706;">Confirm Cancellation</h3>
          <p style="margin:0 0 6px;color:var(--text-mid);font-size:0.9rem;">
            Are you sure you want to cancel Order <strong>#${orderId.substring(0, 8)}</strong>?
          </p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:0.85rem;font-style:italic;">
            Reason: ${reasonLabel}
          </p>
          <p style="margin:0 0 18px;color:#ef4444;font-size:0.82rem;">
            This cannot be undone.
          </p>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button class="btn btn-secondary" id="cancel-confirm-keep-btn" type="button">No, Keep It</button>
            <button class="btn btn-cancel" id="cancel-confirm-yes-btn" type="button">Yes, Cancel Order</button>
          </div>
        </div>
      `;

      document.body.appendChild(confirmModal);

      const closeConfirm = () => confirmModal.remove();

      confirmModal.querySelector('#cancel-confirm-keep-btn').addEventListener('click', closeConfirm);
      confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirm(); });

      confirmModal.querySelector('#cancel-confirm-yes-btn').addEventListener('click', async () => {
        confirmModal.remove();

        try {
          await fetchWithAuth(`/orders/${orderId}/request-cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: reasonLabel }),
          });
          showSuccessToast('✅ Cancellation request submitted. Pending admin review.');

          await this.renderOrders(true);
          this.activeTab = 'orders';
          this.renderTabContent();

          const tabsContainer = this.modal?.querySelector('.pm-tabs');
          if (tabsContainer) {
            tabsContainer.querySelectorAll('.pm-tab').forEach(b => b.classList.remove('active'));
            const ordersBtn = tabsContainer.querySelector('[data-tab="orders"]');
            if (ordersBtn) ordersBtn.classList.add('active');
          }
        } catch (err) {
          showErrorToast(getApiErrorMessage(err) || 'Failed to submit cancellation request.');
        }
      });
    });
  }

  async orderAgain(orderId) {
    const order = (state.orders || []).find((o) => String(o.id) === String(orderId));
    if (!order || !order.items) return;

    if (!state.cart) state.cart = [];

    for (const item of order.items) {
      const existing = state.cart.find((i) => String(i.id) === String(item.product_id || item.id));
      if (existing) {
        existing.quantity += Number(item.quantity || 1);
      } else {
        state.cart.push({
          id: item.product_id || item.id,
          name: item.name || item.product_name || 'Product',
          price: item.price || 0,
          image_url: item.image_url || '/images/product_fresh.png',
          quantity: Number(item.quantity || 1)
        });
      }
    }

    saveCart();
    window.dispatchEvent(new Event('cart:updated'));
    showSuccessToast('Items added to cart!');
    this.close();
    if (window.toggleCart) window.toggleCart(true);
  }

  async handleDelete() {
    const confirmed = await new Promise((resolve) => {
      showConfirmModal({
        title: 'Delete Account',
        message: 'This will permanently remove your account and all associated data. This action cannot be undone.',
        confirmText: 'Delete My Account',
        cancelText: 'Keep Account',
        showReason: true,
        reasonPlaceholder: 'Optional: Tell us why you are leaving (helps us improve)',
        onConfirm: (reason) => resolve(reason || ''),
        onCancel: () => resolve(null),
      });
    });

    if (confirmed === null) return;
    const reason = confirmed;

    if (state.token) {
      try {
        await fetchWithAuth('/auth/me', {
          method: 'DELETE',
          body: JSON.stringify({ reason }),
        });
      } catch (err) {
        showErrorToast(getApiErrorMessage(err) || 'Failed to delete account.');
        return;
      }
    }

    deleteUserProfile();
    window.dispatchEvent(new Event('auth:changed'));
    this.close();
  }
}

const _profileModal = new ProfileModal();
window.profileModal = _profileModal;
window.cancelOrderFromProfile = (orderId) => _profileModal.cancelOrder(orderId);
window.orderAgainFromProfile = (orderId) => _profileModal.orderAgain(orderId);
export const profileModal = _profileModal;
