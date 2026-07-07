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

export function showConfirmModal({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onCancel, showReason = false, reasonPlaceholder = '' } = {}) {
  const existing = document.getElementById('spk-confirm-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'spk-confirm-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:99998;';

  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:16px;padding:28px 32px;max-width:440px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.15);font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;position:relative;animation:spkFadeIn 0.3s ease;';

  let reasonInput = null;

  if (title) {
    const titleEl = document.createElement('h3');
    titleEl.style.cssText = 'margin:0 0 10px;font-size:1.2rem;color:#1d2939;';
    titleEl.textContent = title;
    card.appendChild(titleEl);
  }

  if (message) {
    const msgEl = document.createElement('p');
    msgEl.style.cssText = 'margin:0 0 16px;font-size:0.95rem;color:#475569;line-height:1.5;';
    msgEl.textContent = message;
    card.appendChild(msgEl);
  }

  if (showReason) {
    reasonInput = document.createElement('textarea');
    reasonInput.placeholder = reasonPlaceholder;
    reasonInput.style.cssText = 'width:100%;min-height:70px;padding:10px 12px;border:1px solid #d0d5dd;border-radius:8px;font-size:0.9rem;font-family:inherit;resize:vertical;box-sizing:border-box;margin-bottom:16px;outline:none;';
    reasonInput.addEventListener('focus', () => { reasonInput.style.borderColor = '#8b5cf6'; });
    reasonInput.addEventListener('blur', () => { reasonInput.style.borderColor = '#d0d5dd'; });
    card.appendChild(reasonInput);
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = cancelText;
  cancelBtn.style.cssText = 'padding:10px 20px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:#344054;font-size:0.9rem;cursor:pointer;font-family:inherit;';
  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = '#f9fafb'; });
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = '#fff'; });
  btnRow.appendChild(cancelBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = confirmText;
  confirmBtn.style.cssText = 'padding:10px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:0.9rem;cursor:pointer;font-family:inherit;';
  confirmBtn.addEventListener('mouseenter', () => { confirmBtn.style.background = '#b91c1c'; });
  confirmBtn.addEventListener('mouseleave', () => { confirmBtn.style.background = '#dc2626'; });
  btnRow.appendChild(confirmBtn);

  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  if (!document.getElementById('spk-popup-styles')) {
    const style = document.createElement('style');
    style.id = 'spk-popup-styles';
    style.textContent = '@keyframes spkFadeIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}';
    document.head.appendChild(style);
  }

  const close = (result) => {
    overlay.remove();
    return result;
  };

  cancelBtn.addEventListener('click', () => {
    if (onCancel) onCancel();
    close(false);
  });

  confirmBtn.addEventListener('click', () => {
    if (onConfirm) onConfirm(reasonInput ? reasonInput.value : undefined);
    close(true);
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      if (onCancel) onCancel();
      close(false);
    }
  });

  return { overlay, card, reasonInput, close };
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

/**
 * Premium role-switch modal.
 * Shows when a user tries to access a section their role doesn't permit.
 * @param {object} opts
 * @param {string} opts.title - Modal heading
 * @param {string} opts.message - Explanation text
 * @param {string} opts.targetRole - The role needed ('buyer', 'grower', 'trainee')
 * @param {string} opts.targetHash - Hash to redirect to after re-register
 * @param {string} opts.icon - Emoji or icon HTML
 * @param {string} opts.accentColor - CSS color for accent elements
 */
export function showRoleSwitchModal({ title, message, targetRole, targetHash, icon = '🔄', accentColor = '#8b5cf6' } = {}) {
  const existing = document.getElementById('spk-role-switch-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'spk-role-switch-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);z-index:99998;padding:18px;backdrop-filter:blur(4px);';

  const card = document.createElement('div');
  card.style.cssText = `background:#fff;border-radius:20px;padding:36px 40px 32px;max-width:460px;width:100%;box-shadow:0 25px 80px rgba(0,0,0,0.2);text-align:center;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;position:relative;animation:spkFadeIn 0.35s ease;`;

  // Icon circle
  const iconWrap = document.createElement('div');
  iconWrap.style.cssText = `width:64px;height:64px;border-radius:50%;background:${accentColor}15;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:2rem;`;
  iconWrap.innerHTML = icon;
  card.appendChild(iconWrap);

  if (title) {
    const titleEl = document.createElement('h3');
    titleEl.style.cssText = 'margin:0 0 10px;font-size:1.25rem;font-weight:700;color:#0f172a;line-height:1.3;';
    titleEl.textContent = title;
    card.appendChild(titleEl);
  }

  if (message) {
    const msgEl = document.createElement('p');
    msgEl.style.cssText = 'margin:0 0 24px;font-size:0.95rem;color:#475569;line-height:1.6;';
    msgEl.innerHTML = message;
    card.appendChild(msgEl);
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap;';

  const switchBtn = document.createElement('button');
  const roleLabel = targetRole === 'buyer' ? 'Buyer Account' : targetRole === 'grower' ? 'Cultivator Account' : 'Trainee Account';
  switchBtn.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Register as ${roleLabel}`;
  switchBtn.style.cssText = `padding:12px 28px;border:none;border-radius:12px;background:${accentColor};color:#fff;font-size:0.95rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;box-shadow:0 4px 14px ${accentColor}40;`;
  switchBtn.addEventListener('mouseenter', () => { switchBtn.style.transform = 'translateY(-1px)'; switchBtn.style.boxShadow = `0 6px 20px ${accentColor}50`; });
  switchBtn.addEventListener('mouseleave', () => { switchBtn.style.transform = ''; switchBtn.style.boxShadow = `0 4px 14px ${accentColor}40`; });
  btnRow.appendChild(switchBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.innerHTML = 'Stay';
  dismissBtn.style.cssText = 'padding:12px 24px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;color:#475569;font-size:0.95rem;cursor:pointer;font-family:inherit;transition:all 0.2s;';
  dismissBtn.addEventListener('mouseenter', () => { dismissBtn.style.background = '#f8fafc'; });
  dismissBtn.addEventListener('mouseleave', () => { dismissBtn.style.background = '#fff'; });
  btnRow.appendChild(dismissBtn);

  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  if (!document.getElementById('spk-popup-styles')) {
    const style = document.createElement('style');
    style.id = 'spk-popup-styles';
    style.textContent = '@keyframes spkFadeIn{from{opacity:0;transform:scale(0.92) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}';
    document.head.appendChild(style);
  }

  const close = () => overlay.remove();

  dismissBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  switchBtn.addEventListener('click', () => {
    close();
    // Use globally exposed auth modal
    if (window.authModal && typeof window.authModal.open === 'function') {
      window.authModal.open(targetRole, () => {
        if (targetHash) window.location.hash = targetHash;
      });
    }
  });

  return { overlay, card, close };
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
