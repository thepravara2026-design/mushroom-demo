const db = require("../config/db");
const logger = require("../utils/logger");

const AUDIT_ACTIONS = {
  ORDER_CREATED:           'ORDER_CREATED',
  ORDER_APPROVED:          'ORDER_APPROVED',
  ORDER_REJECTED:          'ORDER_REJECTED',
  STATUS_CHANGED:          'STATUS_CHANGED',
  CANCEL_REQUESTED:        'CANCEL_REQUESTED',
  CANCEL_APPROVED:         'CANCEL_APPROVED',
  CANCEL_REJECTED:         'CANCEL_REJECTED',
  REFUND_INITIATED:        'REFUND_INITIATED',
  REFUND_COMPLETED:        'REFUND_COMPLETED',
  REFUND_FAILED:           'REFUND_FAILED',
  MANUAL_REFUND_INITIATED: 'MANUAL_REFUND_INITIATED',
  MANUAL_REFUND_COMPLETED: 'MANUAL_REFUND_COMPLETED',
  NOTIFICATION_SENT:       'NOTIFICATION_SENT',
};

/**
 * Write an immutable audit log entry for an order action.
 * Logs are INSERT-only — no UPDATE or DELETE endpoints exist.
 *
 * @param {object} params
 * @param {string|number} params.orderId
 * @param {string} params.action          — One of AUDIT_ACTIONS
 * @param {string|object} params.performedBy — user id string, or req.user object
 * @param {object} [params.previousState] — snapshot before the change
 * @param {object} [params.newState]      — snapshot after the change
 * @param {object} [params.metadata]      — reason, notes, refund_id, etc.
 */
async function logAuditAction({ orderId, action, performedBy, previousState = null, newState = null, metadata = {} }) {
  try {
    let actorId = performedBy;
    let actorRole = null;
    if (performedBy && typeof performedBy === 'object') {
      actorId = performedBy.userId || performedBy.id || 'unknown';
      actorRole = performedBy.role || null;
    } else if (performedBy === 'SYSTEM' || performedBy === 'system') {
      actorId = 'system';
    } else if (performedBy === 'ADMIN' || performedBy === 'admin') {
      actorId = 'admin';
      actorRole = 'admin';
    }

    const record = {
      order_id: String(orderId),
      action,
      performed_by: String(actorId),
      previous_state: previousState ? JSON.parse(JSON.stringify(previousState)) : null,
      new_state: newState ? JSON.parse(JSON.stringify(newState)) : null,
      metadata: {
        ...metadata,
        ...(actorRole ? { actor_role: actorRole } : {}),
      },
    };

    logger.info(`[AuditLogService] action=${action} order=${orderId} by=${actorId}`);

    await db.from('order_audit_logs').insert(record);
  } catch (err) {
    logger.error(`[AuditLogService] Failed to write audit log for order ${orderId}: ${err.message}`);
  }
}

/**
 * Fetch audit logs for a specific order (most recent first).
 * @param {string|number} orderId
 * @returns {Promise<Array>}
 */
async function getAuditLogs(orderId) {
  try {
    const { data } = await db
      .from('order_audit_logs')
      .select('*')
      .eq('order_id', String(orderId))
      .order('created_at', { ascending: false });
    return data || [];
  } catch (err) {
    logger.error(`[AuditLogService] Failed to fetch audit logs for order ${orderId}: ${err.message}`);
    return [];
  }
}

module.exports = {
  AUDIT_ACTIONS,
  logAuditAction,
  getAuditLogs,
};
