const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { getProvider } = require('../services/shipping/ProviderRegistry');

const SHIPMENT_STATUS_MAP = {
  'NEW': 'pending',
  'PICKUP SCHEDULED': 'pickup_scheduled',
  'PICKUP SCHEDULED BY CUSTOMER': 'pickup_scheduled',
  'PICKUP RESCHEDULED': 'pickup_scheduled',
  'PICKUP CANCELLED': 'pickup_cancelled',
  'PICKED UP': 'picked_up',
  'SHIPPED': 'shipped',
  'IN TRANSIT': 'in_transit',
  'OUT FOR DELIVERY': 'out_for_delivery',
  'DELIVERED': 'delivered',
  'CANCELLED': 'cancelled',
  'RETURNED': 'returned',
  'RTO': 'returned',
  'RTO OFD': 'returned',
  'RTO DELIVERED': 'returned',
  'NDR': 'ndr',
  'NDR ATTEMPTED': 'ndr',
  'NDR RESCHEDULED': 'ndr',
  'OUT FOR DELIVERY - NDR': 'ndr',
};

const NDR_STATUSES = new Set(['ndr']);

// POST /api/shipping/webhooks/:providerKey
router.post('/webhooks/:providerKey', async (req, res) => {
  const { providerKey } = req.params;

  try {
    const adapter = await getProvider(providerKey);
    if (!adapter) {
      logger.warn(`[shipping-webhook] Unknown or inactive provider: ${providerKey}`);
      return res.status(404).json({ error: 'Provider not found or inactive' });
    }

    if (!adapter.verifyWebhookSignature(req)) {
      logger.warn(`[shipping-webhook] Invalid signature from provider: ${providerKey}`);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = adapter.parseWebhookPayload(req.body);
    if (!payload || !payload.awbCode) {
      return res.status(200).json({ received: true });
    }

    const { data: shipment } = await db
      .from('shipments')
      .select('*')
      .eq('awb_code', payload.awbCode)
      .single();

    if (!shipment) {
      logger.warn(`[shipping-webhook] No shipment found for AWB: ${payload.awbCode}`);
      return res.status(200).json({ received: true });
    }

    const newStatus = SHIPMENT_STATUS_MAP[payload.status?.toUpperCase()] || payload.status?.toLowerCase() || 'unknown';

    const shipmentUpdate = {
      status: newStatus,
      tracking_url: payload.trackingUrl || shipment.tracking_url,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === 'shipped' && !shipment.shipped_at) {
      shipmentUpdate.shipped_at = new Date().toISOString();
    }
    if (newStatus === 'delivered') {
      shipmentUpdate.delivered_at = new Date().toISOString();
    }
    if (newStatus === 'cancelled' || newStatus === 'returned') {
      shipmentUpdate.cancelled_at = new Date().toISOString();
    }
    if (NDR_STATUSES.has(newStatus) && !shipment.ndr_raised_at) {
      shipmentUpdate.ndr_raised_at = new Date().toISOString();
    }

    await db
      .from('shipments')
      .update(shipmentUpdate)
      .eq('id', shipment.id);

    await db
      .from('shipment_tracking_events')
      .insert({
        shipment_id: shipment.id,
        status: newStatus,
        location: payload.location || '',
        description: payload.description || payload.status || '',
        occurred_at: payload.occurredAt || new Date().toISOString(),
      });

    const deliveryStatusMap = {
      'shipped': 'shipped',
      'in_transit': 'in_transit',
      'out_for_delivery': 'in_transit',
      'delivered': 'delivered',
      'cancelled': 'cancelled',
      'returned': 'cancelled',
    };

    // NDR does NOT change order delivery_status — only notifies admin
    if (NDR_STATUSES.has(newStatus)) {
      logger.info(`[shipping-webhook] NDR raised for Order ${shipment.order_id}, AWB ${payload.awbCode}`);

      try {
        const { sendSseEvent } = require('../../lib/sse');
        sendSseEvent('order:ndr', {
          orderId: shipment.order_id,
          shipmentId: shipment.id,
          awbCode: payload.awbCode,
          description: payload.description || '',
          ndr_raised_at: shipmentUpdate.ndr_raised_at,
        });
      } catch (e) { /* ignore */ }

      // Log NDR to order_status_history
      await db.from('order_status_history').insert({
        order_id: shipment.order_id,
        field_name: 'delivery_status',
        old_value: shipment.status || 'unknown',
        new_value: 'ndr',
        changed_by: 'webhook:' + newStatus,
        changed_at: new Date().toISOString(),
      }).catch(() => {});

      return res.status(200).json({ received: true });
    }

    if (deliveryStatusMap[newStatus]) {
      const mappedStatus = deliveryStatusMap[newStatus];
      const orderUpdate = {
        delivery_status: mappedStatus,
        updated_at: new Date().toISOString(),
      };
      if (newStatus === 'delivered') {
        orderUpdate.delivered_at = new Date().toISOString();
        orderUpdate.fulfillment_status = 'delivered';
      }
      await db
        .from('orders')
        .update(orderUpdate)
        .eq('id', shipment.order_id);

      // Log to order_status_history
      await db.from('order_status_history').insert({
        order_id: shipment.order_id,
        field_name: 'delivery_status',
        old_value: shipment.status || 'unknown',
        new_value: mappedStatus,
        changed_by: 'webhook:' + newStatus,
        changed_at: new Date().toISOString(),
      }).catch(() => {});

      // Start return window on webhook-delivered
      if (newStatus === 'delivered') {
        try {
          const { startReturnWindow } = require('../modules/orders/OrderStateService');
          await startReturnWindow(shipment.order_id);
          logger.info(`[shipping-webhook] Return window started for order ${shipment.order_id}`);
        } catch (rwErr) {
          logger.warn(`[shipping-webhook] Failed to start return window for ${shipment.order_id}: ${rwErr.message}`);
        }
      }

      // Auto-cancel + refund on RTO/return
      if (newStatus === 'returned' || newStatus === 'cancelled') {
        try {
          const { cancelCarrierShipment, executeRefundProcess } = require('../modules/refunds/RefundService');
          await cancelCarrierShipment(shipment.order_id, 'RTO: Shipment returned to sender');
          // Also trigger payment gateway refund if order was paid
          const { data: rtoOrder } = await db.from('orders').select('*').eq('id', shipment.order_id).single();
          if (rtoOrder && rtoOrder.razorpay_payment_id) {
            await executeRefundProcess(rtoOrder, rtoOrder.total, 'system', 'RTO: Shipment returned to sender');
          }
        } catch (refundErr) {
          logger.error(`[shipping-webhook] Auto-refund failed after RTO for ${shipment.order_id}: ${refundErr.message}`);
        }
      }
    }

    logger.info(`[shipping-webhook] ${providerKey}: Order ${shipment.order_id} → ${newStatus}`);

    try {
      const { sendSseEvent } = require('../../lib/sse');
      sendSseEvent('order:updated', { orderId: shipment.order_id, delivery_status: newStatus });
    } catch (e) { /* ignore */ }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`[shipping-webhook] Error processing ${providerKey} webhook:`, error.message);
    return res.status(200).json({ received: true });
  }
});

module.exports = router;
