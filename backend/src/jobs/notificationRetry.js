const db = require("../config/db");
const logger = require("../utils/logger");
const { notify } = require("../services/notificationService");

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MINUTES = [1, 5, 15];

async function runNotificationRetry() {
  try {
    const now = new Date();
    const { data: failed } = await db.from("notification_log")
      .select("*")
      .eq("status", "failed")
      .then();

    if (!failed || failed.length === 0) {
      logger.debug("[NotificationRetry] No failed notifications to retry");
      return;
    }

    let retriedCount = 0;

    for (const log of failed) {
      const attempt = (log.attempts || log.retries || 0) + 1;
      if (attempt > MAX_RETRIES) {
        await db.from("notification_log")
          .update({ status: "permanent_failure", attempts: attempt })
          .eq("id", log.id)
          .then();
        continue;
      }

      const backoffMs = (RETRY_BACKOFF_MINUTES[attempt - 1] || 15) * 60 * 1000;
      const lastAttemptAt = log.sent_at || log.created_at;
      if (lastAttemptAt && (new Date(lastAttemptAt).getTime() + backoffMs) > now.getTime()) {
        continue;
      }

      const context = {
        orderId: log.order_id,
        userId: log.user_id,
        email: log.recipient,
        phone: log.recipient,
        name: "",
        amount: 0,
        order: null,
        user: null,
        metadata: {},
        date: "",
      };

      try {
        await notify(log.event_type, context);
        await db.from("notification_log")
          .update({ status: "sent", sent_at: now.toISOString(), attempts: attempt })
          .eq("id", log.id)
          .then();
      } catch {
        await db.from("notification_log")
          .update({ attempts: attempt, sent_at: now.toISOString() })
          .eq("id", log.id)
          .then();
      }

      retriedCount++;
    }

    if (retriedCount > 0) {
      logger.info(`[NotificationRetry] Retried ${retriedCount} failed notifications`);
    }
  } catch (err) {
    logger.error(`[NotificationRetry] Error: ${err.message}`);
  }
}

module.exports = { runNotificationRetry };
