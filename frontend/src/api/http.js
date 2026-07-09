import { state, clearAuth } from '../utils/state.js';

const _rawBase = import.meta.env.VITE_API_BASE_URL || '';
// Normalize configured backend base so both of these are accepted:
//  - https://example.railway.app
//  - https://example.railway.app/ (with trailing slash)
//  - https://example.railway.app/api
// Resulting API_BASE always ends with '/api' (or is '/api' fallback)
export const API_BASE = (_rawBase && !_rawBase.endsWith('/api'))
  ? _rawBase.replace(/\/+$/,'') + '/api'
  : (_rawBase || '/api');

if (import.meta.env.DEV) {
  console.log("VITE_API_BASE_URL =", import.meta.env.VITE_API_BASE_URL);
  console.log("API_BASE =", API_BASE);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getApiErrorMessage(error) {
  if (!error) return 'Unknown error occurred.';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  if (error.body && error.body.error) return error.body.error;
  if (error.status === 401) return 'Unauthorized. Please log in again.';
  return 'API request failed. Please try again.';
}

export async function fetchWithAuth(
  path,
  options = {},
  { retries = 2, retryDelay = 300 } = {},
) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...options, headers });

      if (res.status === 401) {
        // clear auth and surface a specific error to caller
        clearAuth();
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

      // Unwrap standardized backend wrapper if present
      if (
        body
        && typeof body === 'object'
        && body.success === true
        && Object.prototype.hasOwnProperty.call(body, 'data')
      ) {
        return body.data;
      }

      if (body && typeof body === 'object' && body.success === false) {
        const err = new Error(body.error || 'API Request Failed');
        err.status = body.status || res.status;
        err.body = body;
        throw err;
      }

      return body;
    } catch (err) {
      // Retry on network errors or 5xx responses
      const shouldRetry = attempt < retries
        && (!err.status || (err.status >= 500 && err.status < 600));
      if (!shouldRetry) throw err;
      attempt += 1;
      await sleep(retryDelay * 2 ** (attempt - 1));
    }
  }
}
