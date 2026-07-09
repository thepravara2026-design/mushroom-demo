import { API_BASE } from '../api/client.js';

let otpTimer = null;

export function renderCodOtpScreen(container, { orderId, phone, onVerified, onSwitchToOnline }) {
  container.innerHTML = `
    <div class="cod-otp-wrap">
      <div class="cod-otp-card">
        <div class="cod-otp-icon"><i class="fa-solid fa-mobile-screen-button"></i></div>
        <h3>Confirm COD Order</h3>
        <p class="cod-otp-subtitle">Enter the OTP sent to <strong>${phone || 'your phone'}</strong></p>
        
        <div class="cod-otp-boxes">
          <input type="text" inputmode="numeric" maxlength="1" class="cod-otp-box" id="cod-otp-box-0" data-otp-idx="0" />
          <input type="text" inputmode="numeric" maxlength="1" class="cod-otp-box" data-otp-idx="1" />
          <input type="text" inputmode="numeric" maxlength="1" class="cod-otp-box" data-otp-idx="2" />
          <input type="text" inputmode="numeric" maxlength="1" class="cod-otp-box" data-otp-idx="3" />
          <input type="text" inputmode="numeric" maxlength="1" class="cod-otp-box" data-otp-idx="4" />
          <input type="text" inputmode="numeric" maxlength="1" class="cod-otp-box" data-otp-idx="5" />
        </div>
        
        <!-- Hidden input for backward compatibility and test script access -->
        <input type="hidden" id="cod-otp-input" />
        
        <div id="cod-otp-status" class="cod-otp-status" style="margin-top:0.5rem; min-height:1.5rem;"></div>
        
        <div class="cod-otp-actions" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 8px;">
          <button id="cod-otp-verify-btn" class="btn btn-primary btn-block" style="width: 100%;">
            Verify & Place Order
          </button>
          <button id="cod-otp-switch-btn" class="btn btn-secondary btn-block" style="width: 100%;">
            Pay Online Instead
          </button>
        </div>
        
        <p id="cod-otp-timer" class="cod-otp-timer" style="margin-top: 1.25rem; font-size: 0.82rem; font-weight: 600;"></p>
      </div>
    </div>
  `;

  const inputHidden = container.querySelector('#cod-otp-input');
  const verifyBtn = container.querySelector('#cod-otp-verify-btn');
  const statusEl = container.querySelector('#cod-otp-status');
  const timerEl = container.querySelector('#cod-otp-timer');
  const boxes = container.querySelectorAll('.cod-otp-box');

  // Focus the first box automatically
  setTimeout(() => boxes[0]?.focus(), 100);

  // Handle digit inputs focus shifting and value syncing
  boxes.forEach((box, idx) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val) {
        if (idx < 5) {
          boxes[idx + 1].focus();
        }
      }
      syncHiddenValue();
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!box.value && idx > 0) {
          boxes[idx - 1].focus();
          boxes[idx - 1].value = '';
        } else {
          box.value = '';
        }
        syncHiddenValue();
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text').trim();
      if (/^\d{6}$/.test(pasted)) {
        for (let i = 0; i < 6; i++) {
          boxes[i].value = pasted[i];
        }
        syncHiddenValue();
        verifyBtn.focus();
      }
    });
  });

  function syncHiddenValue() {
    let combined = '';
    boxes.forEach(b => {
      combined += b.value;
    });
    inputHidden.value = combined;
  }

  let timeLeft = 300;

  function updateTimer() {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    timerEl.textContent = `OTP expires in ${m}:${s.toString().padStart(2, '0')}`;
    if (timeLeft <= 0) {
      clearInterval(otpTimer);
      timerEl.textContent = 'OTP expired. Please try again.';
      timerEl.style.color = '#ef4444';
    }
    timeLeft--;
  }

  updateTimer();
  clearInterval(otpTimer);
  otpTimer = setInterval(updateTimer, 1000);

  verifyBtn.addEventListener('click', async () => {
    const otp = inputHidden.value.trim();
    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      statusEl.innerHTML = '<span class="cod-otp-error">Enter a valid 6-digit OTP</span>';
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';
    statusEl.innerHTML = '';

    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/verify-cod-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp })
      });
      const json = await res.json();

      if (json.success) {
        clearInterval(otpTimer);
        onVerified();
      } else {
        statusEl.innerHTML = `<span class="cod-otp-error">${json.error || 'Invalid OTP'}</span>`;
      }
    } catch (err) {
      statusEl.innerHTML = '<span class="cod-otp-error">Verification failed. Try again.</span>';
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify & Place Order';
    }
  });

  document.querySelector('#cod-otp-switch-btn').addEventListener('click', () => {
    clearInterval(otpTimer);
    onSwitchToOnline();
  });
}

