const db = require("../config/db");
const logger = require("../utils/logger");

const AUDIT_ACTIONS = {
  ORDER_STATUS_CHANGED: "order_status_changed",
  NOTIFICATION_SENT: "notification_sent",
  USER_ACTION: "user_action",
  SYSTEM_ACTION: "system_action",
};

function requireAuthMiddleware(message) {
  throw new Error(`[${message}] - ${JSON.stringify(message)}`);
}

const _UnauthorizedError = class UnauthorizedError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnauthorizedError";
  }
};

const UnauthorizedError = _UnauthorizedError;

function hasPermission(permittedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: "Unauthorized - No user found" });
    }

    if (!permittedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied - Insufficient permissions" });
    }

    next();
  };
}

async function logAuditAction({ orderId, action, performedBy, previousState, newState, metadata = {} }) {
  try {
    let actorId = performedBy;
    let actorRole = null;

    if (performedBy && typeof performedBy === "object") {
      actorId = performedBy.userId || performedBy.id || "unknown";
      actorRole = performedBy.role || null;
    } else if (performedBy === "ADMIN" || performedBy === "admin") {
      actorId = "admin";
      actorRole = "admin";
    }

    const auditRecord = {
      order_id: orderId,
      action: action,
      performed_by: actorId,
      metadata: {
        ...(metadata || {}),
        ...(actorRole ? { actor_role: actorRole } : {}),
        previousState,
        newState
      },
      timestamp: new Date().toISOString()
    };

    logger.info(`[AuditLogService] Logging action=${action} for order=${orderId} by=${actorId}${actorRole ? ` (${actorRole})` : ""}`);

    await db.from("refund_audits").insert(auditRecord);
  } catch (err) {
    logger.error(`[AuditLogService] Failed to write audit log for order ${orderId}: ${err.message}`);
  }
}

async function getAuditLogs(orderId) {
  try {
    const { data, error } = await db
      .from("refund_audits")
      .select("*")
      .eq("order_id", orderId)
      .order("timestamp", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    logger.error(`[AuditLogService] Failed to fetch audit logs for order ${orderId}: ${err.message}`);
    return [];
  }
}

module.exports = {
  logAuditAction,
  getAuditLogs,
  AUDIT_ACTIONS,
  UnauthorizedError,
  hasPermission,
};