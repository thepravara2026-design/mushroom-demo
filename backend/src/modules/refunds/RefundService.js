const repo = require("./RefundRepository");
const { OrderStates, isValidTransition, restockOrderItems, isWithCarrier } = require("../orders/OrderStateService");
const { generateRefundIdempotencyKey, initiateRazorpayRefund } = require("../payments/PaymentService");
const { logRefundAction } = require("./RefundAuditService");
const { sendWhatsAppMessage } = require("../../services/notificationService");
const razorpay = require("../../config/razorpay");
const db = require("../../config/db");
const logger = require("../../utils/logger");
const FEATURE_FLAGS = require("../../config/featureFlags");
const { withTransaction, withRowLock } = require("../../services/TransactionManager");
const { send, QUEUES } = require("../../services/QueueService");

/**
 * Cancel carrier shipment if one exists for the order.
 * Called by all cancellation paths.
 */
async function cancelCarrierShipment(orderId, reason) {
  try {
    const { data: shipment } = await db
      .from("shipments")
      .select("*")
      .eq("order_id", orderId)
      .single();
    if (!shipment || shipment.status === 'cancelled' || shipment.status === 'delivered') return;

    const { getDefaultProvider } = require("../../services/shipping/ProviderRegistry");
    const provider = await getDefaultProvider();
    if (provider && (shipment.provider_shipment_id || shipment.provider_response?.shipment_id)) {
      const carrierId = shipment.provider_shipment_id || shipment.provider_response?.shipment_id;
      try {
        await provider.adapter.cancelShipment(carrierId);
      } catch (carrierErr) {
        logger.warn(`[RefundService] Carrier cancel failed for order ${orderId}: ${carrierErr.message}`);
      }
    }

    await db.from("shipments").update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || 'Order cancelled',
      updated_at: new Date().toISOString(),
    }).eq("id", shipment.id);

    await db.from("shipment_tracking_events").insert({
      shipment_id: shipment.id,
      status: 'cancelled',
      description: 'Shipment cancelled due to order cancellation',
      occurred_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(`[RefundService] Failed to cancel shipment for order ${orderId}: ${err.message}`);
  }
}

/**
 * Log a fulfillment_status change to order_status_history.
 */
async function logStatusHistory(orderId, field, oldVal, newVal, changedBy) {
  try {
    await db.from("order_status_history").insert({
      order_id: orderId,
      field_name: field,
      old_value: oldVal != null ? String(oldVal) : null,
      new_value: String(newVal),
      changed_by: changedBy || "system",
      changed_at: new Date().toISOString(),
    });
  } catch (e) { /* ignore */ }
}

/**
 * Send WhatsApp notification to user based on refund events
 */
async function sendRefundNotification(order, actionType, metadata = {}) {
  const phone = order.delivery_phone;
  if (!phone) return;

  let message = "";
  const orderIdShort = order.id.substring(0, 8).toUpperCase();
  const amountStr = metadata.amount ? `₹${metadata.amount}` : `₹${order.total}`;

  switch (actionType) {
    case "CANCELLATION_REQUESTED":
      message = `🚨 *Cancellation Requested* \n\nYour cancellation request for Order *#${orderIdShort}* has been received and is pending admin review. For refund queries, contact support@sporekart.com or call +91 80 4991 3800.`;
      break;
    case "APPROVED":
      message = `✅ *Cancellation Approved* \n\nYour cancellation request for Order *#${orderIdShort}* has been approved. Your order has been cancelled. For refund queries, please contact us at support@sporekart.com or call +91 80 4991 3800.`;
      break;
    case "REJECTED":
      message = `❌ *Cancellation Rejected* \n\nYour cancellation request for Order *#${orderIdShort}* was not approved. Your order is processing and will be shipped shortly. Reason: ${metadata.reason || "N/A"}`;
      break;
    case "SELF_CANCELLED":
      message = `✅ *Self Cancellation Confirmed* \n\nOrder *#${orderIdShort}* has been self-cancelled. Refund of ${amountStr} will be processed shortly. For queries, contact support@sporekart.com.`;
      break;
    case "ADMIN_REJECTED":
      message = `❌ *Order Rejected* \n\nOrder *#${orderIdShort}* could not be approved. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Please contact support for details.'} A refund will be processed if payment was made.`;
      break;
    case "ADMIN_CANCELLED":
      message = `❌ *Order Cancelled by Admin* \n\nOrder *#${orderIdShort}* has been cancelled by an administrator. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Please contact support for details.'} A refund will be processed if payment was made.`;
      break;
    case "RETURN_WINDOW":
      message = `📦 *Return Window Open* \n\nOrder *#${orderIdShort}* delivered! You have 7 days from delivery to request a return. Log in to your Sporekart account to start a return.`;
      break;
    case "REFUND_INITIATED":
      message = `🔄 *Refund Initiated* \n\nRefund of ${amountStr} for Order *#${orderIdShort}* has been initiated manually by our team. Expected settlement: 5-7 business days. For queries, contact support@sporekart.com or +91 80 4991 3800.`;
      break;
    case "REFUND_COMPLETED":
      message = `🎉 *Refund Successful* \n\nRefund of ${amountStr} for Order *#${orderIdShort}* has been successfully processed! If you have any questions, contact support@sporekart.com or +91 80 4991 3800. \nRef Number: ${metadata.rzpRefundId || "N/A"}`;
      break;
    case "REFUND_FAILED":
      message = `⚠️ *Refund Failed* \n\nRefund of ${amountStr} for Order *#${orderIdShort}* failed to process. Please contact support@sporekart.com or call +91 80 4991 3800 for assistance.`;
      break;
    case "TECHNICAL_RECOVERY":
      message = `🔧 *Order Recovery Refund* \n\nWe detected a technical glitch with your order *#${orderIdShort}*. Your payment was received but order creation was disrupted. An automatic refund of ${amountStr} has been initiated.`;
      break;
  }

  if (message) {
    // Retry up to 3 times with exponential backoff
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sendWhatsAppMessage(phone, message);
        break; // Success — exit retry loop
      } catch (err) {
        if (attempt < 3) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, then final log
          logger.warn(`[RefundService] WhatsApp send attempt ${attempt}/3 failed for order ${order.id}, retrying in ${delay}ms: ${err.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.error(`[RefundService] All 3 WhatsApp attempts failed for order ${order.id}: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Customer requests cancellation before shipment
 */
async function requestCustomerCancellation(orderId, userId, reason) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (order.user_id !== userId) {
    throw new Error("Unauthorized to cancel this order");
  }

  if (order.status !== "paid" && order.status !== "pending") {
    throw new Error("Only unpaid or paid orders can be cancelled");
  }

  if (isWithCarrier(order)) {
    throw new Error("Order cannot be cancelled after it has been handed to the carrier. Please contact support for RTO assistance.");
  }

  // Validate state machine transition
  if (!isValidTransition(order.status, OrderStates.CANCEL_REQUESTED)) {
    throw new Error(`Invalid status transition from ${order.status} to CANCEL_REQUESTED`);
  }

  // Update order status
  const updatedOrder = await repo.updateOrder(orderId, {
    status: OrderStates.CANCEL_REQUESTED,
    cancel_reason: reason.slice(0, 255),
    cancelled_by: "user",
    cancelled_at: new Date().toISOString()
  });

  // Log audit trail
  await logRefundAction({
    orderId,
    action: "CANCELLATION_REQUESTED",
    performedBy: userId,
    metadata: { reason }
  });

  // Send notification
  await sendRefundNotification(updatedOrder, "CANCELLATION_REQUESTED");

  return updatedOrder;
}

/**
 * Helper to process refund gateway calls and update order/refund records
 * Uses transactions + row-level locks + optimistic concurrency control
 */
async function executeRefundProcess(order, refundAmount, initiatedBy, reason, adminNote = "", adminUser = null) {
  if (!order.razorpay_payment_id) {
    throw new Error("Order has no transaction/payment ID to refund");
  }

  const existingRefunds = await repo.findRefundsByOrderId(order.id);
  const attemptCount = (existingRefunds || []).length;
  const idempotencyKey = generateRefundIdempotencyKey(order.id, order.razorpay_payment_id, refundAmount, attemptCount);
  const auditPerformer = adminUser || (initiatedBy === "admin" ? "ADMIN" : "SYSTEM");
  const usesQueue = FEATURE_FLAGS.ENABLE_QUEUE;
  const usesTransactions = FEATURE_FLAGS.ENABLE_TRANSACTIONS;

  // Phase 1: Atomic status transition to REFUND_PENDING (with row lock + version check)
  if (usesQueue) {
    await send(QUEUES.REFUND_PROCESSING, {
      action: "execute_refund",
      orderId: order.id,
      payload: { amount: refundAmount, initiatedBy, reason, adminNote, adminUser: auditPerformer }
    });
    return { success: true, queued: true, message: "Refund queued for processing" };
  }

  if (usesTransactions) {
    return executeRefundWithTransaction(order, refundAmount, initiatedBy, reason, adminNote, auditPerformer, idempotencyKey);
  }

  // Fallback: original compensating-transaction pattern (no DB-level locking)
  return executeRefundWithCompensatingTransaction(order, refundAmount, initiatedBy, reason, adminNote, auditPerformer, idempotencyKey);
}

async function executeRefundWithTransaction(order, refundAmount, initiatedBy, reason, adminNote, auditPerformer, idempotencyKey) {
  let rzpRefund = null;
  let refundRecord = null;
  let orderVersion;

  // Phase 1: Create refund record + transition order in a transaction with row lock
  await withTransaction(async (client) => {
    const lockedOrder = await withRowLock(client, "orders", order.id);
    if (!lockedOrder) throw new Error("Order not found or locked");
    orderVersion = lockedOrder.version;

    refundRecord = await repo.createRefund({
      order_id: order.id,
      user_id: order.user_id,
      razorpay_payment_id: order.razorpay_payment_id,
      razorpay_refund_id: null,
      amount: refundAmount,
      refund_reason: reason,
      status: "pending",
      cancelled_by: initiatedBy,
      admin_note: adminNote,
    });

    const orderUpdate = {
      status: OrderStates.REFUND_PENDING,
      refund_status: "pending",
    };
    const r = await client.query(
      `UPDATE orders SET status = $1, refund_status = $2, version = version + 1, updated_at = $3 WHERE id = $4 AND version = $5`,
      [orderUpdate.status, orderUpdate.refund_status, new Date().toISOString(), order.id, lockedOrder.version]
    );
    if (r.rowCount === 0) {
      throw new Error(`Optimistic lock conflict on order ${order.id} during refund initiation`);
    }
  });

  await logRefundAction({
    orderId: order.id,
    action: "REFUND_PENDING",
    performedBy: auditPerformer,
    metadata: { refundAmount, reason }
  });

  try {
    const amountInPaise = Math.round(refundAmount * 100);
    rzpRefund = await initiateRazorpayRefund(order.razorpay_payment_id, amountInPaise, idempotencyKey, {
      orderId: order.id,
      reason,
      initiatedBy
    });

    // Phase 2: Update refund + order in transaction with row lock
    await withTransaction(async (client) => {
      const lockedOrder = await withRowLock(client, "orders", order.id);
      if (!lockedOrder) throw new Error("Order not found");

      const r1 = await client.query(
        `UPDATE refunds SET razorpay_refund_id = $1, status = $2, version = version + 1, updated_at = $3 WHERE id = $4 AND version = $5`,
        [rzpRefund.id, "initiated", new Date().toISOString(), refundRecord.id, 1]
      );
      if (r1.rowCount === 0) {
        logger.warn(`[RefundService] Refund record ${refundRecord.id} version mismatch — proceeding`);
      }

      const totalRefunded = Number(order.total_refunded_amount || 0) + Number(refundAmount);
      const r2 = await client.query(
        `UPDATE orders SET status = $1, refund_status = $2, refund_id = $3, total_refunded_amount = $4, version = version + 1, updated_at = $5 WHERE id = $6 AND version >= $7`,
        [OrderStates.REFUND_INITIATED, "initiated", refundRecord.id, totalRefunded, new Date().toISOString(), order.id, lockedOrder.version]
      );
      if (r2.rowCount === 0) {
        throw new Error(`Optimistic lock conflict on order ${order.id} after gateway refund`);
      }
    });

    refundRecord.razorpay_refund_id = rzpRefund.id;
    refundRecord.status = "initiated";

    await restockOrderItems(order);

    await logRefundAction({
      refundId: refundRecord.id,
      orderId: order.id,
      action: "REFUND_INITIATED",
      performedBy: auditPerformer,
      metadata: { razorpayRefundId: rzpRefund.id, amount: refundAmount }
    });

    const updatedOrder = await repo.findOrderById(order.id);
    await sendRefundNotification(updatedOrder, "REFUND_INITIATED", { refundId: rzpRefund.id, amount: refundAmount });

    return { success: true, order: updatedOrder, refund: refundRecord };
  } catch (err) {
    logger.error(`[RefundService] Refund execution failed for order ${order.id}: ${err.message}`);

    try {
      await withTransaction(async (client) => {
        const lockedOrder = await withRowLock(client, "orders", order.id);
        if (refundRecord) {
          await client.query(
            `UPDATE refunds SET razorpay_refund_id = $1, status = $2, failure_reason = $3, version = version + 1, updated_at = $4 WHERE id = $5`,
            [rzpRefund ? rzpRefund.id : `FAILED_${Date.now()}`, "failed", err.message, new Date().toISOString(), refundRecord.id]
          );
        }
        await client.query(
          `UPDATE orders SET status = $1, refund_status = $2, refund_id = $3, version = version + 1, updated_at = $4 WHERE id = $5`,
          [OrderStates.REFUND_FAILED, "failed", refundRecord?.id || null, new Date().toISOString(), order.id]
        );
      });
    } catch (txErr) {
      logger.error(`[RefundService] Failed to record refund failure in transaction: ${txErr.message}`);
    }

    await restockOrderItems(order);

    await logRefundAction({
      refundId: refundRecord?.id,
      orderId: order.id,
      action: "REFUND_FAILED",
      performedBy: auditPerformer,
      metadata: { error: err.message, partialRefundCreated: !!rzpRefund }
    });

    if (rzpRefund) {
      logger.error(`[RefundService] CRITICAL: Razorpay refund ${rzpRefund.id} was created but DB state is failed. Order ${order.id}. Webhook should reconcile.`);
    }

    const failedOrder = await repo.findOrderById(order.id);
    await sendRefundNotification(failedOrder, "REFUND_FAILED", { amount: refundAmount });

    throw new Error(`Refund initiation failed: ${err.message}`);
  }
}

// Original compensating-transaction pattern preserved as fallback
async function executeRefundWithCompensatingTransaction(order, refundAmount, initiatedBy, reason, adminNote, auditPerformer, idempotencyKey) {
  await repo.updateOrder(order.id, {
    status: OrderStates.REFUND_PENDING,
    refund_status: "pending"
  });

  await logRefundAction({
    orderId: order.id,
    action: "REFUND_PENDING",
    performedBy: auditPerformer,
    metadata: { refundAmount, reason }
  });

  let rzpRefund = null;
  let refundRecord = null;

  try {
    refundRecord = await repo.createRefund({
      order_id: order.id,
      user_id: order.user_id,
      razorpay_payment_id: order.razorpay_payment_id,
      razorpay_refund_id: null,
      amount: refundAmount,
      refund_reason: reason,
      status: "pending",
      cancelled_by: initiatedBy,
      admin_note: adminNote
    });

    const amountInPaise = Math.round(refundAmount * 100);
    rzpRefund = await initiateRazorpayRefund(order.razorpay_payment_id, amountInPaise, idempotencyKey, {
      orderId: order.id,
      reason,
      initiatedBy
    });

    refundRecord = await repo.updateRefund(refundRecord.id, {
      razorpay_refund_id: rzpRefund.id,
      status: "initiated"
    });

    const orderUpdates = {
      status: OrderStates.REFUND_INITIATED,
      refund_status: "initiated",
      refund_id: refundRecord.id,
      total_refunded_amount: Number(order.total_refunded_amount || 0) + Number(refundAmount)
    };
    const updatedOrder = await repo.updateOrder(order.id, orderUpdates);

    await restockOrderItems(order);

    await logRefundAction({
      refundId: refundRecord.id,
      orderId: order.id,
      action: "REFUND_INITIATED",
      performedBy: auditPerformer,
      metadata: { razorpayRefundId: rzpRefund.id, amount: refundAmount }
    });

    await sendRefundNotification(updatedOrder, "REFUND_INITIATED", { refundId: rzpRefund.id, amount: refundAmount });

    return { success: true, order: updatedOrder, refund: refundRecord };
  } catch (err) {
    logger.error(`[RefundService] Refund execution failed for order ${order.id}: ${err.message}`);

    if (refundRecord) {
      await repo.updateRefund(refundRecord.id, {
        razorpay_refund_id: rzpRefund ? rzpRefund.id : `FAILED_${Date.now()}`,
        status: "failed",
        failure_reason: err.message
      });
    } else {
      refundRecord = await repo.createRefund({
        order_id: order.id,
        user_id: order.user_id,
        razorpay_payment_id: order.razorpay_payment_id,
        razorpay_refund_id: `FAILED_${Date.now()}`,
        amount: refundAmount,
        refund_reason: reason,
        status: "failed",
        cancelled_by: initiatedBy,
        admin_note: adminNote,
        failure_reason: err.message
      });
    }

    const updatedOrder = await repo.updateOrder(order.id, {
      status: OrderStates.REFUND_FAILED,
      refund_status: "failed",
      refund_id: refundRecord.id
    });

    await restockOrderItems(order);

    await logRefundAction({
      refundId: refundRecord.id,
      orderId: order.id,
      action: "REFUND_FAILED",
      performedBy: auditPerformer,
      metadata: { error: err.message, partialRefundCreated: !!rzpRefund }
    });

    if (rzpRefund) {
      logger.error(`[RefundService] CRITICAL: Razorpay refund ${rzpRefund.id} was created but DB state is failed. Order ${order.id}. Webhook should reconcile.`);
    }

    await sendRefundNotification(updatedOrder, "REFUND_FAILED", { amount: refundAmount });

    throw new Error(`Refund initiation failed: ${err.message}`);
  }
}

/**
 * Admin approves user cancellation request (creates pending refund record)
 */
async function approveCancellation(orderId, adminNote = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStates.CANCEL_REQUESTED) {
    throw new Error(`Order cancellation request must be in CANCEL_REQUESTED status. Current: ${order.status}`);
  }

  if (!isValidTransition(order.status, OrderStates.CANCELLED)) {
    throw new Error(`Invalid transition from ${order.status} to CANCELLED`);
  }

  await cancelCarrierShipment(orderId, order.cancel_reason || "cancellation approved");

  const auditPerformer = adminUser || "ADMIN";
  const cancelledByIdentity = adminUser ? (adminUser.userId || adminUser.id || "admin") : "customer";
  let refundRecord = null;

  if (FEATURE_FLAGS.ENABLE_TRANSACTIONS) {
    await withTransaction(async (client) => {
      const lockedOrder = await withRowLock(client, "orders", orderId);
      if (!lockedOrder) throw new Error("Order not found");

      await client.query(
        `UPDATE orders SET status = $1, delivery_status = $2, fulfillment_status = $3, refund_status = $4, cancelled_by = $5, cancelled_at = $6, version = version + 1, updated_at = $7 WHERE id = $8 AND version = $9`,
        [OrderStates.CANCELLED, "cancelled", null, "pending", cancelledByIdentity, new Date().toISOString(), new Date().toISOString(), orderId, lockedOrder.version]
      );

      refundRecord = await repo.createRefund({
        order_id: order.id,
        user_id: order.user_id,
        razorpay_payment_id: order.razorpay_payment_id || null,
        razorpay_refund_id: null,
        amount: order.total,
        refund_reason: order.cancel_reason || "approved cancellation request",
        status: "pending",
        cancelled_by: cancelledByIdentity,
        admin_note: adminNote
      });
    });
  } else {
    await repo.updateOrder(orderId, {
      status: OrderStates.CANCELLED,
      delivery_status: "cancelled",
      fulfillment_status: null,
      refund_status: "pending",
      cancelled_by: cancelledByIdentity,
      cancelled_at: new Date().toISOString()
    });

    try {
      refundRecord = await repo.createRefund({
        order_id: order.id,
        user_id: order.user_id,
        razorpay_payment_id: order.razorpay_payment_id || null,
        razorpay_refund_id: null,
        amount: order.total,
        refund_reason: order.cancel_reason || "approved cancellation request",
        status: "pending",
        cancelled_by: cancelledByIdentity,
        admin_note: adminNote
      });
    } catch (createErr) {
      logger.warn(`[RefundService] Failed to create refunds table row for order ${order.id}: ${createErr.message}`);
    }
  }

  await restockOrderItems(order);

  await logRefundAction({
    orderId,
    action: "CANCEL_APPROVED",
    performedBy: auditPerformer,
    metadata: { adminNote, refundType: "manual", refundRecordId: refundRecord?.id }
  });

  const cancelledOrder = await repo.findOrderById(orderId);
  await sendRefundNotification(cancelledOrder, "APPROVED", { amount: order.total });

  return { success: true, order: cancelledOrder, refund: refundRecord };
}

/**
 * Admin rejects user cancellation request
 */
async function rejectCancellation(orderId, reason = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStates.CANCEL_REQUESTED) {
    throw new Error("Order must be in CANCEL_REQUESTED status to be rejected.");
  }

  if (!isValidTransition(order.status, OrderStates.CANCEL_REJECTED)) {
    throw new Error(`Invalid transition from ${order.status} to CANCEL_REJECTED`);
  }

  // Return order back to paid status and processing delivery status
  const updatedOrder = await repo.updateOrder(orderId, {
    status: OrderStates.PAID,
    delivery_status: "processing",
    cancel_reason: null
  });

  await logRefundAction({
    orderId,
    action: "CANCEL_REJECTED",
    performedBy: adminUser || "ADMIN",
    metadata: { reason }
  });

  // Notify rejection
  await sendRefundNotification(updatedOrder, "REJECTED", { reason });

  return updatedOrder;
}

/**
 * Admin cancels order directly (manual refund only - no auto gateway refund)
 */
const TERMINAL_STATES = new Set([
  OrderStates.COMPLETED, OrderStates.REFUND_COMPLETED, OrderStates.CANCELLED,
  "cancelled", "delivered",
]);

async function adminDirectCancellation(orderId, reason, adminNote = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (isWithCarrier(order)) {
    throw new Error("Order cannot be cancelled after it has been handed to the carrier. Use RTO flow instead.");
  }

  if (TERMINAL_STATES.has(order.status) || order.delivery_status === "delivered") {
    throw new Error("Cannot cancel an order that is already completed, delivered, or cancelled.");
  }

  const isPaid = order.status === OrderStates.PAID && order.razorpay_payment_id;
  const auditPerformer = adminUser || "ADMIN";

  if (FEATURE_FLAGS.ENABLE_TRANSACTIONS) {
    await withTransaction(async (client) => {
      const lockedOrder = await withRowLock(client, "orders", orderId);
      if (!lockedOrder) throw new Error("Order not found");

      await client.query(
        `UPDATE orders SET status = $1, delivery_status = $2, fulfillment_status = $3, cancel_reason = $4, cancelled_by = $5, cancelled_at = $6, refund_status = $7, version = version + 1, updated_at = $8 WHERE id = $9 AND version = $10`,
        [OrderStates.CANCELLED, "cancelled", null, reason, "admin", new Date().toISOString(), isPaid ? "pending" : "none", new Date().toISOString(), orderId, lockedOrder.version]
      );

      await cancelCarrierShipment(orderId, reason);
    });
  } else {
    await repo.updateOrder(orderId, {
      status: OrderStates.CANCELLED,
      delivery_status: "cancelled",
      fulfillment_status: null,
      cancel_reason: reason,
      cancelled_by: "admin",
      cancelled_at: new Date().toISOString(),
      refund_status: isPaid ? "pending" : "none"
    });

    await cancelCarrierShipment(orderId, reason);
  }

  const cancelledOrder = await repo.findOrderById(orderId);

  await logRefundAction({
    orderId,
    action: "CANCEL_APPROVED",
    performedBy: auditPerformer,
    metadata: { reason, adminNote, refundType: "manual" }
  });

  await sendRefundNotification(cancelledOrder, "ADMIN_CANCELLED", { amount: order.total });

  let refundRecord = null;
  if (isPaid) {
    try {
      const refundResult = await executeRefundProcess(order, order.total, "admin", reason, adminNote, auditPerformer);
      refundRecord = refundResult.refund;
    } catch (refundErr) {
      logger.error(`[RefundService] Auto-refund failed for admin-cancelled order ${order.id}: ${refundErr.message}`);
      refundRecord = await repo.createRefund({
        order_id: order.id,
        user_id: order.user_id,
        razorpay_payment_id: order.razorpay_payment_id || null,
        razorpay_refund_id: null,
        amount: order.total,
        refund_reason: reason,
        status: "pending",
        cancelled_by: "admin",
        admin_note: adminNote
      });
      await logRefundAction({
        orderId: order.id,
        action: "MANUAL_REFUND_PENDING",
        performedBy: auditPerformer,
        metadata: { refundRecordId: refundRecord.id, reason, amount: order.total }
      });
    }
  } else if (order.items && order.items.length > 0) {
    try {
      await restockOrderItems(order);
    } catch (restockErr) {
      logger.warn(`[RefundService] Restock failed for cancelled order ${order.id}: ${restockErr.message}`);
    }
  }

  return { success: true, order: cancelledOrder, refund: refundRecord };
}

/**
 * Admin triggers manual partial refund
 */
async function initiatePartialRefund(orderId, refundAmount, reason, adminNote = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStates.PAID && order.status !== OrderStates.REFUND_INITIATED && order.status !== OrderStates.REFUND_PROCESSING) {
    throw new Error("Partial refunds can only be processed on paid or active refund orders.");
  }

  const currentRefunded = Number(order.total_refunded_amount || 0);
  const remaining = Number(order.total) - currentRefunded;

  if (Number(refundAmount) > remaining) {
    throw new Error(`Refund amount exceeds remaining order balance. Remaining: ₹${remaining}`);
  }

  const auditPerformer = adminUser || "ADMIN";
  return executeRefundProcess(order, refundAmount, "admin", reason, adminNote, auditPerformer);
}

/**
 * Retry a failed refund by order ID
 * Finds the most recent failed refund for the order and retries it.
 */
async function retryFailedRefund(orderId) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  const refunds = await repo.findRefundsByOrderId(orderId);
  const failedRefunds = refunds.filter(r => r.status === "failed");
  if (failedRefunds.length === 0) {
    throw new Error("No failed refund found for this order");
  }

  // Pick the most recent failed refund
  const refund = failedRefunds.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

  // Re-run executeRefundProcess with the old refund's parameters
  const result = await executeRefundProcess(order, refund.amount, refund.cancelled_by || "admin", refund.refund_reason || "Retry Refund", refund.admin_note);

  // Mark the old failed refund as superseded so we know not to retry it again
  await repo.updateRefund(refund.id, {
    status: "superseded",
    failure_reason: (refund.failure_reason || "") + " | Superseded by retry"
  });

  return result;
}

/**
 * Auto-Refund Engine: background job runner
 * Scans for:
 * 1. Payments captured in Razorpay but orders stuck in 'pending' (orphaned payments)
 * 2. Stuck transactions
 */
async function runAutoRefundSweep() {
  logger.info("[AutoRefundEngine] Running auto-refund checks...");
  
  try {
    const potentialOrphans = await repo.findPotentialOrphanedOrders();
    logger.info(`[AutoRefundEngine] Found ${potentialOrphans.length} potential orphaned orders.`);

    for (const order of potentialOrphans) {
      try {
        let isPaidOnGateway = false;
        
        if (razorpay.isMock) {
          // In mock mode, check if the razorpay_order_id includes 'captured' or if we want to mock it.
          // For integration tests, let's treat any mock order id ending with '_orphan' as a paid captured order.
          isPaidOnGateway = order.razorpay_order_id.endsWith("_orphan") || order.razorpay_order_id.includes("orphan");
        } else {
          // Query official Razorpay API for order details
          const rzpOrder = await razorpay.orders.fetch(order.razorpay_order_id);
          // If status is 'paid', or amount_paid > 0
          if (rzpOrder.status === "paid" || rzpOrder.amount_paid > 0) {
            isPaidOnGateway = true;
          }
        }

        if (isPaidOnGateway) {
          // Re-read order from DB to avoid race with concurrent sweep/webhook
          const freshOrder = await repo.findOrderById(order.id);
          if (!freshOrder || freshOrder.status !== "pending") {
            logger.info(`[AutoRefundEngine] Order ${order.id} already processed by another path, skipping.`);
            continue;
          }

          logger.warn(`[AutoRefundEngine] ORPHAN DETECTED: Order ${order.id} is paid on Razorpay but pending in DB!`);

          // Execute automatic recovery refund
          await logRefundAction({
            orderId: order.id,
            action: "TECHNICAL_RECOVERY",
            performedBy: "SYSTEM",
            metadata: { message: "Orphaned payment detected. Initiating automated recovery refund." }
          });

          // In mock mode, we need a mock payment ID.
          const mockPaymentId = order.razorpay_payment_id || `pay_orphan_${Date.now()}`;
          order.razorpay_payment_id = mockPaymentId;

          // Notify customer
          await sendRefundNotification(order, "TECHNICAL_RECOVERY", { amount: order.total });

          // Cancel the order first
          await repo.updateOrder(order.id, {
            status: OrderStates.CANCEL_APPROVED,
            delivery_status: "cancelled",
            cancel_reason: "Technical checkout recovery - orphaned payment",
            cancelled_by: "system",
            cancelled_at: new Date().toISOString()
          });

          // Run the refund
          await executeRefundProcess(
            order,
            order.total,
            "system",
            "Technical recovery refund for orphaned payment"
          );

          logger.info(`[AutoRefundEngine] Recovered orphaned order ${order.id} successfully.`);
        }
      } catch (orderErr) {
        logger.error(`[AutoRefundEngine] Error inspecting order ${order.id}: ${orderErr.message}`);
      }
    }
  } catch (err) {
    logger.error(`[AutoRefundEngine] Auto-refund sweep error: ${err.message}`);
  }
}

/**
 * Progress manual refund through a specific step
 * Steps: pending → initiated → processing → completed
 */
async function progressManualRefundStep(orderId, targetStep, adminUser = null) {
  const allowedSteps = ['initiated', 'processing', 'completed'];
  if (!allowedSteps.includes(targetStep)) {
    throw new Error(`Invalid refund step "${targetStep}". Must be one of: ${allowedSteps.join(', ')}`);
  }

  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  const cancelledStatuses = ['cancelled', 'self_cancelled', 'admin_rejected', 'REFUND_FAILED', 'CANCEL_APPROVED', 'CANCEL_REJECTED', 'REFUND_PENDING', 'REFUND_INITIATED', 'REFUND_PROCESSING'];
  if (!cancelledStatuses.includes(order.status)) {
    throw new Error(`Manual refund can only be processed on cancelled orders. Current status: ${order.status}`);
  }

  const currentRefundStatus = order.refund_status || 'pending';

  // Define valid transitions for refund_status
  const stepTransitions = {
    'pending': ['initiated'],
    'initiated': ['processing', 'completed'],
    'processing': ['completed'],
    'completed': []
  };

  const allowedNext = stepTransitions[currentRefundStatus] || [];
  if (!allowedNext.includes(targetStep)) {
    throw new Error(`Cannot move from refund status "${currentRefundStatus}" to "${targetStep}". Allowed: ${allowedNext.join(', ') || 'none'}`);
  }

  const auditPerformer = adminUser || "ADMIN";

  // Build update payload
  const updates = {
    refund_status: targetStep,
    updated_at: new Date().toISOString()
  };

  // When marking as completed, add this refund amount to running total
  if (targetStep === 'completed') {
    const existingRefunds = await repo.findRefundsByOrderId(orderId);
    const openRefund = existingRefunds.find(r => !["completed", "failed", "superseded"].includes(r.status));
    const manualRefundAmount = openRefund ? Number(openRefund.amount || 0) : 0;
    const previouslyRefunded = Number(order.total_refunded_amount || 0);
    updates.total_refunded_amount = previouslyRefunded + manualRefundAmount;
  }

  const updatedOrder = await repo.updateOrder(orderId, updates);

  // ── Sync the refunds-table row status ──
  try {
    const existingRefunds = await repo.findRefundsByOrderId(orderId);
    const openRefund = existingRefunds.find(r => !["completed", "failed", "superseded"].includes(r.status));
    if (openRefund) {
      const refundUpdates = { status: targetStep };
      if (targetStep === 'completed') {
        refundUpdates.processed_at = new Date().toISOString();
      }
      await repo.updateRefund(openRefund.id, refundUpdates);
    }
  } catch (syncErr) {
    logger.warn(`[RefundService] Failed to sync refunds table row for order ${orderId}: ${syncErr.message}`);
  }

  // Log audit
  await logRefundAction({
    orderId,
    action: `MANUAL_REFUND_${targetStep.toUpperCase()}`,
    performedBy: auditPerformer,
    metadata: { step: targetStep, previousStatus: currentRefundStatus }
  });

  // Notify user on each step
  if (targetStep === 'initiated') {
    await sendRefundNotification(updatedOrder, "REFUND_INITIATED", { amount: order.total });
  } else if (targetStep === 'completed') {
    await sendRefundNotification(updatedOrder, "REFUND_COMPLETED", { amount: order.total });
  }

  return updatedOrder;
}

/**
 * Stub: Initiate manual refund (bypass gateway) — used by separate controller route.
 * The primary flow goes through adminDirectCancellation + progressManualRefundStep.
 */
async function manualRefundInitiate(orderId, paymentMode, paymentDetails, adminNote, adminUser) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  // Delegate to progressManualRefundStep('initiated')
  return progressManualRefundStep(orderId, 'initiated', adminUser);
}

/**
 * Stub: Complete manual refund (bypass gateway) — used by separate controller route.
 * The primary flow goes through progressManualRefundStep('completed').
 */
async function manualRefundComplete(orderId, adminNote, adminUser) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  // Delegate to progressManualRefundStep('completed')
  return progressManualRefundStep(orderId, 'completed', adminUser);
}

module.exports = {
  requestCustomerCancellation,
  approveCancellation,
  rejectCancellation,
  adminDirectCancellation,
  initiatePartialRefund,
  retryFailedRefund,
  runAutoRefundSweep,
  sendRefundNotification,
  executeRefundProcess,
  progressManualRefundStep,
  manualRefundInitiate,
  manualRefundComplete,
  cancelCarrierShipment
};
