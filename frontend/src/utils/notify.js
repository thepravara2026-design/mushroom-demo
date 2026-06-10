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
