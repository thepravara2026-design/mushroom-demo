import { fetchWithAuth } from './client.js';

export const searchApi = {
  search: (q) => fetchWithAuth(`/search?q=${encodeURIComponent(q)}`),
};
