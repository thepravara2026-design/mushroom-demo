export function renderOrderReviewPage(container, deliveryFormData, state) {
  const itemsHtml = (state.cart || []).map(item => `
    <div class="or-item">
      <span class="or-item-name">${item.name || 'Item'} (x${item.quantity || 1})</span>
      <span class="or-item-price">₹${(item.price * (item.quantity || 1)).toFixed(2)}</span>
    </div>
  `).join('');

  const subtotal = (state.cart || []).reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
  const gst = +(subtotal * 0.05).toFixed(2);
  const discount = state.activePromo ? 50 : 0;
  const total = subtotal + gst - discount;

  container.innerHTML = `
    <div class="order-review-wrap">
      <h3>Review Your Order</h3>
      
      <div class="or-section">
        <div class="or-section-header">
          <h4>Delivery Address</h4>
          <button id="orev-back-btn" class="or-edit-btn">
            <i class="fa-solid fa-pen"></i> Edit Details
          </button>
        </div>
        <div class="or-address">
          <p><strong>${deliveryFormData.customer_name || ''}</strong></p>
          <p>${deliveryFormData.address_line1 || ''}</p>
          ${deliveryFormData.address_line2 ? `<p>${deliveryFormData.address_line2}</p>` : ''}
          <p>${deliveryFormData.city || ''}, ${deliveryFormData.state || ''} - ${deliveryFormData.pincode || ''}</p>
          <p>Phone: ${deliveryFormData.delivery_phone || ''}</p>
          ${deliveryFormData.customer_email ? `<p>Email: ${deliveryFormData.customer_email}</p>` : ''}
        </div>
      </div>

      <div class="or-section">
        <div class="or-section-header">
          <h4>Items in Order</h4>
        </div>
        ${itemsHtml}
      </div>

      <div class="or-section">
        <div class="or-price-row">
          <span>Subtotal</span>
          <span>₹${subtotal.toFixed(2)}</span>
        </div>
        <div class="or-price-row">
          <span>GST (5%)</span>
          <span>₹${gst.toFixed(2)}</span>
        </div>
        ${discount > 0 ? `
        <div class="or-price-row or-discount">
          <span>Promo Discount</span>
          <span>-₹${discount.toFixed(2)}</span>
        </div>
        ` : ''}
        <div class="or-price-row or-total">
          <strong>Total Amount</strong>
          <strong>₹${total.toFixed(2)}</strong>
        </div>
      </div>

      <div class="or-actions">
        <button id="orev-pay-btn" class="btn btn-primary btn-block or-place-btn">
          <i class="fa-solid fa-credit-card"></i> Proceed to Payment
        </button>
        <button id="orev-back-btn-secondary" class="btn btn-secondary btn-block">
          <i class="fa-solid fa-arrow-left"></i> Back to Details
        </button>
      </div>
    </div>
  `;

  const goBack = () => {
    if (typeof window.__goBackToCheckoutForm === 'function') {
      window.__goBackToCheckoutForm();
    }
  };

  document.getElementById('orev-back-btn')?.addEventListener('click', goBack);
  document.getElementById('orev-back-btn-secondary')?.addEventListener('click', goBack);

  document.getElementById('orev-pay-btn')?.addEventListener('click', () => {
    if (typeof window.__proceedToPayment === 'function') {
      window.__proceedToPayment();
    }
  });
}

