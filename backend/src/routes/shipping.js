const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');
const { success, error: respondError } = require('../lib/response');
const logger = require('../utils/logger');
const selectBestProvider = require('../services/shipping/selectBestProvider');
const { getProvider, getDefaultProvider } = require('../services/shipping/ProviderRegistry');

// GET /api/shipping/all
// Admin: fetch all shipments with order info
router.get('/all', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return respondError(res, 'Admins only', 403);

    const { data: shipments } = await db
      .from('shipments')
      .select('*')
      .order('created_at', { ascending: false });

    if (!shipments) return success(res, []);

    // Enrich with customer name from orders (bounded concurrency to avoid pool exhaustion)
    const enriched = [];
    for (const s of shipments) {
      const { data: order } = await db
        .from('orders')
        .select('customer_name, delivery_phone')
        .eq('id', s.order_id)
        .single();
      enriched.push({ ...s, customer_name: order?.customer_name || '', delivery_phone: order?.delivery_phone || '' });
    }

    return success(res, enriched);
  } catch (error) {
    logger.error('[shipping] fetch all failed:', error.message);
    return respondError(res, error.message || 'Failed to fetch shipments', 500);
  }
});

// GET /api/shipping/check-serviceability?pincode=&weight=&cod=
router.get('/check-serviceability', async (req, res) => {
  try {
    const { pincode, weight, cod } = req.query;
    if (!pincode || !weight) {
      return respondError(res, 'pincode and weight are required', 400);
    }

    const result = await selectBestProvider({
      pickupPincode: process.env.SHOP_PINCODE || '560064',
      deliveryPincode: pincode,
      weight: parseFloat(weight),
      cod: cod === 'true',
    });

    if (!result) {
      return success(res, { available: false, message: 'No shipping provider available for this pincode' });
    }

    const courier = result.serviceability?.data?.available_courier?.[0];
    return success(res, {
      available: !!courier,
      provider: result.provider?.provider_key,
      courier_name: courier?.courier_name,
      rate: courier?.rate,
      estimated_delivery: courier?.estimated_delivery_days,
      cod_available: courier?.cod,
    });
  } catch (error) {
    logger.error('[shipping] serviceability check failed:', error.message);
    return respondError(res, error.message || 'Serviceability check failed', 500);
  }
});

// POST /api/shipping/create
// Internal — called by payment verification / admin approval to create shipment
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { orderId, weight, cod } = req.body;
    if (!orderId) return respondError(res, 'orderId is required', 400);

    const { data: order } = await req.db
      .from('orders')
      .select('*, user_id')
      .eq('id', orderId)
      .single();

    if (!order) return respondError(res, 'Order not found', 404);

    const isAdmin = req.user.role === 'admin';
    const isOwner = String(order.user_id) === String(req.user.userId || req.user.id);
    if (!isAdmin && !isOwner) {
      return respondError(res, 'Access denied', 403);
    }

    const provider = await getDefaultProvider();
    if (!provider) return respondError(res, 'No active shipping provider configured', 503);

    const { data: providerRecord } = await req.db
      .from('shipping_providers')
      .select('id')
      .eq('provider_key', provider.provider.provider_key)
      .single();

    const payload = {
      order_id: order.id,
      order_date: order.created_at,
      pickup_location: 'Primary',
      billing_customer_name: order.customer_name || 'Customer',
      billing_last_name: '',
      billing_address: order.delivery_address || '',
      billing_city: req.body.city || '',
      billing_state: req.body.state || '',
      billing_pincode: req.body.pincode || '',
      billing_email: order.customer_email || '',
      billing_phone: order.delivery_phone || '',
      shipping_is_billing: true,
      order_items: (order.items || []).map((item) => ({
        name: item.name || 'Item',
        quantity: item.quantity || 1,
        price: item.price || 0,
      })),
      payment_method: order.payment_method === 'COD' ? 'COD' : 'Prepaid',
      sub_total: order.subtotal || 0,
      length: req.body.length || 10,
      breadth: req.body.breadth || 10,
      height: req.body.height || 10,
      weight: weight || 0.5,
    };

    const shipmentResult = await provider.adapter.createShipment(payload);

    let awbResult = null;
    let pickupResult = null;
    let labelResult = null;
    if (shipmentResult.shipment_id) {
      awbResult = await provider.adapter.assignCourier(shipmentResult.shipment_id);
      try {
        pickupResult = await provider.adapter.schedulePickup(shipmentResult.shipment_id);
      } catch (pickErr) {
        logger.warn(`[shipping] Pickup scheduling failed: ${pickErr.message}`);
      }
      try {
        labelResult = await provider.adapter.generateLabel(shipmentResult.shipment_id);
      } catch (labelErr) {
        logger.warn(`[shipping] Label generation failed: ${labelErr.message}`);
      }
    }

    const providerShipmentId = shipmentResult.shipment_id ? String(shipmentResult.shipment_id) : null;

    const { data: shipment } = await req.db
      .from('shipments')
      .insert({
        order_id: order.id,
        shipping_provider_id: providerRecord.id,
        awb_code: awbResult?.awb_code || null,
        status: 'pending',
        weight: parseFloat(weight) || 0.5,
        is_cod: order.payment_method === 'COD',
        courier_name: awbResult?.courier_name || null,
        courier_id: req.body.courier_id || null,
        provider_shipment_id: providerShipmentId,
        service_type: awbResult?.courier_name ? 'standard' : null,
        provider_response: shipmentResult,
        pickup_requested: !!pickupResult,
        pickup_requested_at: pickupResult ? new Date().toISOString() : null,
        label_generated: !!labelResult,
        origin_address: process.env.SHOP_ADDRESS || 'Primary Warehouse',
        recipient_address_snapshot: JSON.parse(JSON.stringify({
          name: order.customer_name,
          phone: order.delivery_phone,
          address: order.delivery_address,
        })),
      })
      .single();

    // Link shipment to order
    if (shipment) {
      await req.db.from('orders').update({
        shipment_id: shipment.id,
        shipment_awb: awbResult?.awb_code || null,
        shipment_courier: awbResult?.courier_name || null,
        shipment_status: 'pending',
        fulfillment_status: 'with_carrier',
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
    }

    return success(res, {
      message: 'Shipment created successfully',
      shipment,
      provider: provider.provider.provider_key,
    });
  } catch (error) {
    logger.error('[shipping] create shipment failed:', error.message);
    return respondError(res, error.message || 'Shipment creation failed', 500);
  }
});

// GET /api/shipping/track/:orderId
router.get('/track/:orderId', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;

    const { data: order } = await req.db
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (!order) return respondError(res, 'Order not found', 404);

    const isOwner = String(order.user_id) === String(req.user.userId || req.user.id);
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return respondError(res, 'Access denied', 403);
    }

    const trackDb = isAdmin ? db : req.db;

    const { data: shipment } = await trackDb
      .from('shipments')
      .select('*, shipping_provider_id')
      .eq('order_id', orderId)
      .single();

    if (!shipment) {
      return success(res, { hasShipment: false, message: 'No shipment record found for this order' });
    }

    let trackingEvents = [];
    let awbTracking = null;

    const { data: events } = await trackDb
      .from('shipment_tracking_events')
      .select('*')
      .eq('shipment_id', shipment.id)
      .order('occurred_at', { ascending: false });

    trackingEvents = events || [];

    if (shipment.awb_code) {
      try {
        const provider = await getDefaultProvider();
        if (provider && !db.isMock) {
          awbTracking = await provider.adapter.trackShipment(shipment.awb_code);
        }
      } catch (err) {
        logger.warn(`[shipping] AWB tracking failed for ${shipment.awb_code}: ${err.message}`);
      }
    }

    const timeline = buildTimeline(trackingEvents, awbTracking, order);

    return success(res, {
      hasShipment: true,
      shipment: {
        id: shipment.id,
        awbCode: shipment.awb_code,
        status: shipment.status,
        courierName: shipment.courier_name,
        trackingUrl: shipment.tracking_url,
        labelUrl: shipment.label_url,
        weight: shipment.weight,
        isCod: shipment.is_cod,
        createdAt: shipment.created_at,
        shippedAt: shipment.shipped_at,
        deliveredAt: shipment.delivered_at,
      },
      timeline,
    });
  } catch (error) {
    logger.error('[shipping] track failed:', error.message);
    return respondError(res, error.message || 'Tracking failed', 500);
  }
});

function buildTimeline(events, awbTracking, order) {
  const timeline = [];

  timeline.push({
    status: 'placed',
    label: 'Order Placed',
    done: true,
    time: order.created_at,
  });

  if (events.length > 0) {
    const sorted = [...events].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
    for (const ev of sorted) {
      timeline.push({
        status: ev.status,
        label: ev.description || ev.status,
        done: true,
        time: ev.occurred_at,
        location: ev.location,
      });
    }
  }

  if (awbTracking?.tracking_data?.timeline) {
    for (const entry of awbTracking.tracking_data.timeline) {
      const exists = timeline.some((t) => t.status === entry.status);
      if (!exists) {
        timeline.push({
          status: entry.status,
          label: entry.activity || entry.status,
          done: true,
          time: entry.date,
          location: entry.location,
        });
      }
    }
  }

  return timeline;
}

// POST /api/shipping/cancel/:orderId
router.post('/cancel/:orderId', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) return respondError(res, 'Admins only', 403);

    const { data: shipment } = await db
      .from('shipments')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (!shipment) return respondError(res, 'No shipment found for this order', 404);

    const provider = await getDefaultProvider();
    if (!provider) return respondError(res, 'No active shipping provider', 503);

    const providerShipmentId = shipment.provider_shipment_id || shipment.provider_response?.shipment_id;
    if (providerShipmentId) {
      await provider.adapter.cancelShipment(providerShipmentId);
    }

    await db
      .from('shipments')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: req.body.reason || 'Cancelled by admin',
        updated_at: new Date().toISOString(),
      })
      .eq('id', shipment.id);

    await db
      .from('shipment_tracking_events')
      .insert({
        shipment_id: shipment.id,
        status: 'cancelled',
        description: 'Shipment cancelled by admin',
        occurred_at: new Date().toISOString(),
      });

    return success(res, { message: 'Shipment cancelled successfully' });
  } catch (error) {
    logger.error('[shipping] cancel failed:', error.message);
    return respondError(res, error.message || 'Shipment cancellation failed', 500);
  }
});

// GET /api/shipping/ndr-shipments
// Admin: fetch all shipments with NDR status
router.get('/ndr-shipments', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return respondError(res, 'Admins only', 403);

    const { data: shipments } = await db
      .from('shipments')
      .select('*')
      .eq('status', 'ndr')
      .order('updated_at', { ascending: false });

    if (!shipments || shipments.length === 0) return success(res, []);

    const enriched = [];
    for (const s of shipments) {
      const { data: order } = await db
        .from('orders')
        .select('customer_name, delivery_phone, delivery_address, id, total, status, delivery_status, fulfillment_status')
        .eq('id', s.order_id)
        .single();
      enriched.push({
        ...s,
        customer_name: order?.customer_name || '',
        delivery_phone: order?.delivery_phone || '',
        delivery_address: order?.delivery_address || '',
        order_total: order?.total || 0,
        order_status: order?.status || '',
        order_delivery_status: order?.delivery_status || '',
        order_fulfillment_status: order?.fulfillment_status || '',
      });
    }

    return success(res, enriched);
  } catch (error) {
    logger.error('[shipping] NDR fetch failed:', error.message);
    return respondError(res, error.message || 'Failed to fetch NDR shipments', 500);
  }
});

module.exports = router;
