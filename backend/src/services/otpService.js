const db = require("../config/db");
const logger = require("../utils/logger");

const OTP_EXPIRY_MINUTES = 10;

async function sendCodOtp(orderId, phone) {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { error } = await db.from("cod_otps").insert({
      order_id: orderId,
      phone,
      otp,
      expires_at: expiresAt,
      used: false,
    });
    if (error) return { error: { message: error.message } };

    logger.info(`[OtpService] OTP ${otp} sent for order ${orderId} to ${phone}`);
    return { data: { message: "OTP sent successfully", expires_at: expiresAt } };
  } catch (err) {
    return { error: { message: err.message } };
  }
}

async function verifyCodOtp(orderId, otp) {
  try {
    const { data: record } = await db.from("cod_otps")
      .select("*")
      .eq("order_id", orderId)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!record) return { error: { message: "No OTP found for this order" } };
    if (new Date(record.expires_at) < new Date()) return { error: { message: "OTP has expired" } };
    if (record.otp !== otp) return { error: { message: "Invalid OTP" } };

    await db.from("cod_otps").update({ used: true }).eq("id", record.id);
    return { verified: true, message: "OTP verified successfully" };
  } catch (err) {
    return { error: { message: err.message } };
  }
}

module.exports = { sendCodOtp, verifyCodOtp };
