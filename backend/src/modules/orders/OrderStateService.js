const db = require("../../config/db");
const logger = require("../../utils/logger");

const OrderStates = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCEL_REJECTED: "CANCEL_REJECTED",
  CANCELLED: "cancelled",
  REFUND_PENDING: "REFUND_PENDING",
  REFUND_INITIATED: "REFUND_INITIATED",
  REFUND_PROCESSING: "REFUND_PROCESSING",
  REFUND_COMPLETED: "REFUND_COMPLETED",
  REFUND_FAILED: "REFUND_FAILED",
};

const VALID_TRANSITIONS = {
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

function isValidTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(nextStatus);
}

const NON_CANCELLABLE_FULFILLMENT = ['with_carrier', 'delivered'];

/**
 * Check if an order has been handed to the carrier — no cancel allowed.
 */
function isWithCarrier(order) {
  if (NON_CANCELLABLE_FULFILLMENT.includes(order.fulfillment_status)) return true;
  if (["shipped", "in_transit", "delivered"].includes(order.delivery_status)) return true;
  return false;
}

/**
 * Restocks items for a cancelled order.
 * idempotent — skips if order.restocked is already true.
 */
async function restockOrderItems(order) {
  if (!order || !Array.isArray(order.items)) return;

  if (order.restocked) {
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

  // Mark as restocked to prevent double-restock
  try {
    await db
      .from("orders")
      .update({ restocked: true, updated_at: new Date().toISOString() })
      .eq("id", order.id);
  } catch (e) {
    logger.warn(`[OrderStateService] Failed to mark restocked for ${order.id}: ${e.message}`);
  }
}

function resolveState(order) {
  if (!order) return "unknown";
  const { status, delivery_status, admin_approval_status, fulfillment_status } = order;

  if (status === "CANCEL_REQUESTED") return "Cancellation Requested";
  if (status === "CANCEL_REJECTED") return "Cancellation Rejected";
  if (status === "REFUND_PENDING") return "Refund Pending";
  if (status === "REFUND_INITIATED") return "Refund Initiated";
  if (status === "REFUND_PROCESSING") return "Refund Processing";
  if (status === "REFUND_COMPLETED") return "Refund Completed";
  if (status === "REFUND_FAILED") return "Refund Failed";
  if (status === "cancelled") return "Cancelled";

  if (admin_approval_status === "pending" && (status === "paid" || delivery_status === "placed")) {
    return "Pending Approval";
  }
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
  const ORDERED_STATUSES = ["placed", "processing", "inoculating", "shipped", "in_transit", "delivered"];
  const currentIdx = ORDERED_STATUSES.indexOf(currentStatus);
  const nextIdx = ORDERED_STATUSES.indexOf(nextStatus);
  if (currentIdx === -1 || nextIdx === -1) return true;
  if (nextIdx < currentIdx) {
    throw new Error(
      `Cannot move delivery status backward from "${currentStatus}" to "${nextStatus}". Only forward transitions are allowed.`
    );
  }
  return true;
}

function assertCancellable(order) {
  if (!order) throw new Error("Order not found");

  const { delivery_status, status, fulfillment_status } = order;

  // With carrier — no cancel by admin/buyer
  if (isWithCarrier(order)) {
    throw new Error("Order cannot be cancelled after it has been handed to the carrier.");
  }

  // Already in terminal states
  if (["cancelled", "REFUND_COMPLETED", "REFUND_FAILED"].includes(status)) {
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
  assertCancellable,
  isWithCarrier,
};
