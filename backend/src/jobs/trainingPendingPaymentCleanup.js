const db = require("../config/db");
const logger = require("../utils/logger");

const PENDING_PAYMENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function runTrainingPendingPaymentCleanup() {
  try {
    const cutoff = new Date(Date.now() - PENDING_PAYMENT_TIMEOUT_MS).toISOString();

    const { data: staleEnrollments, error } = await db
      .from("training_enrollments")
      .select("id, batch_id, created_at")
      .eq("status", "pending_payment")
      .lt("created_at", cutoff);

    if (error) {
      logger.error(`[TrainingPendingPaymentCleanup] Query error: ${error.message}`);
      return;
    }

    const rows = staleEnrollments || [];
    if (rows.length === 0) return;

    const ids = rows.map(r => r.id);

    await db
      .from("training_enrollments")
      .in("id", ids)
      .update({ status: "failed" });

    logger.info(`[TrainingPendingPaymentCleanup] Expired ${rows.length} stale pending_payment enrollments`);
  } catch (err) {
    logger.error(`[TrainingPendingPaymentCleanup] Error: ${err.message}`);
  }
}

module.exports = { runTrainingPendingPaymentCleanup };
