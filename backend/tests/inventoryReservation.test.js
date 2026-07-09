process.env.JWT_SECRET = 'mushroom-spore-secret-key-123';

const request = require('supertest');

describe('Inventory reservation API', () => {
  let app;
  let db;

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    db = require('../src/config/db');
    db.resetMockStore();

    const mockStore = db._getMockStore();
    mockStore.products.push({
      id: 'prod-reserve-test',
      name: 'Reserve Test Product',
      stock: 3,
      price: 100,
      gst_rate: 5,
    });

    app = require('../src/server');
  });

  test('creates an active reservation for cart items without reducing stock', async () => {
    const res = await request(app)
      .post('/api/inventory/reserve')
      .send({ items: [{ productId: 'prod-reserve-test', quantity: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const mockStore = db._getMockStore();
    expect(mockStore.inventory_reservations).toHaveLength(1);
    expect(mockStore.inventory_reservations[0].status).toBe('active');
    expect(mockStore.inventory_reservations[0].quantity).toBe(2);

    const product = mockStore.products.find((p) => p.id === 'prod-reserve-test');
    expect(product.stock).toBe(3);
  });
});
