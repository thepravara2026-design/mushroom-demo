const db = require("../../config/db");
const logger = require("../../utils/logger");

/**
 * Log a refund/cancellation action to the database audit table.
 * @param {object} params
 * @param {string} [params.refundId]
 * @param {string} params.orderId
 * @param {string} params.action - E.g. 'CANCELLATION_REQUESTED', 'APPROVED', 'REJECTED', 'REFUND_INITIATED', 'REFUND_COMPLETED', 'REFUND_FAILED'
 * @param {string} params.performedBy - User ID or 'SYSTEM' or 'ADMIN'
 * @param {object} [params.metadata] - Extra metadata payload
 */
async function logRefundAction({ refundId = null, orderId, action, performedBy, metadata = {} }) {
  try {
    logger.info(`[RefundAuditService] Logging action=${action} for order=${orderId} by=${performedBy}`);
    
    await db.from("refund_audits").insert({
      refund_id: refundId,
      order_id: orderId,
      action: action,
      performed_by: performedBy,
      metadata: metadata,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error(`[RefundAuditService] Failed to write audit log for order ${orderId}: ${err.message}`);
    // Do not crash the application if audit logging fails, but log the error prominently
  }
}

module.exports = {
  logRefundAction
};
