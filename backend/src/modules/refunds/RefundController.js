const express = require("express");
const authMiddleware = require("../../middleware/auth");
const { validateBody } = require("../../middleware/validate");
const { success, error: respondError } = require("../../lib/response");
const { sendSseEvent } = require("../../lib/sse");
const service = require("./RefundService");
const repo = require("./RefundRepository");
const validator = require("./RefundValidator");
const { handleWebhookRequest } = require("./RefundWebhookHandler");
const db = require("../../config/db");
const logger = require("../../utils/logger");

const router = express.Router();

/**
 * Public Webhook Endpoint (does not require JWT auth)
 * Razorpay posts events here. Must use raw body parsing.
 */
router.post("/webhook", express.raw({ type: "application/json" }), handleWebhookRequest);

// Enforce authentication on all following routes
router.use(authMiddleware);

// Helper helper to enforce admin role
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return respondError(res, "Access denied. Admins only.", 403);
  }
  next();
}

/**
 * Admin: Approve cancellation request and trigger gateway refund
 */
router.post(
  "/cancel-requests/:id/approve",
  requireAdmin,
  validateBody(validator.adminApproveRejectSchema),
  async (req, res) => {
    try {
      const { adminNote, refundType } = req.body;
      const result = await service.approveCancellation(req.params.id, adminNote, req.user, refundType || 'auto');
      try {
        sendSseEvent(
          "order:updated",
          { order: result.order, refund: result.refund },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === result.order.user_id),
        );
      } catch (_) { /* ignore SSE errors */ }
      return success(res, {
        message: "Cancellation request approved. Refund initiated.",
        order: result.order,
        refund: result.refund
      });
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

/**
 * Admin: Reject cancellation request
 */
router.post(
  "/cancel-requests/:id/reject",
  requireAdmin,
  validateBody(validator.adminApproveRejectSchema),
  async (req, res) => {
    try {
      const { reason } = req.body;
      const updatedOrder = await service.rejectCancellation(req.params.id, reason, req.user);
      try {
        sendSseEvent(
          "order:updated",
          { order: updatedOrder },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === updatedOrder.user_id),
        );
      } catch (_) { /* ignore SSE errors */ }
      return success(res, {
        message: "Cancellation request rejected. Order reverted to processing.",
        order: updatedOrder
      });
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

/**
 * Admin: Cancel order directly and initiate refund automatically
 */
router.post(
  "/admin-cancel/:id",
  requireAdmin,
  validateBody(validator.adminCancelSchema),
  async (req, res) => {
    try {
      const { reason, adminNote } = req.body;
      const result = await service.adminDirectCancellation(req.params.id, reason, adminNote, req.user);
      try {
        sendSseEvent(
          "order:updated",
          { order: result.order, refund: result.refund },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === result.order.user_id),
        );
      } catch (_) { /* ignore SSE errors */ }
      return success(res, {
        message: "Order cancelled by admin. Refund initiated.",
        order: result.order,
        refund: result.refund
      });
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

/**
 * Admin: Initiate manual partial refund
 */
router.post(
  "/partial-refund/:id",
  requireAdmin,
  validateBody(validator.partialRefundSchema),
  async (req, res) => {
    try {
      const { refundAmount, reason, adminNote } = req.body;
      const result = await service.initiatePartialRefund(req.params.id, refundAmount, reason, adminNote, req.user);
      try {
        sendSseEvent(
          "order:updated",
          { order: result.order, refund: result.refund },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === result.order.user_id),
        );
      } catch (_) { /* ignore SSE errors */ }
      return success(res, {
        message: `Partial refund of ₹${refundAmount} initiated successfully.`,
        order: result.order,
        refund: result.refund
      });
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

/**
 * Admin: Retry a failed refund
 */
router.post(
  "/retry/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await service.retryFailedRefund(req.params.id);
      try {
        sendSseEvent(
          "order:updated",
          { order: result.order, refund: result.refund },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === result.order.user_id),
        );
      } catch (_) { /* ignore SSE errors */ }
      return success(res, {
        message: "Refund retry initiated successfully.",
        order: result.order,
        refund: result.refund
      });
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

/**
 * Admin: Initiate manual refund (bypass gateway)
 */
router.post(
  "/manual-refund/:id/initiate",
  requireAdmin,
  validateBody(validator.manualRefundSchema),
  async (req, res) => {
    try {
      const { paymentMode, paymentDetails, adminNote } = req.body;
      const result = await service.manualRefundInitiate(req.params.id, paymentMode, paymentDetails, adminNote, req.user);
      try {
        sendSseEvent(
          "order:updated",
          { order: result.order, refund: result.refund },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === result.order.user_id),
        );
      } catch (_) { /* ignore SSE errors */ }
      return success(res, {
        message: "Manual refund initiated. Complete the refund offline and confirm completion.",
        order: result.order,
        refund: result.refund
      });
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

/**
 * Admin: Complete manual refund
 */
router.post(
  "/manual-refund/:id/complete",
  requireAdmin,
  validateBody(validator.manualRefundSchema),
  async (req, res) => {
    try {
      const { adminNote } = req.body;
      const updatedOrder = await service.manualRefundComplete(req.params.id, adminNote, req.user);
      try {
        sendSseEvent(
          "order:updated",
          { order: updatedOrder },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === updatedOrder.user_id),
        );
      } catch (_) { /* ignore SSE errors */ }
      return success(res, {
        message: "Manual refund completed successfully.",
        order: updatedOrder
      });
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

/**
 * Admin: Get Refund Dashboard Statistics & List (Queue)
 */
router.get(
  "/dashboard",
  requireAdmin,
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const { status, search } = req.query;

      const result = await repo.listAllRefunds(page, limit);
      let refunds = result.data;
      const totalCount = result.total;

      // If filtering, fetch all (or more) for accurate filtered results
      if (status || search) {
        // For filtered views, fetch up to 1000 records
        const allResult = await repo.listAllRefunds(1, 1000);
        refunds = allResult.data;
      }

      const { data: users } = await db.from("users").select("id, email, full_name");
      const { data: orders } = await db.from("orders").select("id, total, status, delivery_status");

      // Enrich refunds with order details & user details
      const userMap = {};
      (users || []).forEach(u => {
        userMap[u.id] = { email: u.email, name: u.full_name };
      });

      const orderMap = {};
      (orders || []).forEach(o => {
        orderMap[o.id] = o;
      });

      const enrichedRefunds = refunds.map(r => {
        const user = r.user_id ? (userMap[r.user_id] || { email: "N/A", name: "Deleted User" }) : { email: "N/A", name: "Deleted User" };
        const order = orderMap[r.order_id] || { total: r.amount || r.refund_amount, status: "unknown" };
        return {
          ...r,
          refund_status: r.status || r.refund_status,
          refund_amount: r.amount || r.refund_amount,
          user_email: user.email,
          user_name: user.name,
          order_total: order.total,
          order_status: order.status,
          order_delivery_status: order.delivery_status
        };
      });

      // Apply filters
      let filtered = enrichedRefunds;
      if (status) {
        filtered = filtered.filter(r => r.refund_status === status);
      }
      if (search) {
        const term = search.toLowerCase().trim();
        filtered = filtered.filter(r => 
          r.order_id.toLowerCase().includes(term) ||
          r.razorpay_payment_id.toLowerCase().includes(term) ||
          (r.razorpay_refund_id && r.razorpay_refund_id.toLowerCase().includes(term)) ||
          r.user_email.toLowerCase().includes(term) ||
          r.user_name.toLowerCase().includes(term)
        );
      }

      // Compute statistics from all matching records
      const { data: allRefunds } = await db.from("refunds").select("*");
      const allRefundList = allRefunds || [];
      const stats = {
        totalRefunded: allRefundList.filter(r => r.status === "processed").reduce((acc, r) => acc + Number(r.amount || 0), 0),
        pendingCount: allRefundList.filter(r => r.status === "initiated" || r.status === "pending").length,
        failedCount: allRefundList.filter(r => r.status === "failed").length,
        totalCount: totalCount
      };

      return success(res, {
        refunds: filtered,
        stats,
        pagination: { page, limit, total: totalCount }
      });
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

/**
 * Admin: Get Audit Trail Logs
 */
router.get(
  "/audit-logs",
  requireAdmin,
  async (req, res) => {
    try {
      const logs = await repo.listAuditLogs(req.query.orderId || null);
      return success(res, logs);
    } catch (err) {
      return respondError(res, err.message, 500);
    }
  }
);

module.exports = router;
