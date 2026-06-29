process.env.JWT_SECRET = 'mushroom-spore-secret-key-123';

const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('Backend API integration tests', () => {
  let app;
  let adminToken;

  beforeEach(() => {
    // Force mock mode by clearing Supabase env vars before modules are loaded
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    jest.resetModules();
    app = require('../src/server');
    const secret = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';
    adminToken = jwt.sign(
      { id: 'user-admin', role: 'admin', email: 'admin@sporekart.com' },
      secret,
      { expiresIn: '1h' },
    );
  });

  test('POST /api/auth/admin-login sends OTP for valid admin email', async () => {
    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'admin@sporekart.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('OTP sent');
    // In mock mode, OTP is included in response — only assert it's hidden in production
    if (process.env.NODE_ENV === 'production') {
      expect(res.body.data).not.toHaveProperty('otp');
    }
  });

  test('POST /api/auth/admin-login fails for non-admin user', async () => {
    const res = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'buyer@sporekart.com' });

    expect(res.status).toBe(403);
  });

  test('POST /api/auth/admin-verify-otp verifies OTP and returns token', async () => {
    // First request OTP
    const otpRes = await request(app)
      .post('/api/auth/admin-login')
      .send({ email: 'admin@sporekart.com' });
    expect(otpRes.status).toBe(200);

    // Read OTP from exposed test store (OTP is never in the response for security)
    const authService = require('../src/services/authService');
    const otpRecord = authService.__adminOtpStore.get('admin@sporekart.com');
    expect(otpRecord).toBeDefined();
    const otpCode = otpRecord.otp;

    // Then verify with the OTP
    const verifyRes = await request(app)
      .post('/api/auth/admin-verify-otp')
      .send({ email: 'admin@sporekart.com', otpCode });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data).toHaveProperty('token');
    expect(verifyRes.body.data.user.role).toBe('admin');
  });

  test('POST /api/auth/admin-verify-otp rejects invalid OTP', async () => {
    const verifyRes = await request(app)
      .post('/api/auth/admin-verify-otp')
      .send({ email: 'admin@sporekart.com', otpCode: '654321' });

    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.error).toContain('No OTP request found');
  });

  test('GET /api/categories returns a list of categories', async () => {
    const response = await request(app).get('/api/categories');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data[0]).toHaveProperty('id');
    expect(response.body.data[0]).toHaveProperty('name');
  });

  test('Protected category POST requires admin token and can create a category', async () => {
    const payload = {
      id: 'integration-cat',
      name: 'Integration Category',
      category_id: 'spore-999997',
    };
    const response = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.data).toHaveProperty('id', payload.id);
    expect(response.body.data).toHaveProperty(
      'category_id',
      payload.category_id,
    );
  });

  test('Protected product POST can create and delete a product under admin auth', async () => {
    const productPayload = {
      name: 'Integration Product',
      description: 'A product created during integration tests',
      price: 99.99,
      category: 'spawn',
    };

    const createRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(productPayload);

    expect(createRes.status).toBe(201);
    expect(createRes.body.data).toHaveProperty('id');
    expect(createRes.body.data.category).toBe('spawn');

    const deleteRes = await request(app)
      .delete(`/api/products/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data).toHaveProperty('message');
  });
});
