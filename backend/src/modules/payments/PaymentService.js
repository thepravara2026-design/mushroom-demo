const crypto = require("crypto");
const razorpay = require("../../config/razorpay");
const logger = require("../../utils/logger");

/**
 * Generates a deterministic UUID-style idempotency key based on transaction details.
 * @param {string} orderId 
 * @param {string} paymentId 
 * @param {number} amount 
 * @returns {string} UUIDv4 format compatible string
 */
function generateRefundIdempotencyKey(orderId, paymentId, amount) {
  const input = `${orderId}:${paymentId}:${Number(amount).toFixed(2)}`;
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  
  // Format as a UUID (8-4-4-4-12)
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    hash.substring(12, 16),
    hash.substring(16, 20),
    hash.substring(20, 32)
  ].join("-");
}

/**
 * Call Razorpay Refund API with idempotency and robust error handling.
 * @param {string} paymentId 
 * @param {number} amountInPaise 
 * @param {string} idempotencyKey 
 * @param {object} notes 
 * @returns {Promise<object>} Refund response entity
 */
async function initiateRazorpayRefund(paymentId, amountInPaise, idempotencyKey, notes = {}) {
  try {
    logger.info(`[PaymentService] Initiating refund for payment ${paymentId}, amount=${amountInPaise} paise, idempotencyKey=${idempotencyKey}`);

    const options = {
      amount: amountInPaise,
      speed: "normal",
      notes: notes,
      headers: {
        "X-Refund-Idempotency": idempotencyKey
      }
    };

    // If using the mock client, it will intercept this correctly
    const result = await razorpay.payments.refund(paymentId, options);
    return result;
  } catch (err) {
    logger.error(`[PaymentService] Razorpay refund error for payment ${paymentId}: ${err.message}`);
    throw err;
  }
}

/**
 * Verifies Razorpay Webhook Signatures securely.
 * @param {Buffer|string} body Raw body text
 * @param {string} signature Razorpay header signature
 * @param {string} secret Webhook secret key
 * @returns {boolean}
 */
function verifyWebhookSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");
    return expected === signature;
  } catch (err) {
    logger.error(`[PaymentService] Webhook signature verification error: ${err.message}`);
    return false;
  }
}

module.exports = {
  generateRefundIdempotencyKey,
  initiateRazorpayRefund,
  verifyWebhookSignature
};
