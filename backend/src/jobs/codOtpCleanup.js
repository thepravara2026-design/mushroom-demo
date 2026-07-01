const db = require("../config/db");
const logger = require("../utils/logger");

async function runCodOtpCleanup() {
  try {
    const now = new Date().toISOString();
    const { data: expired } = await db.from("order_cod_otps")
      .select("*")
      .eq("verified", false)
      .lt("expires_at", now)
      .then();

    if (!expired || expired.length === 0) {
      logger.debug("[CodOtpCleanup] No expired OTPs found");
      return;
    }

    await db.from("order_cod_otps")
      .delete()
      .eq("verified", false)
      .lt("expires_at", now)
      .then();

    logger.info(`[CodOtpCleanup] Cleaned ${expired.length} expired COD OTPs`);
  } catch (err) {
    logger.error(`[CodOtpCleanup] Error: ${err.message}`);
  }
}

module.exports = { runCodOtpCleanup };
