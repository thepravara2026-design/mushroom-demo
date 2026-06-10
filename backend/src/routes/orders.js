const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const db = require('../config/db');
const razorpay = require('../config/razorpay');
const authMiddleware = require('../middleware/auth');
const { success, error: respondError } = require('../lib/response');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';

// Simple in-memory SSE subscribers list. Each subscriber: { id, res, user }
const sseSubscribers = [];

function sendSseEvent(event, data, filterFn) {
  const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  sseSubscribers.forEach((sub) => {
    try {
      if (typeof filterFn === 'function' && !filterFn(sub)) return;
      sub.res.write(payload);
    } catch (e) {
      // ignore write errors; cleanup will remove closed connections
    }
  });
}

function addSseSubscriber(req, res, user) {
  const id = crypto.randomBytes(8).toString('hex');
  const sub = { id, req, res, user };
  sseSubscribers.push(sub);
  req.on('close', () => {
    const idx = sseSubscribers.findIndex((s) => s.id === id);
    if (idx !== -1) sseSubscribers.splice(idx, 1);
  });
  return sub;
}

function buildInvoiceData(order, user) {
  const gstSummary = {
    slab5: { taxableAmount: 0, gstAmount: 0 },
    slab12: { taxableAmount: 0, gstAmount: 0 },
    slab18: { taxableAmount: 0, gstAmount: 0 },
  };

  (order.items || []).forEach((item) => {
    const taxable = item.price * item.quantity - item.discountAmount;
    const key = `slab${item.gstRate}`;
    if (gstSummary[key]) {
      gstSummary[key].taxableAmount += taxable;
      gstSummary[key].gstAmount += item.gstAmount;
    }
  });

  return {
    invoiceNumber: `INV-${order.id.substring(0, 8).toUpperCase()}-${new Date(order.created_at).getFullYear()}`,
    invoiceDate: order.created_at,
    seller: {
      name: 'Sporekart Store Private Limited',
      address:
        '4th Genetic Floor, Agritech Park, Phase 2, Bangalore, Karnataka, 560064',
      gstin: '29SPKRT9876A1Z0',
      email: 'support@sporekart.com',
      phone: '+91 80 4991 3800',
    },
    buyer: {
      name:
        order.customer_name || (user ? user.full_name : 'Valued Cultivator'),
      email: user ? user.email : '',
      phone: order.delivery_phone || (user ? user.whatsapp_number : ''),
      address: order.delivery_address || 'Not Specified',
    },
    paymentMethod:
      order.payment_method
      || (order.razorpay_order_id ? 'Razorpay' : 'Pending'),
    paymentId: order.razorpay_payment_id || '',
    transactionId: order.transaction_id || order.razorpay_payment_id || '',
    items: order.items || [],
    totals: {
      subtotal: order.subtotal,
      discount: order.discount_amount,
      gstAmount: order.gst_amount,
      shippingCharge: order.shipping_charge || 0,
      total: order.total,
      promoCode: order.promo_code,
    },
    gstSummary: {
      slab5: {
        taxable: parseFloat(gstSummary.slab5.taxableAmount.toFixed(2)),
        cgst: parseFloat((gstSummary.slab5.gstAmount / 2).toFixed(2)),
        sgst: parseFloat((gstSummary.slab5.gstAmount / 2).toFixed(2)),
        totalGst: parseFloat(gstSummary.slab5.gstAmount.toFixed(2)),
      },
      slab12: {
        taxable: parseFloat(gstSummary.slab12.taxableAmount.toFixed(2)),
        cgst: parseFloat((gstSummary.slab12.gstAmount / 2).toFixed(2)),
        sgst: parseFloat((gstSummary.slab12.gstAmount / 2).toFixed(2)),
        totalGst: parseFloat(gstSummary.slab12.gstAmount.toFixed(2)),
      },
      slab18: {
        taxable: parseFloat(gstSummary.slab18.taxableAmount.toFixed(2)),
        cgst: parseFloat((gstSummary.slab18.gstAmount / 2).toFixed(2)),
        sgst: parseFloat((gstSummary.slab18.gstAmount / 2).toFixed(2)),
        totalGst: parseFloat(gstSummary.slab18.gstAmount.toFixed(2)),
      },
    },
    paymentStatus: order.status,
    invoiceToken: order.invoice_token || null,
  };
}

async function getShippingCharge() {
  // Delivery is always free
  return 0;
}

// POST /api/orders/checkout
// Create order and Razorpay order ID
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const {
      items, promoCode, delivery_address, delivery_phone,
    } = req.body; // items: [{ id, quantity }]

    if (!items || !items.length) {
      return respondError(res, 'Cart is empty.', 400);
    }

    // Accept delivery address/phone from request or fallback to user profile when available.
    const rawAddress = String(delivery_address || (req.user && req.user.address) || '').trim();
    const rawPhone = String(
      delivery_phone || (req.user && req.user.whatsapp_number) || '',
    ).trim();
    const sanitizedPhone = rawPhone.replace(/\D/g, '');

    // Do not require address/phone for checkout in mock/e2e flows; prefer user data if present.
    let deliveryPhone = '';
    if (rawPhone) {
      if (sanitizedPhone.length < 10 || sanitizedPhone.length > 15) {
        return respondError(res, 'Valid delivery phone number is required.', 400);
      }
      deliveryPhone = rawPhone.startsWith('+') ? `+${sanitizedPhone}` : sanitizedPhone;
    } else if (req.user && req.user.whatsapp_number) {
      deliveryPhone = req.user.whatsapp_number;
    }

    // Fetch products to verify pricing & tax rates
    const { data: dbProducts } = await db.from('products').select('*');

    // Determine discount percentage
    let discountPercent = 0;
    if (promoCode === 'SPORE10') discountPercent = 0.1;
    if (promoCode === 'SHROOM20') discountPercent = 0.2;

    let subtotal = 0;
    let discountAmount = 0;
    let gstAmount = 0;
    const orderItems = [];

    // Calculate itemized details
    for (const cartItem of items) {
      const product = dbProducts.find((p) => p.id === cartItem.id);
      if (!product) {
        return respondError(
          res,
          `Product with id ${cartItem.id} not found.`,
          400,
        );
      }

      const quantity = parseInt(cartItem.quantity, 10) || 1;
      if (product.stock !== undefined && quantity > product.stock) {
        return respondError(
          res,
          `Insufficient stock for ${product.name}. Only ${product.stock} unit(s) available.`,
          400,
        );
      }

      const basePrice = product.price;
      const lineSubtotal = basePrice * quantity;

      const lineDiscount = lineSubtotal * discountPercent;
      const lineDiscountedSubtotal = lineSubtotal - lineDiscount;
      const lineGst = lineDiscountedSubtotal * (product.gst_rate / 100);
      const lineTotal = lineDiscountedSubtotal + lineGst;

      subtotal += lineSubtotal;
      discountAmount += lineDiscount;
      gstAmount += lineGst;

      orderItems.push({
        productId: product.id,
        name: product.name,
        price: basePrice,
        quantity,
        gstRate: product.gst_rate,
        gstAmount: lineGst,
        discountAmount: lineDiscount,
        total: lineTotal,
      });
    }

    const shippingCharge = await getShippingCharge();
    const total = subtotal - discountAmount + gstAmount + shippingCharge;

    const orderDate = new Date();
    const formattedDate = `${orderDate.getFullYear()}${String(orderDate.getDate()).padStart(2, '0')}${String(orderDate.getMonth() + 1).padStart(2, '0')}`;
    const orderPrefix = `spore-${formattedDate}-ord`;

    const { data: existingOrders } = await db.from('orders').select('id');
    const matchingOrders = Array.isArray(existingOrders)
      ? existingOrders.filter(
        (o) => typeof o.id === 'string' && o.id.startsWith(`${orderPrefix}-`),
      )
      : [];
    const nextSequence = String(matchingOrders.length + 1).padStart(5, '0');
    const generatedOrderId = `${orderPrefix}-${nextSequence}`;

    // Insert order in 'pending' status
    const invoiceToken = crypto.randomBytes(12).toString('hex');
    const { data: newOrder, error: dbError } = await db
      .from('orders')
      .insert({
        id: generatedOrderId,
        user_id: req.user.userId,
        customer_name: req.user.fullName || req.user.email || 'Customer',
        delivery_address: rawAddress,
        delivery_phone: deliveryPhone,
        items: orderItems,
        subtotal: parseFloat(subtotal.toFixed(2)),
        discount_amount: parseFloat(discountAmount.toFixed(2)),
        gst_amount: parseFloat(gstAmount.toFixed(2)),
        shipping_charge: parseFloat(shippingCharge.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        promo_code: promoCode || '',
        status: 'pending',
        delivery_status: 'placed',
        invoice_token: invoiceToken,
      })
      .single();

    // Call Razorpay API to generate order
    // Razorpay amount is in paise (1 INR = 100 paise)
    const amountInPaise = Math.round(total * 100);
    const rzpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `receipt_${newOrder.id}`,
      notes: {
        orderId: newOrder.id,
        userId: req.user.userId,
      },
    });

    // Update order with Razorpay Order ID
    await db
      .from('orders')
      .update({ razorpay_order_id: rzpOrder.id })
      .eq('id', newOrder.id);

    newOrder.razorpay_order_id = rzpOrder.id;

    return success(res, {
      order: newOrder,
      razorpay: {
        orderId: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        keyId: razorpay.isMock
          ? 'rzp_test_mockKey123'
          : process.env.RAZORPAY_KEY_ID || 'rzp_test_mockKey123',
      },
    });
  } catch (error) {
    return respondError(res, error.message || 'Checkout failed', 500);
  }
});

// POST /api/orders/verify-payment
// Confirm signature & finalize order
router.post('/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return respondError(res, 'Missing payment details.', 400);
    }

    const isValid = razorpay.payments.verifySignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    if (isValid) {
      // Update order status to paid and record payment details
      const transactionId = `TXN-${razorpay_payment_id}`;
      const { data: existingOrder } = await db
        .from('orders')
        .select('invoice_token')
        .eq('razorpay_order_id', razorpay_order_id)
        .single();
      const invoiceToken = existingOrder && existingOrder.invoice_token
        ? existingOrder.invoice_token
        : crypto.randomBytes(12).toString('hex');
      const { data: updatedOrder, error } = await db
        .from('orders')
        .update({
          status: 'paid',
          delivery_status: 'placed',
          payment_method: 'Razorpay',
          razorpay_payment_id,
          transaction_id: transactionId,
          invoice_token: invoiceToken,
          updated_at: new Date().toISOString(),
        })
        .eq('razorpay_order_id', razorpay_order_id)
        .single();

      if (error) {
        return respondError(
          res,
          error.message || 'Failed to update order',
          500,
        );
      }

      // Decrement product stock for purchased items when payment is confirmed
      if (updatedOrder && Array.isArray(updatedOrder.items)) {
        for (const item of updatedOrder.items) {
          const { data: productData, error: productErr } = await db
            .from('products')
            .select('stock')
            .eq('id', item.productId)
            .single();

          if (productErr || !productData) continue;

          const newStock = Math.max(
            0,
            (productData.stock || 0) - item.quantity,
          );
          await db
            .from('products')
            .update({ stock: newStock })
            .eq('id', item.productId);
        }
      }

      // Emit SSE event for updated order (admins + order owner)
      try {
        sendSseEvent(
          'order:updated',
          { order: updatedOrder },
          (sub) => (sub.user && sub.user.role === 'admin') || (sub.user && sub.user.userId === updatedOrder.user_id),
        );
      } catch (e) {
        // ignore SSE errors
      }

      return success(res, {
        message: 'Payment verified successfully.',
        order: updatedOrder,
      });
    }
    // Mark as failed
    await db
      .from('orders')
      .update({ status: 'failed' })
      .eq('razorpay_order_id', razorpay_order_id);

    return respondError(res, 'Payment verification failed.', 400);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Payment verification failed',
      500,
    );
  }
});

// GET /api/orders/shipping-settings
// Fetch global shipping charge for cart and checkout
router.get('/shipping-settings', async (req, res) => {
  try {
    return success(res, { shipping_charge: 0 });
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to fetch shipping settings',
      500,
    );
  }
});

// PUT /api/orders/shipping-settings
// Admin updates global shipping charge
router.put('/shipping-settings', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return respondError(res, 'Access denied. Admins only.', 403);
    }

    const shipping_charge = Number(req.body.shipping_charge);
    if (Number.isNaN(shipping_charge) || shipping_charge < 0) {
      return respondError(
        res,
        'Shipping charge must be a non-negative number.',
        400,
      );
    }

    const { data: existingSetting, error: selectError } = await db
      .from('settings')
      .select('*')
      .eq('key', 'shipping_charge')
      .single();
    if (selectError || !existingSetting) {
      const { data: insertedSetting, error: insertError } = await db
        .from('settings')
        .insert({
          key: 'shipping_charge',
          value: shipping_charge,
        })
        .single();
      if (insertError) {
        return respondError(
          res,
          insertError.message || 'Failed to create setting',
          500,
        );
      }
      return success(res, {
        shipping_charge: Number(insertedSetting.value) || 0,
      });
    }

    const { data: updatedSetting, error: updateError } = await db
      .from('settings')
      .update({ value: shipping_charge })
      .eq('key', 'shipping_charge')
      .single();

    if (updateError) {
      return respondError(
        res,
        updateError.message || 'Failed to update setting',
        500,
      );
    }

    return success(res, { shipping_charge: Number(updatedSetting.value) || 0 });
  } catch (error) {
    return respondError(
      res,
      error.message || 'Shipping settings update failed',
      500,
    );
  }
});

// GET /api/orders/my-orders
// Fetch all orders of authenticated user
router.get('/my-orders', authMiddleware, async (req, res) => {
  try {
    const { data: orders, error } = await db
      .from('orders')
      .select('*')
      .eq('user_id', req.user.userId);

    if (error) {
      return respondError(res, error.message || 'Failed to fetch orders', 500);
    }

    return success(res, orders);
  } catch (error) {
    return respondError(res, error.message || 'Failed to fetch orders', 500);
  }
});

// GET /api/orders/all-orders
// Fetch all orders in the system (admin only)
router.get('/all-orders', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return respondError(res, 'Access denied. Admins only.', 403);
    }

    const { data: orders, error: ordersErr } = await db
      .from('orders')
      .select('*');
    if (ordersErr) {
      return respondError(
        res,
        ordersErr.message || 'Failed to fetch orders',
        500,
      );
    }

    const { data: users } = await db.from('users').select('*');
    const userMap = {};
    if (users) {
      users.forEach((u) => {
        userMap[u.id] = u.email;
      });
    }

    const enrichedOrders = orders.map((o) => ({
      ...o,
      user_email: userMap[o.user_id] || 'unknown@sporekart.com',
    }));

    // Sort descending by created_at
    enrichedOrders.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    return success(res, enrichedOrders);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to fetch all orders',
      500,
    );
  }
});

// PUT /api/orders/:id/status
// Update delivery status of an order (admin only)
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return respondError(res, 'Access denied. Admins only.', 403);
    }

    const { delivery_status } = req.body;
    if (!delivery_status) {
      return respondError(res, 'Delivery status is required.', 400);
    }

    const { data: order, error: orderErr } = await db
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (orderErr || !order) {
      return respondError(res, 'Order not found.', 404);
    }

    const updatePayload = {
      delivery_status,
      updated_at: new Date().toISOString(),
    };

    if (!order.invoice_token) {
      updatePayload.invoice_token = crypto.randomBytes(12).toString('hex');
    }

    const { data: updatedOrder, error } = await db
      .from('orders')
      .update(updatePayload)
      .eq('id', req.params.id)
      .single();

    if (error) {
      return respondError(res, error.message || 'Failed to update order', 500);
    }

    // Emit SSE event for updated order (admins + order owner)
    try {
      sendSseEvent(
        'order:updated',
        { order: updatedOrder },
        (sub) => (sub.user && sub.user.role === 'admin') || (sub.user && sub.user.userId === updatedOrder.user_id),
      );
    } catch (e) {
      // ignore SSE errors
    }

    return success(res, {
      message: 'Order status updated successfully.',
      order: updatedOrder,
    });
  } catch (error) {
    return respondError(
      res,
      error.message || 'Order status update failed',
      500,
    );
  }
});

// PUT /api/orders/:id/cancel
// Allow buyers to cancel an order before it ships
router.put('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const { data: order, error: orderErr } = await db
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (orderErr || !order) {
      return respondError(res, 'Order not found.', 404);
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner = order.user_id === req.user.userId;
    if (!isAdmin && !isOwner) {
      return respondError(
        res,
        'Access denied. You do not have permission to cancel this order.',
        403,
      );
    }

    if (!isAdmin && order.delivery_status !== 'processing') {
      return respondError(
        res,
        'Order can be cancelled only when the order is in processing stage.',
        400,
      );
    }

    if (['shipped', 'delivered', 'cancelled'].includes(order.delivery_status)) {
      return respondError(res, 'Order cannot be cancelled at this stage.', 400);
    }

    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return respondError(res, 'Cancellation reason is required.', 400);
    }

    const updatePayload = {
      status: 'cancelled',
      delivery_status: 'cancelled',
      cancel_reason: reason.trim().slice(0, 255),
      cancelled_by: isAdmin ? 'admin' : 'user',
      cancelled_at: new Date().toISOString(),
    };

    const { data: canceledOrder, error: cancelErr } = await db
      .from('orders')
      .update(updatePayload)
      .eq('id', req.params.id)
      .single();

    if (cancelErr) {
      return respondError(
        res,
        cancelErr.message || 'Failed to cancel order',
        500,
      );
    }

    // Emit SSE event for cancelled order (admins + order owner)
    try {
      sendSseEvent(
        'order:updated',
        { order: canceledOrder },
        (sub) => (sub.user && sub.user.role === 'admin') || (sub.user && sub.user.userId === canceledOrder.user_id),
      );
    } catch (e) {
      // ignore
    }

    // Restock items if payment had already been confirmed
    if (order.status === 'paid' && Array.isArray(order.items)) {
      for (const item of order.items) {
        const { data: productData, error: productErr } = await db
          .from('products')
          .select('stock')
          .eq('id', item.productId)
          .single();

        if (productErr || !productData) continue;

        const newStock = (productData.stock || 0) + item.quantity;
        await db
          .from('products')
          .update({ stock: newStock })
          .eq('id', item.productId);
      }
    }

    return success(res, {
      message: 'Order cancelled successfully.',
      order: canceledOrder,
    });
  } catch (error) {
    return respondError(res, error.message || 'Order cancellation failed', 500);
  }
});

// GET /api/orders/:id/invoice
// Generate detailed invoice data
router.get('/:id/invoice', authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await db
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !order) {
      return respondError(res, 'Order not found.', 404);
    }

    // Fetch user details for invoice billing info
    const { data: user } = await db
      .from('users')
      .select('*')
      .eq('id', order.user_id)
      .single();
    const invoice = buildInvoiceData(order, user);
    return success(res, invoice);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to generate invoice',
      500,
    );
  }
});

// Public invoice share endpoint for copyable/downloadable links
router.get('/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).send('Invoice token is missing.');
    }

    const { data: order, error } = await db
      .from('orders')
      .select('*')
      .eq('invoice_token', token)
      .single();
    if (error || !order) {
      return res.status(404).send('Invoice not found for this token.');
    }

    const { data: user } = await db
      .from('users')
      .select('*')
      .eq('id', order.user_id)
      .single();
    const inv = buildInvoiceData(order, user);
    const shareUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${inv.invoiceNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f4f7fb; color: #1d2939; }
    .page { max-width: 960px; margin: 24px auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08); }
    h1, h2, h3, h4 { margin: 0 0 12px; }
    .topbar { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
    .section { margin-top: 24px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .invoice-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    .invoice-table th, .invoice-table td { border: 1px solid #e2e8f0; padding: 12px; }
    .invoice-table th { background: #f8fafc; text-align: left; }
    .text-right { text-align: right; }
    .summary { margin-top: 16px; display: grid; grid-template-columns: 1fr auto; gap: 12px; }
    .summary div { padding: 12px; background: #f8fafc; border-radius: 10px; }
    .invoice-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    .invoice-actions a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; text-decoration: none; background: #0f766e; color: #fff; border-radius: 8px; }
    .invoice-actions a.secondary { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="page">
    <div class="topbar">
      <div>
        <h1>Sporekart Store</h1>
        <p>4th Genetic Floor, Agritech Park, Phase 2, Bangalore, Karnataka, 560064</p>
        <p>GSTIN: 29SPKRT9876A1Z0</p>
      </div>
      <div>
        <h2>Tax Invoice</h2>
        <p><strong>Invoice No:</strong> ${inv.invoiceNumber}</p>
        <p><strong>Date:</strong> ${new Date(inv.invoiceDate).toLocaleDateString('en-IN')}</p>
        <p><strong>Status:</strong> ${inv.paymentStatus}</p>
      </div>
    </div>

    <div class="section grid-2">
      <div>
        <h3>Billed To</h3>
        <p><strong>${inv.buyer.name}</strong></p>
        <p>Email: ${inv.buyer.email || 'N/A'}</p>
        <p>Phone: ${inv.buyer.phone || 'N/A'}</p>
      </div>
      <div>
        <h3>Delivery</h3>
        <p>${inv.buyer.address || 'N/A'}</p>
      </div>
    </div>

    <div class="section">
      <table class="invoice-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th class="text-right">Unit Price</th>
            <th class="text-center">Qty</th>
            <th class="text-right">GST</th>
            <th class="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${inv.items
    .map(
      (item, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td>${item.name}</td>
              <td class="text-right">₹${item.price.toFixed(2)}</td>
              <td class="text-center">${item.quantity}</td>
              <td class="text-right">₹${item.gstAmount.toFixed(2)}</td>
              <td class="text-right">₹${item.total.toFixed(2)}</td>
            </tr>
          `,
    )
    .join('')}
        </tbody>
      </table>
    </div>

    <div class="summary">
      <div>
        <p><strong>Payment Method:</strong> ${inv.paymentMethod}</p>
        <p><strong>Transaction ID:</strong> ${inv.transactionId || 'N/A'}</p>
      </div>
      <div>
        <p><strong>Subtotal:</strong> ₹${inv.totals.subtotal.toFixed(2)}</p>
        <p><strong>Discount:</strong> -₹${inv.totals.discount.toFixed(2)}</p>
        <p><strong>GST:</strong> ₹${inv.totals.gstAmount.toFixed(2)}</p>
        <p><strong>Shipping:</strong> ₹${(inv.totals.shippingCharge || 0).toFixed(2)}</p>
        <p><strong>Total:</strong> ₹${inv.totals.total.toFixed(2)}</p>
      </div>
    </div>

    <div class="invoice-actions">
      <a href="javascript:window.print()">Print Invoice</a>
      <a class="secondary" href="${shareUrl}">Reload Share Link</a>
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// GET /api/orders/:id/track
// Get tracking status. Simulates shipping status over time!
router.get('/:id/track', authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await db
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !order) {
      return respondError(res, 'Order not found.', 404);
    }

    // Time difference in minutes since order creation
    const diffMs = Date.now() - new Date(order.created_at).getTime();
    const diffMin = diffMs / (1000 * 60);

    let calculatedStatus = 'placed';
    let progressPercent = 10;
    let message = 'Spores picked & prepped. Sterilization check in progress.';

    if (diffMin >= 1 && diffMin < 2) {
      calculatedStatus = 'inoculating';
      progressPercent = 40;
      message = 'Inoculation complete. Grains seeded with liquid mycelium under laminar flow.';
    } else if (diffMin >= 2 && diffMin < 4) {
      calculatedStatus = 'shipped';
      progressPercent = 75;
      message = 'Mycelium fully colonised! Substrate block packaged in thermal safety bag and shipped.';
    } else if (diffMin >= 4) {
      calculatedStatus = 'delivered';
      progressPercent = 100;
      message = 'Delivered! Arrived at your facility. Time to slit the bag, mist daily, and start fruiting.';
    }

    const statusResult = order.delivery_status === 'cancelled' ? 'cancelled' : calculatedStatus;

    if (
      order.status === 'paid'
      && order.delivery_status !== statusResult
      && order.delivery_status !== 'cancelled'
    ) {
      await db
        .from('orders')
        .update({ delivery_status: statusResult })
        .eq('id', order.id);
    }

    const responseStatus = order.delivery_status === 'cancelled' ? 'cancelled' : statusResult;
    const responseProgress = order.delivery_status === 'cancelled' ? 0 : progressPercent;
    const responseMessage = order.delivery_status === 'cancelled'
      ? 'Order was cancelled. Thank you for shopping with us.'
      : message;

    const timeline = [
      {
        status: 'placed',
        label: 'Spores Selected',
        done: true,
        time: order.created_at,
      },
    ];

    if (order.delivery_status === 'cancelled') {
      timeline.push({
        status: 'cancelled',
        label: 'Order cancelled',
        done: true,
        time:
          order.updated_at || order.cancelled_at || new Date().toISOString(),
      });
    } else {
      timeline.push({
        status: 'inoculating',
        label: 'Mycelium Inoculated (1 min elapsed)',
        done: diffMin >= 1,
      });
      timeline.push({
        status: 'shipped',
        label: 'Fruiting Kit Dispatched (2 mins elapsed)',
        done: diffMin >= 2,
      });
      timeline.push({
        status: 'delivered',
        label: 'Ready to Harvest! (4 mins elapsed)',
        done: diffMin >= 4,
      });
    }

    return success(res, {
      orderId: order.id,
      paymentStatus: order.status,
      paymentMethod: order.razorpay_order_id ? 'Razorpay' : 'Pending',
      paymentId: order.razorpay_payment_id || '',
      transactionId: order.transaction_id || order.razorpay_payment_id || '',
      deliveryStatus: responseStatus,
      progressPercent: responseProgress,
      trackingMessage: responseMessage,
      cancelReason: order.cancel_reason || '',
      timestamp: new Date().toISOString(),
      timeline,
    });
  } catch (error) {
    return respondError(res, error.message || 'Order tracking failed', 500);
  }
});

// SSE: /api/orders/events
// Clients may connect with Authorization: Bearer <token>. Admins receive all order events.
router.get('/events', (req, res) => {
  const authHeader = req.headers.authorization;
  // Support token in Authorization header or as query param (?token=...)
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

  let user = null;
  if (token) {
    try {
      user = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      // ignore invalid token; allow anonymous connections as read-only (no admin privileges)
      user = null;
    }
  }

  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  addSseSubscriber(req, res, user);
});

module.exports = router;
