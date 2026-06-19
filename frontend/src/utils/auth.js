import { state, clearAuth } from './state.js';

export function isAuthenticated() {
  return Boolean(state && state.token && state.user);
}

export function getUser() {
  return state.user || null;
}

export function requireRole(role) {
  return (to = () => {}, fallback = () => {}) => {
    if (isAuthenticated() && state.user.role === role) return to();
    return fallback();
  };
}

export function requireAnyRole(roles = []) {
  return (to = () => {}, fallback = () => {}) => {
    if (isAuthenticated() && roles.includes((state.user || {}).role)) return to();
    return fallback();
  };
}

export function logoutAndRedirect() {
  clearAuth();
  window.location.hash = '#shop';
  window.location.reload();
}

export function createEventSourceWithAuth(url, token) {
  const eventTarget = new EventTarget();
  let abortController = new AbortController();
  let reconnectTimeout = null;
  let reader = null;

  async function connect() {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        signal: abortController.signal,
      });
      if (!response.ok) {
        eventTarget.dispatchEvent(new CustomEvent('error', { detail: { status: response.status } }));
        return;
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let eventType = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            data = line.slice(6);
          } else if (line === '' && data) {
            eventTarget.dispatchEvent(new MessageEvent(eventType, { data }));
            eventType = 'message';
            data = '';
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    }
  }

  connect();

  eventTarget.addEventListener = eventTarget.addEventListener.bind(eventTarget);
  eventTarget.removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
  eventTarget.close = () => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    abortController.abort();
    abortController = new AbortController();
  };

  return eventTarget;
}
