const crypto = require("crypto");
const repo = require("./RefundRepository");
const { OrderStates, isValidTransition, restockOrderItems } = require("../orders/OrderStateService");
const { generateRefundIdempotencyKey, initiateRazorpayRefund } = require("../payments/PaymentService");
const { logRefundAction } = require("./RefundAuditService");
const { sendWhatsAppMessage } = require("../../services/notificationService");
const razorpay = require("../../config/razorpay");
const logger = require("../../utils/logger");

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
      message = `🚨 *Cancellation Requested* \n\nYour cancellation request for Order *#${orderIdShort}* has been received and is pending admin review.`;
      break;
    case "APPROVED":
      message = `✅ *Cancellation Approved* \n\nYour cancellation request for Order *#${orderIdShort}* has been approved. We are initiating your refund of ${amountStr}.`;
      break;
    case "REJECTED":
      message = `❌ *Cancellation Rejected* \n\nYour cancellation request for Order *#${orderIdShort}* was not approved. Your order is processing and will be shipped shortly. Reason: ${metadata.reason || "N/A"}`;
      break;
    case "REFUND_INITIATED":
      message = `🔄 *Refund Initiated* \n\nRefund of ${amountStr} for Order *#${orderIdShort}* has been initiated via ${order.payment_method || "Razorpay"}. Expected settlement time: 5-7 business days. Reference: ${metadata.refundId || "N/A"}`;
      break;
    case "REFUND_COMPLETED":
      message = `🎉 *Refund Successful* \n\nRefund of ${amountStr} for Order *#${orderIdShort}* has been successfully processed! \nRef Number: ${metadata.rzpRefundId || "N/A"}`;
      break;
    case "REFUND_FAILED":
      message = `⚠️ *Refund Failed* \n\nRefund of ${amountStr} for Order *#${orderIdShort}* failed to process. Our support team is looking into this manually.`;
      break;
    case "TECHNICAL_RECOVERY":
      message = `🔧 *Order Recovery Refund* \n\nWe detected a technical glitch with your order *#${orderIdShort}*. Your payment was received but order creation was disrupted. An automatic refund of ${amountStr} has been initiated.`;
      break;
  }

  if (message) {
    try {
      await sendWhatsAppMessage(phone, message);
    } catch (err) {
      logger.error(`[RefundService] Failed to send notification for order ${order.id}: ${err.message}`);
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

  if (order.status !== "paid") {
    throw new Error("Only paid orders can be cancelled with refund flow");
  }

  if (order.delivery_status !== "processing" && order.delivery_status !== "placed") {
    throw new Error("Order can only be cancelled before it is shipped");
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
 */
async function executeRefundProcess(order, refundAmount, initiatedBy, reason, adminNote = "") {
  if (!order.razorpay_payment_id) {
    throw new Error("Order has no transaction/payment ID to refund");
  }

  // Generate deterministic idempotency key
  const idempotencyKey = generateRefundIdempotencyKey(order.id, order.razorpay_payment_id, refundAmount);

  // Transition to REFUND_PENDING
  await repo.updateOrder(order.id, {
    status: OrderStates.REFUND_PENDING,
    refund_status: "pending"
  });

  // Log audit
  await logRefundAction({
    orderId: order.id,
    action: "REFUND_PENDING",
    performedBy: initiatedBy === "admin" ? "ADMIN" : "SYSTEM",
    metadata: { refundAmount, reason }
  });

  let rzpRefund = null;
  let refundRecord = null;

  try {
    const amountInPaise = Math.round(refundAmount * 100);
    
    // Call Razorpay API
    rzpRefund = await initiateRazorpayRefund(order.razorpay_payment_id, amountInPaise, idempotencyKey, {
      orderId: order.id,
      reason: reason,
      initiatedBy: initiatedBy
    });

    // Create refund record
    refundRecord = await repo.createRefund({
      order_id: order.id,
      user_id: order.user_id,
      razorpay_payment_id: order.razorpay_payment_id,
      razorpay_refund_id: rzpRefund.id,
      refund_amount: refundAmount,
      refund_reason: reason,
      refund_status: "initiated",
      initiated_by: initiatedBy,
      admin_note: adminNote
    });

    // Update order
    const orderUpdates = {
      status: OrderStates.REFUND_INITIATED,
      refund_status: "initiated",
      refund_id: refundRecord.id,
      total_refunded_amount: Number(order.total_refunded_amount || 0) + Number(refundAmount)
    };
    const updatedOrder = await repo.updateOrder(order.id, orderUpdates);

    // Restock items
    await restockOrderItems(order);

    // Audit logs
    await logRefundAction({
      refundId: refundRecord.id,
      orderId: order.id,
      action: "REFUND_INITIATED",
      performedBy: initiatedBy === "admin" ? "ADMIN" : "SYSTEM",
      metadata: { razorpayRefundId: rzpRefund.id, amount: refundAmount }
    });

    // Notify user
    await sendRefundNotification(updatedOrder, "REFUND_INITIATED", { refundId: rzpRefund.id, amount: refundAmount });

    return { success: true, order: updatedOrder, refund: refundRecord };
  } catch (err) {
    logger.error(`[RefundService] Refund execution failed for order ${order.id}: ${err.message}`);

    // Create failed refund record in database
    refundRecord = await repo.createRefund({
      order_id: order.id,
      user_id: order.user_id,
      razorpay_payment_id: order.razorpay_payment_id,
      razorpay_refund_id: `FAILED_${Date.now()}`,
      refund_amount: refundAmount,
      refund_reason: reason,
      refund_status: "failed",
      initiated_by: initiatedBy,
      admin_note: adminNote,
      failure_reason: err.message
    });

    // Update order to REFUND_FAILED status
    const updatedOrder = await repo.updateOrder(order.id, {
      status: OrderStates.REFUND_FAILED,
      refund_status: "failed",
      refund_id: refundRecord.id
    });

    // Restock anyway since order cancellation is approved/processed
    await restockOrderItems(order);

    // Log failure audit
    await logRefundAction({
      refundId: refundRecord.id,
      orderId: order.id,
      action: "REFUND_FAILED",
      performedBy: initiatedBy === "admin" ? "ADMIN" : "SYSTEM",
      metadata: { error: err.message }
    });

    // Notify user
    await sendRefundNotification(updatedOrder, "REFUND_FAILED", { amount: refundAmount });

    throw new Error(`Refund initiation failed: ${err.message}`);
  }
}

/**
 * Admin approves user cancellation request
 */
async function approveCancellation(orderId, adminNote = "") {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStates.CANCEL_REQUESTED) {
    throw new Error(`Order cancellation request must be in CANCEL_REQUESTED status. Current: ${order.status}`);
  }

  // Update status to CANCEL_APPROVED
  await repo.updateOrder(orderId, {
    status: OrderStates.CANCEL_APPROVED
  });

  await logRefundAction({
    orderId,
    action: "CANCEL_APPROVED",
    performedBy: "ADMIN",
    metadata: { adminNote }
  });

  // Notify cancellation approval
  await sendRefundNotification(order, "APPROVED", { amount: order.total });

  // Initiate full refund
  return executeRefundProcess(order, order.total, "admin", order.cancel_reason || "User Cancelled", adminNote);
}

/**
 * Admin rejects user cancellation request
 */
async function rejectCancellation(orderId, reason = "") {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStates.CANCEL_REQUESTED) {
    throw new Error("Order must be in CANCEL_REQUESTED status to be rejected.");
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
    performedBy: "ADMIN",
    metadata: { reason }
  });

  // Notify rejection
  await sendRefundNotification(updatedOrder, "REJECTED", { reason });

  return updatedOrder;
}

/**
 * Admin cancels order directly (due to inventory, errors, etc.)
 */
async function adminDirectCancellation(orderId, reason, adminNote = "") {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (["shipped", "delivered", "cancelled"].includes(order.delivery_status)) {
    throw new Error("Order cannot be cancelled at this stage.");
  }

  // Direct cancellation sets status to CANCEL_APPROVED directly
  const cancelledOrder = await repo.updateOrder(orderId, {
    status: OrderStates.CANCEL_APPROVED,
    delivery_status: "cancelled",
    cancel_reason: reason,
    cancelled_by: "admin",
    cancelled_at: new Date().toISOString()
  });

  await logRefundAction({
    orderId,
    action: "CANCEL_APPROVED",
    performedBy: "ADMIN",
    metadata: { reason, adminNote }
  });

  // Notify approval
  await sendRefundNotification(cancelledOrder, "APPROVED", { amount: order.total });

  // If order is not paid, cancel it directly without gateway refund
  if (order.status !== "paid" || !order.razorpay_payment_id) {
    logger.info(`[RefundService] Order ${orderId} is unpaid or pending verification. Cancelling without refund.`);
    await repo.updateOrder(orderId, {
      status: OrderStates.CANCELLED,
      refund_status: "none"
    });
    await restockOrderItems(order);
    return { success: true, order: cancelledOrder, refund: null };
  }

  // Initiate full refund
  return executeRefundProcess(cancelledOrder, order.total, "admin", reason, adminNote);
}

/**
 * Admin triggers manual partial refund
 */
async function initiatePartialRefund(orderId, refundAmount, reason, adminNote = "") {
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

  return executeRefundProcess(order, refundAmount, "admin", reason, adminNote);
}

/**
 * Retry a failed refund
 */
async function retryFailedRefund(refundId) {
  const refund = await repo.findRefundById(refundId);
  if (!refund) throw new Error("Refund record not found");

  if (refund.status !== "failed") {
    throw new Error("Only failed refunds can be retried");
  }

  const order = await repo.findOrderById(refund.order_id);
  if (!order) throw new Error("Associated order not found");

  // Re-run executeRefundProcess
  return executeRefundProcess(order, refund.amount, refund.initiated_by, refund.refund_reason || "Retry Refund", refund.admin_note);
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

module.exports = {
  requestCustomerCancellation,
  approveCancellation,
  rejectCancellation,
  adminDirectCancellation,
  initiatePartialRefund,
  retryFailedRefund,
  runAutoRefundSweep,
  sendRefundNotification
};
