const db = require("../config/db");
const logger = require("../utils/logger");

async function runReservationCleanup() {
  try {
    const now = new Date().toISOString();
    const { data: expired } = await db.from("inventory_reservations")
      .select("*")
      .eq("status", "active")
      .lt("expires_at", now)
      .then();

    if (!expired || expired.length === 0) {
      logger.debug("[ReservationCleanup] No expired reservations found");
      return;
    }

    let releasedCount = 0;

    for (const reservation of expired) {
      await db.from("inventory_reservations")
        .update({ status: "expired", released_at: now })
        .eq("id", reservation.id)
        .then();

      const { data: product } = await db.from("products")
        .select("reserved_quantity, stock")
        .eq("id", reservation.product_id)
        .single();

      if (product) {
        const newReserved = Math.max(0, (product.reserved_quantity || 0) - reservation.quantity);
        await db.from("products")
          .update({ reserved_quantity: newReserved })
          .eq("id", reservation.product_id)
          .then();

        await db.from("inventory_log").insert({
          product_id: reservation.product_id,
          action: "reservation_expired",
          quantity_change: -reservation.quantity,
          new_stock: product.stock || 0,
          new_reserved: newReserved,
          reference_type: "inventory_reservation",
          reference_id: reservation.id,
        }).then();
      }

      releasedCount++;
    }

    logger.info(`[ReservationCleanup] Released ${releasedCount} expired reservations`);
  } catch (err) {
    logger.error(`[ReservationCleanup] Error: ${err.message}`);
  }
}

module.exports = { runReservationCleanup };
