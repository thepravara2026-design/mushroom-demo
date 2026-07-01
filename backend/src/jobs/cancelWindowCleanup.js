const { closeExpiredWindows } = require("../modules/orders/OrderStateService");
const logger = require("../utils/logger");

async function runCancelWindowCleanup() {
  try {
    const result = await closeExpiredWindows();
    if (result.closed > 0) {
      logger.info(`[CancelWindowCleanup] Closed ${result.closed} expired cancellation windows`);
    }
  } catch (err) {
    logger.error(`[CancelWindowCleanup] Error: ${err.message}`);
  }
}

module.exports = { runCancelWindowCleanup };
