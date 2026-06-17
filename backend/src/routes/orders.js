const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const db = require('../config/db');
const razorpay = require('../config/razorpay');
const authMiddleware = require('../middleware/auth');
const { success, error: respondError } = require('../lib/response');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const { sendInvoiceWhatsApp } = require('../services/notificationService');

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
      items, promoCode, delivery_phone,
      address_line1, address_line2, landmark, city, state, pincode
    } = req.body; // items: [{ id, quantity }]

    if (!items || !items.length) {
      return respondError(res, 'Cart is empty.', 400);
    }

    // Build the combined delivery address
    const addressParts = [
      address_line1,
      address_line2,
      landmark,
      city,
      state,
      pincode ? `Pincode: ${pincode}` : ''
    ].filter(Boolean);

    let rawAddress = addressParts.join(', ');
    if (!rawAddress) {
      rawAddress = String(req.body.delivery_address || (req.user && req.user.address) || '').trim();
    }

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

    // Sync address back to user profile
    if (req.user && req.user.userId && rawAddress) {
      const addressUpdates = { default_address: rawAddress };
      if (address_line1) addressUpdates.address_line1 = address_line1;
      if (address_line2) addressUpdates.address_line2 = address_line2;
      if (landmark) addressUpdates.landmark = landmark;
      if (city) addressUpdates.city = city;
      if (state) addressUpdates.state = state;
      if (pincode) addressUpdates.default_pincode = pincode;

      await db.from('users').update(addressUpdates).eq('id', req.user.userId);
    }

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

      // Decrement product stock for purchased items when payment is confirmed.
      // Live mode: uses atomic DB function (race-condition safe).
      // Mock mode: manual read-then-write fallback.
      if (updatedOrder && Array.isArray(updatedOrder.items)) {
        if (!db.isMock && supabaseAdmin) {
          // ── Supabase live: atomic stock decrement via stored function ─────
          for (const item of updatedOrder.items) {
            try {
              await supabaseAdmin.rpc('decrement_stock', {
                p_product_id: item.productId,
                p_quantity: item.quantity,
              });
            } catch (rpcErr) {
              // Log but don't fail the payment — stock can be reconciled manually
              console.error(`[orders] decrement_stock RPC failed for ${item.productId}:`, rpcErr.message);
            }
          }
        } else {
          // ── Mock mode: read-then-write fallback ───────────────────────────
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

    const { delivery_status, delivery_days_text } = req.body;
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

    const STATUS_FLOW = ['placed', 'processing', 'shipped', 'in_transit', 'delivered'];
    const currentStatus = order.delivery_status;

    if (currentStatus === 'cancelled') {
      return respondError(res, 'Cannot change status of a cancelled order.', 400);
    }

    const currentIndex = STATUS_FLOW.indexOf(currentStatus);
    const newIndex = STATUS_FLOW.indexOf(delivery_status);

    if (newIndex === -1 && delivery_status !== 'cancelled') {
      return respondError(res, 'Invalid delivery status.', 400);
    }

    if (delivery_status !== 'cancelled' && newIndex < currentIndex) {
      return respondError(res, 'Cannot move order status backward to a previous stage.', 400);
    }

    const updatePayload = {
      delivery_status,
      updated_at: new Date().toISOString(),
    };

    if (delivery_days_text) {
      updatePayload.delivery_days_text = delivery_days_text.trim().slice(0, 100);
      const daysMatch = delivery_days_text.match(/(\d+)/);
      if (daysMatch) {
        const days = parseInt(daysMatch[1], 10);
        if (!isNaN(days) && days > 0) {
          const expectedDate = new Date();
          expectedDate.setDate(expectedDate.getDate() + days);
          updatePayload.expected_delivery_date = expectedDate.toISOString();
        }
      }
    }

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

    // Send invoice via WhatsApp when order is shipped
    if (delivery_status === 'shipped' && !order.whatsapp_sent) {
      try {
        const { data: user } = await db
          .from('users')
          .select('*')
          .eq('id', order.user_id)
          .single();
        if (user) {
          const result = await sendInvoiceWhatsApp(updatedOrder, user, req);
          if (result.success) {
            await db
              .from('orders')
              .update({ whatsapp_sent: true, updated_at: new Date().toISOString() })
              .eq('id', order.id);
          }
        }
      } catch (waErr) {
        console.error('[orders] Failed to send WhatsApp invoice:', waErr.message);
      }
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
/*
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
*/

// for refund of amound implemented-pravara
// PUT /api/orders/:id/cancel
// Allow buyers and admins to cancel an order + auto-initiate refund if paid
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
      return respondError(res, 'Access denied. You do not have permission to cancel this order.', 403);
    }

    // Users can only cancel during 'processing'; admins can cancel anytime before shipped
    if (!isAdmin && order.delivery_status !== 'processing') {
      return respondError(res, 'Order can be cancelled only when the order is in processing stage.', 400);
    }

    if (['shipped', 'delivered', 'cancelled'].includes(order.delivery_status)) {
      return respondError(res, 'Order cannot be cancelled at this stage.', 400);
    }

    // Prevent double-cancel
    if (order.refund_status === 'initiated' || order.refund_status === 'processed') {
      return respondError(res, 'A refund has already been initiated for this order.', 400);
    }

    const { reason, adminNote } = req.body;
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return respondError(res, 'Cancellation reason is required.', 400);
    }

    // ── Refund logic (only if payment was confirmed) ──────────────────────
    let refundRecord = null;

    if (order.status === 'paid' && order.razorpay_payment_id) {
      try {
        const amountInPaise = Math.round(order.total * 100);

        // Call Razorpay refund API
        const rzpRefund = await razorpay.payments.refund(
          order.razorpay_payment_id,
          {
            amount: amountInPaise,
            speed: 'normal',
            notes: {
              orderId: order.id,
              reason: reason.trim(),
              cancelledBy: isAdmin ? 'admin' : 'user',
            },
          }
        );

        // Save refund record to DB
        const { data: newRefund, error: refundErr } = await db
          .from('refunds')
          .insert({
            order_id: order.id,
            user_id: order.user_id,
            razorpay_payment_id: order.razorpay_payment_id,
            razorpay_refund_id: rzpRefund.id,
            amount: order.total,
            status: 'initiated',
            cancelled_by: isAdmin ? 'admin' : 'user',
            admin_note: isAdmin ? (adminNote || reason).trim().slice(0, 500) : null,
            initiated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (refundErr) throw new Error(refundErr.message);
        refundRecord = newRefund;

      } catch (refundError) {
        // Refund initiation failed — still cancel the order but flag it
        console.error('Razorpay refund initiation failed:', refundError.message);
        // Continue with cancellation; admin can retry refund manually
      }
    }

    // ── Cancel the order ──────────────────────────────────────────────────
    const cancelPayload = {
      status: 'cancelled',
      delivery_status: 'cancelled',
      cancel_reason: reason.trim().slice(0, 255),
      cancelled_by: isAdmin ? 'admin' : 'user',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      refund_status: refundRecord ? 'initiated' : (order.status === 'paid' ? 'failed' : 'none'),
      ...(refundRecord && { refund_id: refundRecord.id }),
    };

    const { data: cancelledOrder, error: cancelErr } = await db
      .from('orders')
      .update(cancelPayload)
      .eq('id', req.params.id)
      .select()
      .single();

    if (cancelErr) {
      return respondError(res, cancelErr.message || 'Failed to cancel order', 500);
    }

    // ── Restock items ─────────────────────────────────────────────────────
    if (order.status === 'paid' && Array.isArray(order.items)) {
      for (const item of order.items) {
        const { data: productData } = await db
          .from('products')
          .select('stock')
          .eq('id', item.productId)
          .single();

        if (!productData) continue;
        await db
          .from('products')
          .update({ stock: (productData.stock || 0) + item.quantity })
          .eq('id', item.productId);
      }
    }

    // ── SSE broadcast ─────────────────────────────────────────────────────
    try {
      sendSseEvent(
        'order:updated',
        { order: cancelledOrder, refund: refundRecord },
        (sub) =>
          (sub.user && sub.user.role === 'admin') ||
          (sub.user && sub.user.userId === cancelledOrder.user_id),
      );
    } catch (e) { /* ignore */ }

    return success(res, {
      message: refundRecord
        ? 'Order cancelled. Refund initiated — expect 5–7 business days.'
        : 'Order cancelled successfully.',
      order: cancelledOrder,
      refund: refundRecord,
    });

  } catch (error) {
    return respondError(res, error.message || 'Order cancellation failed', 500);
  }
});

//refund implementation-pravara
// GET /api/orders/:id/refund
// Fetch refund details for an order (owner or admin)
router.get('/:id/refund', authMiddleware, async (req, res) => {
  try {
    const { data: order, error: orderErr } = await db
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (orderErr || !order) return respondError(res, 'Order not found.', 404);

    const isAdmin = req.user.role === 'admin';
    const isOwner = order.user_id === req.user.userId;

    if (!isAdmin && !isOwner) {
      return respondError(res, 'Access denied.', 403);
    }

    if (!order.refund_id) {
      return success(res, { refund: null, message: 'No refund associated with this order.' });
    }

    const { data: refund, error: refundErr } = await db
      .from('refunds')
      .select('*')
      .eq('id', order.refund_id)
      .single();

    if (refundErr) return respondError(res, 'Failed to fetch refund.', 500);

    return success(res, { refund });
  } catch (error) {
    return respondError(res, error.message || 'Failed to fetch refund', 500);
  }
});

// GET /api/orders/admin/refunds
// Admin: list all refunds across all orders
router.get('/admin/refunds', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return respondError(res, 'Access denied. Admins only.', 403);
    }

    const { data: refunds, error } = await db
      .from('refunds')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return respondError(res, error.message, 500);

    // Enrich with order and user info
    const enriched = await Promise.all(
      refunds.map(async (r) => {
        const { data: user } = await db
          .from('users')
          .select('email, full_name')
          .eq('id', r.user_id)
          .single();
        return { ...r, user_email: user?.email, user_name: user?.full_name };
      })
    );

    return success(res, enriched);
  } catch (error) {
    return respondError(res, error.message || 'Failed to fetch refunds', 500);
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

    if (!['shipped', 'in_transit', 'delivered'].includes(order.delivery_status)) {
      return respondError(res, 'Invoice can only be generated after the order is shipped.', 403);
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

    if (!['shipped', 'in_transit', 'delivered'].includes(order.delivery_status)) {
      return res.status(403).send('Invoice is not yet available for this order. It will be generated once shipped.');
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

    if (diffMin >= 1 && diffMin < 2) {
      calculatedStatus = 'inoculating';
    } else if (diffMin >= 2 && diffMin < 4) {
      calculatedStatus = 'shipped';
    } else if (diffMin >= 4) {
      calculatedStatus = 'delivered';
    }

    const STATUS_INDEX = {
      'placed': 0,
      'inoculating': 1,
      'processing': 1,
      'shipped': 2,
      'in_transit': 3,
      'delivered': 4,
      'cancelled': 5
    };

    const statusResult = order.delivery_status === 'cancelled' ? 'cancelled' : calculatedStatus;
    const currentIdx = STATUS_INDEX[order.delivery_status] || 0;
    const simulatedIdx = STATUS_INDEX[statusResult] || 0;

    let responseStatus = order.delivery_status;

    if (
      order.status === 'paid'
      && order.delivery_status !== 'cancelled'
      && simulatedIdx > currentIdx
    ) {
      responseStatus = statusResult;
      await db
        .from('orders')
        .update({ delivery_status: statusResult })
        .eq('id', order.id);
    }

    const getStatusDetails = (statusVal) => {
      switch (statusVal) {
        case 'placed':
          return { progress: 10, msg: 'Spores picked & prepped. Sterilization check in progress.' };
        case 'inoculating':
        case 'processing':
          return { progress: 40, msg: 'Inoculation complete. Grains seeded with liquid mycelium under laminar flow.' };
        case 'shipped':
          return { progress: 75, msg: 'Mycelium fully colonised! Substrate block packaged in thermal safety bag and shipped.' };
        case 'in_transit':
          return { progress: 85, msg: 'Fruiting kit is in transit. Package has left the hub and is on its way to your location.' };
        case 'delivered':
          return { progress: 100, msg: 'Delivered! Arrived at your facility. Time to slit the bag, mist daily, and start fruiting.' };
        case 'cancelled':
          return { progress: 0, msg: 'Order was cancelled. Thank you for shopping with us.' };
        default:
          return { progress: 10, msg: 'Spores picked & prepped. Sterilization check in progress.' };
      }
    };

    const details = getStatusDetails(responseStatus);
    const responseProgress = details.progress;
    const responseMessage = details.msg;

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
        done: diffMin >= 1 || STATUS_INDEX[responseStatus] >= STATUS_INDEX['inoculating'],
      });
      timeline.push({
        status: 'shipped',
        label: 'Fruiting Kit Dispatched (2 mins elapsed)',
        done: diffMin >= 2 || STATUS_INDEX[responseStatus] >= STATUS_INDEX['shipped'],
      });
      timeline.push({
        status: 'delivered',
        label: 'Ready to Harvest! (4 mins elapsed)',
        done: diffMin >= 4 || STATUS_INDEX[responseStatus] >= STATUS_INDEX['delivered'],
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

// POST /api/orders/:id/review
// Add a rating and review text to a delivered order
router.post('/:id/review', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, reviewText } = req.body;

    const { data: order, error } = await db.from('orders').select('*').eq('id', id).single();

    if (error || !order) {
      return respondError(res, 'Order not found', 404);
    }

    if (order.user_id !== req.user.userId) {
      return respondError(res, 'Unauthorized to review this order', 403);
    }

    if (order.delivery_status !== 'delivered') {
      return respondError(res, 'Only delivered orders can be reviewed', 400);
    }

    const numericRating = parseInt(rating, 10);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      return respondError(res, 'Rating must be between 1 and 5', 400);
    }

    await db.from('orders').update({
      rating: numericRating,
      review_text: reviewText || ''
    }).eq('id', id);

    return success(res, { message: 'Review saved successfully' });
  } catch (error) {
    return respondError(res, error.message || 'Failed to save review', 500);
  }
});

//razorpay webhook refund -pravara
// POST /api/orders/webhook/razorpay
// Razorpay webhook — updates refund status when processed/failed
// IMPORTANT: Register this URL in Razorpay dashboard > Webhooks
// Use express.raw() — must be registered before express.json() in server.js
router.post(
  '/webhook/razorpay',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const signature = req.headers['x-razorpay-signature'];

      // Always verify signature in production
      if (secret && signature) {
        const expected = crypto
          .createHmac('sha256', secret)
          .update(req.body)
          .digest('hex');
        if (expected !== signature) {
          return res.status(400).json({ error: 'Invalid webhook signature' });
        }
      }

      const event = JSON.parse(req.body);
      const refundEntity = event?.payload?.refund?.entity;

      if (!refundEntity) return res.json({ received: true });

      const { id: razorpayRefundId } = refundEntity;

      if (event.event === 'refund.processed') {
        const { data: refund } = await db
          .from('refunds')
          .update({ status: 'processed', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('razorpay_refund_id', razorpayRefundId)
          .select()
          .single();

        if (refund) {
          await db
            .from('orders')
            .update({ refund_status: 'processed', updated_at: new Date().toISOString() })
            .eq('id', refund.order_id);

          // SSE notify user + admin
          sendSseEvent(
            'refund:updated',
            { refund },
            (sub) =>
              (sub.user && sub.user.role === 'admin') ||
              (sub.user && sub.user.userId === refund.user_id),
          );
        }
      }

      if (event.event === 'refund.failed') {
        const { data: refund } = await db
          .from('refunds')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('razorpay_refund_id', razorpayRefundId)
          .select()
          .single();

        if (refund) {
          await db
            .from('orders')
            .update({ refund_status: 'failed', updated_at: new Date().toISOString() })
            .eq('id', refund.order_id);
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error('Webhook error:', err.message);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

module.exports = router;
