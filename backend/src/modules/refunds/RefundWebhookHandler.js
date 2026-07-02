const repo = require("./RefundRepository");
const { OrderStates, restockOrderItems } = require("../orders/OrderStateService");
const { verifyWebhookSignature } = require("../payments/PaymentService");
const { logRefundAction } = require("./RefundAuditService");
const { sendRefundNotification } = require("./RefundService");
const db = require("../../config/db");
const { sendSseEvent } = require("../../lib/sse");
const { notify } = require("../../services/notificationService");
const logger = require("../../utils/logger");

/**
 * Reconcile a training refund after receiving a webhook update from Razorpay.
 * Attempts to find a matching training_refund by razorpay_refund_id and updates
 * the training_payment and training_enrollment statuses accordingly.
 */
async function reconcileTrainingRefund(rzpRefundId, newStatus, failureDesc) {
  try {
    const rows = await db
      .from("training_refunds")
      .select("*")
      .eq("razorpay_refund_id", rzpRefundId)
      .then(r => r.data || r);
    if (!rows || rows.length === 0) return;

    const trainingRefund = rows[0];
    if (newStatus === "processed" && trainingRefund.status === "processed") {
      logger.info(`[RefundWebhookHandler] Training refund ${trainingRefund.id} already processed.`);
      return;
    }
    if (newStatus === "failed" && trainingRefund.status === "failed") {
      logger.info(`[RefundWebhookHandler] Training refund ${trainingRefund.id} already marked as failed.`);
      return;
    }

    // Update training_refund record
    const updates = { status: newStatus };
    if (newStatus === "processed") updates.processed_at = new Date().toISOString();
    if (newStatus === "failed" && failureDesc) updates.reason = failureDesc;

    await db
      .from("training_refunds")
      .eq("id", trainingRefund.id)
      .update(updates)
      .then(r => r.data || r);

    // Find associated payment
    const paymentRows = await db
      .from("training_payments")
      .select("*")
      .eq("id", trainingRefund.payment_id)
      .then(r => r.data || r);
    if (paymentRows && paymentRows.length > 0) {
      const payment = paymentRows[0];
      const paymentStatus = newStatus === "processed" ? "refunded" : "failed";
      await db
        .from("training_payments")
        .eq("id", payment.id)
        .update({ status: paymentStatus })
        .then(r => r.data || r);

      // Update enrollment status
      const enrollmentStatus = newStatus === "processed" ? "refunded" : "confirmed";
      await db
        .from("training_enrollments")
        .eq("id", payment.enrollment_id)
        .update({ status: enrollmentStatus })
        .then(r => r.data || r);

      // Decrement seats_taken when refund is confirmed
      if (newStatus === "processed") {
        const enrollRows = await db
          .from("training_enrollments")
          .select("batch_id, user_id")
          .eq("id", payment.enrollment_id)
          .then(r => r.data || r);
        if (enrollRows && enrollRows.length > 0) {
          const batchRows = await db
            .from("training_batches")
            .select("seats_taken")
            .eq("id", enrollRows[0].batch_id)
            .then(r => r.data || r);
          if (batchRows && batchRows.length > 0) {
            await db
              .from("training_batches")
              .eq("id", enrollRows[0].batch_id)
              .update({ seats_taken: Math.max(0, (batchRows[0].seats_taken || 1) - 1) })
              .then(r => r.data || r);
          }

          // Send refund notification
          const batchNameRows = await db
            .from("training_batches")
            .select("title")
            .eq("id", enrollRows[0].batch_id)
            .then(r => r.data || r);
          const batchTitle = batchNameRows && batchNameRows.length > 0 ? batchNameRows[0].title : "Training";
          const userRows = await db
            .from("users")
            .select("email, phone, full_name")
            .eq("id", enrollRows[0].user_id)
            .then(r => r.data || r);
          if (userRows && userRows.length > 0) {
            const user = {
              email: userRows[0].email,
              phone: userRows[0].phone,
              fullName: userRows[0].full_name,
            };
            notify("TRAINING_REFUNDED", trainingRefund, user, {
              batchTitle,
              amount: trainingRefund.amount,
              refundId: trainingRefund.razorpay_refund_id,
            }).catch(() => {});
          }
        }
      }

      sendSseEvent("training_enrollment:updated", {
        enrollment_id: payment.enrollment_id,
        status: enrollmentStatus,
        refund_status: newStatus,
      });
    }

    logger.info(`[RefundWebhookHandler] Training refund ${trainingRefund.id} reconciled as ${newStatus}`);
  } catch (err) {
    logger.error(`[RefundWebhookHandler] Failed to reconcile training refund: ${err.message}`);
  }
}

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
        // Calculate total refunded from all processed refunds to avoid staleness
        const allRefunds = await repo.findRefundsByOrderId(order.id);
        const totalProcessed = (allRefunds || [])
          .filter(r => r.status === "processed" || r.id === refund.id)
          .reduce((sum, r) => sum + Number(r.amount || r.refund_amount || 0), 0);
        const orderTotal = Number(order.total);
        const isFullRefund = totalProcessed >= orderTotal;

        const orderUpdates = {
          status: isFullRefund ? OrderStates.REFUND_COMPLETED : OrderStates.REFUND_PROCESSING,
          refund_status: isFullRefund ? "processed" : "partial",
          total_refunded_amount: totalProcessed
        };

        const updatedOrder = await repo.updateOrder(order.id, orderUpdates);

        // Audit log
        await logRefundAction({
          refundId: refund.id,
          orderId: order.id,
          action: "REFUND_COMPLETED",
          performedBy: "SYSTEM",
          metadata: { rzpRefundId, amount: refund.amount || refund.refund_amount, isFullRefund }
        });

        // Notify user
        await sendRefundNotification(updatedOrder, "REFUND_COMPLETED", { rzpRefundId, amount: refund.amount || refund.refund_amount });
      }

      // Also reconcile training refunds if this is a training enrollment refund
      await reconcileTrainingRefund(rzpRefundId, "processed");
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
        await sendRefundNotification(updatedOrder, "REFUND_FAILED", { amount: refund.amount || refund.refund_amount });
      }

      // Also reconcile training refunds if this is a training enrollment refund
      await reconcileTrainingRefund(rzpRefundId, "failed", entity.error_description);
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
        // Re-read order from DB to avoid race with auto-refund sweep
        const freshOrder = await repo.findOrderById(order.id);
        if (!freshOrder || freshOrder.status !== "pending") {
          logger.info(`[RefundWebhookHandler] Order ${order.id} already processed by sweep, skipping.`);
          return;
        }

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
        const { executeRefundProcess } = require("./RefundService");
        
        // Notify customer
        await sendRefundNotification(order, "TECHNICAL_RECOVERY", { amount: order.total });

        // Trigger automatic refund process (await to prevent retry race)
        try {
          await executeRefundProcess(order, order.total, "system", "Technical recovery refund for orphaned payment webhook");
          logger.info(`[RefundWebhookHandler] Technical recovery refund processed for order ${order.id}`);
        } catch (err) {
          logger.error(`[RefundWebhookHandler] Technical recovery refund execution failed for order ${order.id}: ${err.message}`);
        }
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

    // Signature verification
    if (!secret) {
      logger.error("[RefundWebhookHandler] RAZORPAY_WEBHOOK_SECRET is not configured — rejecting all webhook requests.");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }
    if (!signature) {
      logger.warn("[RefundWebhookHandler] Webhook signature header missing.");
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : (Buffer.isBuffer(req.body) ? req.body : null);
    if (!rawBody) {
      logger.error("[RefundWebhookHandler] Raw request body not available — signature verification impossible.");
      return res.status(500).json({ error: "Raw body not available" });
    }
    const isValid = verifyWebhookSignature(rawBody, signature, secret);

    if (!isValid) {
      logger.warn("[RefundWebhookHandler] Webhook signature verification failed!");
      return res.status(400).json({ error: "Invalid webhook signature" });
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
