const db = require("../../config/db");
const logger = require("../../utils/logger");

const OrderStates = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCEL_APPROVED: "CANCEL_APPROVED",
  CANCEL_REJECTED: "CANCEL_REJECTED",
  REFUND_PENDING: "REFUND_PENDING",
  REFUND_INITIATED: "REFUND_INITIATED",
  REFUND_PROCESSING: "REFUND_PROCESSING",
  REFUND_COMPLETED: "REFUND_COMPLETED",
  REFUND_FAILED: "REFUND_FAILED",
  CANCELLED: "cancelled", // Legacy/Terminal status
  REFUNDED: "refunded"     // Legacy/Terminal status
};

const VALID_TRANSITIONS = {
  [OrderStates.PENDING]: [OrderStates.PAID, OrderStates.FAILED, OrderStates.CANCELLED, OrderStates.CANCEL_REQUESTED],
  [OrderStates.PAID]: [OrderStates.CANCEL_REQUESTED, OrderStates.REFUND_PENDING, OrderStates.CANCELLED],
  [OrderStates.CANCEL_REQUESTED]: [OrderStates.CANCEL_APPROVED, OrderStates.CANCEL_REJECTED],
  [OrderStates.CANCEL_REJECTED]: [OrderStates.PAID], // Return to operational state
  [OrderStates.CANCEL_APPROVED]: [OrderStates.REFUND_PENDING],
  [OrderStates.REFUND_PENDING]: [OrderStates.REFUND_INITIATED, OrderStates.REFUND_FAILED],
  [OrderStates.REFUND_INITIATED]: [OrderStates.REFUND_PROCESSING, OrderStates.REFUND_FAILED, OrderStates.REFUND_COMPLETED],
  [OrderStates.REFUND_PROCESSING]: [OrderStates.REFUND_COMPLETED, OrderStates.REFUND_FAILED],
  [OrderStates.REFUND_FAILED]: [OrderStates.REFUND_PENDING, OrderStates.REFUND_INITIATED], // Allow admin manual retry and direct retry success
  [OrderStates.REFUND_COMPLETED]: [], // Terminal state
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
}


/**
 * Resolves a human-readable state label for an order based on its status and delivery_status.
 * @param {object} order - Order object with status and delivery_status fields
 * @returns {string} Resolved state description
 */
function resolveState(order) {
  if (!order) return "unknown";

  const { status, delivery_status } = order;

  // Cancel/Refund states take priority
  if (status === "CANCEL_REQUESTED") return "Cancellation Requested";
  if (status === "CANCEL_APPROVED") return "Cancellation Approved";
  if (status === "CANCEL_REJECTED") return "Cancellation Rejected";
  if (status === "REFUND_PENDING") return "Refund Pending";
  if (status === "REFUND_INITIATED") return "Refund Initiated";
  if (status === "REFUND_PROCESSING") return "Refund Processing";
  if (status === "REFUND_COMPLETED") return "Refund Completed";
  if (status === "REFUND_FAILED") return "Refund Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "refunded") return "Refunded";

  // Payment states
  if (status === "pending") return "Pending Payment";
  if (status === "failed") return "Payment Failed";
  if (status === "paid" && delivery_status === "placed") return "Order Placed";

  // Delivery states
  if (delivery_status === "processing" || delivery_status === "inoculating") return "Processing";
  if (delivery_status === "shipped") return "Shipped";
  if (delivery_status === "in_transit") return "In Transit";
  if (delivery_status === "delivered") return "Delivered";

  return status || "unknown";
}

/**
 * Asserts that a delivery_status transition is forward-only.
 * Throws an error if the new status is not a forward progression.
 * @param {string} currentStatus - Current delivery_status
 * @param {string} nextStatus - New delivery_status to transition to
 * @returns {boolean} Returns true if valid
 * @throws {Error} If transition is not forward-only
 */
function assertForwardOnly(currentStatus, nextStatus) {
  const ORDERED_STATUSES = ["placed", "processing", "inoculating", "shipped", "in_transit", "delivered"];

  const currentIdx = ORDERED_STATUSES.indexOf(currentStatus);
  const nextIdx = ORDERED_STATUSES.indexOf(nextStatus);

  // If either status is not in the ordered list, allow it (custom statuses like 'cancelled')
  if (currentIdx === -1 || nextIdx === -1) return true;

  if (nextIdx < currentIdx) {
    throw new Error(
      `Cannot move delivery status backward from "${currentStatus}" to "${nextStatus}". ` +
      "Only forward transitions are allowed."
    );
  }

  return true;
}

/**
 * Asserts that an order is cancellable (not shipped, in_transit, or delivered).
 * Throws an error if the order cannot be cancelled.
 * @param {object} order - Order object to check
 * @returns {boolean} Returns true if cancellable
 * @throws {Error} If order cannot be cancelled
 */
function assertCancellable(order) {
  if (!order) {
    throw new Error("Order not found");
  }

  const { delivery_status, status } = order;

  if (["shipped", "in_transit", "delivered"].includes(delivery_status)) {
    throw new Error("Order cannot be cancelled after it has been shipped.");
  }

  if (["cancelled", "refunded", "CANCEL_REQUESTED", "REFUND_FAILED", "REFUND_COMPLETED", "MANUAL_REFUND_INITIATED", "MANUAL_REFUND_COMPLETED"].includes(status)) {
    throw new Error("Order is already cancelled or has a completed refund.");
  }

  return true;
}

module.exports = {
  OrderStates,
  isValidTransition,
  restockOrderItems,
  resolveState,
  assertForwardOnly,
  assertCancellable
};
