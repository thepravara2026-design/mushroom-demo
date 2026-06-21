import { fetchWithAuth } from './client.js';

export const locationApi = {
  async getStates() {
    return fetchWithAuth('/locations/states');
  },

  async getCities(stateName) {
    return fetchWithAuth(`/locations/states/${encodeURIComponent(stateName)}/cities`);
  },
};
