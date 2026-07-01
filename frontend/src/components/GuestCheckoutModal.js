export function renderGuestCheckoutModal(container) {
  container.innerHTML = `
    <div class="guest-checkout-wrap">
      <div class="gc-card">
        <div class="gc-icon"><i class="fa-solid fa-user-clock"></i></div>
        <h3>Continue as Guest</h3>
        <p class="gc-subtitle">Enter your details to proceed without signing in</p>
        <div class="guest-checkout-form">
          <div class="gc-field">
            <label for="guest-phone">Phone Number</label>
            <input type="tel" id="guest-phone" class="gc-input" placeholder="10-digit mobile number" maxlength="10" inputmode="numeric">
          </div>
          <div class="gc-field" style="margin-top: 1rem;">
            <label for="guest-email">Email (optional)</label>
            <input type="email" id="guest-email" class="gc-input" placeholder="your@email.com">
          </div>
          <button id="guest-proceed-btn" class="btn btn-primary btn-block guest-proceed-btn" style="margin-top: 1.5rem; width: 100%;">
            Proceed to Checkout
          </button>
        </div>
        <div class="gc-divider"><span>or</span></div>
        <button id="guest-login-btn" class="btn btn-secondary btn-block guest-login-btn" style="width: 100%;">
          Sign in to your account
        </button>
      </div>
    </div>
  `;

  document.getElementById('guest-proceed-btn').addEventListener('click', () => {
    const phone = document.getElementById('guest-phone').value.trim();
    const email = document.getElementById('guest-email').value.trim();

    if (!phone || phone.length !== 10 || !/^\d{10}$/.test(phone)) {
      alert('Please enter a valid 10-digit phone number');
      return;
    }

    window.__guestInfo = { phone, email: email || undefined };
    if (typeof container.__proceedGuest === 'function') {
      container.__proceedGuest();
    }
  });

  document.getElementById('guest-login-btn').addEventListener('click', () => {
    import('./AuthModal.js').then(mod => mod.authModal.open('buyer'));
  });
}

