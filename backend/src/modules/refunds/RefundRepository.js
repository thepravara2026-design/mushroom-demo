const db = require("../../config/db");
const logger = require("../../utils/logger");

/**
 * Find order by ID
 */
async function findOrderById(orderId) {
  const { data, error } = await db
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error && error.message !== "No rows found") {
    logger.error(`[RefundRepository] findOrderById error for ${orderId}: ${error.message}`);
  }
  return data;
}

/**
 * Update order fields.
 * Resilient: if Supabase rejects the update because a refund/payment column is not yet
 * in the schema cache (migration pending), falls back to updating only the core
 * columns (status, delivery_status, updated_at) so orders are never left in a
 * broken state while the schema is being migrated.
 */
async function updateOrder(orderId, updates) {
  const { data, error } = await db
    .from("orders")
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq("id", orderId)
    .single();

  if (error) {
    // Detect schema-cache errors for refund/payment columns not yet migrated
    const isSchemaMiss = error.message && (
      error.message.includes("refund_status") ||
      error.message.includes("refund_id") ||
      error.message.includes("total_refunded_amount") ||
      error.message.includes("payment_status") ||
      error.message.includes("customer_email") ||
      error.message.includes("schema cache")
    );

    if (isSchemaMiss) {
      logger.warn(`[RefundRepository] Schema cache miss for updateOrder on ${orderId} — retrying with core fields only. Error: ${error.message}`);

      // Retry with only the columns guaranteed to exist in the schema
      const safeFields = ["status", "delivery_status", "cancel_reason", "cancelled_by", "cancelled_at",
        "razorpay_order_id", "razorpay_payment_id", "payment_method", "transaction_id",
        "whatsapp_sent", "rating", "review_text", "expected_delivery_date", "delivery_days_text"];

      const safeUpdate = { updated_at: new Date().toISOString() };
      for (const key of safeFields) {
        if (key in updates) safeUpdate[key] = updates[key];
      }

      const { data: fallbackData, error: fallbackError } = await db
        .from("orders")
        .update(safeUpdate)
        .eq("id", orderId)
        .single();

      if (fallbackError) {
        logger.error(`[RefundRepository] updateOrder fallback also failed for ${orderId}: ${fallbackError.message}`);
        throw fallbackError;
      }

      logger.warn(`[RefundRepository] updateOrder completed with core fields only for ${orderId}. Run DB migration to persist refund columns.`);
      return fallbackData;
    }

    logger.error(`[RefundRepository] updateOrder error for ${orderId}: ${error.message}`);
    throw error;
  }
  return data;
}

/**
 * Find refund by ID
 */
async function findRefundById(refundId) {
  const { data, error } = await db
    .from("refunds")
    .select("*")
    .eq("id", refundId)
    .single();

  if (error && error.message !== "No rows found") {
    logger.error(`[RefundRepository] findRefundById error for ${refundId}: ${error.message}`);
  }
  return data;
}

/**
 * Find all refunds by Order ID
 */
async function findRefundsByOrderId(orderId) {
  const { data, error } = await db
    .from("refunds")
    .select("*")
    .eq("order_id", orderId);

  if (error) {
    logger.error(`[RefundRepository] findRefundsByOrderId error for ${orderId}: ${error.message}`);
    throw error;
  }
  return data || [];
}

/**
 * Find refund by Razorpay Refund ID
 */
async function findRefundByRazorpayRefundId(rzpRefundId) {
  const { data, error } = await db
    .from("refunds")
    .select("*")
    .eq("razorpay_refund_id", rzpRefundId)
    .single();

  if (error && error.message !== "No rows found") {
    logger.error(`[RefundRepository] findRefundByRazorpayRefundId error for ${rzpRefundId}: ${error.message}`);
  }
  return data;
}

/**
 * Create a new refund record
 */
async function createRefund(refundData) {
  const { data, error } = await db
    .from("refunds")
    .insert({
      ...refundData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .single();

  if (error) {
    logger.error(`[RefundRepository] createRefund error: ${error.message}`);
    throw error;
  }
  return data;
}

/**
 * Update an existing refund record
 */
async function updateRefund(refundId, updates) {
  const { data, error } = await db
    .from("refunds")
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq("id", refundId)
    .single();

  if (error) {
    logger.error(`[RefundRepository] updateRefund error for ${refundId}: ${error.message}`);
    throw error;
  }
  return data;
}

/**
 * List all refunds in the system, descending by creation date
 */
async function listAllRefunds() {
  const { data, error } = await db
    .from("refunds")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error(`[RefundRepository] listAllRefunds error: ${error.message}`);
    throw error;
  }
  return data || [];
}

/**
 * List audit logs for a specific order or all orders if orderId is null
 */
async function listAuditLogs(orderId = null) {
  let query = db.from("refund_audits").select("*");
  if (orderId) {
    query = query.eq("order_id", orderId);
  }
  const { data, error } = await query.order("timestamp", { ascending: false });

  if (error) {
    logger.error(`[RefundRepository] listAuditLogs error: ${error.message}`);
    throw error;
  }
  return data || [];
}

/**
 * Search for orders that are stuck in 'pending' but might have captured payments in Razorpay.
 * Typically orders created in the last 2 hours.
 */
async function findPotentialOrphanedOrders() {
  const cutoffTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  
  // Fetch orders created in the last 2 hours that are in 'pending' status
  // and have a razorpay_order_id
  const { data, error } = await db
    .from("orders")
    .select("*")
    .eq("status", "pending")
    .gt("created_at", cutoffTime);

  if (error) {
    logger.error(`[RefundRepository] findPotentialOrphanedOrders error: ${error.message}`);
    throw error;
  }

  // Filter for those that actually have a razorpay_order_id
  return (data || []).filter(o => o.razorpay_order_id);
}

module.exports = {
  findOrderById,
  updateOrder,
  findRefundById,
  findRefundsByOrderId,
  findRefundByRazorpayRefundId,
  createRefund,
  updateRefund,
  listAllRefunds,
  listAuditLogs,
  findPotentialOrphanedOrders
};
