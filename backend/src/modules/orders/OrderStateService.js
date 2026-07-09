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
    transitions: [OrderStatus.CANCELLATION_WINDOW, OrderStatus.PAYMENT_VERIFIED, OrderStatus.FAILED],
    onEnter: 'setCancelWindow',
  },
  [OrderStatus.CANCELLATION_WINDOW]: {
    transitions: [OrderStatus.SELF_CANCELLED, OrderStatus.WINDOW_CLOSED, OrderStatus.PAYMENT_VERIFIED, OrderStatus.FAILED],
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
    transitions: [OrderStatus.ADMIN_PENDING, OrderStates.CANCEL_REQUESTED],
  },
  [OrderStatus.ADMIN_PENDING]: {
    transitions: [OrderStatus.APPROVED, OrderStatus.ADMIN_REJECTED, OrderStates.CANCEL_REQUESTED],
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
    transitions: [OrderStatus.PENDING_DISPATCH, OrderStatus.SHIPMENT_FAILED],
  },
  [OrderStatus.PENDING_DISPATCH]: {
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

  // Try the primary machine first; fall back to the other machine if the
  // status doesn't exist in the primary one.  This lets callers mix v3 and
  // legacy states regardless of ENABLE_NEW_STATE_MACHINE.
  const primary = FEATURE_FLAGS.ENABLE_NEW_STATE_MACHINE ? V3_STATE_MACHINE : LEGACY_VALID_TRANSITIONS;
  const fallback = FEATURE_FLAGS.ENABLE_NEW_STATE_MACHINE ? LEGACY_VALID_TRANSITIONS : V3_STATE_MACHINE;

  let node = primary[currentStatus];
  if (!node) node = fallback[currentStatus];
  if (!node) return false;

  // node.transitions could be an array (v3 node) or an array (legacy map value)
  const transitions = Array.isArray(node) ? node : (node.transitions || []);
  return transitions.includes(nextStatus);
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

  if (![OrderStatus.CANCELLATION_WINDOW, OrderStatus.ORDER_CREATED, OrderStatus.PAYMENT_VERIFIED, OrderStatus.ADMIN_PENDING, "pending", "paid", "placed"].includes(order.status)) {
    throw new Error("Order is not in a cancellable state");
  }

  if (!canSelfCancel(order)) {
    throw new Error("Self-cancellation window has expired");
  }

  if (isWithCarrier(order)) {
    throw new Error("Order has been handed to carrier and cannot be self-cancelled");
  }

  await coherentOrderUpdate(orderId, order.version, {
    status: OrderStatus.SELF_CANCELLED,
    cancel_reason: "Self-cancelled within window",
    cancelled_by: "customer",
    cancelled_at: new Date().toISOString(),
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
    try {
      await restockOrderItems(order);
    } catch (restockErr) {
      logger.warn(`[OrderStateService] Restock failed for self-cancelled order ${orderId}: ${restockErr.message}`);
    }
    return { success: true, message: "Order self-cancelled. Auto-refund failed — stock will be restored and an admin will review.", refundFailed: true };
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

  await coherentOrderUpdate(orderId, order.version, {
    status: OrderStatus.ADMIN_REJECTED,
    rejection_reason: reason.trim(),
    cancelled_by: "admin",
    cancelled_at: new Date().toISOString(),
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

  await coherentOrderUpdate(orderId, order.version, {
    status: OrderStatus.APPROVED,
    admin_approval_status: "approved",
  });

  const freshOrder = await atomicOrderFetch(orderId);
  return { success: true, message: "Order approved", order: freshOrder || { ...order, status: OrderStatus.APPROVED } };
}

async function startReturnWindow(orderId) {
  const order = await atomicOrderFetch(orderId);
  if (!order) throw new Error("Order not found");
  if (order.return_window_expires) return { success: true, message: "Return window already set" };

  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  // Use order.version for optimistic locking if available
  const version = order.version;
  await coherentOrderUpdate(orderId, version, {
    return_window_expires: expires,
    status: OrderStatus.RETURN_WINDOW,
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
    .in("status", [OrderStatus.ORDER_CREATED, OrderStatus.CANCELLATION_WINDOW, "pending"]);

  if (!expired || expired.length === 0) return { closed: 0 };

  const ids = expired.map(o => o.id);

  const dims = STATE_DIMENSION_MAP[OrderStatus.WINDOW_CLOSED];
  if (FEATURE_FLAGS.ENABLE_TRANSACTIONS) {
    await withTransaction(async (client) => {
      const locked = await withRowLocks(client, "orders", ids);
      if (locked.length === 0) return;
      await client.query(
        `UPDATE orders SET status = $1, delivery_status = $2, fulfillment_status = $3, updated_at = $4 WHERE id = ANY($5::text[])`,
        [OrderStatus.WINDOW_CLOSED, dims.delivery_status, dims.fulfillment_status, new Date().toISOString(), ids]
      );
    });
  } else {
    await db.from("orders").update({
      status: OrderStatus.WINDOW_CLOSED,
      delivery_status: dims.delivery_status,
      fulfillment_status: dims.fulfillment_status,
      updated_at: new Date().toISOString(),
    }).in("id", ids);
  }

  logger.info(`[OrderStateService] Closed ${ids.length} expired cancellation windows`);
  return { closed: ids.length };
}

// ── Legacy Methods (preserved) ────────────────────────────────────────────

const NON_CANCELLABLE_FULFILLMENT = ['with_carrier', 'delivered'];

function isWithCarrier(order) {
  if (!order) return false;
  // Primary: check status (source of truth)
  if (NON_CANCELLABLE_STATUSES.has(order.status)) return true;
  // Legacy fallback for orders still using the old dimension-only approach
  if (NON_CANCELLABLE_FULFILLMENT.includes(order.fulfillment_status)) return true;
  if (["shipped", "in_transit", "delivered", "with_carrier", "out_for_delivery", "ndr"].includes(order.delivery_status)) return true;
  return false;
}

/**
 * Determine if an order was paid (stock was deducted, not just reserved).
 */
function wasOrderPaid(order) {
  if (!order) return false;
  const PAID_STATUSES = new Set(["paid", OrderStates.PAID, OrderStates.PAYMENT_VERIFIED, OrderStates.APPROVED]);
  return !!(order.razorpay_payment_id && PAID_STATUSES.has(order.status));
}

async function restockOrderItems(order) {
  if (!order || !Array.isArray(order.items)) return;
  const wasPaid = wasOrderPaid(order);

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

  logger.info(`[OrderStateService} Restocking items for order ${order.id} (wasPaid=${wasPaid})`);

  async function restockItem(productId, qty, weight, unit) {
    if (!productId || qty <= 0) return;
    if (weight !== undefined && weight !== null && unit) {
      const { data: product } = await db.from("products").select("weight_pricing, version").eq("id", productId).single();
      if (product && Array.isArray(product.weight_pricing)) {
        const variant = product.weight_pricing.find(
          v => Number(v.weight) === Number(weight) && v.unit === unit
        );
        if (variant) {
          const updatedWp = product.weight_pricing.map(v => {
            if (Number(v.weight) === Number(weight) && v.unit === unit) {
              const update = { ...v };
              if (wasPaid && v.stock !== undefined) update.stock = (v.stock || 0) + qty;
              if (v.reserved_quantity !== undefined) update.reserved_quantity = Math.max(0, (v.reserved_quantity || 0) - qty);
              return update;
            }
            return v;
          });
          await db.from("products").update({
            weight_pricing: updatedWp,
            version: (product.version || 0) + 1,
            updated_at: new Date().toISOString(),
          }).eq("id", productId);
          return;
        }
      }
    }
    // Top-level stock
    const { data: product } = await db.from("products").select("stock, reserved_quantity").eq("id", productId).single();
    if (!product) { logger.warn(`[OrderStateService] Product ${productId} not found during restocking.`); return; }
    const updateFields = { reserved_quantity: Math.max(0, (product.reserved_quantity || 0) - qty) };
    if (wasPaid) updateFields.stock = (product.stock || 0) + qty;
    await db.from("products").update(updateFields).eq("id", productId);
  }

  if (FEATURE_FLAGS.ENABLE_TRANSACTIONS && !FEATURE_FLAGS.INVENTORY_SERVICE) {
    await withTransaction(async (client) => {
      const productIds = [...new Set(order.items.filter(i => i.productId).map(i => i.productId))];
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

        if (item.weight !== undefined && item.weight !== null && item.unit && Array.isArray(product.weight_pricing)) {
          const variantIdx = product.weight_pricing.findIndex(
            v => Number(v.weight) === Number(item.weight) && v.unit === item.unit
          );
          if (variantIdx !== -1) {
            // Release reserved_quantity; only restore stock if was paid
            const stockExpr = wasPaid ? `jsonb_set(elem, '{stock}', to_jsonb(COALESCE((elem->>'stock')::int, 0) + $2))` : 'elem';
            await client.query(
              `UPDATE products SET weight_pricing = (
                SELECT jsonb_agg(
                  CASE
                    WHEN (elem->>'weight')::numeric = $4 AND elem->>'unit' = $5
                    THEN jsonb_set(${stockExpr}, '{reserved_quantity}', to_jsonb(GREATEST(0, COALESCE((elem->>'reserved_quantity')::int, 0) - $2)))
                    ELSE elem
                  END
                )
                FROM jsonb_array_elements(weight_pricing) AS elem
                WHERE id = $3
              ), version = version + 1, updated_at = $6
              WHERE id = $3`,
              [qty, qty, item.productId, Number(item.weight), item.unit, new Date().toISOString()]
            );
            continue;
          }
        }
        const newReserved = Math.max(0, (product.reserved_quantity || 0) - qty);
        const updates = { reserved_quantity: newReserved };
        if (wasPaid) updates.stock = (product.stock || 0) + qty;
        await optimisticUpdate(client, "products", item.productId, updates, product.version);
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
        if (item.weight !== undefined && item.weight !== null && item.unit) {
          await restockItem(item.productId, qty, item.weight, item.unit);
        } else {
          await inventoryService.restockStock(item.productId, qty, 'cancellation', order.id);
        }
      } catch (err) {
        logger.error(`[OrderStateService] Failed to restock product ${item.productId}: ${err.message}`);
      }
    }
  } else {
    for (const item of order.items) {
      if (!item.productId) continue;
      try {
        const qty = parseInt(item.quantity, 10) || 0;
        if (qty <= 0) continue;
        await restockItem(item.productId, qty, item.weight, item.unit);
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
  if (status === OrderStatus.PACKED) return "Packed";
  if (status === OrderStatus.READY_TO_SHIP) return "Ready to Ship";
  if (status === OrderStatus.PENDING_DISPATCH) return "Pending Dispatch";
  if (status === OrderStatus.SHIPMENT_FAILED) return "Shipment Failed";
  if (status === OrderStatus.WITH_CARRIER) return "With Carrier";
  if (status === OrderStatus.OUT_FOR_DELIVERY) return "Out for Delivery";
  if (status === OrderStatus.NDR) return "Non-Delivery Report";
  if (status === OrderStatus.RTO) return "Return to Origin";
  if (status === OrderStatus.DELIVERED) return "Delivered";
  if (status === OrderStatus.RETURN_WINDOW) return "Return Window";
  if (status === OrderStatus.RETURN_REQUESTED) return "Return Requested";
  if (status === OrderStatus.RETURN_APPROVED) return "Return Approved";
  if (status === OrderStatus.RETURN_REJECTED) return "Return Rejected";
  if (status === OrderStatus.RETURN_PICKUP) return "Return Pickup";
  if (status === OrderStatus.RETURN_RECEIVED) return "Return Received";
  if (status === OrderStatus.QUALITY_CHECK) return "Quality Check";
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
  const TERMINAL_STATES = new Set(["cancelled", OrderStatus.SELF_CANCELLED, OrderStatus.ADMIN_REJECTED, OrderStatus.COMPLETED, OrderStatus.RETURN_REJECTED, "REFUND_COMPLETED", "REFUND_FAILED"]);
  if (TERMINAL_STATES.has(status)) throw new Error("Order is already cancelled or has a completed refund.");
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

async function buildTrackingData(order, trackDb) {
  const { data: shipment } = await trackDb
    .from("shipments")
    .select("*, shipping_provider_id")
    .eq("order_id", order.id)
    .single();

  let events = [];
  const timeline = [
    {
      status: "placed",
      label: "Order Placed",
      done: true,
      time: order.created_at,
    },
  ];

  if (shipment) {
    const { data: trackingEvents } = await trackDb
      .from("shipment_tracking_events")
      .select("*")
      .eq("shipment_id", shipment.id)
      .order("occurred_at", { ascending: true });
    events = trackingEvents || [];

    for (const ev of events) {
      timeline.push({
        status: ev.status,
        label: ev.description || ev.status,
        done: true,
        time: ev.occurred_at,
        location: ev.location,
      });
    }
  }

  return { shipment, events, timeline };
}

// ── State Dimension Synchronization ──────────────────────────────────────
// Maps every status to its canonical delivery_status and fulfillment_status.
// This is the SINGLE SOURCE OF TRUTH for all three dimensions.

const STATE_DIMENSION_MAP = {
  // v3 states
  [OrderStatus.ORDER_CREATED]:      { delivery_status: "placed",      fulfillment_status: null },
  [OrderStatus.CANCELLATION_WINDOW]: { delivery_status: "placed",      fulfillment_status: null },
  [OrderStatus.SELF_CANCELLED]:     { delivery_status: "cancelled",   fulfillment_status: null },
  [OrderStatus.WINDOW_CLOSED]:      { delivery_status: "placed",      fulfillment_status: null },
  [OrderStatus.PAYMENT_VERIFIED]:   { delivery_status: "placed",      fulfillment_status: null },
  [OrderStatus.ADMIN_PENDING]:      { delivery_status: "placed",      fulfillment_status: null },
  [OrderStatus.ADMIN_REJECTED]:     { delivery_status: "rejected",    fulfillment_status: null },
  [OrderStatus.APPROVED]:           { delivery_status: "placed",      fulfillment_status: "pending_fulfillment" },
  [OrderStatus.PACKING]:            { delivery_status: "processing",  fulfillment_status: "packing_required" },
  [OrderStatus.PACKED]:             { delivery_status: "processing",  fulfillment_status: "packed" },
  [OrderStatus.READY_TO_SHIP]:      { delivery_status: "processing",  fulfillment_status: "ready_to_ship" },
  [OrderStatus.PENDING_DISPATCH]:   { delivery_status: "processing",  fulfillment_status: "pending_dispatch" },
  [OrderStatus.SHIPMENT_FAILED]:    { delivery_status: "failed",      fulfillment_status: null },
  [OrderStatus.WITH_CARRIER]:       { delivery_status: "shipped",     fulfillment_status: "with_carrier" },
  [OrderStatus.OUT_FOR_DELIVERY]:   { delivery_status: "out_for_delivery", fulfillment_status: "with_carrier" },
  [OrderStatus.NDR]:                { delivery_status: "ndr",         fulfillment_status: "with_carrier" },
  [OrderStatus.RTO]:                { delivery_status: "cancelled",   fulfillment_status: null },
  [OrderStatus.DELIVERED]:          { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.RETURN_WINDOW]:      { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.RETURN_REQUESTED]:   { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.RETURN_APPROVED]:    { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.RETURN_PICKUP]:      { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.RETURN_RECEIVED]:    { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.QUALITY_CHECK]:      { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.RETURN_REJECTED]:    { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.COMPLETED]:          { delivery_status: "delivered",   fulfillment_status: "delivered" },
  [OrderStatus.FAILED]:             { delivery_status: "placed",      fulfillment_status: null },

  // Legacy states
  [OrderStates.PENDING]:            { delivery_status: "placed",      fulfillment_status: null },
  [OrderStates.PAID]:               { delivery_status: "placed",      fulfillment_status: null },
  [OrderStates.CANCEL_REQUESTED]:   { delivery_status: "placed",      fulfillment_status: null },
  [OrderStates.CANCEL_REJECTED]:    { delivery_status: "processing",  fulfillment_status: null },
  [OrderStates.CANCELLED]:          { delivery_status: "cancelled",   fulfillment_status: null },
};

// Reverse map: fulfillment_status → canonical status + delivery_status
const FULFILLMENT_STATUS_MAP = {
  "pending_fulfillment":  { status: OrderStatus.APPROVED,       delivery_status: "placed" },
  "packing_required":     { status: OrderStatus.PACKING,        delivery_status: "processing" },
  "packed":               { status: OrderStatus.PACKED,         delivery_status: "processing" },
  "ready_to_ship":        { status: OrderStatus.READY_TO_SHIP,     delivery_status: "processing" },
  "pending_dispatch":     { status: OrderStatus.PENDING_DISPATCH, delivery_status: "processing" },
  "with_carrier":         { status: OrderStatus.WITH_CARRIER,     delivery_status: "shipped" },
  "delivered":            { status: OrderStatus.DELIVERED,      delivery_status: "delivered" },
};

// Webhook shipment status → v3 order status
const WEBHOOK_STATUS_MAP = {
  "shipped":          OrderStatus.WITH_CARRIER,
  "in_transit":       OrderStatus.WITH_CARRIER,
  "out_for_delivery": OrderStatus.OUT_FOR_DELIVERY,
  "delivered":        OrderStatus.DELIVERED,
  "cancelled":        OrderStatus.RTO,
  "returned":         OrderStatus.RTO,
  "ndr":              OrderStatus.NDR,
};

const REFUND_STATES = new Set([
  OrderStatus.REFUND_PENDING, OrderStatus.REFUND_INITIATED,
  OrderStatus.REFUND_PROCESSING, OrderStatus.REFUND_COMPLETED, OrderStatus.REFUND_FAILED,
  OrderStates.REFUND_PENDING, OrderStates.REFUND_INITIATED,
  OrderStates.REFUND_PROCESSING, OrderStates.REFUND_COMPLETED, OrderStates.REFUND_FAILED,
]);

const NON_CANCELLABLE_STATUSES = new Set([
  OrderStatus.PENDING_DISPATCH, OrderStatus.WITH_CARRIER, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.NDR,
  OrderStatus.DELIVERED, OrderStatus.RETURN_WINDOW, OrderStatus.RETURN_REQUESTED,
  OrderStatus.RETURN_APPROVED, OrderStatus.RETURN_PICKUP, OrderStatus.RETURN_RECEIVED,
  OrderStatus.QUALITY_CHECK, OrderStatus.RETURN_REJECTED, OrderStatus.COMPLETED,
]);

/**
 * Atomically updates order state with all three dimensions synchronized.
 * - When `status` is set, fills in canonical `delivery_status` and `fulfillment_status`
 * - When only `fulfillment_status` is set, derives canonical `status` and `delivery_status`
 * - For refund states, preserves existing dimension values
 */
async function coherentOrderUpdate(orderId, expectedVersion, updates) {
  const newStatus = updates.status;

  if (newStatus && REFUND_STATES.has(newStatus)) {
    const current = await atomicOrderFetch(orderId);
    if (current) {
      if (updates.delivery_status === undefined) updates.delivery_status = current.delivery_status;
      if (updates.fulfillment_status === undefined) updates.fulfillment_status = current.fulfillment_status;
    }
  } else if (updates.fulfillment_status && !newStatus) {
    const mapped = FULFILLMENT_STATUS_MAP[updates.fulfillment_status];
    if (mapped) {
      updates.status = mapped.status;
      if (updates.delivery_status === undefined) updates.delivery_status = mapped.delivery_status;
    }
  } else if (newStatus) {
    const dims = STATE_DIMENSION_MAP[newStatus];
    if (dims) {
      if (updates.delivery_status === undefined) updates.delivery_status = dims.delivery_status;
      if (updates.fulfillment_status === undefined) updates.fulfillment_status = dims.fulfillment_status;
    }
  }

  updates.updated_at = new Date().toISOString();
  await atomicStateTransition(orderId, expectedVersion, updates);
}

/**
 * Read-time reconciliation: given an order object, return its canonical state dimensions.
 * `status` is the source of truth; delivery_status and fulfillment_status are advisory.
 */
function reconcileDimensions(order) {
  if (!order) return { status: null, delivery_status: null, fulfillment_status: null };
  const canonical = STATE_DIMENSION_MAP[order.status];
  if (canonical) {
    return { status: order.status, delivery_status: canonical.delivery_status, fulfillment_status: canonical.fulfillment_status };
  }
  // Refund states — preserve DB values
  if (REFUND_STATES.has(order.status)) {
    return { status: order.status, delivery_status: order.delivery_status, fulfillment_status: order.fulfillment_status };
  }
  // Unknown state — return as-is
  return { status: order.status, delivery_status: order.delivery_status, fulfillment_status: order.fulfillment_status };
}

// ── Missing Transition Cron Jobs ─────────────────────────────────────────

/**
 * Transition REFUND_COMPLETED orders to COMPLETED.
 * Preserves existing delivery/fulfillment dimensions (e.g., cancelled/refunded
 * orders keep "cancelled" delivery_status rather than "delivered").
 */
async function completeRefundedOrders() {
  const { data: orders } = await db
    .from("orders")
    .select("id, status, delivery_status, fulfillment_status, version")
    .in("status", [OrderStatus.REFUND_COMPLETED, OrderStates.REFUND_COMPLETED]);

  if (!orders || orders.length === 0) return { completed: 0 };

  let count = 0;
  for (const order of orders) {
    try {
      // Preserve dimensions — don't overwrite with COMPLETED canonical values
      await atomicStateTransition(order.id, order.version, {
        status: OrderStatus.COMPLETED,
        updated_at: new Date().toISOString(),
      });
      count++;
    } catch (err) {
      logger.warn(`[OrderStateService] Failed to complete refunded order ${order.id}: ${err.message}`);
    }
  }

  logger.info(`[OrderStateService] Completed ${count} refunded orders`);
  return { completed: count };
}

/**
 * Transition expired RETURN_WINDOW orders to COMPLETED.
 * Uses canonical dimensions for delivered orders.
 */
async function closeCompletedWindows() {
  const { data: orders } = await db
    .from("orders")
    .select("id, version")
    .eq("status", OrderStatus.RETURN_WINDOW)
    .lt("return_window_expires", new Date().toISOString());

  if (!orders || orders.length === 0) return { closed: 0 };

  const dims = STATE_DIMENSION_MAP[OrderStatus.COMPLETED] || { delivery_status: "delivered", fulfillment_status: "delivered" };
  let count = 0;
  for (const order of orders) {
    try {
      await atomicStateTransition(order.id, order.version, {
        status: OrderStatus.COMPLETED,
        delivery_status: dims.delivery_status,
        fulfillment_status: dims.fulfillment_status,
        updated_at: new Date().toISOString(),
      });
      count++;
    } catch (err) {
      logger.warn(`[OrderStateService] Failed to close window for order ${order.id}: ${err.message}`);
    }
  }

  logger.info(`[OrderStateService] Closed ${count} expired return windows`);
  return { closed: count };
}

module.exports = {
  OrderStates,
  isValidTransition,
  getStateMachine,
  wasOrderPaid,
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
  buildTrackingData,
  coherentOrderUpdate,
  reconcileDimensions,
  completeRefundedOrders,
  closeCompletedWindows,
  STATE_DIMENSION_MAP,
  FULFILLMENT_STATUS_MAP,
  WEBHOOK_STATUS_MAP,
  REFUND_STATES,
  NON_CANCELLABLE_STATUSES,
};
