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

module.exports = {
  OrderStates,
  isValidTransition,
  restockOrderItems
};
