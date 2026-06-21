const repo = require("./RefundRepository");
const { OrderStates, restockOrderItems } = require("../orders/OrderStateService");
const { verifyWebhookSignature } = require("../payments/PaymentService");
const { logRefundAction } = require("./RefundAuditService");
const { sendRefundNotification } = require("./RefundService");
const logger = require("../../utils/logger");

/**
 * Handle incoming verified Razorpay webhook events
 * @param {object} event - Parsed Razorpay webhook JSON payload
 */
async function handleWebhookEvent(event) {
  const eventName = event.event;
  logger.info(`[RefundWebhookHandler] Processing webhook event: ${eventName}`);

  switch (eventName) {
    case "refund.processed": {
      const entity = event.payload.refund.entity;
      const rzpRefundId = entity.id;

      const refund = await repo.findRefundByRazorpayRefundId(rzpRefundId);
      if (!refund) {
        logger.warn(`[RefundWebhookHandler] refund.processed event: Refund record not found for Razorpay ID ${rzpRefundId}`);
        return;
      }

      // Check if already processed to prevent duplicate processing
      if (refund.status === "processed") {
        logger.info(`[RefundWebhookHandler] Refund ${refund.id} already processed.`);
        return;
      }

      // Update refund record
      const updatedRefund = await repo.updateRefund(refund.id, {
        status: "processed",
        processed_at: new Date().toISOString()
      });

      // Fetch order
      const order = await repo.findOrderById(refund.order_id);
      if (order) {
        const totalRefunded = Number(order.total_refunded_amount || 0);
        const orderTotal = Number(order.total);
        const isFullRefund = totalRefunded >= orderTotal;

        const orderUpdates = {
          status: isFullRefund ? OrderStates.REFUND_COMPLETED : OrderStates.REFUND_PROCESSING,
          refund_status: isFullRefund ? "processed" : "partial"
        };

        const updatedOrder = await repo.updateOrder(order.id, orderUpdates);

        // Audit log
        await logRefundAction({
          refundId: refund.id,
          orderId: order.id,
          action: "REFUND_COMPLETED",
          performedBy: "SYSTEM",
          metadata: { rzpRefundId, amount: refund.refund_amount, isFullRefund }
        });

        // Notify user
        await sendRefundNotification(updatedOrder, "REFUND_COMPLETED", { rzpRefundId, amount: refund.refund_amount });
      }
      break;
    }

    case "refund.failed": {
      const entity = event.payload.refund.entity;
      const rzpRefundId = entity.id;

      const refund = await repo.findRefundByRazorpayRefundId(rzpRefundId);
      if (!refund) {
        logger.warn(`[RefundWebhookHandler] refund.failed event: Refund record not found for Razorpay ID ${rzpRefundId}`);
        return;
      }

      if (refund.status === "failed") {
        logger.info(`[RefundWebhookHandler] Refund ${refund.id} already marked as failed.`);
        return;
      }

      // Update refund record
      await repo.updateRefund(refund.id, {
        status: "failed",
        failure_reason: entity.error_description || "Razorpay processed failure"
      });

      const order = await repo.findOrderById(refund.order_id);
      if (order) {
        const updatedOrder = await repo.updateOrder(order.id, {
          status: OrderStates.REFUND_FAILED,
          refund_status: "failed"
        });

        // Audit log
        await logRefundAction({
          refundId: refund.id,
          orderId: order.id,
          action: "REFUND_FAILED",
          performedBy: "SYSTEM",
          metadata: { rzpRefundId, error: entity.error_description }
        });

        // Notify user
        await sendRefundNotification(updatedOrder, "REFUND_FAILED", { amount: refund.refund_amount });
      }
      break;
    }

    case "payment.captured": {
      const entity = event.payload.payment.entity;
      const rzpOrderId = entity.order_id;
      const rzpPaymentId = entity.id;

      // Scan for orphaned order: order exists as 'pending' but payment captured on gateway
      const { data: orders, error } = await repo.findPotentialOrphanedOrders();
      if (error) {
        logger.error(`[RefundWebhookHandler] Error scanning for orphaned order: ${error.message}`);
        return;
      }

      const order = (orders || []).find(o => o.razorpay_order_id === rzpOrderId);

      if (order && order.status === "pending") {
        logger.warn(`[RefundWebhookHandler] ORPHAN DETECTED via Webhook: Order ${order.id} is paid on Razorpay but pending in DB!`);

        // Execute recovery: cancel order & trigger refund
        await logRefundAction({
          orderId: order.id,
          action: "TECHNICAL_RECOVERY",
          performedBy: "SYSTEM",
          metadata: { message: "Orphaned payment detected via webhook capture event. Initiating automated recovery refund.", rzpPaymentId }
        });

        order.razorpay_payment_id = rzpPaymentId;
        await repo.updateOrder(order.id, {
          razorpay_payment_id: rzpPaymentId,
          status: OrderStates.CANCEL_APPROVED,
          delivery_status: "cancelled",
          cancel_reason: "Technical checkout recovery - orphaned payment webhook",
          cancelled_by: "system",
          cancelled_at: new Date().toISOString()
        });

        // Trigger refund process asynchronously to return fast from webhook response
        const { initiatePartialRefund, approveCancellation, adminDirectCancellation } = require("./RefundService");
        
        // Notify customer
        await sendRefundNotification(order, "TECHNICAL_RECOVERY", { amount: order.total });

        // Trigger automatic refund process
        const { executeRefundProcess } = require("./RefundService");
        executeRefundProcess(order, order.total, "system", "Technical recovery refund for orphaned payment webhook")
          .then(() => logger.info(`[RefundWebhookHandler] Technical recovery refund processed for order ${order.id}`))
          .catch(err => logger.error(`[RefundWebhookHandler] Technical recovery refund execution failed for order ${order.id}: ${err.message}`));
      }
      break;
    }

    default:
      logger.info(`[RefundWebhookHandler] Ignoring unhandled webhook event: ${eventName}`);
  }
}

/**
 * Express Middleware to verify webhook and process request
 */
async function handleWebhookRequest(req, res) {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Signature verification (only if secret is configured)
    if (secret && signature) {
      // In Express raw body parser middleware may pass the raw body as buffer on req.body
      const rawBody = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
      const isValid = verifyWebhookSignature(rawBody, signature, secret);

      if (!isValid) {
        logger.warn("[RefundWebhookHandler] Webhook signature verification failed!");
        return res.status(400).json({ error: "Invalid webhook signature" });
      }
    } else {
      logger.warn("[RefundWebhookHandler] Webhook secret not configured or signature header missing. Bypassing signature verification.");
    }

    // Parse payload
    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    
    // Process event asynchronously
    handleWebhookEvent(payload)
      .then(() => logger.info("[RefundWebhookHandler] Webhook event handler execution finished"))
      .catch(err => logger.error(`[RefundWebhookHandler] Webhook event handler execution failed: ${err.message}`));

    return res.json({ received: true });
  } catch (err) {
    logger.error(`[RefundWebhookHandler] Webhook request handling failed: ${err.message}`);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

module.exports = {
  handleWebhookEvent,
  handleWebhookRequest
};
