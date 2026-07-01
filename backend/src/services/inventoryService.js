const db = require("../config/db");
const logger = require("../utils/logger");

async function restockStock(productId, quantity, source, referenceId) {
  const { data: product } = await db.from("products").select("stock").eq("id", productId).single();
  if (!product) throw new Error(`Product ${productId} not found`);
  const newStock = (product.stock || 0) + quantity;
  await db.from("products").update({ stock: newStock }).eq("id", productId);
  logger.info(`[InventoryService] Restocked ${productId} +${quantity} (${source}:${referenceId})`);
}

async function confirmReservation(reservationId, orderId) {
  const { error } = await db.from("inventory_reservations").update({ status: "confirmed", order_id: orderId }).eq("id", reservationId);
  if (error) logger.warn(`[InventoryService] confirmReservation error: ${error.message}`);
}

async function deductStock(productId, quantity, orderId) {
  const { data: product } = await db.from("products").select("stock").eq("id", productId).single();
  if (!product) throw new Error(`Product ${productId} not found`);
  const newStock = (product.stock || 0) - quantity;
  if (newStock < 0) throw new Error(`Insufficient stock for product ${productId}`);
  await db.from("products").update({ stock: newStock }).eq("id", productId);
  logger.info(`[InventoryService] Deducted ${productId} -${quantity} for order ${orderId}`);
}

module.exports = { restockStock, confirmReservation, deductStock };
