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
 * Update order fields
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
  findRefundByRazorpayRefundId,
  createRefund,
  updateRefund,
  listAllRefunds,
  listAuditLogs,
  findPotentialOrphanedOrders
};
