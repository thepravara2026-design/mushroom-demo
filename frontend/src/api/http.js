import { state, clearAuth } from '../utils/state.js';

export const API_BASE = '/api';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithAuth(path, options = {}, { retries = 2, retryDelay = 300 } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

      if (res.status === 401) {
        // clear auth and surface a specific error to caller
        clearAuth();
        window.location.reload();
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(body.error || 'API Request Failed');
        err.status = res.status;
        err.body = body;
        throw err;
      }

      return body;
    } catch (err) {
      // Retry on network errors or 5xx responses
      const shouldRetry = attempt < retries && (!err.status || (err.status >= 500 && err.status < 600));
      if (!shouldRetry) throw err;
      attempt += 1;
      await sleep(retryDelay * Math.pow(2, attempt - 1));
    }
  }
}
