export function initDeliveryCheck(container, options = {}) {
  if (!container) return;

  const { weight = 0.5, cod = false } = options;

  container.innerHTML = `
    <div class="delivery-check-widget">
      <div class="delivery-check-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="1" y="3" width="15" height="13" rx="2"/>
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
          <circle cx="5.5" cy="18.5" r="2.5"/>
          <circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
        <span>Check Delivery Availability</span>
      </div>
      <div class="delivery-check-input-group">
        <input type="text" class="delivery-check-input" placeholder="Enter pincode" maxlength="6" inputmode="numeric" pattern="[0-9]*">
        <button class="delivery-check-btn">Check</button>
      </div>
      <div class="delivery-check-result"></div>
    </div>
  `;

  const input = container.querySelector('.delivery-check-input');
  const btn = container.querySelector('.delivery-check-btn');
  const resultEl = container.querySelector('.delivery-check-result');

  async function checkPincode() {
    const pincode = input.value.trim();
    if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      resultEl.innerHTML = '<span class="delivery-check-error">Enter a valid 6-digit pincode</span>';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Checking...';
    resultEl.innerHTML = '<span class="delivery-check-loading">Checking availability...</span>';

    try {
      const res = await fetch(`/api/shipping/check-serviceability?pincode=${pincode}&weight=${weight}&cod=${cod}`);
      const json = await res.json();

      if (json.success && json.data.available) {
        const days = json.data.estimated_delivery
          ? `Delivered in ${json.data.estimated_delivery} day${json.data.estimated_delivery !== 1 ? 's' : ''}`
          : 'Available';
        resultEl.innerHTML = `
          <span class="delivery-check-success">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            ${days}
            ${json.data.rate ? `<span class="delivery-check-rate"> — ₹${Number(json.data.rate).toFixed(0)}</span>` : ''}
          </span>
        `;
      } else {
        resultEl.innerHTML = '<span class="delivery-check-error">Not available for this pincode</span>';
      }
    } catch (err) {
      resultEl.innerHTML = '<span class="delivery-check-error">Could not check availability. Try again.</span>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check';
    }
  }

  btn.addEventListener('click', checkPincode);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkPincode();
  });
}
