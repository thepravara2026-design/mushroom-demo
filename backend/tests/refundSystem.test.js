const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const { OrderStates, isValidTransition, restockOrderItems } = require('../src/modules/orders/OrderStateService');
const { generateRefundIdempotencyKey, verifyWebhookSignature } = require('../src/modules/payments/PaymentService');
const RefundService = require('../src/modules/refunds/RefundService');
const RefundRepository = require('../src/modules/refunds/RefundRepository');
const crypto = require('crypto');

describe('Refund Management System', () => {
  let app;
  let adminToken;
  let buyerToken;
  let testOrderId;
  let testProductId = 'prod-1';

  beforeEach(async () => {
    // Force mock mode
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    
    // Clear mock tables
    db.from('orders').data = [];
    db.from('refunds').data = [];
    db.from('refund_audits').data = [];

    // Reset modules to reload config
    jest.resetModules();
    app = require('../src/server');

    const secret = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';
    
    adminToken = jwt.sign(
      { id: 'user-admin', role: 'admin', email: 'admin@sporekart.com' },
      secret,
      { expiresIn: '1h' }
    );

    buyerToken = jwt.sign(
      { id: 'user-buyer', role: 'buyer', email: 'buyer@sporekart.com' },
      secret,
      { expiresIn: '1h' }
    );

    // Create a mock product with some stock
    db.from('products').data = [
      {
        id: testProductId,
        name: 'Pink Oyster Spore Syringe (10ml)',
        stock: 100,
        price: 350.0,
        gst_rate: 5
      }
    ];

    // Create a mock order that is paid
    const orderData = {
      id: 'test-order-xyz',
      user_id: 'user-buyer',
      total: 350.0,
      subtotal: 350.0,
      gst_amount: 0.0,
      status: OrderStates.PAID,
      delivery_status: 'processing',
      razorpay_payment_id: 'pay_test_payment_123',
      razorpay_order_id: 'order_test_order_123',
      items: [
        {
          productId: testProductId,
          quantity: 2,
          price: 175.0,
          name: 'Pink Oyster Spore Syringe (10ml)'
        }
      ]
    };
    const { data: createdOrder } = await db.from('orders').insert(orderData).single();
    testOrderId = createdOrder.id;
  });

  describe('1. State Machine Transition Rules', () => {
    test('Should allow valid transitions', () => {
      expect(isValidTransition(OrderStates.PAID, OrderStates.CANCEL_REQUESTED)).toBe(true);
      expect(isValidTransition(OrderStates.CANCEL_REQUESTED, OrderStates.CANCEL_APPROVED)).toBe(true);
      expect(isValidTransition(OrderStates.CANCEL_APPROVED, OrderStates.REFUND_PENDING)).toBe(true);
      expect(isValidTransition(OrderStates.REFUND_PENDING, OrderStates.REFUND_INITIATED)).toBe(true);
      expect(isValidTransition(OrderStates.REFUND_INITIATED, OrderStates.REFUND_PROCESSING)).toBe(true);
      expect(isValidTransition(OrderStates.REFUND_PROCESSING, OrderStates.REFUND_COMPLETED)).toBe(true);
    });

    test('Should reject invalid transitions', () => {
      expect(isValidTransition(OrderStates.PAID, OrderStates.REFUND_COMPLETED)).toBe(false);
      expect(isValidTransition(OrderStates.CANCEL_REQUESTED, OrderStates.REFUND_INITIATED)).toBe(false);
      expect(isValidTransition(OrderStates.REFUND_COMPLETED, OrderStates.PAID)).toBe(false);
    });
  });

  describe('2. Order Cancellation & Auto-Refund Trigger', () => {
    test('Customer can request cancellation', async () => {
      const res = await request(app)
        .post(`/api/orders/${testOrderId}/request-cancel`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ reason: 'Changed my mind' });

      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe(OrderStates.CANCEL_REQUESTED);

      // Check audit log
      const logs = await RefundRepository.listAuditLogs(testOrderId);
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('CANCELLATION_REQUESTED');
    });

    test('Admin can approve cancellation and trigger refund', async () => {
      // Setup order in CANCEL_REQUESTED status
      await db.from('orders').update({ status: OrderStates.CANCEL_REQUESTED }).eq('id', testOrderId);

      const res = await request(app)
        .post(`/api/refunds/cancel-requests/${testOrderId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adminNote: 'Approved by admin' });

      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe(OrderStates.REFUND_INITIATED);
      expect(res.body.data.refund.refund_status).toBe('initiated');

      // Check stock was restocked
      const { data: product } = await db.from('products').select('stock').eq('id', testProductId).single();
      expect(product.stock).toBe(102); // 100 + 2 from order items
    });

    test('Admin can reject cancellation request', async () => {
      // Setup order in CANCEL_REQUESTED status
      await db.from('orders').update({ status: OrderStates.CANCEL_REQUESTED }).eq('id', testOrderId);

      const res = await request(app)
        .post(`/api/refunds/cancel-requests/${testOrderId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Already in shipping preparation stage' });

      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe(OrderStates.PAID);
      expect(res.body.data.order.delivery_status).toBe('processing');

      // Check audit log
      const logs = await RefundRepository.listAuditLogs(testOrderId);
      expect(logs.some(l => l.action === 'CANCEL_REJECTED')).toBe(true);
    });
  });

  describe('3. Partial Refunds Calculation & Validation', () => {
    test('Admin can initiate a partial refund', async () => {
      const res = await request(app)
        .post(`/api/refunds/partial-refund/${testOrderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ refundAmount: 150.0, reason: 'Damaged item', adminNote: 'Partial refund' });

      expect(res.status).toBe(200);
      expect(Number(res.body.data.order.total_refunded_amount)).toBe(150.0);
      expect(res.body.data.refund.refund_status).toBe('initiated');
    });

    test('Partial refund exceeding remaining balance should fail', async () => {
      // First partial refund of 200
      await request(app)
        .post(`/api/refunds/partial-refund/${testOrderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ refundAmount: 200.0, reason: 'Damaged item', adminNote: 'Partial refund' });

      // Second partial refund of 200 should fail (exceeds 350 total)
      const res = await request(app)
        .post(`/api/refunds/partial-refund/${testOrderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ refundAmount: 200.0, reason: 'Another damage', adminNote: 'Partial refund 2' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('exceeds remaining order balance');
    });
  });

  describe('4. Gateway Transaction Idempotency', () => {
    test('Idempotency key generation should be deterministic', () => {
      const key1 = generateRefundIdempotencyKey(testOrderId, 'pay_123', 150.00);
      const key2 = generateRefundIdempotencyKey(testOrderId, 'pay_123', 150.00);
      const key3 = generateRefundIdempotencyKey(testOrderId, 'pay_123', 150.01);

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    });
  });

  describe('5. Webhook Signature & Replay Protection', () => {
    test('verifyWebhookSignature should validate signatures correctly', () => {
      const secret = 'webhook_secret';
      const body = JSON.stringify({ event: 'refund.processed' });
      const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
      expect(verifyWebhookSignature(body, 'wrong_signature', secret)).toBe(false);
    });

    test('Webhook endpoint processes refund.processed events', async () => {
      // Initiate refund record
      const refundRecord = await db.from('refunds').insert({
        order_id: testOrderId,
        user_id: 'user-buyer',
        razorpay_payment_id: 'pay_test_payment_123',
        razorpay_refund_id: 'rfnd_test_refund_123',
        refund_amount: 350.0,
        refund_status: 'initiated',
        initiated_by: 'admin'
      }).single();

      // Mock webhook event payload
      const webhookPayload = {
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_test_refund_123',
              payment_id: 'pay_test_payment_123',
              amount: 35000,
              status: 'processed'
            }
          }
        }
      };

      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;
      const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(webhookPayload)).digest('hex');

      const res = await request(app)
        .post('/api/orders/webhook/razorpay')
        .set('x-razorpay-signature', signature)
        .send(webhookPayload);

      expect(res.status).toBe(200);

      // Verify refund record is updated to processed
      const { data: updatedRefund } = await db.from('refunds').select('refund_status').eq('id', refundRecord.id).single();
      expect(updatedRefund.refund_status).toBe('processed');

      // Verify order is updated to REFUND_COMPLETED
      const { data: updatedOrder } = await db.from('orders').select('status').eq('id', testOrderId).single();
      expect(updatedOrder.status).toBe(OrderStates.REFUND_COMPLETED);
    });
  });

  describe('6. Automated Stock Restoration Check', () => {
    test('restockOrderItems should correctly restore inventory quantities', async () => {
      const order = await db.from('orders').select('*').eq('id', testOrderId).single();
      
      // Stock before: 100
      await restockOrderItems(order.data);

      const { data: product } = await db.from('products').select('stock').eq('id', testProductId).single();
      expect(product.stock).toBe(102); // 100 + 2 from order items
    });
  });
});
