import { showErrorToast, showSuccessToast } from '../utils/notify.js';
import { API_BASE } from '../api/client.js';

export async function renderReturnPage(orderId) {
  const trackSection = document.getElementById('tracker-cancel-section');
  if (!trackSection) return;

  trackSection.innerHTML = `
    <div class="return-request-card" style="max-width:600px;margin:2rem auto;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <h3 style="margin:0 0 1rem 0;font-size:1.25rem;">Request a Return</h3>
      <p style="margin:0 0 1.5rem 0;color:#666;">Order #${orderId}</p>
      <form id="return-request-form">
        <div style="margin-bottom:1rem;">
          <label style="display:block;margin-bottom:0.5rem;font-weight:600;">Reason for Return</label>
          <select id="return-reason" required style="width:100%;padding:0.75rem;border:1px solid #ddd;border-radius:8px;">
            <option value="">Select a reason</option>
            <option value="defective">Product defective or damaged</option>
            <option value="wrong_item">Wrong item received</option>
            <option value="quality">Quality not as expected</option>
            <option value="expired">Product expired or near expiry</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;margin-bottom:0.5rem;font-weight:600;">Additional Details</label>
          <textarea id="return-details" rows="3" style="width:100%;padding:0.75rem;border:1px solid #ddd;border-radius:8px;resize:vertical;" placeholder="Describe the issue..."></textarea>
        </div>
        <div style="display:flex;gap:0.75rem;">
          <button type="submit" id="btn-submit-return" style="flex:1;padding:0.75rem;background:#2e7d32;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Submit Return Request</button>
          <button type="button" id="btn-cancel-return" style="padding:0.75rem 1.5rem;background:#f5f5f5;color:#333;border:1px solid #ddd;border-radius:8px;cursor:pointer;">Cancel</button>
        </div>
      </form>
      <div id="return-status" style="display:none;margin-top:1rem;padding:1rem;border-radius:8px;"></div>
    </div>
  `;

  document.getElementById('btn-cancel-return')?.addEventListener('click', () => {
    window.location.hash = '#track';
  });

  document.getElementById('return-request-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = document.getElementById('return-reason')?.value;
    const details = document.getElementById('return-details')?.value || '';
    const btn = document.getElementById('btn-submit-return');
    if (!reason) {
      showErrorToast('Please select a reason for return');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    try {
      const token = localStorage.getItem('token');
      const base = API_BASE || '';
      const res = await fetch(`${base}/orders/${orderId}/return-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason, details }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to submit return request');
      showSuccessToast('Return request submitted successfully');
      setTimeout(() => { window.location.hash = '#track'; }, 1500);
    } catch (err) {
      showErrorToast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Return Request';
    }
  });
}
