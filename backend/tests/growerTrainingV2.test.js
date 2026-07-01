process.env.JWT_SECRET = 'mushroom-spore-secret-key-123';

const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('Grower Training v2 API', () => {
  let app;
  let growerToken;
  let adminToken;

  beforeEach(() => {
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    jest.resetModules();
    app = require('../src/server');
    const secret = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';
    growerToken = jwt.sign(
      { userId: 'user-grower', role: 'grower', email: 'grower@sporekart.com' },
      secret,
      { expiresIn: '1h' },
    );
    adminToken = jwt.sign(
      { userId: 'user-admin', role: 'admin', email: 'admin@sporekart.com' },
      secret,
      { expiresIn: '1h' },
    );
  });

  test('GET /api/trainings returns trainings with nested batches', async () => {
    const res = await request(app).get('/api/trainings');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('batches');
  });

  test('GET /api/trainings/batches/:id returns batch with seats_left', async () => {
    const listRes = await request(app).get('/api/trainings');
    const batches = listRes.body.data.flatMap(t => t.batches || []);
    if (batches.length === 0) return; // skip if no batches seeded

    const batchId = batches[0].id;
    const res = await request(app).get(`/api/trainings/batches/${batchId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('seats_left');
    expect(typeof res.body.data.seats_left).toBe('number');
  });

  describe('Cancellation Policy Engine', () => {
    test('POST /api/trainings/enrollments/:id/cancel rejects if enrollment does not exist', async () => {
      const res = await request(app)
        .post('/api/trainings/enrollments/nonexistent-id/cancel')
        .set('Authorization', `Bearer ${growerToken}`)
        .send({ reason: 'Test cancellation' });
      expect(res.status).toBe(404);
    });

    test('POST /api/trainings/enrollments/:id/cancel rejects if enrollment not confirmed', async () => {
      const listRes = await request(app).get('/api/trainings');
      const batches = listRes.body.data.flatMap(t => t.batches || []);
      if (batches.length === 0) return;

      const batch = batches[0];
      if (batch.seats_left <= 0) return;

      const regRes = await request(app)
        .post(`/api/trainings/batches/${batch.id}/register`)
        .set('Authorization', `Bearer ${growerToken}`)
        .send({ role: 'grower' });
      if (regRes.status !== 200) return;

      const enrollmentId = regRes.body.data.enrollment_id;
      const cancelRes = await request(app)
        .post(`/api/trainings/enrollments/${enrollmentId}/cancel`)
        .set('Authorization', `Bearer ${growerToken}`)
        .send({ reason: 'Test cancel before payment' });
      // pending_payment enrollments cannot be cancelled
      expect(cancelRes.status).toBe(400);
    });
  });

  describe('Admin Routes', () => {
    test('GET /api/trainings/admin/dashboard returns stats', async () => {
      const res = await request(app)
        .get('/api/trainings/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('total_batches');
      expect(res.body.data).toHaveProperty('active_enrollments');
    });

    test('POST /api/trainings/admin/batches creates a batch', async () => {
      const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await request(app)
        .post('/api/trainings/admin/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          training_id: 'train-1',
          title: 'Test Batch',
          start_date: futureDate,
          end_date: futureDate,
          capacity: 10,
          price_actual: 999,
          instructor: 'Test Instructor',
          location: 'Test Location',
          cancellation_cutoff_days: 3,
        });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('id');
    });

    test('POST /api/trainings/admin/enrollments/:id/attendance marks attendance', async () => {
      const regRes = await request(app)
        .post('/api/trainings/batches/batch-1/register')
        .set('Authorization', `Bearer ${growerToken}`)
        .send({ role: 'grower' });
      if (regRes.status !== 200) return;

      const enrollmentId = regRes.body.data.enrollment_id;

      const res = await request(app)
        .post(`/api/trainings/admin/enrollments/${enrollmentId}/attendance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ attendance: 'present' });
      expect(res.status).toBe(400); // enrollment is pending_payment, not confirmed
    });

    test('GET /api/trainings/admin/action-logs returns logs', async () => {
      const res = await request(app)
        .get('/api/trainings/admin/action-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('Registration Flow', () => {
    test('POST /api/trainings/batches/:id/register creates enrollment and Razorpay order', async () => {
      const listRes = await request(app).get('/api/trainings');
      const batches = listRes.body.data.flatMap(t => t.batches || []);
      const batch = batches.find(b => b.seats_left > 0);
      if (!batch) return;

      const res = await request(app)
        .post(`/api/trainings/batches/${batch.id}/register`)
        .set('Authorization', `Bearer ${growerToken}`)
        .send({ role: 'grower' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('enrollment_id');
      expect(res.body.data).toHaveProperty('razorpay_order_id');
      expect(res.body.data).toHaveProperty('amount');
    });

    test('POST /api/trainings/batches/:id/register rejects duplicate registration', async () => {
      const listRes = await request(app).get('/api/trainings');
      const batches = listRes.body.data.flatMap(t => t.batches || []);
      const batch = batches.find(b => b.seats_left > 0);
      if (!batch) return;

      // First registration
      const first = await request(app)
        .post(`/api/trainings/batches/${batch.id}/register`)
        .set('Authorization', `Bearer ${growerToken}`)
        .send({ role: 'grower' });
      if (first.status !== 200) return;

      // Second registration should be rejected
      const second = await request(app)
        .post(`/api/trainings/batches/${batch.id}/register`)
        .set('Authorization', `Bearer ${growerToken}`)
        .send({ role: 'grower' });
      expect(second.status).toBe(409);
    });
  });
});
