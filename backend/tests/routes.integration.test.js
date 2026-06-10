const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('Backend API integration tests', () => {
  let app;
  let adminToken;

  beforeEach(() => {
    jest.resetModules();
    app = require('../src/server');
    const secret = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';
    adminToken = jwt.sign(
      { id: 'user-admin', role: 'admin', email: 'admin@sporekart.com' },
      secret,
      { expiresIn: '1h' },
    );
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
