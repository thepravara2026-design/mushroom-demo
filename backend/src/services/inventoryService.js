const db = require("../config/db");
const logger = require("../utils/logger");
const FEATURE_FLAGS = require("../config/featureFlags");
const { withTransaction, withRowLock } = require("./TransactionManager");

async function restockStock(productId, quantity, source, referenceId) {
  if (FEATURE_FLAGS.ENABLE_TRANSACTIONS && !db.isMock) {
    await withTransaction(async (client) => {
      const locked = await withRowLock(client, "products", productId);
      if (!locked) throw new Error(`Product ${productId} not found`);
      const newStock = (locked.stock || 0) + quantity;
      await client.query(
        `UPDATE products SET stock = $1, version = version + 1, updated_at = $2 WHERE id = $3 AND version = $4`,
        [newStock, new Date().toISOString(), productId, locked.version]
      );
    });
    logger.info(`[InventoryService] Restocked ${productId} +${quantity} (${source}:${referenceId})`);
    return;
  }
  const { data: product } = await db.from("products").select("stock").eq("id", productId).single();
  if (!product) throw new Error(`Product ${productId} not found`);
  const newStock = (product.stock || 0) + quantity;
  await db.from("products").update({ stock: newStock }).eq("id", productId);
  logger.info(`[InventoryService] Restocked ${productId} +${quantity} (${source}:${referenceId})`);
}

async function createReservation({ productId, quantity, userId = null, guestToken = null, orderId = null, expiresInMinutes = 10 }) {
  const { data: product } = await db
    .from("products")
    .select("stock, reserved_quantity")
    .eq("id", productId)
    .single();

  if (!product) throw new Error(`Product ${productId} not found`);

  const currentReserved = Number(product.reserved_quantity || 0);
  const available = Number(product.stock || 0) - currentReserved;
  if (quantity > available) {
    throw new Error(`Insufficient stock for product ${productId}`);
  }

  await db.from("products").update({ reserved_quantity: currentReserved + quantity }).eq("id", productId);

  const { data: reservation, error } = await db
    .from("inventory_reservations")
    .insert({
      product_id: productId,
      user_id: userId,
      guest_token: guestToken,
      quantity,
      status: "active",
      reserved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString(),
      converted_to_order_id: orderId,
    })
    .select()
    .single();

  if (error) throw new Error(error.message || "Failed to create inventory reservation");

  logger.info(`[InventoryService] Reserved ${productId} x${quantity}`);
  return reservation;
}

async function confirmReservation(reservationId, orderId) {
  const { error } = await db.from("inventory_reservations").update({ status: "confirmed", order_id: orderId }).eq("id", reservationId);
  if (error) logger.warn(`[InventoryService] confirmReservation error: ${error.message}`);
}

async function deductStock(productId, quantity, orderId) {
  if (FEATURE_FLAGS.ENABLE_TRANSACTIONS && !db.isMock) {
    await withTransaction(async (client) => {
      const locked = await withRowLock(client, "products", productId);
      if (!locked) throw new Error(`Product ${productId} not found`);
      const newStock = (locked.stock || 0) - quantity;
      if (newStock < 0) throw new Error(`Insufficient stock for product ${productId}`);
      await client.query(
        `UPDATE products SET stock = $1, version = version + 1, updated_at = $2 WHERE id = $3 AND version = $4`,
        [newStock, new Date().toISOString(), productId, locked.version]
      );
    });
    logger.info(`[InventoryService] Deducted ${productId} -${quantity} for order ${orderId}`);
    return;
  }
  const { data: product } = await db.from("products").select("stock").eq("id", productId).single();
  if (!product) throw new Error(`Product ${productId} not found`);
  const newStock = (product.stock || 0) - quantity;
  if (newStock < 0) throw new Error(`Insufficient stock for product ${productId}`);
  await db.from("products").update({ stock: newStock }).eq("id", productId);
  logger.info(`[InventoryService] Deducted ${productId} -${quantity} for order ${orderId}`);
}

module.exports = { restockStock, createReservation, confirmReservation, deductStock };