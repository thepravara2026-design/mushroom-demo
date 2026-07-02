process.env.JWT_SECRET = 'mushroom-spore-secret-key-123';

const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('E-Commerce Edge Cases Test Suite', () => {
  let app;
  let db;
  let buyerToken;
  let adminToken;
  let growerToken;

  beforeEach(() => {
    // Force mock mode
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    jest.resetModules();
    db = require('../src/config/db');
    db.resetMockStore();

    app = require('../src/server');
    const secret = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';
    
    buyerToken = jwt.sign(
      { userId: 'user-buyer', role: 'buyer', email: 'buyer@sporekart.com' },
      secret,
      { expiresIn: '1h' }
    );
    growerToken = jwt.sign(
      { userId: 'user-grower', role: 'grower', email: 'grower@sporekart.com' },
      secret,
      { expiresIn: '1h' }
    );
    adminToken = jwt.sign(
      { userId: 'user-admin', role: 'admin', email: 'admin@sporekart.com' },
      secret,
      { expiresIn: '1h' }
    );
  });

  describe('Authentication & Gating Edge Cases', () => {
    test('EC-AUTH-003: User Role Parameter Tampering during OTP request/verification', async () => {
      // Seed user-grower as buyer or trainee, and verify we cannot manually override role to admin
      const authService = require('../src/services/authService');
      const email = 'hacker@sporekart.com';
      
      // Requesting OTP with admin role should be rejected
      const reqRes = await request(app)
        .post('/api/auth/request-otp')
        .send({ email, role: 'admin', fullName: 'Hacker' });
        
      expect(reqRes.status).toBe(400);
      expect(reqRes.body.error).toContain('buyer, grower');
    });

    test('EC-AUTH-004: Direct Checkout block on unauthenticated user', async () => {
      // Attempt checkout without auth token
      const orderPayload = {
        items: [{ id: 'prod-1', quantity: 1 }],
        delivery_phone: '9876543212',
        address_line1: '123 Cultivator Way',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001'
      };

      const res = await request(app)
        .post('/api/orders/checkout')
        .send(orderPayload);

      // Unauthenticated requests should be rejected
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('Cart & Inventory Reservation Edge Cases', () => {
    test('EC-CART-001: Concurrent Stock Grab (Overselling Race Condition)', async () => {
      const dbStore = db._getMockStore();
      
      // Set stock to 1
      dbStore.products = [{
        id: 'prod-race',
        name: 'Race Spores',
        price: 100.0,
        stock: 1,
        gst_rate: 5
      }];

      // We will perform two sequential attempts to place orders
      const orderPayload = {
        items: [{ id: 'prod-race', quantity: 1 }],
        delivery_phone: '9876543211',
        address_line1: '456 Buyer St',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001'
      };

      // Place first order
      const firstRes = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send(orderPayload);
      
      expect(firstRes.status).toBe(200);

      // Place second order
      const secondRes = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send(orderPayload);
        
      // Second checkout must fail as stock is depleted
      expect(secondRes.status).toBe(400);
      expect(secondRes.body.error).toContain('Insufficient stock');
    });
  });

  describe('Order State Machine Edge Cases', () => {
    test('EC-STATE-001: Illegal Backward State Transition', async () => {
      const OrderStateService = require('../src/modules/orders/OrderStateService');
      
      // Test illegal transition from completed/cancelled backward
      const cancelToProcess = OrderStateService.isValidTransition('cancelled', 'processing');
      const refundToPaid = OrderStateService.isValidTransition('refunded', 'paid');
      const completedToPending = OrderStateService.isValidTransition('completed', 'pending');

      expect(cancelToProcess).toBe(false);
      expect(refundToPaid).toBe(false);
      expect(completedToPending).toBe(false);
    });
  });

  describe('Refund System & Cancellation Edge Cases', () => {
    test('EC-REF-002: Partial Refund Exceeding Order Value', async () => {
      // Re-acquire db after resetModules()
      const freshDb = require('../src/config/db');
      const dbStore = freshDb._getMockStore();
      const orderId = 'order-ref-test';
      dbStore.orders = [{
        id: orderId,
        user_id: 'user-buyer',
        total: 1000.00,
        status: 'paid',
        payment_status: 'paid',
        refund_status: 'none',
        total_refunded_amount: 0.00,
        razorpay_payment_id: 'pay_test_123'
      }];

      // Mock payment details to match
      const RefundService = require('../src/modules/refunds/RefundService');
      
      // Perform initial partial refund of 600
      const res1 = await RefundService.initiatePartialRefund(orderId, 600.00, 'Damage', 'Note', { role: 'admin', userId: 'user-admin' });
      expect(res1.refund).toBeDefined();
      expect(res1.order.total_refunded_amount).toBe(600.00);

      // Try second partial refund of 500 (total would be 1100, exceeding 1000)
      await expect(
        RefundService.initiatePartialRefund(orderId, 500.00, 'Damage', 'Note', { role: 'admin', userId: 'user-admin' })
      ).rejects.toThrow(/exceeds remaining/i);
    });
  });
});
