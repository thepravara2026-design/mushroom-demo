import { state, saveUserProfile, deleteUserProfile, saveCart } from '../utils/state.js';
import { fetchWithAuth, API_BASE, getApiErrorMessage } from '../api/client.js';
import { showErrorToast, showSuccessToast } from '../utils/notify.js';
import { isValidIndianPhone } from '../utils/validation.js';

const STATE_CITIES = {
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Tirupati", "Kurnool", "Rajahmundry", "Kadapa"],
  "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Pasighat", "Tawang"],
  "Assam": ["Guwahati", "Dibrugarh", "Silchar", "Jorhat", "Nagaon", "Tinsukia"],
  "Bihar": ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Purnia", "Darbhanga", "Ara"],
  "Chhattisgarh": ["Raipur", "Bhilai", "Bilaspur", "Korba", "Rajnandgaon"],
  "Delhi": ["New Delhi", "Delhi Cantt", "Dwarka", "Rohini", "Saket", "Vasant Kunj"],
  "Goa": ["Panaji", "Margao", "Vasco da Gama", "Mapusa"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Gandhinagar"],
  "Haryana": ["Faridabad", "Gurugram", "Panipat", "Ambala", "Yamunanagar", "Rohtak", "Hisar"],
  "Himachal Pradesh": ["Shimla", "Dharamshala", "Solan", "Mandi"],
  "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Deoghar"],
  "Karnataka": ["Bengaluru", "Davangere", "Mysuru", "Hubballi", "Mangaluru", "Belagavi", "Tumakuru", "Ballari", "Shimoga"],
  "Kerala": ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Alappuzha", "Palakkad"],
  "Madhya Pradesh": ["Indore", "Bhopal", "Jabalpur", "Gwalior", "Ujjain", "Sagar", "Dewas"],
  "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Thane", "Nashik", "Kalyan-Dombivli", "Vasai-Virar", "Aurangabad", "Navi Mumbai", "Solapur"],
  "Manipur": ["Imphal", "Thoubal"],
  "Meghalaya": ["Shillong", "Tura"],
  "Mizoram": ["Aizawl", "Lunglei"],
  "Nagaland": ["Dimapur", "Kohima"],
  "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur"],
  "Punjab": ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda"],
  "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Bikaner", "Ajmer", "Bhilwara"],
  "Sikkim": ["Gangtok", "Namchi"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tiruppur", "Erode", "Vellore"],
  "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam", "Ramagundam"],
  "Tripura": ["Agartala", "Dharmanagar"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Ghaziabad", "Agra", "Meerut", "Varanasi", "Prayagraj", "Noida", "Greater Noida", "Bareilly", "Aligarh"],
  "Uttarakhand": ["Dehradun", "Haridwar", "Roorkee", "Haldwani"],
  "West Bengal": ["Kolkata", "Howrah", "Darjeeling", "Siliguri", "Asansol", "Durgapur", "Kharagpur"]
};

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
            <button id="btn-profile-close" class="btn btn-primary profile-mini-btn">Shop</button>
          </div>
        </div>
        <div class="profile-modal-content">
          <div class="profile-main-column" style="width: 100%;">
            <div id="profile-main"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);

    // close when clicking outside the card
    this._overlayClickHandler = (ev) => {
      if (!this.modal) return;
      const card = this.modal.querySelector('.profile-modal-card');
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
    const mainCol = this.modal.querySelector('.profile-main-column');
    const container = this.modal.querySelector('#profile-main');

    let tabsContainer = this.modal.querySelector('.profile-tabs');
    if (!tabsContainer) {
      tabsContainer = document.createElement('div');
      tabsContainer.className = 'profile-tabs';
      tabsContainer.style.cssText = 'display:flex;gap:1rem;margin-bottom:1.5rem;border-bottom:1px solid #e2e8f0;padding-bottom:0.5rem;overflow-x:auto;';
      tabsContainer.innerHTML = `
        <button class="profile-tab-btn active" data-tab="details" style="background:none;border:none;font-weight:600;color:var(--color-primary);cursor:pointer;padding:0.5rem 0.5rem;border-bottom:2px solid var(--color-primary);">My Details</button>
        <button class="profile-tab-btn" data-tab="orders" style="background:none;border:none;font-weight:500;color:#64748b;cursor:pointer;padding:0.5rem 0.5rem;border-bottom:2px solid transparent;">My Orders</button>
        <button class="profile-tab-btn" data-tab="recent" style="background:none;border:none;font-weight:500;color:#64748b;cursor:pointer;padding:0.5rem 0.5rem;border-bottom:2px solid transparent;">Recent Orders</button>
        <button class="profile-tab-btn" data-tab="quick_actions" style="background:none;border:none;font-weight:500;color:#64748b;cursor:pointer;padding:0.5rem 0.5rem;border-bottom:2px solid transparent;">Quick Actions</button>
      `;
      mainCol.insertBefore(tabsContainer, container);

      tabsContainer.querySelectorAll('.profile-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          tabsContainer.querySelectorAll('.profile-tab-btn').forEach(b => {
            b.classList.remove('active');
            b.style.fontWeight = '500';
            b.style.color = '#64748b';
            b.style.borderBottom = '2px solid transparent';
          });
          btn.classList.add('active');
          btn.style.fontWeight = '600';
          btn.style.color = 'var(--color-primary)';
          btn.style.borderBottom = '2px solid var(--color-primary)';
          this.activeTab = btn.dataset.tab;
          this.renderTabContent();
        });
      });
      this.activeTab = this.initialTab || 'details';

      // Select the active tab button visually
      const activeBtn = tabsContainer.querySelector(`[data-tab="${this.activeTab}"]`);
      if (activeBtn) {
        tabsContainer.querySelectorAll('.profile-tab-btn').forEach(b => {
          b.classList.remove('active');
          b.style.fontWeight = '500';
          b.style.color = '#64748b';
          b.style.borderBottom = '2px solid transparent';
        });
        activeBtn.classList.add('active');
        activeBtn.style.fontWeight = '600';
        activeBtn.style.color = 'var(--color-primary)';
        activeBtn.style.borderBottom = '2px solid var(--color-primary)';
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
        <section class="profile-summary-card">
          <div class="profile-summary-content">
            <p class="profile-overline">Account overview</p>
            <h4>Welcome back, ${user.fullName || 'Sporekart user'}</h4>
            <p class="profile-copy">Update your contact details and shipping preferences to keep orders moving smoothly.</p>
          </div>
          <div class="profile-summary-meta" style="display:flex; align-items:center; gap: 1rem;">
            <div class="profile-avatar-container" style="position:relative; width: 64px; height: 64px; border-radius: 50%; overflow: hidden; border: 2px solid var(--color-primary); cursor: pointer;" onclick="document.getElementById('avatar-upload').click()">
              <img id="profile-avatar-img" src="${user.avatarUrl || '/images/default_avatar.png'}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/images/default_avatar.png'">
              <div style="position:absolute; bottom:0; left:0; right:0; background: rgba(0,0,0,0.5); color: white; font-size: 10px; text-align: center; padding: 2px 0;">Edit</div>
            </div>
            <input type="file" id="avatar-upload" accept="image/*" style="display: none;" onchange="window.profileModal.handleAvatarChange(event)">
            <span class="profile-pill">${(user.role || 'buyer').toUpperCase()}</span>
          </div>
        </section>

        <section class="profile-form-card">
          <div class="profile-card-header" style="cursor:pointer;" onclick="this.parentElement.querySelector('.profile-field-grid').classList.toggle('hidden'); this.querySelector('.profile-toggle-icon').classList.toggle('fa-chevron-down'); this.querySelector('.profile-toggle-icon').classList.toggle('fa-chevron-up');">
            <div>
              <h4>Basic details <i class="fa-solid fa-chevron-down profile-toggle-icon" style="font-size:0.8rem;margin-left:6px;"></i></h4>
              <p class="profile-card-subtitle">Your personal information and default delivery address.</p>
            </div>
          </div>
          <div class="profile-field-grid hidden">
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
            <div class="input-field" style="grid-column: 1 / -1;">
              <label>Address Line 1 <span style="color:var(--color-danger)">*</span></label>
              <input id="profile-address-line1" value="${user.addressLine1 || ''}" class="profile-input" placeholder="House/Flat No, Building, Street">
            </div>
            <div class="input-field" style="grid-column: 1 / -1;">
              <label>Address Line 2 <span style="color:var(--color-danger)">*</span></label>
              <input id="profile-address-line2" value="${user.addressLine2 || ''}" class="profile-input" placeholder="Area, Sector, Locality">
            </div>
            <div class="input-field">
              <label>Landmark <span style="color:var(--color-danger)">*</span></label>
              <input id="profile-landmark" value="${user.landmark || ''}" class="profile-input" placeholder="Near XYZ">
            </div>
            <div class="input-field">
              <label>Pincode <span style="color:var(--color-danger)">*</span></label>
              <input id="profile-pincode" value="${user.defaultPincode || ''}" class="profile-input">
            </div>
            <div class="input-field">
              <label>State <span style="color:var(--color-danger)">*</span></label>
              <select id="profile-state" class="profile-input" style="background: #fff; color: var(--color-text-dark);"></select>
            </div>
            <div class="input-field">
              <label>City <span style="color:var(--color-danger)">*</span></label>
              <select id="profile-city" class="profile-input" style="background: #fff; color: var(--color-text-dark);"></select>
            </div>
            <div class="input-field" style="grid-column: 1 / -1;">
              <label>Default Address (Legacy)</label>
              <input id="profile-address" value="${user.defaultAddress || ''}" class="profile-input" disabled>
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
      `;
      this.modal.querySelector('#btn-save-profile')?.addEventListener('click', () => this.saveProfile());
      this.renderCart();
      this.initAddressDropdownsAndPincode();
    } else if (this.activeTab === 'orders') {
      container.innerHTML = `
        <section class="profile-card profile-section">
          <div class="profile-card-header">
            <div>
              <h4>Active Orders</h4>
              <p class="profile-card-subtitle">Track your current shipments.</p>
            </div>
          </div>
          <div id="profile-active-orders" class="profile-orders-list"></div>
        </section>
      `;
      this.renderOrdersList('#profile-active-orders', false);
    } else if (this.activeTab === 'recent') {
      container.innerHTML = `
        <section class="profile-card profile-section">
          <div class="profile-card-header">
            <div>
              <h4>Recent Orders</h4>
              <p class="profile-card-subtitle">Your delivered and cancelled orders.</p>
            </div>
          </div>
          <div id="profile-recent-orders" class="profile-orders-list"></div>
        </section>
      `;
      this.renderOrdersList('#profile-recent-orders', true);
    } else if (this.activeTab === 'quick_actions') {
      container.innerHTML = `
        <section class="profile-card profile-section">
          <div class="profile-card-header">
            <div>
              <h4>Quick Actions</h4>
              <p class="profile-card-subtitle">Manage your account and local data.</p>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 1rem; max-width: 300px; padding: 1rem 0;">
            <button id="tab-btn-view-orders" class="btn btn-secondary profile-sidebar-btn" style="width: 100%">Refresh Orders</button>
            <button id="tab-btn-clear-local" class="btn btn-secondary profile-sidebar-btn" style="width: 100%">Clear Local Profile</button>
            <button id="tab-btn-delete-account" class="btn btn-danger profile-sidebar-btn" style="width: 100%">Delete Account</button>
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

  initAddressDropdownsAndPincode() {
    const user = state.user || {};
    const stateSelect = this.modal.querySelector('#profile-state');
    const citySelect = this.modal.querySelector('#profile-city');
    const pincodeInput = this.modal.querySelector('#profile-pincode');

    if (stateSelect && citySelect) {
      // Populate state dropdown
      stateSelect.innerHTML = '<option value="">Select State</option>' +
        Object.keys(STATE_CITIES).map(s => `<option value="${s}">${s}</option>`).join('');

      // Helper to update city dropdown based on selected state
      const updateCitiesForState = (selectedState, defaultCity = '') => {
        if (!selectedState || !STATE_CITIES[selectedState]) {
          citySelect.innerHTML = '<option value="">Select State first</option>';
          return;
        }
        const cities = STATE_CITIES[selectedState];
        citySelect.innerHTML = '<option value="">Select City</option>' +
          cities.map(c => `<option value="${c}">${c}</option>`).join('');

        if (defaultCity) {
          if (!cities.includes(defaultCity)) {
            const opt = document.createElement('option');
            opt.value = defaultCity;
            opt.textContent = defaultCity;
            citySelect.appendChild(opt);
          }
          citySelect.value = defaultCity;
        }
      };

      // Set initial values
      const initialState = user.state || '';
      const initialCity = user.city || '';
      if (initialState) {
        stateSelect.value = initialState;
        updateCitiesForState(initialState, initialCity);
      } else {
        citySelect.innerHTML = '<option value="">Select State first</option>';
      }

      // Listen to state change
      stateSelect.addEventListener('change', (e) => {
        updateCitiesForState(e.target.value);
      });

      // Pincode autofill
      if (pincodeInput) {
        const handlePincodeAutofill = async () => {
          const pin = pincodeInput.value.trim();
          if (pin.length === 6 && /^\d{6}$/.test(pin)) {
            try {
              const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
              const data = await res.json();
              if (data && data[0] && data[0].Status === 'Success') {
                const postOffice = data[0].PostOffice[0];
                const fetchedState = postOffice.State || '';
                const fetchedCity = postOffice.District || postOffice.Region || '';

                if (fetchedState) {
                  if (!STATE_CITIES[fetchedState]) {
                    const opt = document.createElement('option');
                    opt.value = fetchedState;
                    opt.textContent = fetchedState;
                    stateSelect.appendChild(opt);
                  }
                  stateSelect.value = fetchedState;
                  updateCitiesForState(fetchedState, fetchedCity);
                }
              }
            } catch (err) {
              console.error('Failed to fetch pincode details in profile', err);
            }
          }
        };

        pincodeInput.addEventListener('input', handlePincodeAutofill);
        // Trigger if initial pincode exists
        if (pincodeInput.value) {
          handlePincodeAutofill();
        }
      }
    }
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
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsHtml = items.length
      ? `<div class="profile-order-items">
          <div class="profile-order-items-label">Ordered items</div>
          <ul>${items
        .map((item) => `<li>${item.name || item.product_name || 'Product'} × ${item.quantity || item.qty || 1}</li>`)
        .join('')}</ul>
        </div>`
      : '';

    return `<div class="profile-order-card">
      <div class="profile-order-header">
        <div>
          <div class="profile-order-title">Order ${o.id || o.orderId}</div>
          <div class="profile-order-meta">Placed: ${placed}</div>
          ${o.expected_delivery_date && ['shipped', 'in_transit'].includes(o.delivery_status) ? `<div class="profile-order-meta" style="color:var(--color-primary);">Expected delivery: ${new Date(o.expected_delivery_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${o.delivery_days_text ? ' (' + o.delivery_days_text + ')' : ''}</div>` : ''}
        </div>
        <span class="profile-order-status ${status}">${status}</span>
      </div>
      <div class="profile-order-summary">₹${total} • ${items.length} item${items.length !== 1 ? 's' : ''}</div>
      ${itemsHtml}
      ${trackingHtml}
      ${cancelNote}
      <div class="profile-order-actions">
        ${['shipped', 'in_transit', 'delivered'].includes(status) ? `
          <button class="btn btn-secondary" onclick="window.viewInvoice('${o.id}')">View invoice</button>
          ${shareLink ? `<button class="btn btn-secondary" data-share-url="${shareLink}" onclick="window.open(this.dataset.shareUrl,'_blank')">Share invoice</button><button class="btn btn-secondary" onclick="window.copyInvoiceLink('${o.invoice_token}')">Copy invoice link</button>` : ''}
        ` : ''}
        ${canCancel ? `<button class="btn btn-cancel profile-order-cancel" onclick="window.cancelOrderFromProfile('${o.id}')"><i class="fa-solid fa-ban"></i> Cancel order</button>` : ''}
        ${status === 'delivered' && !o.rating ? `<button class="btn btn-primary" onclick="window.openReviewModal('${o.id}')"><i class="fa-solid fa-star"></i> Leave a Review</button>` : ''}
        ${isRecent ? `<button class="btn btn-primary" onclick="window.orderAgainFromProfile('${o.id}')"><i class="fa-solid fa-rotate-right"></i> Order Again</button>` : ''}
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

  initAddressDropdownsAndPincode() {
    const stateSelect = this.modal.querySelector('#profile-state');
    const citySelect = this.modal.querySelector('#profile-city');
    const pincodeInput = this.modal.querySelector('#profile-pincode');
    if (!stateSelect || !citySelect || !pincodeInput) return;

    // Populate states
    stateSelect.innerHTML = '<option value="">Select State</option>';
    Object.keys(STATE_CITIES).sort().forEach(state => {
      const opt = document.createElement('option');
      opt.value = state;
      opt.textContent = state;
      stateSelect.appendChild(opt);
    });

    const updateCities = (stateVal, defaultCity = '') => {
      citySelect.innerHTML = '<option value="">Select City</option>';
      if (stateVal && STATE_CITIES[stateVal]) {
        STATE_CITIES[stateVal].sort().forEach(city => {
          const opt = document.createElement('option');
          opt.value = city;
          opt.textContent = city;
          citySelect.appendChild(opt);
        });
      }
      if (defaultCity) {
        citySelect.value = defaultCity;
      }
    };

    stateSelect.addEventListener('change', (e) => {
      updateCities(e.target.value);
    });

    // Handle Pincode Auto-select (mock logic for demo)
    pincodeInput.addEventListener('blur', (e) => {
      const pin = e.target.value.trim();
      if (pin.length === 6) {
        // Mock lookup: if it starts with 1, Delhi. If 4, Maharashtra. If 5, Karnataka. Else, just random logic or do nothing.
        let detectedState = '';
        let detectedCity = '';
        if (pin.startsWith('1')) {
          detectedState = 'Delhi';
          detectedCity = 'New Delhi';
        } else if (pin.startsWith('4')) {
          detectedState = 'Maharashtra';
          detectedCity = 'Mumbai';
        } else if (pin.startsWith('5')) {
          detectedState = 'Karnataka';
          detectedCity = 'Bengaluru';
        } else if (pin.startsWith('6')) {
          detectedState = 'Tamil Nadu';
          detectedCity = 'Chennai';
        }

        if (detectedState) {
          stateSelect.value = detectedState;
          updateCities(detectedState, detectedCity);
        }
      }
    });

    // Set initial values
    const user = state.user || {};
    if (user.state) {
      stateSelect.value = user.state;
      updateCities(user.state, user.city);
    }
  }

  saveProfile() {
    const fullName = this.modal.querySelector('#profile-fullname')?.value.trim() || '';
    const email = this.modal.querySelector('#profile-email')?.value.trim() || '';
    const phone = this.modal.querySelector('#profile-phone')?.value.trim() || '';
    const addressLine1 = this.modal.querySelector('#profile-address-line1')?.value.trim() || '';
    const addressLine2 = this.modal.querySelector('#profile-address-line2')?.value.trim() || '';
    const landmark = this.modal.querySelector('#profile-landmark')?.value.trim() || '';
    const city = this.modal.querySelector('#profile-city')?.value.trim() || '';
    const stateVal = this.modal.querySelector('#profile-state')?.value.trim() || '';
    const pincodeVal = this.modal.querySelector('#profile-pincode')?.value.trim() || '';

    if (!fullName) {
      showErrorToast('Full name is required.');
      return;
    }
    if (!email) {
      showErrorToast('Email is required.');
      return;
    }
    if (!phone) {
      showErrorToast('Phone number is required.');
      return;
    }
    if (!isValidIndianPhone(phone)) {
      showErrorToast('Enter a valid Indian phone number (e.g. +91 9876543210).');
      return;
    }
    if (!addressLine1 || !addressLine2 || !landmark || !city || !stateVal || !pincodeVal) {
      showErrorToast('All address fields (Line 1, Line 2, Landmark, Pincode, City, State) are mandatory.');
      return;
    }
    if (!/^\d{6}$/.test(pincodeVal)) {
      showErrorToast('Enter a valid 6-digit pincode.');
      return;
    }

    const addressParts = [addressLine1, addressLine2, landmark, city, stateVal, pincodeVal ? 'Pincode: ' + pincodeVal : ''].filter(Boolean);
    const addressVal = addressParts.join(', ');

    const user = { ...(state.user || {}) };
    // apply edits only to allowed fields
    if (user.loginMethod !== 'google') user.email = email;
    if (user.loginMethod !== 'phone') user.whatsappNumber = phone;
    user.fullName = fullName;
    if (this.tempAvatarData) {
      user.avatarUrl = this.tempAvatarData;
    }

    // If authenticated, persist to server
    if (state.token) {
      (async () => {
        try {
          const payload = {
            fullName: user.fullName,
            address_line1: addressLine1,
            address_line2: addressLine2,
            landmark: landmark,
            city: city,
            state: stateVal,
          };
          if (user.loginMethod !== 'google') payload.email = user.email;
          if (user.loginMethod !== 'phone') payload.whatsappNumber = user.whatsappNumber;
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

    if (status !== 'processing') {
      showErrorToast('Order can be cancelled only when the order is in processing stage.');
      return;
    }

    const origRender = this.renderOrders.bind(this, true);

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
        const cancelResult = await fetchWithAuth(`/orders/${orderId}/cancel`, {
          method: 'PUT',
          body: JSON.stringify({ reason }),
        });
        showSuccessToast('✅ Order cancelled successfully.');

        const hasRefund = cancelResult && cancelResult.refund;
        if (hasRefund) {
          showSuccessToast('💰 Refund initiated — expect 5–7 business days.');
        }

        await this.renderOrders(true);
        this.activeTab = 'recent';
        this.renderTabContent();

        const tabsContainer = this.modal?.querySelector('.profile-tabs');
        if (tabsContainer) {
          tabsContainer.querySelectorAll('.profile-tab-btn').forEach(b => {
            b.classList.remove('active');
            b.style.fontWeight = '500';
            b.style.color = '#64748b';
            b.style.borderBottom = '2px solid transparent';
          });
          const recentBtn = tabsContainer.querySelector('[data-tab="recent"]');
          if (recentBtn) {
            recentBtn.classList.add('active');
            recentBtn.style.fontWeight = '600';
            recentBtn.style.color = 'var(--color-primary)';
            recentBtn.style.borderBottom = '2px solid var(--color-primary)';
          }
        }
      } catch (err) {
        showErrorToast(getApiErrorMessage(err) || 'Failed to cancel order.');
      }
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
window.profileModal = _profileModal;
window.cancelOrderFromProfile = (orderId) => _profileModal.cancelOrder(orderId);
window.orderAgainFromProfile = (orderId) => _profileModal.orderAgain(orderId);
export const profileModal = _profileModal;
