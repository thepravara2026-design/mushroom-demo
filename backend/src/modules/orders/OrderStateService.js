const db = require("../../config/db");
const logger = require("../../utils/logger");
const FEATURE_FLAGS = require("../../config/featureFlags");
const { OrderStatus } = require("../../constants");
const inventoryService = require("../../services/inventoryService");
const { withTransaction, withRowLock, optimisticUpdate, withRowLocks } = require("../../services/TransactionManager");
const { send, QUEUES } = require("../../services/QueueService");

// Alias OrderStates from shared constants for backward compatibility
const OrderStates = {
  ...OrderStatus,
  PENDING: OrderStatus.PENDING,
  PAID: OrderStatus.PAID,
  FAILED: OrderStatus.FAILED,
  CANCEL_REQUESTED: OrderStatus.CANCEL_REQUESTED,
  CANCEL_REJECTED: OrderStatus.CANCEL_REJECTED,
  CANCELLED: OrderStatus.CANCELLED,
  REFUND_PENDING: OrderStatus.REFUND_PENDING,
  REFUND_INITIATED: OrderStatus.REFUND_INITIATED,
  REFUND_PROCESSING: OrderStatus.REFUND_PROCESSING,
  REFUND_COMPLETED: OrderStatus.REFUND_COMPLETED,
  REFUND_FAILED: OrderStatus.REFUND_FAILED,

  PENDING_APPROVAL: "PENDING_APPROVAL",
  PLACED: "PLACED",
  PROCESSING: "PROCESSING",
  SHIPPING: "SHIPPING",
  DELIVERED: "DELIVERED",
  REJECTED: "REJECTED",
  CANCEL_APPROVED: "CANCEL_APPROVED",
  MANUAL_REFUND_INITIATED: "MANUAL_REFUND_INITIATED",
  MANUAL_REFUND_COMPLETED: "MANUAL_REFUND_COMPLETED",
};

// ── v3 State Machine (Phase 5) ───────────────────────────────────────────
const V3_STATE_MACHINE = {
  [OrderStatus.ORDER_CREATED]: {
    transitions: [OrderStatus.CANCELLATION_WINDOW, OrderStatus.FAILED],
    onEnter: 'setCancelWindow',
  },
  [OrderStatus.CANCELLATION_WINDOW]: {
    transitions: [OrderStatus.SELF_CANCELLED, OrderStatus.WINDOW_CLOSED, OrderStatus.FAILED],
    timeout: 30 * 60 * 1000,
  },
  [OrderStatus.SELF_CANCELLED]: {
    transitions: [OrderStatus.REFUND_PENDING],
    onEnter: 'autoRefund',
  },
  [OrderStatus.WINDOW_CLOSED]: {
    transitions: [OrderStatus.PAYMENT_VERIFIED, OrderStatus.FAILED],
  },
  [OrderStatus.PAYMENT_VERIFIED]: {
    transitions: [OrderStatus.ADMIN_PENDING],
  },
  [OrderStatus.ADMIN_PENDING]: {
    transitions: [OrderStatus.APPROVED, OrderStatus.ADMIN_REJECTED],
  },
  [OrderStatus.ADMIN_REJECTED]: {
    transitions: [OrderStatus.REFUND_PENDING],
    onEnter: 'notifyRejectionAndRefund',
  },
  [OrderStatus.APPROVED]: {
    transitions: [OrderStatus.PACKING],
  },
  [OrderStatus.PACKING]: {
    transitions: [OrderStatus.PACKED, OrderStatus.SHIPMENT_FAILED],
  },
  [OrderStatus.PACKED]: {
    transitions: [OrderStatus.READY_TO_SHIP, OrderStatus.SHIPMENT_FAILED],
  },
  [OrderStatus.READY_TO_SHIP]: {
    transitions: [OrderStatus.WITH_CARRIER, OrderStatus.SHIPMENT_FAILED],
  },
  [OrderStatus.SHIPMENT_FAILED]: {
    transitions: [OrderStatus.READY_TO_SHIP],
  },
  [OrderStatus.WITH_CARRIER]: {
    transitions: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.NDR, OrderStatus.RTO],
  },
  [OrderStatus.OUT_FOR_DELIVERY]: {
    transitions: [OrderStatus.DELIVERED, OrderStatus.NDR],
  },
  [OrderStatus.NDR]: {
    transitions: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RTO],
  },
  [OrderStatus.RTO]: {
    transitions: [OrderStatus.REFUND_PENDING],
  },
  [OrderStatus.DELIVERED]: {
    transitions: [OrderStatus.RETURN_WINDOW],
  },
  [OrderStatus.RETURN_WINDOW]: {
    transitions: [OrderStatus.RETURN_REQUESTED, OrderStatus.COMPLETED],
    timeout: 7 * 24 * 60 * 60 * 1000,
  },
  [OrderStatus.RETURN_REQUESTED]: {
    transitions: [OrderStatus.RETURN_APPROVED, OrderStatus.RETURN_REJECTED],
  },
  [OrderStatus.RETURN_APPROVED]: {
    transitions: [OrderStatus.RETURN_PICKUP],
  },
  [OrderStatus.RETURN_PICKUP]: {
    transitions: [OrderStatus.RETURN_RECEIVED],
  },
  [OrderStatus.RETURN_RECEIVED]: {
    transitions: [OrderStatus.QUALITY_CHECK],
  },
  [OrderStatus.QUALITY_CHECK]: {
    transitions: [OrderStatus.REFUND_PENDING, OrderStatus.RETURN_REJECTED],
  },
  [OrderStatus.RETURN_REJECTED]: {
    transitions: [OrderStatus.COMPLETED],
  },
  [OrderStatus.REFUND_PENDING]: {
    transitions: [OrderStatus.REFUND_INITIATED, OrderStatus.REFUND_FAILED],
  },
  [OrderStatus.REFUND_INITIATED]: {
    transitions: [OrderStatus.REFUND_PROCESSING, OrderStatus.REFUND_COMPLETED, OrderStatus.REFUND_FAILED],
  },
  [OrderStatus.REFUND_PROCESSING]: {
    transitions: [OrderStatus.REFUND_COMPLETED, OrderStatus.REFUND_FAILED],
  },
  [OrderStatus.REFUND_FAILED]: {
    transitions: [OrderStatus.REFUND_PENDING, OrderStatus.REFUND_INITIATED],
  },
  [OrderStatus.REFUND_COMPLETED]: {
    transitions: [OrderStatus.COMPLETED],
  },
  [OrderStatus.COMPLETED]: {
    transitions: [],
  },

  // Legacy states for backward compatibility
  [OrderStates.PENDING]: {
    transitions: [OrderStates.PAID, OrderStates.FAILED, OrderStates.CANCEL_REQUESTED, OrderStates.CANCELLED],
    legacy: true,
    mapsTo: OrderStatus.ORDER_CREATED,
  },
  [OrderStates.PAID]: {
    transitions: [OrderStates.CANCEL_REQUESTED, OrderStates.CANCELLED],
    legacy: true,
    mapsTo: OrderStatus.PAYMENT_VERIFIED,
  },
  [OrderStates.CANCEL_REQUESTED]: {
    transitions: [OrderStates.CANCELLED, OrderStates.CANCEL_REJECTED],
    legacy: true,
  },
  [OrderStates.CANCEL_REJECTED]: {
    transitions: [OrderStates.PAID],
    legacy: true,
  },
  [OrderStates.CANCELLED]: {
    transitions: [OrderStates.REFUND_PENDING],
    legacy: true,
  },
};

const LEGACY_VALID_TRANSITIONS = {
  [OrderStates.PENDING]: [OrderStates.PAID, OrderStates.FAILED, OrderStates.CANCELLED, OrderStates.CANCEL_REQUESTED],
  [OrderStates.PAID]: [OrderStates.CANCEL_REQUESTED, OrderStates.CANCELLED],
  [OrderStates.CANCEL_REQUESTED]: [OrderStates.CANCELLED, OrderStates.CANCEL_REJECTED],
  [OrderStates.CANCEL_REJECTED]: [OrderStates.PAID],
  [OrderStates.CANCELLED]: [OrderStates.REFUND_PENDING],
  [OrderStates.REFUND_PENDING]: [OrderStates.REFUND_INITIATED, OrderStates.REFUND_FAILED],
  [OrderStates.REFUND_INITIATED]: [OrderStates.REFUND_PROCESSING, OrderStates.REFUND_FAILED, OrderStates.REFUND_COMPLETED],
  [OrderStates.REFUND_PROCESSING]: [OrderStates.REFUND_COMPLETED, OrderStates.REFUND_FAILED],
  [OrderStates.REFUND_FAILED]: [OrderStates.REFUND_PENDING, OrderStates.REFUND_INITIATED],
  [OrderStates.REFUND_COMPLETED]: [],
};

function getStateMachine() {
  if (FEATURE_FLAGS.ENABLE_NEW_STATE_MACHINE) return V3_STATE_MACHINE;
  return null; // Keep using legacy transition maps
}

function isValidTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;

  if (FEATURE_FLAGS.ENABLE_NEW_STATE_MACHINE) {
    const node = V3_STATE_MACHINE[currentStatus];
    if (!node) return false;
    return node.transitions.includes(nextStatus);
  }

  const allowed = LEGACY_VALID_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(nextStatus);
}

// ── Atomic State Transition (optimistic locking + optional transaction) ────

async function atomicStateTransition(orderId, expectedVersion, updates) {
  if (!FEATURE_FLAGS.ENABLE_TRANSACTIONS && !FEATURE_FLAGS.ENABLE_OPTIMISTIC_LOCKING) {
    const { error } = await db.from("orders").update(updates).eq("id", orderId);
    if (error) throw new Error(`Failed to update order: ${error.message}`);
    return;
  }

  if (FEATURE_FLAGS.ENABLE_QUEUE) {
    await send(QUEUES.ORDER_PROCESSING, {
      action: "update_status",
      orderId,
      payload: { updates, expectedVersion },
    });
    return;
  }

  await withTransaction(async (client) => {
    const order = await withRowLock(client, "orders", orderId);
    if (!order) throw new Error("Order not found");
    if (expectedVersion !== undefined && order.version !== expectedVersion) {
      const err = new Error(`Concurrent modification detected for order ${orderId}`);
      err.code = "OPTIMISTIC_LOCK_CONFLICT";
      throw err;
    }
    await optimisticUpdate(client, "orders", orderId, updates, order.version);
  });
}

async function atomicOrderFetch(orderId) {
  if (!FEATURE_FLAGS.ENABLE_OPTIMISTIC_LOCKING && !FEATURE_FLAGS.ENABLE_TRANSACTIONS) {
    const { data } = await db.from("orders").select("*").eq("id", orderId).single();
    return data;
  }

  if (FEATURE_FLAGS.ENABLE_QUEUE) {
    const { data } = await db.from("orders").select("*").eq("id", orderId).single();
    return data;
  }

  return withTransaction(async (client) => {
    return withRowLock(client, "orders", orderId);
  });
}

// ── Phase 5: New State Machine Methods ────────────────────────────────────

async function selfCancel(orderId, userId) {
  if (!FEATURE_FLAGS.SELF_CANCEL_WINDOW) throw new Error("Self-cancellation window is disabled");

  const order = await atomicOrderFetch(orderId);
  if (!order) throw new Error("Order not found");

  if (order.user_id !== userId && userId !== 'system') {
    throw new Error("Unauthorized to cancel this order");
  }

  if (order.status !== OrderStatus.CANCELLATION_WINDOW && order.status !== OrderStatus.ORDER_CREATED && order.status !== OrderStatus.PAYMENT_VERIFIED && order.status !== OrderStatus.ADMIN_PENDING) {
    throw new Error("Order is not in a cancellable state");
  }

  if (!canSelfCancel(order)) {
    throw new Error("Self-cancellation window has expired");
  }

  if (isWithCarrier(order)) {
    throw new Error("Order has been handed to carrier and cannot be self-cancelled");
  }

  await atomicStateTransition(orderId, order.version, {
    status: OrderStatus.SELF_CANCELLED,
    delivery_status: "cancelled",
    fulfillment_status: null,
    cancel_reason: "Self-cancelled within window",
    cancelled_by: "customer",
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  let refundFailed = false;
  try {
    const { executeRefundProcess } = require("../refunds/RefundService");
    await executeRefundProcess(order, order.total, "customer", "Self-cancellation within window");
  } catch (refundErr) {
    refundFailed = true;
    logger.warn(`[OrderStateService] Auto-refund failed for self-cancelled order ${orderId}: ${refundErr.message}`);
  }

  if (refundFailed) {
    return { success: true, message: "Order self-cancelled. Auto-refund failed — an admin will review and process the refund manually.", refundFailed: true };
  }

  return { success: true, message: "Order self-cancelled and refund initiated successfully" };
}

async function adminReject(orderId, reason, adminUser = null) {
  if (!reason || reason.trim().length === 0) throw new Error("Rejection reason is required");

  const order = await atomicOrderFetch(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStatus.ADMIN_PENDING && order.status !== OrderStates.CANCEL_REQUESTED && order.status !== "paid") {
    throw new Error(`Order cannot be rejected in status: ${order.status}`);
  }

  if (isWithCarrier(order)) {
    throw new Error("Order has been handed to carrier and cannot be rejected");
  }

  await atomicStateTransition(orderId, order.version, {
    status: OrderStatus.ADMIN_REJECTED,
    delivery_status: "rejected",
    rejection_reason: reason.trim(),
    cancelled_by: "admin",
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  let refundFailed = false;
  try {
    const { executeRefundProcess } = require("../refunds/RefundService");
    if (order.razorpay_payment_id) {
      await executeRefundProcess(order, order.total, "admin", reason.trim(), "", adminUser);
    } else {
      await restockOrderItems(order);
    }
  } catch (refundErr) {
    refundFailed = true;
    logger.warn(`[OrderStateService] Auto-refund failed for rejected order ${orderId}: ${refundErr.message}`);
  }

  try {
    const { sendRefundNotification } = require("../refunds/RefundService");
    await sendRefundNotification(order, "REJECTED", { reason: reason.trim() });
  } catch (notifErr) {
    logger.warn(`[OrderStateService] Rejection notification failed for order ${orderId}: ${notifErr.message}`);
  }

  if (refundFailed) {
    return { success: true, message: "Order rejected. Auto-refund failed — an admin should process the refund manually.", refundFailed: true };
  }
  return { success: true, message: "Order rejected and refund initiated" };
}

async function adminApprove(orderId) {
  const order = await atomicOrderFetch(orderId);
  if (!order) throw new Error("Order not found");

  if (order.status !== OrderStatus.ADMIN_PENDING && order.status !== OrderStates.CANCEL_REQUESTED && order.status !== "paid") {
    throw new Error(`Order cannot be approved in status: ${order.status}`);
  }

  await atomicStateTransition(orderId, order.version, {
    status: OrderStatus.APPROVED,
    fulfillment_status: "pending_fulfillment",
    admin_approval_status: "approved",
    updated_at: new Date().toISOString(),
  });

  return { success: true, message: "Order approved", order: { ...order, status: OrderStatus.APPROVED } };
}

async function startReturnWindow(orderId) {
  const order = await atomicOrderFetch(orderId);
  if (!order) throw new Error("Order not found");
  if (order.return_window_expires) return { success: true, message: "Return window already set" };

  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await atomicStateTransition(orderId, order.version, {
    return_window_expires: expires,
    status: OrderStatus.RETURN_WINDOW,
    updated_at: new Date().toISOString(),
  });
  return { success: true, returnWindowExpires: expires };
}

async function getCancelWindow(orderId) {
  const { data: order, error } = await db.from("orders").select("id, cancel_window_expires, status").eq("id", orderId).single();
  if (error || !order) throw new Error("Order not found");

  if (!order.cancel_window_expires) {
    return { cancellable: false, reason: "No cancellation window set", remainingMs: 0 };
  }

  const now = Date.now();
  const expires = new Date(order.cancel_window_expires).getTime();
  const remainingMs = Math.max(0, expires - now);

  if (remainingMs <= 0) {
    return { cancellable: false, reason: "Cancellation window has expired", remainingMs: 0 };
  }

  if (!FEATURE_FLAGS.SELF_CANCEL_WINDOW) {
    return { cancellable: false, reason: "Self-cancellation is disabled", remainingMs };
  }

  return { cancellable: true, remainingMs, windowExpires: order.cancel_window_expires };
}

async function closeExpiredWindows() {
  const { data: expired } = await db.from("orders")
    .select("id, status, cancel_window_expires")
    .lt("cancel_window_expires", new Date().toISOString())
    .in("status", [OrderStatus.ORDER_CREATED, OrderStatus.CANCELLATION_WINDOW]);

  if (!expired || expired.length === 0) return { closed: 0 };

  const ids = expired.map(o => o.id);

  if (FEATURE_FLAGS.ENABLE_TRANSACTIONS) {
    await withTransaction(async (client) => {
      const locked = await withRowLocks(client, "orders", ids);
      if (locked.length === 0) return;
      await client.query(
        `UPDATE orders SET status = $1, updated_at = $2 WHERE id = ANY($3::text[])`,
        [OrderStatus.WINDOW_CLOSED, new Date().toISOString(), ids]
      );
    });
  } else {
    await db.from("orders").update({
      status: OrderStatus.WINDOW_CLOSED,
      updated_at: new Date().toISOString(),
    }).in("id", ids);
  }

  logger.info(`[OrderStateService] Closed ${ids.length} expired cancellation windows`);
  return { closed: ids.length };
}

// ── Legacy Methods (preserved) ────────────────────────────────────────────

const NON_CANCELLABLE_FULFILLMENT = ['with_carrier', 'delivered'];

function isWithCarrier(order) {
  if (NON_CANCELLABLE_FULFILLMENT.includes(order.fulfillment_status)) return true;
  if (["shipped", "in_transit", "delivered"].includes(order.delivery_status)) return true;
  return false;
}

async function restockOrderItems(order) {
  if (!order || !Array.isArray(order.items)) return;

  if (order.restocked) {
    logger.info(`[OrderStateService] Order ${order.id} already restocked (in-memory) — skipping.`);
    return;
  }
  try {
    const { data: current } = await db.from("orders").select("restocked").eq("id", order.id).single();
    if (current?.restocked) {
      logger.info(`[OrderStateService] Order ${order.id} already restocked (DB) — skipping.`);
      return;
    }
  } catch (_) { }

  logger.info(`[OrderStateService] Restocking items for order ${order.id}`);

  if (FEATURE_FLAGS.ENABLE_TRANSACTIONS && !FEATURE_FLAGS.INVENTORY_SERVICE) {
    await withTransaction(async (client) => {
      const productIds = order.items.filter(i => i.productId).map(i => i.productId);
      const products = await withRowLocks(client, "products", productIds, "UPDATE");

      const productMap = {};
      for (const p of products) productMap[p.id] = p;

      for (const item of order.items) {
        if (!item.productId) continue;
        const qty = parseInt(item.quantity, 10) || 0;
        if (qty <= 0) continue;
        const product = productMap[item.productId];
        if (!product) {
          logger.warn(`[OrderStateService] Product ${item.productId} not found during restocking.`);
          continue;
        }
        const newStock = (product.stock || 0) + qty;
        await optimisticUpdate(client, "products", item.productId, { stock: newStock }, product.version);
      }

      await optimisticUpdate(client, "orders", order.id,
        { restocked: true, updated_at: new Date().toISOString() },
        order.version !== undefined ? order.version : undefined
      );
    });
    return;
  }

  if (FEATURE_FLAGS.INVENTORY_SERVICE) {
    for (const item of order.items) {
      if (!item.productId) continue;
      try {
        const qty = parseInt(item.quantity, 10) || 0;
        if (qty <= 0) continue;
        await inventoryService.restockStock(item.productId, qty, 'cancellation', order.id);
      } catch (err) {
        logger.error(`[OrderStateService] Failed to restock product ${item.productId}: ${err.message}`);
      }
    }
  } else {
    for (const item of order.items) {
      if (!item.productId) continue;
      try {
        const { data: product } = await db.from("products").select("stock").eq("id", item.productId).single();
        if (!product) { logger.warn(`[OrderStateService] Product ${item.productId} not found during restocking.`); continue; }
        const currentStock = product.stock || 0;
        const updatedStock = currentStock + (parseInt(item.quantity, 10) || 0);
        await db.from("products").update({ stock: updatedStock }).eq("id", item.productId);
      } catch (err) {
        logger.error(`[OrderStateService] Failed to restock product ${item.productId}: ${err.message}`);
      }
    }
  }

  try {
    await db.from("orders").update({ restocked: true, updated_at: new Date().toISOString() }).eq("id", order.id);
  } catch (e) {
    logger.warn(`[OrderStateService] Failed to mark restocked for ${order.id}: ${e.message}`);
  }
}

function resolveState(order) {
  if (!order) return "unknown";
  const { status, delivery_status, admin_approval_status, fulfillment_status } = order;

  if (status === OrderStatus.ORDER_CREATED) return "Order Created";
  if (status === OrderStatus.CANCELLATION_WINDOW) return "Cancellation Window";
  if (status === OrderStatus.WINDOW_CLOSED) return "Window Closed";
  if (status === OrderStatus.SELF_CANCELLED) return "Self Cancelled";
  if (status === OrderStatus.PAYMENT_VERIFIED) return "Payment Verified";
  if (status === OrderStatus.ADMIN_PENDING) return "Pending Admin Approval";
  if (status === OrderStatus.ADMIN_REJECTED) return "Admin Rejected";
  if (status === OrderStatus.APPROVED) return "Approved";
  if (status === OrderStatus.PACKING) return "Packing";
  if (status === OrderStatus.RETURN_WINDOW) return "Return Window";
  if (status === OrderStatus.RETURN_REQUESTED) return "Return Requested";
  if (status === OrderStatus.RETURN_APPROVED) return "Return Approved";
  if (status === OrderStatus.RETURN_REJECTED) return "Return Rejected";
  if (status === OrderStatus.COMPLETED) return "Completed";

  if (status === "CANCEL_REQUESTED") return "Cancellation Requested";
  if (status === "CANCEL_REJECTED") return "Cancellation Rejected";
  if (status === "REFUND_PENDING") return "Refund Pending";
  if (status === "REFUND_INITIATED") return "Refund Initiated";
  if (status === "REFUND_PROCESSING") return "Refund Processing";
  if (status === "REFUND_COMPLETED") return "Refund Completed";
  if (status === "REFUND_FAILED") return "Refund Failed";
  if (status === "cancelled") return "Cancelled";

  if (admin_approval_status === "pending" && (status === "paid" || delivery_status === "placed")) return "Pending Approval";
  if (status === "pending") return "Pending Payment";
  if (status === "failed") return "Payment Failed";

  if (fulfillment_status) {
    if (fulfillment_status === "pending_fulfillment") return "Pending Fulfillment";
    if (fulfillment_status === "packing_required") return "Packing Required";
    if (fulfillment_status === "packed") return "Packed";
    if (fulfillment_status === "ready_to_ship") return "Ready to Ship";
    if (fulfillment_status === "with_carrier") return "With Carrier";
    if (fulfillment_status === "delivered") return "Delivered";
  }

  if (delivery_status === "processing" || delivery_status === "inoculating") return "Processing";
  if (delivery_status === "shipped") return "Shipped";
  if (delivery_status === "in_transit") return "In Transit";
  if (delivery_status === "delivered") return "Delivered";
  if (status === "paid" && delivery_status === "placed") return "Order Placed";

  return status || "unknown";
}

function assertForwardOnly(currentStatus, nextStatus) {
  if (!FEATURE_FLAGS.ENFORCE_FORWARD_ONLY) return true;
  const ORDERED_STATUSES = ["placed", "processing", "inoculating", "shipped", "in_transit", "delivered"];
  const currentIdx = ORDERED_STATUSES.indexOf(currentStatus);
  const nextIdx = ORDERED_STATUSES.indexOf(nextStatus);
  if (currentIdx === -1 || nextIdx === -1) return true;
  if (nextIdx < currentIdx) {
    throw new Error(`Cannot move delivery status backward from "${currentStatus}" to "${nextStatus}". Only forward transitions are allowed.`);
  }
  return true;
}

function assertCancellable(order) {
  if (!order) throw new Error("Order not found");
  const { delivery_status, status, fulfillment_status } = order;
  if (isWithCarrier(order)) throw new Error("Order cannot be cancelled after it has been handed to the carrier.");
  if (["cancelled", "REFUND_COMPLETED", "REFUND_FAILED"].includes(status)) throw new Error("Order is already cancelled or has a completed refund.");
  return true;
}

function canSelfCancel(order) {
  if (!order) return false;
  if (!order.cancel_window_expires) return false;
  if (new Date(order.cancel_window_expires) < new Date()) return false;
  if (isWithCarrier(order)) return false;
  return true;
}

async function setCancelWindow(orderId, minutes = 30) {
  const expires = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  const { error } = await db.from("orders").update({ cancel_window_expires: expires }).eq("id", orderId);
  if (error) logger.warn(`[OrderStateService] Failed to set cancel window for ${orderId}: ${error.message}`);
  return expires;
}

module.exports = {
  OrderStates,
  isValidTransition,
  getStateMachine,
  restockOrderItems,
  resolveState,
  assertForwardOnly,
  assertCancellable,
  isWithCarrier,
  canSelfCancel,
  setCancelWindow,
  selfCancel,
  adminReject,
  adminApprove,
  startReturnWindow,
  getCancelWindow,
  closeExpiredWindows,
  atomicStateTransition,
  atomicOrderFetch,
};
