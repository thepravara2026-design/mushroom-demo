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

  // ── Grower Training v2 ──
  getBatch: (id) => fetchWithAuth(`/trainings/batches/${id}`),
  registerForBatch: (batchId, body = {}) => fetchWithAuth(`/trainings/batches/${batchId}/register`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  verifyPayment: (details) => fetchWithAuth('/trainings/verify-payment', {
    method: 'POST',
    body: JSON.stringify(details),
  }),
  cancelEnrollment: (enrollmentId, body = {}) => fetchWithAuth(`/trainings/enrollments/${enrollmentId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  // ── Admin Console ──
  getAdminDashboard: () => fetchWithAuth('/trainings/admin/dashboard'),
  getAllBatches: () => fetchWithAuth('/trainings/admin/batches'),
  getAllEnrollments: () => fetchWithAuth('/trainings/enrollments'),
  createBatch: (body) => fetchWithAuth('/trainings/admin/batches', { method: 'POST', body: JSON.stringify(body) }),
  updateBatch: (id, body) => fetchWithAuth(`/trainings/admin/batches/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  cloneBatch: (id, body = {}) => fetchWithAuth(`/trainings/admin/batches/${id}/clone`, { method: 'POST', body: JSON.stringify(body) }),
  forceCancelBatch: (id, body = {}) => fetchWithAuth(`/trainings/admin/batches/${id}/force-cancel`, { method: 'POST', body: JSON.stringify(body) }),
  manualRefund: (enrollmentId, body) => fetchWithAuth(`/trainings/admin/enrollments/${enrollmentId}/manual-refund`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  markAttendance: (enrollmentId, body) => fetchWithAuth(`/trainings/admin/enrollments/${enrollmentId}/attendance`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  getActionLogs: () => fetchWithAuth('/trainings/admin/action-logs'),
};
