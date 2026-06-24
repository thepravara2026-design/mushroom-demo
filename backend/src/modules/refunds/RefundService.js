const crypto = require("crypto");
const repo = require("./RefundRepository");
const { OrderStates, isValidTransition, restockOrderItems, assertCancellable } = require("../orders/OrderStateService");
const { generateRefundIdempotencyKey, initiateRazorpayRefund } = require("../payments/PaymentService");
const { logRefundAction } = require("./RefundAuditService");
const { sendWhatsAppMessage } = require("../../services/notificationService");
const { logAuditAction, AUDIT_ACTIONS } = require("../../services/AuditLogService");
const { notify } = require("../../services/NotificationService");
const db = require("../../config/db");
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

  if (!["paid", "pending", "pending_upi_verification"].includes(order.status)) {
    throw new Error("Only unpaid or paid orders can be cancelled");
  }

  assertCancellable(order);

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
async function executeRefundProcess(order, refundAmount, initiatedBy, reason, adminNote = "", adminUser = null) {
  if (!order.razorpay_payment_id) {
    throw new Error("Order has no transaction/payment ID to refund");
  }

  // Check if a refund was already issued for this amount — prevents double-refund on retry
  const existingRefunds = await repo.findRefundsByOrderId(order.id);
  const completedRefund = (existingRefunds || []).find(
    (r) => r.razorpay_refund_id && r.status !== "failed" && Number(r.amount) === Number(refundAmount),
  );
  if (completedRefund) {
    logger.info(`[RefundService] Refund ${completedRefund.id} already issued for order ${order.id} — skipping gateway call.`);
    const updatedOrder = await repo.updateOrder(order.id, {
      status: OrderStates.REFUND_INITIATED,
      refund_status: "initiated",
      refund_id: completedRefund.id,
      total_refunded_amount: Number(order.total_refunded_amount || 0) + Number(refundAmount),
    });
    await restockOrderItems(order);
    return { success: true, order: updatedOrder, refund: completedRefund };
  }

  const attemptCount = (existingRefunds || []).length;

  // Generate deterministic idempotency key
  const idempotencyKey = generateRefundIdempotencyKey(order.id, order.razorpay_payment_id, refundAmount, attemptCount);

  // Transition to REFUND_PENDING
  await repo.updateOrder(order.id, {
    status: OrderStates.REFUND_PENDING,
    refund_status: "pending"
  });

  // Resolve the performer identity for audit logs
  const auditPerformer = adminUser || (initiatedBy === "admin" ? "ADMIN" : "SYSTEM");

  // Log audit
  await logRefundAction({
    orderId: order.id,
    action: "REFUND_PENDING",
    performedBy: auditPerformer,
    metadata: { refundAmount, reason }
  });

  let rzpRefund = null;
  let refundRecord = null;

  try {
    // ── Create refund record BEFORE gateway call (compensating transaction) ──
    // This ensures we always have a DB record even if the Razorpay call fails
    // or if the DB update after a successful Razorpay call fails.
    refundRecord = await repo.createRefund({
      order_id: order.id,
      user_id: order.user_id,
      razorpay_payment_id: order.razorpay_payment_id,
      razorpay_refund_id: null, // Will be set after successful gateway call
      amount: refundAmount,
      refund_reason: reason,
      status: "pending", // Start as pending; updated to initiated or failed
      cancelled_by: initiatedBy,
      admin_note: adminNote
    });

    const amountInPaise = Math.round(refundAmount * 100);
    
    // Call Razorpay API
    rzpRefund = await initiateRazorpayRefund(order.razorpay_payment_id, amountInPaise, idempotencyKey, {
      orderId: order.id,
      reason: reason,
      initiatedBy: initiatedBy
    });

    // ── Gateway call succeeded — update refund record ──
    refundRecord = await repo.updateRefund(refundRecord.id, {
      razorpay_refund_id: rzpRefund.id,
      status: "initiated"
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
      performedBy: auditPerformer,
      metadata: { razorpayRefundId: rzpRefund.id, amount: refundAmount }
    });

    // Notify user
    await sendRefundNotification(updatedOrder, "REFUND_INITIATED", { refundId: rzpRefund.id, amount: refundAmount });

    return { success: true, order: updatedOrder, refund: refundRecord };
  } catch (err) {
    logger.error(`[RefundService] Refund execution failed for order ${order.id}: ${err.message}`);

    if (refundRecord) {
      // We already have a refund record — update it to failed
      await repo.updateRefund(refundRecord.id, {
        razorpay_refund_id: rzpRefund ? rzpRefund.id : `FAILED_${Date.now()}`,
        status: "failed",
        failure_reason: err.message
      });
    } else {
      // Refund record creation itself failed (rare) — create a failed record
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
      performedBy: auditPerformer,
      metadata: { error: err.message, partialRefundCreated: !!rzpRefund }
    });

    // If Razorpay refund was created but DB update failed, log a critical warning
    if (rzpRefund) {
      logger.error(`[RefundService] CRITICAL: Razorpay refund ${rzpRefund.id} was created but DB state is failed. Order ${order.id}. Webhook should reconcile.`);
    }

    // Notify user
    await sendRefundNotification(updatedOrder, "REFUND_FAILED", { amount: refundAmount });

    throw new Error(`Refund initiation failed: ${err.message}`);
  }
}

/**
 * Admin approves user cancellation request with refund type selection.
 * @param {string} orderId
 * @param {string} [adminNote=""]
 * @param {object|null} [adminUser=null]
 * @param {string} [refundType="auto"] — 'auto' (Razorpay) or 'manual' (offline)
 */
async function approveCancellation(orderId, adminNote = "", adminUser = null, refundType = "auto") {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  const isRetry = order.status === OrderStates.REFUND_FAILED;

  if (order.status !== OrderStates.CANCEL_REQUESTED && !isRetry) {
    throw new Error(`Order cancellation request must be in CANCEL_REQUESTED status. Current: ${order.status}`);
  }

  const auditPerformer = adminUser || "ADMIN";

  if (!isRetry) {
    // First-time approval — transition from CANCEL_REQUESTED → CANCEL_APPROVED
    await repo.updateOrder(orderId, {
      status: OrderStates.CANCEL_APPROVED,
      refund_type: refundType,
    });

    await logRefundAction({
      orderId,
      action: "CANCEL_APPROVED",
      performedBy: auditPerformer,
      metadata: { adminNote, refundType }
    });

    // Notify cancellation approval
    await sendRefundNotification(order, "APPROVED", { amount: order.total });
  }

  // If order has no payment ID, cancel it directly without gateway refund
  if (!order.razorpay_payment_id) {
    await repo.updateOrder(orderId, {
      status: OrderStates.CANCELLED,
      refund_status: "none"
    });
    await restockOrderItems(order);
    const cancelledOrder = await repo.findOrderById(orderId);
    return { success: true, order: cancelledOrder, refund: null };
  }

  // Route by refund type
  if (refundType === "manual") {
    return manualRefundInitiate(orderId, "other", `Manual refund via approval — ${adminNote}`, adminNote, auditPerformer);
  }

  // Default: auto refund via Razorpay
  return executeRefundProcess(order, order.total, "admin", order.cancel_reason || "User Cancelled", adminNote, auditPerformer);
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
 * Admin cancels order directly (due to inventory, errors, etc.)
 */
async function adminDirectCancellation(orderId, reason, adminNote = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  assertCancellable(order);

  // Direct cancellation sets status to CANCEL_APPROVED directly
  const cancelledOrder = await repo.updateOrder(orderId, {
    status: OrderStates.CANCEL_APPROVED,
    delivery_status: "cancelled",
    cancel_reason: reason,
    cancelled_by: "admin",
    cancelled_at: new Date().toISOString()
  });

  const auditPerformer = adminUser || "ADMIN";

  await logRefundAction({
    orderId,
    action: "CANCEL_APPROVED",
    performedBy: auditPerformer,
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
  return executeRefundProcess(cancelledOrder, order.total, "admin", reason, adminNote, auditPerformer);
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
 * Admin manually marks refund as initiated (offline/gateway bypass)
 */
async function manualRefundInitiate(orderId, paymentMode = "", paymentDetails = "", adminNote = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStates.REFUND_FAILED) {
    throw new Error(`Manual refund can only be initiated for orders with REFUND_FAILED status. Current: ${order.status}`);
  }

  const auditPerformer = adminUser || "ADMIN";

  // Create a refund record for the manual refund
  const refundRecord = await repo.createRefund({
    order_id: order.id,
    user_id: order.user_id,
    razorpay_payment_id: order.razorpay_payment_id || `manual_${Date.now()}`,
    amount: order.total,
    refund_reason: order.cancel_reason || "Manual refund",
    status: "manual_initiated",
    cancelled_by: "admin",
    admin_note: adminNote,
    payment_mode: paymentMode,
    payment_details: paymentDetails
  });

  const updatedOrder = await repo.updateOrder(orderId, {
    status: OrderStates.MANUAL_REFUND_INITIATED,
    refund_status: "manual_initiated",
    refund_id: refundRecord.id,
    manual_refund_payment_mode: paymentMode,
    manual_refund_payment_details: paymentDetails
  });

  await logRefundAction({
    orderId,
    action: "MANUAL_REFUND_INITIATED",
    performedBy: auditPerformer,
    metadata: { adminNote, paymentMode, paymentDetails, refundId: refundRecord.id }
  });

  await sendRefundNotification(updatedOrder, "REFUND_INITIATED", { amount: order.total });

  return { order: updatedOrder, refund: refundRecord };
}

/**
 * Admin manually marks refund as completed
 */
async function manualRefundComplete(orderId, adminNote = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStates.MANUAL_REFUND_INITIATED) {
    throw new Error(`Manual refund can only be completed for orders in MANUAL_REFUND_INITIATED status. Current: ${order.status}`);
  }

  const auditPerformer = adminUser || "ADMIN";

  // Update the refund record to completed
  const refunds = await repo.findRefundsByOrderId(orderId);
  const activeRefund = refunds.find(r => r.status === "manual_initiated");
  if (activeRefund) {
    await repo.updateRefund(activeRefund.id, {
      status: "manual_completed",
      processed_at: new Date().toISOString()
    });
  }

  const updatedOrder = await repo.updateOrder(orderId, {
    status: OrderStates.MANUAL_REFUND_COMPLETED,
    refund_status: "manual_completed"
  });

  await logRefundAction({
    orderId,
    action: "MANUAL_REFUND_COMPLETED",
    performedBy: auditPerformer,
    metadata: { adminNote, refundId: activeRefund?.id }
  });

  await sendRefundNotification(updatedOrder, "REFUND_COMPLETED", { amount: order.total });

  return updatedOrder;
}

/**
 * Admin approves a PENDING_APPROVAL order → PLACED.
 */
async function approveOrder(orderId, adminNote = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  const isPaid = order.status === "paid" || order.status === OrderStates.PAID;
  if (!isPaid) {
    throw new Error(`Only paid orders can be approved. Current status: ${order.status}`);
  }

  const approvalStatus = order.admin_approval_status || "pending";
  if (approvalStatus === "approved") {
    throw new Error("Order is already approved.");
  }

  const auditPerformer = adminUser || "ADMIN";
  const updatedOrder = await repo.updateOrder(orderId, {
    admin_approval_status: "approved",
    delivery_status: "placed",
    updated_at: new Date().toISOString()
  });

  logAuditAction({
    orderId,
    action: AUDIT_ACTIONS.ORDER_APPROVED,
    performedBy: auditPerformer,
    previousState: { status: order.status, delivery_status: order.delivery_status, admin_approval_status: order.admin_approval_status },
    newState: { status: updatedOrder.status, delivery_status: updatedOrder.delivery_status, admin_approval_status: "approved" },
    metadata: { adminNote }
  }).catch(() => {});

  const { data: user } = await db.from("users").select("*").eq("id", order.user_id).single().catch(() => ({}));
  if (user) {
    notify("ORDER_APPROVED", updatedOrder, user, { adminNote }).catch(() => {});
  }

  return updatedOrder;
}

/**
 * Admin rejects a PENDING_APPROVAL order → REJECTED.
 */
async function rejectOrder(orderId, reason = "", adminNote = "", adminUser = null) {
  const order = await repo.findOrderById(orderId);
  if (!order) throw new Error("Order not found");

  const auditPerformer = adminUser || "ADMIN";

  const updatedOrder = await repo.updateOrder(orderId, {
    status: OrderStates.REJECTED,
    admin_approval_status: "rejected",
    rejection_reason: reason,
    updated_at: new Date().toISOString()
  });

  // Restock items since order is rejected
  await restockOrderItems(order);

  logAuditAction({
    orderId,
    action: AUDIT_ACTIONS.ORDER_REJECTED,
    performedBy: auditPerformer,
    previousState: { status: order.status, delivery_status: order.delivery_status, admin_approval_status: order.admin_approval_status },
    newState: { status: updatedOrder.status, admin_approval_status: "rejected" },
    metadata: { reason, adminNote }
  }).catch(() => {});

  const { data: user } = await db.from("users").select("*").eq("id", order.user_id).single().catch(() => ({}));
  if (user) {
    notify("ORDER_REJECTED", updatedOrder, user, { reason, adminNote }).catch(() => {});
  }

  return updatedOrder;
}

module.exports = {
  requestCustomerCancellation,
  approveCancellation,
  rejectCancellation,
  adminDirectCancellation,
  initiatePartialRefund,
  retryFailedRefund,
  manualRefundInitiate,
  manualRefundComplete,
  runAutoRefundSweep,
  sendRefundNotification,
  executeRefundProcess,
  approveOrder,
  rejectOrder
};
