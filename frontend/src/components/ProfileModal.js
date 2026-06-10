import { state, saveUserProfile, deleteUserProfile } from '../utils/state.js';
import { fetchWithAuth, API_BASE } from '../api/client.js';

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
      <div style="width:100%;max-width:920px;background:#fff;border-radius:10px;overflow:auto;max-height:90vh;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #eef2f7;">
          <h3 style="margin:0">My Profile</h3>
          <div>
            <button id="btn-profile-logout" class="btn btn-secondary">Logout</button>
            <button id="btn-profile-close" class="btn">Close</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 360px;gap:12px;padding:14px;">
          <div id="profile-main" style="padding:8px 12px;"></div>
          <aside style="padding:12px;border-left:1px solid #f1f5f9;">
            <h4 style="margin-top:0">Quick Actions</h4>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
              <button id="btn-delete-account" class="btn btn-danger">Delete account</button>
              <button id="btn-view-orders" class="btn">Refresh Orders</button>
              <button id="btn-clear-local" class="btn btn-secondary">Clear Local Profile</button>
            </div>
          </aside>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);

    document.getElementById('btn-profile-close')?.addEventListener('click', () => this.close());
    document.getElementById('btn-profile-logout')?.addEventListener('click', () => this.logout());
    document.getElementById('btn-delete-account')?.addEventListener('click', () => this.handleDelete());
    document.getElementById('btn-view-orders')?.addEventListener('click', () => this.renderOrders(true));
    document.getElementById('btn-clear-local')?.addEventListener('click', () => {
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
    const loginMethod = user.loginMethod || (user.whatsappNumber ? 'phone' : (user.email ? 'email' : 'guest'));

    container.innerHTML = `
      <section style="padding-bottom:12px;border-bottom:1px solid #f1f5f9;">
        <h4>Basic Details</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <div>
            <label style="font-size:0.9rem">Full name</label>
            <input id="profile-fullname" value="${user.fullName || ''}" style="width:100%;padding:8px;border:1px solid #e6edf3;border-radius:6px;">
          </div>
          <div>
            <label style="font-size:0.9rem">Email</label>
            <input id="profile-email" value="${user.email || ''}" style="width:100%;padding:8px;border:1px solid #e6edf3;border-radius:6px;" ${loginMethod==='google' ? 'disabled' : ''}>
          </div>
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:0.9rem">Phone</label>
            <input id="profile-phone" value="${user.whatsappNumber || ''}" style="width:100%;padding:8px;border:1px solid #e6edf3;border-radius:6px;" ${loginMethod==='phone' ? 'disabled' : ''}>
          </div>
          <div>
            <label style="font-size:0.9rem">Role</label>
            <input value="${user.role || 'buyer'}" disabled style="width:100%;padding:8px;border:1px solid #e6edf3;border-radius:6px;">
          </div>
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:0.9rem">Default Pincode</label>
            <input id="profile-pincode" value="${user.defaultPincode || ''}" style="width:100%;padding:8px;border:1px solid #e6edf3;border-radius:6px;">
          </div>
          <div>
            <label style="font-size:0.9rem">Default Address</label>
            <input id="profile-address" value="${user.defaultAddress || ''}" style="width:100%;padding:8px;border:1px solid #e6edf3;border-radius:6px;">
          </div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
          <button id="btn-save-profile" class="btn btn-primary">Save</button>
        </div>
      </section>

      <section style="margin-top:12px;padding-bottom:12px;border-bottom:1px solid #f1f5f9;">
        <h4 style="margin-top:12px">My Cart</h4>
        <div id="profile-cart" style="margin-top:8px"></div>
      </section>

      <section style="margin-top:12px;">
        <h4 style="margin-top:12px">Tracking & Orders</h4>
        <div id="profile-orders" style="margin-top:8px"></div>
      </section>
    `;

    this.modal.querySelector('#btn-save-profile')?.addEventListener('click', () => this.saveProfile());
    this.renderCart();
  }

  renderCart() {
    const el = this.modal.querySelector('#profile-cart');
    if (!el) return;
    if (!state.cart || !state.cart.length) {
      el.innerHTML = '<div class="cart-empty-message">No items in cart.</div>';
      return;
    }
    el.innerHTML = state.cart.map(i=>`<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px dashed #eef2f7;"><img src="${i.image_url||'/images/product_fresh.png'}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;"><div style="flex:1"><div style="font-weight:700">${i.name}</div><div style="font-size:0.9rem;color:#475569">₹${(i.price||0).toFixed(2)} × ${i.quantity}</div></div></div>`).join('');
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
      el.innerHTML = orders.slice(0,10).map(o=> this.renderOrderCard(o)).join('');
    } catch (err) {
      el.innerHTML = `<div style="color:#b91c1c">Unable to load orders: ${err.message||err}</div>`;
    }
  }

  renderOrderCard(o) {
    const placed = new Date(o.created_at||o.createdAt||o.orderedAt||Date.now()).toLocaleString();
    const status = o.delivery_status || o.status || 'pending';
    const total = (o.total || o.order_total || o.amount || 0).toFixed ? (o.total || 0).toFixed(2) : Number(o.total||0).toFixed(2);
    const trackingHtml = this.renderTrackingTimeline(o);
    const shareLink = o.invoice_token ? `${window.location.origin}/api/orders/share/${o.invoice_token}` : '';
    return `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;"><div style="display:flex;justify-content:space-between;align-items:center;"><div><strong>Order ${o.id || o.orderId}</strong><div style="font-size:0.9rem;color:#475569">Placed: ${placed}</div></div><div style="text-align:right"><div style="font-weight:700">₹${total}</div><div style="font-size:0.9rem;color:#475569">${status}</div></div></div>${trackingHtml}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><button class="btn btn-secondary" onclick="window.viewInvoice('${o.id}')">View invoice</button>${shareLink ? `<button class="btn btn-secondary" data-share-url="${shareLink}" onclick="window.open(this.dataset.shareUrl,'_blank')">Open shareable invoice</button><button class="btn btn-secondary" onclick="window.copyInvoiceLink('${o.invoice_token}')">Copy invoice link</button>` : ''}</div></div>`;
  }

  renderTrackingTimeline(o) {
    const status = o.delivery_status || o.status || 'pending';
    const updatedAt = o.updated_at || o.updatedAt || null;
    const createdAt = o.created_at || o.createdAt || null;
    const deliveredAt = o.delivered_at || o.deliveredAt || o.deliveredAt || null;
    const cancelledAt = o.cancelled_at || o.cancelledAt || null;
    const itemsCount = Array.isArray(o.items) ? o.items.length : (o.items ? o.items.length : 0);

    const lines = [];
    if (createdAt) lines.push({ label: 'Order placed', time: new Date(createdAt).toLocaleString(), done: true });
    if (status === 'pending' || status === 'placed') lines.push({ label: 'Payment & processing', time: updatedAt ? new Date(updatedAt).toLocaleString() : '', done: status !== 'pending' });
    if (status === 'paid' || status === 'processing') lines.push({ label: 'Payment confirmed', time: updatedAt ? new Date(updatedAt).toLocaleString() : '', done: ['paid','processing'].includes(status) });
    if (status === 'shipped' || status === 'in_transit') lines.push({ label: 'Shipped', time: updatedAt ? new Date(updatedAt).toLocaleString() : '', done: ['shipped','in_transit'].includes(status) });
    if (status === 'delivered') lines.push({ label: 'Delivered', time: deliveredAt ? new Date(deliveredAt).toLocaleString() : (updatedAt? new Date(updatedAt).toLocaleString() : ''), done: true });
    if (status === 'cancelled') lines.push({ label: 'Cancelled', time: cancelledAt ? new Date(cancelledAt).toLocaleString() : (updatedAt? new Date(updatedAt).toLocaleString() : ''), done: true });

    const html = `<div style="margin-top:8px;font-size:0.9rem;color:#475569">${lines.map(l=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px dashed #f1f5f9;"><div>${l.done ? '✅' : '🔘'} ${l.label}</div><div style="color:#64748b">${l.time||'—'}</div></div>`).join('')}</div>`;
    return html;
  }

  saveProfile() {
    const fullName = this.modal.querySelector('#profile-fullname')?.value.trim() || '';
    const email = this.modal.querySelector('#profile-email')?.value.trim() || '';
    const phone = this.modal.querySelector('#profile-phone')?.value.trim() || '';
    const user = Object.assign({}, state.user || {});
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
          const pincodeVal = this.modal.querySelector('#profile-pincode')?.value.trim();
          const addressVal = this.modal.querySelector('#profile-address')?.value.trim();
          if (typeof pincodeVal === 'string') payload.default_pincode = pincodeVal;
          if (typeof addressVal === 'string') payload.default_address = addressVal;

          const updated = await fetchWithAuth('/auth/me', { method: 'PUT', body: JSON.stringify(payload) });
          // server returns updated user
          const savedUser = Object.assign({}, user, {
            id: updated.id,
            email: updated.email,
            fullName: updated.fullName,
            whatsappNumber: updated.whatsappNumber,
            role: updated.role,
            loginMethod: updated.loginMethod || user.loginMethod,
            defaultAddress: updated.defaultAddress || addressVal || user.defaultAddress || '',
            defaultPincode: updated.defaultPincode || pincodeVal || user.defaultPincode || ''
          });
          saveUserProfile(savedUser);
          window.dispatchEvent(new Event('auth:changed'));
          alert('Profile saved.');
        } catch (err) {
          alert('Failed to save profile: ' + (err.message || err));
        }
      })();
      return;
    }

    // unauthenticated fallback: save local address fields
    user.defaultPincode = this.modal.querySelector('#profile-pincode')?.value.trim() || user.defaultPincode || '';
    user.defaultAddress = this.modal.querySelector('#profile-address')?.value.trim() || user.defaultAddress || '';
    saveUserProfile(user);
    window.dispatchEvent(new Event('auth:changed'));
    alert('Profile saved locally.');
  }

  async handleDelete() {
    const doDelete = confirm('Delete account? This will remove your account. This action cannot be undone. Proceed?');
    if (!doDelete) return;

    if (state.token) {
      const reason = prompt('Optional: Please tell us why you are deleting (helps us improve).') || '';
      try {
        await fetchWithAuth('/auth/me', { method: 'DELETE', body: JSON.stringify({ reason }) });
      } catch (err) {
        alert('Failed to delete account: ' + (err.message || err));
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
export const profileModal = _profileModal;
