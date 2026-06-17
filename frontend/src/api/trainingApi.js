import { fetchWithAuth } from './client.js';

export const trainingApi = {
  getTrainings: () => fetchWithAuth('/trainings'),
  createTraining: (body) => fetchWithAuth('/trainings', { method: 'POST', body: JSON.stringify(body) }),
  updateTraining: (id, body) => fetchWithAuth(`/trainings/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),
  deleteTraining: (id) => fetchWithAuth(`/trainings/${id}`, { method: 'DELETE' }),
  enroll: (trainingId, body = {}) => fetchWithAuth(`/trainings/${trainingId}/enroll`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  getMyEnrollments: () => fetchWithAuth('/trainings/my-enrollments'),
};
