const express = require('express');
const router = express.Router();
const db = require('../config/db');
const razorpay = require('../config/razorpay');
const authMiddleware = require('../middleware/auth');

// POST /api/orders/checkout
// Create order and Razorpay order ID
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { items, promoCode } = req.body; // items: [{ id, quantity }]
    
    if (!items || !items.length) {
      return res.status(400).json({ error: 'Cart is empty.' });
    }

    // Fetch products to verify pricing & tax rates
    const { data: dbProducts } = await db.from('products').select('*');
    
    // Determine discount percentage
    let discountPercent = 0;
    if (promoCode === 'SPORE10') discountPercent = 0.10;
    if (promoCode === 'SHROOM20') discountPercent = 0.20;

    let subtotal = 0;
    let discountAmount = 0;
    let gstAmount = 0;
    const orderItems = [];

    // Calculate itemized details
    for (const cartItem of items) {
      const product = dbProducts.find(p => p.id === cartItem.id);
      if (!product) {
        return res.status(400).json({ error: `Product with id ${cartItem.id} not found.` });
      }

      const quantity = parseInt(cartItem.quantity, 10) || 1;
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
        quantity: quantity,
        gstRate: product.gst_rate,
        gstAmount: lineGst,
        discountAmount: lineDiscount,
        total: lineTotal
      });
    }

    const total = subtotal - discountAmount + gstAmount;

    // Insert order in 'pending' status
    const { data: newOrder, error: dbError } = await db.from('orders').insert({
      user_id: req.user.userId,
      items: orderItems,
      subtotal: parseFloat(subtotal.toFixed(2)),
      discount_amount: parseFloat(discountAmount.toFixed(2)),
      gst_amount: parseFloat(gstAmount.toFixed(2)),
      total: parseFloat(total.toFixed(2)),
      promo_code: promoCode || '',
      status: 'pending',
      delivery_status: 'placed'
    }).single();

    if (dbError) {
      return res.status(500).json({ error: dbError.message });
    }

    // Call Razorpay API to generate order
    // Razorpay amount is in paise (1 INR = 100 paise)
    const amountInPaise = Math.round(total * 100);
    const rzpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `receipt_${newOrder.id.substring(0, 8)}`,
      notes: {
        orderId: newOrder.id,
        userId: req.user.userId
      }
    });

    // Update order with Razorpay Order ID
    await db.from('orders')
      .update({ razorpay_order_id: rzpOrder.id })
      .eq('id', newOrder.id);

    newOrder.razorpay_order_id = rzpOrder.id;

    res.status(201).json({
      order: newOrder,
      razorpay: {
        orderId: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockKey123'
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/orders/verify-payment
// Confirm signature & finalize order
router.post('/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details.' });
    }

    const isValid = razorpay.payments.verifySignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    });

    if (isValid) {
      // Update order status to paid
      const { data: updatedOrder, error } = await db.from('orders')
        .update({
          status: 'paid',
          razorpay_payment_id: razorpay_payment_id
        })
        .eq('razorpay_order_id', razorpay_order_id)
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json({ message: 'Payment verified successfully.', order: updatedOrder });
    } else {
      // Mark as failed
      await db.from('orders')
        .update({ status: 'failed' })
        .eq('razorpay_order_id', razorpay_order_id);

      res.status(400).json({ error: 'Payment verification failed.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/my-orders
// Fetch all orders of authenticated user
router.get('/my-orders', authMiddleware, async (req, res) => {
  try {
    const { data: orders, error } = await db.from('orders')
      .select('*')
      .eq('user_id', req.user.userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/:id/invoice
// Generate detailed invoice data
router.get('/:id/invoice', authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await db.from('orders').select('*').eq('id', req.params.id).single();
    if (error || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Fetch user details for invoice billing info
    const { data: user } = await db.from('users').select('*').eq('id', order.user_id).single();

    // Grouping GST summary by slabs (5%, 12%, 18%)
    const gstSummary = {
      slab5: { taxableAmount: 0, gstAmount: 0 },
      slab12: { taxableAmount: 0, gstAmount: 0 },
      slab18: { taxableAmount: 0, gstAmount: 0 }
    };

    order.items.forEach(item => {
      const taxable = (item.price * item.quantity) - item.discountAmount;
      const key = `slab${item.gstRate}`;
      if (gstSummary[key]) {
        gstSummary[key].taxableAmount += taxable;
        gstSummary[key].gstAmount += item.gstAmount;
      }
    });

    const invoice = {
      invoiceNumber: `INV-${order.id.substring(0, 8).toUpperCase()}-${new Date(order.created_at).getFullYear()}`,
      invoiceDate: order.created_at,
      seller: {
        name: "Sporekart Store Private Limited",
        address: "4th Genetic Floor, Agritech Park, Phase 2, Bangalore, Karnataka, 560064",
        gstin: "29SPKRT9876A1Z0",
        email: "support@sporekart.com",
        phone: "+91 80 4991 3800"
      },
      buyer: {
        name: user ? user.full_name : "Valued Cultivator",
        email: user ? user.email : "",
        phone: user ? user.whatsapp_number : "",
      },
      items: order.items,
      totals: {
        subtotal: order.subtotal,
        discount: order.discount_amount,
        gstAmount: order.gst_amount,
        total: order.total,
        promoCode: order.promo_code
      },
      gstSummary: {
        slab5: {
          taxable: parseFloat(gstSummary.slab5.taxableAmount.toFixed(2)),
          cgst: parseFloat((gstSummary.slab5.gstAmount / 2).toFixed(2)),
          sgst: parseFloat((gstSummary.slab5.gstAmount / 2).toFixed(2)),
          totalGst: parseFloat(gstSummary.slab5.gstAmount.toFixed(2))
        },
        slab12: {
          taxable: parseFloat(gstSummary.slab12.taxableAmount.toFixed(2)),
          cgst: parseFloat((gstSummary.slab12.gstAmount / 2).toFixed(2)),
          sgst: parseFloat((gstSummary.slab12.gstAmount / 2).toFixed(2)),
          totalGst: parseFloat(gstSummary.slab12.gstAmount.toFixed(2))
        },
        slab18: {
          taxable: parseFloat(gstSummary.slab18.taxableAmount.toFixed(2)),
          cgst: parseFloat((gstSummary.slab18.gstAmount / 2).toFixed(2)),
          sgst: parseFloat((gstSummary.slab18.gstAmount / 2).toFixed(2)),
          totalGst: parseFloat(gstSummary.slab18.gstAmount.toFixed(2))
        }
      },
      paymentStatus: order.status
    };

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/:id/track
// Get tracking status. Simulates shipping status over time!
router.get('/:id/track', authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await db.from('orders').select('*').eq('id', req.params.id).single();
    if (error || !order) {
      return res.status(404).json({ error: 'Order not found.' });
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

    // Update database status if it changed
    if (order.status === 'paid' && order.delivery_status !== calculatedStatus) {
      await db.from('orders').update({ delivery_status: calculatedStatus }).eq('id', order.id);
    }

    res.json({
      orderId: order.id,
      paymentStatus: order.status,
      deliveryStatus: calculatedStatus,
      progressPercent,
      trackingMessage: message,
      timestamp: new Date().toISOString(),
      timeline: [
        { status: 'placed', label: 'Spores Selected', done: true, time: order.created_at },
        { status: 'inoculating', label: 'Mycelium Inoculated (1 min elapsed)', done: diffMin >= 1 },
        { status: 'shipped', label: 'Fruiting Kit Dispatched (2 mins elapsed)', done: diffMin >= 2 },
        { status: 'delivered', label: 'Ready to Harvest! (4 mins elapsed)', done: diffMin >= 4 }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
