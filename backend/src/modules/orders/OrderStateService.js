const db = require("../../config/db");
const logger = require("../../utils/logger");

const OrderStates = {
  // ── Order Lifecycle ──
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  PENDING_APPROVAL: "pending_approval",
  PLACED: "placed",
  REJECTED: "rejected",
  PROCESSING: "processing",
  SHIPPING: "shipping",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
  // ── Cancellation ──
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCEL_APPROVED: "CANCEL_APPROVED",
  CANCEL_REJECTED: "CANCEL_REJECTED",
  // ── Refund ──
  REFUND_PENDING: "REFUND_PENDING",
  REFUND_INITIATED: "REFUND_INITIATED",
  REFUND_PROCESSING: "REFUND_PROCESSING",
  REFUND_COMPLETED: "REFUND_COMPLETED",
  REFUND_FAILED: "REFUND_FAILED",
  MANUAL_REFUND_INITIATED: "MANUAL_REFUND_INITIATED",
  MANUAL_REFUND_COMPLETED: "MANUAL_REFUND_COMPLETED",
  // ── Legacy Terminal ──
  CANCELLED: "cancelled",
  REFUNDED: "refunded"
};

const VALID_TRANSITIONS = {
  // ── Payment ──
  [OrderStates.PENDING]: [OrderStates.PAID, OrderStates.FAILED, OrderStates.CANCELLED, OrderStates.CANCEL_REQUESTED],
  ["pending_upi_verification"]: [OrderStates.PAID, OrderStates.CANCEL_REQUESTED],
  [OrderStates.PAID]: [OrderStates.PENDING_APPROVAL, OrderStates.CANCEL_REQUESTED, OrderStates.REFUND_PENDING, OrderStates.CANCELLED],
  // ── Approval ──
  [OrderStates.PENDING_APPROVAL]: [OrderStates.PLACED, OrderStates.REJECTED, OrderStates.CANCEL_REQUESTED],
  [OrderStates.PLACED]: [OrderStates.PROCESSING, OrderStates.CANCEL_REQUESTED],
  [OrderStates.REJECTED]: [],
  // ── Fulfillment ──
  [OrderStates.PROCESSING]: [OrderStates.SHIPPING, OrderStates.CANCEL_REQUESTED],
  [OrderStates.SHIPPING]: [OrderStates.IN_TRANSIT, OrderStates.DELIVERED],
  [OrderStates.IN_TRANSIT]: [OrderStates.DELIVERED],
  [OrderStates.DELIVERED]: [],
  // ── Cancellation ──
  [OrderStates.CANCEL_REQUESTED]: [OrderStates.CANCEL_APPROVED, OrderStates.CANCEL_REJECTED],
  [OrderStates.CANCEL_REJECTED]: [OrderStates.PLACED],
  [OrderStates.CANCEL_APPROVED]: [OrderStates.REFUND_PENDING],
  // ── Refund ──
  [OrderStates.REFUND_PENDING]: [OrderStates.REFUND_INITIATED, OrderStates.REFUND_FAILED],
  [OrderStates.REFUND_INITIATED]: [OrderStates.REFUND_PROCESSING, OrderStates.REFUND_FAILED, OrderStates.REFUND_COMPLETED],
  [OrderStates.REFUND_PROCESSING]: [OrderStates.REFUND_COMPLETED, OrderStates.REFUND_FAILED],
  [OrderStates.REFUND_FAILED]: [OrderStates.REFUND_PENDING, OrderStates.REFUND_INITIATED, OrderStates.MANUAL_REFUND_INITIATED],
  [OrderStates.MANUAL_REFUND_INITIATED]: [OrderStates.MANUAL_REFUND_COMPLETED, OrderStates.REFUND_FAILED],
  [OrderStates.MANUAL_REFUND_COMPLETED]: [],
  // ── Legacy Terminal ──
  [OrderStates.CANCELLED]: [],
  [OrderStates.REFUNDED]: []
};

/**
 * Validates whether an order status transition is allowed.
 * @param {string} currentStatus 
 * @param {string} nextStatus 
 * @returns {boolean}
 */
function isValidTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(nextStatus);
}

/**
 * Restocks items for a cancelled order.
 * Ensures stock is only added back if the order was paid and not already restocked.
 * @param {object} order 
 */
async function restockOrderItems(order) {
  if (!order || !Array.isArray(order.items)) {
    return;
  }

  // Idempotency guard — skip if stock was already restored for this order
  if (order.stock_restored) {
    logger.info(`[OrderStateService] Order ${order.id} already restocked — skipping.`);
    return;
  }

  logger.info(`[OrderStateService] Restocking items for order ${order.id}`);

  for (const item of order.items) {
    if (!item.productId) continue;

    try {
      const { data: product } = await db
        .from("products")
        .select("stock")
        .eq("id", item.productId)
        .single();

      if (!product) {
        logger.warn(`[OrderStateService] Product ${item.productId} not found during restocking.`);
        continue;
      }

      const currentStock = product.stock || 0;
      const updatedStock = currentStock + (parseInt(item.quantity, 10) || 0);

      await db
        .from("products")
        .update({ stock: updatedStock })
        .eq("id", item.productId);

      logger.info(`[OrderStateService] Restocked product ${item.productId}: ${currentStock} -> ${updatedStock}`);
    } catch (err) {
      logger.error(`[OrderStateService] Failed to restock product ${item.productId}: ${err.message}`);
    }
  }

  // Mark order as restocked so subsequent calls are no-ops
  try {
    await db.from("orders").update({ stock_restored: true }).eq("id", order.id);
  } catch (err) {
    logger.error(`[OrderStateService] Failed to set stock_restored for order ${order.id}: ${err.message}`);
  }
}

/**
 * Delivery-status ordering for forward-only enforcement.
 */
const DELIVERY_STATUS_ORDER = ['placed', 'processing', 'shipped', 'in_transit', 'delivered'];

/**
 * Assert that a delivery_status transition moves only forward, one step at a time.
 * @param {string} currentStatus
 * @param {string} newStatus
 * @throws {Error} if the transition is backward or skips a status
 */
function assertForwardOnly(currentStatus, newStatus) {
  if (currentStatus === newStatus) return;
  const currentIdx = DELIVERY_STATUS_ORDER.indexOf(currentStatus);
  const newIdx = DELIVERY_STATUS_ORDER.indexOf(newStatus);
  if (newIdx < currentIdx) {
    throw new Error(`Cannot move backward from ${currentStatus} to ${newStatus}`);
  }
  if (newIdx > currentIdx + 1) {
    throw new Error(`Cannot skip status from ${currentStatus} to ${newStatus}`);
  }
}

/**
 * Assert that an order can still be cancelled (not shipped, in_transit, or delivered).
 * @param {object} order
 * @throws {Error} if the order is past the cancellation point
 */
function assertCancellable(order) {
  const NON_CANCELLABLE = ['shipped', 'in_transit', 'delivered'];
  const deliveryStatus = order.delivery_status || '';
  if (NON_CANCELLABLE.includes(deliveryStatus)) {
    throw new Error('Order has already been shipped and can no longer be cancelled.');
  }
}

/**
 * Map an order's internal status + delivery_status to our logical state.
 * Used when reading orders so the new state machine can interpret legacy data.
 */
function resolveState(order) {
  const { status, delivery_status } = order;

  // Refund states take priority
  const refundMap = {
    REFUND_PENDING: OrderStates.REFUND_PENDING,
    REFUND_INITIATED: OrderStates.REFUND_INITIATED,
    REFUND_PROCESSING: OrderStates.REFUND_PROCESSING,
    REFUND_COMPLETED: OrderStates.REFUND_COMPLETED,
    REFUND_FAILED: OrderStates.REFUND_FAILED,
    MANUAL_REFUND_INITIATED: OrderStates.MANUAL_REFUND_INITIATED,
    MANUAL_REFUND_COMPLETED: OrderStates.MANUAL_REFUND_COMPLETED,
  };
  if (refundMap[status]) return refundMap[status];

  // Cancellation states
  if (status === OrderStates.CANCEL_REQUESTED) return OrderStates.CANCEL_REQUESTED;
  if (status === OrderStates.CANCEL_APPROVED) return OrderStates.CANCEL_APPROVED;
  if (status === OrderStates.CANCEL_REJECTED) return OrderStates.CANCEL_REJECTED;

  // Legacy terminal
  if (status === OrderStates.CANCELLED || delivery_status === 'cancelled') return OrderStates.CANCELLED;
  if (status === OrderStates.REFUNDED) return OrderStates.REFUNDED;

  // Payment states
  if (status === OrderStates.PENDING || status === 'pending') return OrderStates.PENDING;
  if (status === OrderStates.FAILED) return OrderStates.FAILED;

  // Paid — check admin approval status
  if (status === OrderStates.PAID || status === 'paid') {
    const approvalStatus = order.admin_approval_status || 'pending';
    if (approvalStatus === 'approved') {
      // Map delivery_status to lifecycle state
      if (delivery_status === 'placed' || !delivery_status) return OrderStates.PLACED;
      if (delivery_status === 'processing') return OrderStates.PROCESSING;
      if (delivery_status === 'shipped') return OrderStates.SHIPPING;
      if (delivery_status === 'in_transit') return OrderStates.IN_TRANSIT;
      if (delivery_status === 'delivered') return OrderStates.DELIVERED;
      return OrderStates.PLACED;
    }
    if (approvalStatus === 'rejected') return OrderStates.REJECTED;
    return OrderStates.PENDING_APPROVAL;
  }

  // Fallback
  return delivery_status || OrderStates.PENDING;
}

module.exports = {
  OrderStates,
  isValidTransition,
  restockOrderItems,
  assertForwardOnly,
  assertCancellable,
  resolveState
};
