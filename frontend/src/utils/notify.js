function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function showPopupModal({ title, message, duration = 2000, refreshOnClose = false, redirectHash = '' } = {}) {
  const existing = document.getElementById('spk-popup-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'spk-popup-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:99998;';

  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:16px;padding:32px 40px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.15);text-align:center;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;position:relative;animation:spkFadeIn 0.3s ease;';

  if (title) {
    const titleEl = document.createElement('h3');
    titleEl.style.cssText = 'margin:0 0 8px;font-size:1.3rem;color:#1d2939;';
    titleEl.textContent = title;
    card.appendChild(titleEl);
  }

  if (message) {
    const msgEl = document.createElement('p');
    msgEl.style.cssText = 'margin:0 0 16px;font-size:1rem;color:#475569;line-height:1.5;';
    msgEl.textContent = message;
    card.appendChild(msgEl);
  }

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Dismiss';
  closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:none;border:none;font-size:1.5rem;cursor:pointer;color:#94a3b8;line-height:1;padding:4px;';
  closeBtn.setAttribute('aria-label', 'Close');
  card.appendChild(closeBtn);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  if (!document.getElementById('spk-popup-styles')) {
    const style = document.createElement('style');
    style.id = 'spk-popup-styles';
    style.textContent = '@keyframes spkFadeIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}';
    document.head.appendChild(style);
  }

  const done = () => {
    overlay.remove();
    if (refreshOnClose) {
      window.location.reload();
    } else if (redirectHash) {
      window.location.hash = redirectHash;
    }
  };

  closeBtn.addEventListener('click', done);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) done(); });

  if (duration > 0) {
    setTimeout(done, duration);
  }

  return { overlay, card, close: done };
}

export function showSuccessToast(message) {
  const existing = document.getElementById('spk-success-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'spk-success-toast';
  toast.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#2b8a56;color:#fff;padding:12px 18px;border-radius:8px;z-index:9999;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,0.12);';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function showErrorToast(message) {
  const existing = document.getElementById('spk-error-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'spk-error-toast';
  toast.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#c43d3d;color:#fff;padding:12px 18px;border-radius:8px;z-index:9999;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,0.12);';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

export function showInfoToast(message) {
  const existing = document.getElementById('spk-info-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'spk-info-toast';
  toast.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#2b6fb6;color:#fff;padding:12px 18px;border-radius:8px;z-index:9999;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,0.12);';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
