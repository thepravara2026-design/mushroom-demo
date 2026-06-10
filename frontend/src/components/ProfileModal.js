import { state, saveUserProfile, deleteUserProfile } from '../utils/state.js';
import { fetchWithAuth, API_BASE, getApiErrorMessage } from '../api/client.js';
import { showErrorToast, showSuccessToast } from '../utils/notify.js';

class ProfileModal {
  constructor() {
    this.modal = null;
  }

  async open() {
    this.close();
    this.modal = document.createElement('div');
    this.modal.className = 'modal-overlay open';
    this.modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:10000;padding:18px;';
    this.modal.innerHTML = `
      <div class="profile-modal-card">
        <div class="profile-modal-header">
          <div>
            <p class="profile-modal-overline">My Profile</p>
            <h3 class="profile-modal-title">Your account dashboard</h3>
            <p class="profile-modal-subtitle">A modern control center for your orders, delivery info and profile settings.</p>
          </div>
          <div class="profile-modal-actions">
            <button id="btn-profile-logout" class="btn btn-secondary profile-mini-btn">Logout</button>
            <button id="btn-profile-close" class="btn btn-primary profile-mini-btn">Close</button>
          </div>
        </div>
        <div class="profile-modal-content">
          <div class="profile-main-column">
            <div id="profile-main"></div>
          </div>
          <aside class="profile-sidebar">
            <div class="profile-sidebar-card">
              <h4>Quick actions</h4>
              <p class="profile-sidebar-copy">Refresh your latest orders, clear local profile data, or manage your account quickly from one place.</p>
              <div class="profile-sidebar-buttons">
                <button id="btn-view-orders" class="btn btn-secondary profile-sidebar-btn">Refresh Orders</button>
                <button id="btn-clear-local" class="btn btn-secondary profile-sidebar-btn">Clear Local Profile</button>
                <button id="btn-delete-account" class="btn btn-danger profile-sidebar-btn">Delete Account</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);

    document
      .getElementById('btn-profile-close')
      ?.addEventListener('click', () => this.close());
    document
      .getElementById('btn-profile-logout')
      ?.addEventListener('click', () => this.logout());
    document
      .getElementById('btn-delete-account')
      ?.addEventListener('click', () => this.handleDelete());
    document
      .getElementById('btn-view-orders')
      ?.addEventListener('click', () => this.renderOrders(true));
    document
      .getElementById('btn-clear-local')
      ?.addEventListener('click', () => {
        deleteUserProfile();
        window.dispatchEvent(new Event('auth:changed'));
        this.close();
      });

    this.renderProfile();
    this.renderOrders();
    this.startPollingOrders();
  }

  close() {
    if (this.modal && this.modal.parentElement) this.modal.parentElement.removeChild(this.modal);
    this.modal = null;
    this.stopPollingOrders();
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
    const user = state.user || {};
    const loginMethod = user.loginMethod
      || (user.whatsappNumber ? 'phone' : user.email ? 'email' : 'guest');

    container.innerHTML = `
      <section class="profile-summary-card">
        <div class="profile-summary-content">
          <p class="profile-overline">Account overview</p>
          <h4>Welcome back, ${user.fullName || 'Sporekart user'}</h4>
          <p class="profile-copy">Update your contact details and shipping preferences to keep orders moving smoothly.</p>
        </div>
        <div class="profile-summary-meta">
          <span class="profile-pill">${(user.role || 'buyer').toUpperCase()}</span>
        </div>
      </section>

      <section class="profile-form-card">
        <div class="profile-card-header">
          <div>
            <h4>Basic details</h4>
            <p class="profile-card-subtitle">Your personal information and default delivery address.</p>
          </div>
        </div>
        <div class="profile-field-grid">
          <div class="input-field">
            <label>Full name</label>
            <input id="profile-fullname" value="${user.fullName || ''}" class="profile-input">
          </div>
          <div class="input-field">
            <label>Email</label>
            <input id="profile-email" value="${user.email || ''}" class="profile-input" ${loginMethod === 'google' ? 'disabled' : ''}>
          </div>
          <div class="input-field">
            <label>Phone</label>
            <input id="profile-phone" value="${user.whatsappNumber || ''}" class="profile-input" ${loginMethod === 'phone' ? 'disabled' : ''}>
          </div>
          <div class="input-field">
            <label>Role</label>
            <input value="${user.role || 'buyer'}" disabled class="profile-input">
          </div>
          <div class="input-field">
            <label>Default pincode</label>
            <input id="profile-pincode" value="${user.defaultPincode || ''}" class="profile-input">
          </div>
          <div class="input-field">
            <label>Default address</label>
            <input id="profile-address" value="${user.defaultAddress || ''}" class="profile-input">
          </div>
        </div>
        <div class="profile-form-footer">
          <button id="btn-save-profile" class="btn btn-primary">Save changes</button>
        </div>
      </section>

      <section class="profile-card profile-section">
        <div class="profile-card-header">
          <div>
            <h4>Current cart</h4>
            <p class="profile-card-subtitle">A quick snapshot of the items you are ready to purchase.</p>
          </div>
        </div>
        <div id="profile-cart" class="profile-cart-list"></div>
      </section>

      <section class="profile-card profile-section">
        <div class="profile-card-header">
          <div>
            <h4>Tracking & Orders</h4>
            <p class="profile-card-subtitle">Everything you need to review and manage your recent orders.</p>
          </div>
        </div>
        <div id="profile-orders" class="profile-orders-list"></div>
      </section>
    `;

    this.modal
      .querySelector('#btn-save-profile')
      ?.addEventListener('click', () => this.saveProfile());
    this.renderCart();
  }

  renderCart() {
    const el = this.modal.querySelector('#profile-cart');
    if (!el) return;
    if (!state.cart || !state.cart.length) {
      el.innerHTML = '<div class="cart-empty-message">No items in cart.</div>';
      return;
    }
    el.innerHTML = state.cart
      .map(
        (i) => `<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px dashed #eef2f7;"><img src="${i.image_url || '/images/product_fresh.png'}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;"><div style="flex:1"><div style="font-weight:700">${i.name}</div><div style="font-size:0.9rem;color:#475569">₹${(i.price || 0).toFixed(2)} × ${i.quantity}</div></div></div>`,
      )
      .join('');
  }

  async renderOrders(forceRefresh = false) {
    const el = this.modal.querySelector('#profile-orders');
    if (!el) return;
    el.innerHTML = '<div style="color:#64748b">Loading orders…</div>';
    try {
      let orders = state.orders || [];
      if (state.token && (forceRefresh || !orders.length)) {
        // fetch user's orders from API
        orders = await fetchWithAuth('/orders/my-orders');
        state.orders = orders;
      }
      if (!orders || !orders.length) {
        el.innerHTML = '<div>No recent orders.</div>';
        return;
      }
      el.innerHTML = orders
        .slice(0, 10)
        .map((o) => this.renderOrderCard(o))
        .join('');
    } catch (err) {
      el.innerHTML = `<div style="color:#b91c1c">Unable to load orders: ${err.message || err}</div>`;
    }
  }

  renderOrderCard(o) {
    const placed = new Date(
      o.created_at || o.createdAt || o.orderedAt || Date.now(),
    ).toLocaleString();
    const status = o.delivery_status || o.status || 'pending';
    const total = (o.total || o.order_total || o.amount || 0).toFixed
      ? (o.total || 0).toFixed(2)
      : Number(o.total || 0).toFixed(2);
    const trackingHtml = this.renderTrackingTimeline(o);
    const shareLink = o.invoice_token
      ? `${window.location.origin}/api/orders/share/${o.invoice_token}`
      : '';
    const cancelNote = o.delivery_status === 'cancelled' && o.cancel_reason
      ? `<div style="margin-top:10px;font-size:0.92rem;color:#b91c1c;"><strong>Cancellation reason:</strong> ${o.cancel_reason}</div>`
      : '';
    const canCancel = o.delivery_status === 'processing';

    return `<div class="profile-order-card">
      <div class="profile-order-header">
        <div>
          <div class="profile-order-title">Order ${o.id || o.orderId}</div>
          <div class="profile-order-meta">Placed: ${placed}</div>
        </div>
        <span class="profile-order-status ${status}">${status}</span>
      </div>
      <div class="profile-order-summary">₹${total} • ${o.items?.length || 0} item${(o.items?.length || 0) !== 1 ? 's' : ''}</div>
      ${trackingHtml}
      ${cancelNote}
      <div class="profile-order-actions">
        <button class="btn btn-secondary" onclick="window.viewInvoice('${o.id}')">View invoice</button>
        ${shareLink ? `<button class="btn btn-secondary" data-share-url="${shareLink}" onclick="window.open(this.dataset.shareUrl,'_blank')">Share invoice</button><button class="btn btn-secondary" onclick="window.copyInvoiceLink('${o.invoice_token}')">Copy invoice link</button>` : ''}
        ${canCancel ? `<button class="btn btn-cancel profile-order-cancel" onclick="window.cancelOrderFromProfile('${o.id}')"><i class="fa-solid fa-ban"></i> Cancel order</button>` : ''}
      </div>
    </div>`;
  }

  renderTrackingTimeline(o) {
    const status = o.delivery_status || o.status || 'pending';
    const updatedAt = o.updated_at || o.updatedAt || null;
    const createdAt = o.created_at || o.createdAt || null;
    const deliveredAt = o.delivered_at || o.deliveredAt || o.deliveredAt || null;
    const cancelledAt = o.cancelled_at || o.cancelledAt || null;
    const itemsCount = Array.isArray(o.items)
      ? o.items.length
      : o.items
        ? o.items.length
        : 0;

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
    if (status === 'paid' || status === 'processing') {
      lines.push({
        label: 'Payment confirmed',
        time: updatedAt ? new Date(updatedAt).toLocaleString() : '',
        done: ['paid', 'processing'].includes(status),
      });
    }
    if (status === 'shipped' || status === 'in_transit') {
      lines.push({
        label: 'Shipped',
        time: updatedAt ? new Date(updatedAt).toLocaleString() : '',
        done: ['shipped', 'in_transit'].includes(status),
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
    if (status === 'cancelled') {
      lines.push({
        label: 'Cancelled',
        time: cancelledAt
          ? new Date(cancelledAt).toLocaleString()
          : updatedAt
            ? new Date(updatedAt).toLocaleString()
            : '',
        done: true,
      });
    }

    const html = `<div style="margin-top:8px;font-size:0.9rem;color:#475569">${lines.map((l) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px dashed #f1f5f9;"><div>${l.done ? '✅' : '🔘'} ${l.label}</div><div style="color:#64748b">${l.time || '—'}</div></div>`).join('')}</div>`;
    return html;
  }

  saveProfile() {
    const fullName = this.modal.querySelector('#profile-fullname')?.value.trim() || '';
    const email = this.modal.querySelector('#profile-email')?.value.trim() || '';
    const phone = this.modal.querySelector('#profile-phone')?.value.trim() || '';
    const user = { ...(state.user || {}) };
    // apply edits only to allowed fields
    if (user.loginMethod !== 'google') user.email = email;
    if (user.loginMethod !== 'phone') user.whatsappNumber = phone;
    user.fullName = fullName;
    // If authenticated, persist to server
    if (state.token) {
      (async () => {
        try {
          const payload = { fullName: user.fullName };
          if (user.loginMethod !== 'google') payload.email = user.email;
          if (user.loginMethod !== 'phone') payload.whatsappNumber = user.whatsappNumber;
          // include default address and pincode if present in inputs
          const pincodeVal = this.modal
            .querySelector('#profile-pincode')
            ?.value.trim();
          const addressVal = this.modal
            .querySelector('#profile-address')
            ?.value.trim();
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
    user.defaultPincode = this.modal.querySelector('#profile-pincode')?.value.trim()
      || user.defaultPincode
      || '';
    user.defaultAddress = this.modal.querySelector('#profile-address')?.value.trim()
      || user.defaultAddress
      || '';
    saveUserProfile(user);
    window.dispatchEvent(new Event('auth:changed'));
    showSuccessToast('Profile saved locally.');
  }

  async cancelOrder(orderId) {
    const order = (state.orders || []).find((o) => o.id === orderId);
    const status = order?.delivery_status || order?.status || 'unknown';

    if (status !== 'processing') {
      showErrorToast('Order can be cancelled only when the order is in processing stage.');
      return;
    }

    const confirmed = confirm(
      'Cancel this order? This will stop processing and cannot be undone.',
    );
    if (!confirmed) return;

    const reason = prompt('Please enter a cancellation reason for this order:');
    if (!reason || !reason.trim()) {
      showErrorToast('Cancellation reason is required.');
      return;
    }

    try {
      await fetchWithAuth(`/orders/${orderId}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      showSuccessToast('✅ Order cancelled successfully.');
      await this.renderOrders(true);
    } catch (err) {
      showErrorToast(getApiErrorMessage(err) || 'Failed to cancel order.');
    }
  }

  async handleDelete() {
    const doDelete = confirm(
      'Delete account? This will remove your account. This action cannot be undone. Proceed?',
    );
    if (!doDelete) return;

    if (state.token) {
      const reason = prompt(
        'Optional: Please tell us why you are deleting (helps us improve).',
      ) || '';
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

    // clear local profile and auth
    deleteUserProfile();
    window.dispatchEvent(new Event('auth:changed'));
    this.close();
  }
}

const _profileModal = new ProfileModal();
window.cancelOrderFromProfile = (orderId) => _profileModal.cancelOrder(orderId);
export const profileModal = _profileModal;
