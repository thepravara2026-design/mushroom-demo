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
    // If performedBy is an object with id/role (from req.user), extract the actual ID
    let actorId = performedBy;
    let actorRole = null;
    if (performedBy && typeof performedBy === "object") {
      actorId = performedBy.userId || performedBy.id || "unknown";
      actorRole = performedBy.role || null;
    } else if (performedBy === "ADMIN" || performedBy === "admin") {
      // Legacy fallback — use 'admin' as actorId with no specific user
      actorId = "admin";
      actorRole = "admin";
    }

    const auditRecord = {
      refund_id: refundId,
      order_id: orderId,
      action: action,
      performed_by: actorId,
      metadata: {
        ...(metadata || {}),
        ...(actorRole ? { actor_role: actorRole } : {})
      },
      timestamp: new Date().toISOString()
    };

    logger.info(`[RefundAuditService] Logging action=${action} for order=${orderId} by=${actorId}${actorRole ? ` (${actorRole})` : ""}`);
    
    await db.from("refund_audits").insert(auditRecord);
  } catch (err) {
    logger.error(`[RefundAuditService] Failed to write audit log for order ${orderId}: ${err.message}`);
    // Do not crash the application if audit logging fails, but log the error prominently
  }
}

module.exports = {
  logRefundAction
};
