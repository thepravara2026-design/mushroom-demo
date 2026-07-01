import { state } from '../utils/state.js';

export function renderCouponSection(container, { subtotal, onApply, onRemove }) {
  const isApplied = !!state.activePromo;

  container.innerHTML = `
    <div class="coupon-section-wrap">
      <div class="cs-header" id="cs-header-toggle">
        <h4><i class="fa-solid fa-ticket" style="margin-right:6px;color:var(--green-mid);"></i> Apply Promo Coupon</h4>
        <span class="cs-toggle-icon" id="cs-toggle-icon"><i class="fa-solid fa-chevron-down"></i></span>
      </div>
      
      <div class="cs-body" id="cs-body-content">
        ${isApplied ? `
          <div style="margin-top: 0.75rem;">
            <div class="cs-applied-badge">
              <i class="fa-solid fa-circle-check"></i>
              <span>Coupon <strong>${state.activePromo}</strong> Applied</span>
              <i class="fa-solid fa-circle-xmark" id="cs-remove-btn" style="cursor:pointer;margin-left:4px;" title="Remove Coupon"></i>
            </div>
            <div class="cs-feedback cs-success" style="margin-top:0.5rem;">Discount successfully applied to your cart!</div>
          </div>
        ` : `
          <div class="cs-row">
            <input type="text" id="coupon-code-input" class="cs-input" placeholder="Enter coupon code" maxlength="20">
            <button id="coupon-apply-btn" class="cs-btn">Apply</button>
          </div>
          <div id="coupon-status" class="cs-feedback"></div>
        `}
      </div>
    </div>
  `;

  const header = container.querySelector('#cs-header-toggle');
  const body = container.querySelector('#cs-body-content');
  const icon = container.querySelector('#cs-toggle-icon');

  // Load open/close state
  const isOpen = window.__couponSectionOpen === true;
  if (isOpen || isApplied) {
    body.classList.add('open');
    icon.classList.add('open');
  }

  header.addEventListener('click', () => {
    const isNowOpen = body.classList.toggle('open');
    icon.classList.toggle('open');
    window.__couponSectionOpen = isNowOpen;
  });

  if (isApplied) {
    const removeBtn = container.querySelector('#cs-remove-btn');
    removeBtn.addEventListener('click', () => {
      onRemove();
      // Re-render
      renderCouponSection(container, { subtotal, onApply, onRemove });
    });
  } else {
    const input = container.querySelector('#coupon-code-input');
    const applyBtn = container.querySelector('#coupon-apply-btn');
    const statusEl = container.querySelector('#coupon-status');

    applyBtn.addEventListener('click', async () => {
      const code = input.value.trim().toUpperCase();
      if (!code) {
        statusEl.className = 'cs-feedback cs-error';
        statusEl.innerHTML = 'Please enter a coupon code';
        return;
      }

      applyBtn.disabled = true;
      applyBtn.textContent = 'Checking...';

      try {
        const res = await fetch(`/api/orders/validate-coupon?code=${encodeURIComponent(code)}&subtotal=${subtotal}`);
        const json = await res.json();

        if (json.success && json.data.valid) {
          statusEl.className = 'cs-feedback cs-success';
          statusEl.innerHTML = `${json.data.discount_percent}% off applied!`;
          onApply(code);
          // Re-render after a short delay so user sees success message
          setTimeout(() => {
            renderCouponSection(container, { subtotal, onApply, onRemove });
          }, 800);
        } else {
          statusEl.className = 'cs-feedback cs-error';
          statusEl.innerHTML = json.data?.message || 'Invalid or expired coupon';
        }
      } catch (err) {
        statusEl.className = 'cs-feedback cs-error';
        statusEl.innerHTML = 'Validation failed. Try again.';
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply';
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyBtn.click();
      }
    });
  }
}

