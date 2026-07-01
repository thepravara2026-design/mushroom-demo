export function renderPaymentRetryScreen(container, { orderId, amount, onRetry }) {
  container.innerHTML = `
    <div class="payment-retry-screen">
      <div class="payment-retry-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <h3>Payment Pending</h3>
      <p class="payment-retry-subtitle">Your payment of <strong>₹${(amount / 100).toFixed(0)}</strong> was not completed</p>
      <div class="payment-retry-options">
        <button id="retry-razorpay-btn" class="btn-primary payment-retry-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="4" width="22" height="16" rx="2"/>
            <line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          Retry with Card / UPI / NetBanking
        </button>
        <button id="retry-cod-btn" class="btn-outline payment-retry-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <circle cx="12" cy="12" r="2"/>
          </svg>
          Switch to Cash on Delivery
        </button>
      </div>
    </div>
  `;

  document.getElementById('retry-razorpay-btn').addEventListener('click', () => onRetry('online'));
  document.getElementById('retry-cod-btn').addEventListener('click', () => onRetry('cod'));
}
