const db = require("../config/db");
const logger = require("../utils/logger");
const { notify } = require("../services/notificationService");

const TRIGGER_SCHEDULE = [
  { number: 1, eventType: "cart.abandoned.1hr", delayMs: 60 * 60 * 1000 },
  { number: 2, eventType: "cart.abandoned.12hr", delayMs: 12 * 60 * 60 * 1000 },
  { number: 3, eventType: "cart.abandoned.24hr", delayMs: 24 * 60 * 60 * 1000 },
];

async function runAbandonmentCron() {
  try {
    const now = new Date();
    const { data: carts } = await db.from("abandoned_carts")
      .select("*")
      .eq("status", "active")
      .then();

    if (!carts || carts.length === 0) return;

    const { data: existingTriggers } = await db.from("abandonment_triggers").select("*").then();
    const triggeredMap = new Map();
    if (existingTriggers) {
      for (const t of existingTriggers) {
        if (!triggeredMap.has(t.cart_id)) triggeredMap.set(t.cart_id, new Set());
        triggeredMap.get(t.cart_id).add(t.trigger_number);
      }
    }

    let triggeredCount = 0;

    for (const cart of carts) {
      if (cart.expired_at && new Date(cart.expired_at) <= now) continue;

      const cartCreatedAt = new Date(cart.created_at);
      const elapsed = now.getTime() - cartCreatedAt.getTime();
      const sent = triggeredMap.get(cart.id) || new Set();

      for (const trigger of TRIGGER_SCHEDULE) {
        if (sent.has(trigger.number)) continue;
        if (elapsed < trigger.delayMs) continue;

        const channel = trigger.eventType.includes("whatsapp") ? "whatsapp"
          : trigger.eventType.includes("email") && trigger.eventType.includes("sms") ? "email,sms"
          : trigger.eventType.includes("email") ? "email"
          : "whatsapp";

        const context = {
          orderId: null,
          userId: cart.user_id,
          email: cart.email,
          phone: cart.phone,
          name: "",
          amount: cart.cart_total || 0,
          order: null,
          user: null,
          metadata: { cart_id: cart.id, cart_data: cart.cart_data, cart_total: cart.cart_total },
          date: cartCreatedAt.toLocaleDateString("en-IN"),
        };

        try {
          await notify(trigger.eventType.toUpperCase().replace(/\./g, "_"), context);
        } catch {
          // notify is fire-and-forget, swallow individual failures
        }

        await db.from("abandonment_triggers").insert({
          cart_id: cart.id,
          trigger_number: trigger.number,
          channel,
        }).then();

        const updateFields = {};
        if (trigger.number === 1) updateFields.first_trigger_at = now.toISOString();
        else if (trigger.number === 2) updateFields.second_trigger_at = now.toISOString();
        else if (trigger.number === 3) updateFields.third_trigger_at = now.toISOString();

        if (Object.keys(updateFields).length > 0) {
          await db.from("abandoned_carts").update(updateFields).eq("id", cart.id).then();
        }

        triggeredCount++;
      }
    }

    if (triggeredCount > 0) {
      logger.info(`[AbandonmentCron] Sent ${triggeredCount} abandonment triggers`);
    }
  } catch (err) {
    logger.error(`[AbandonmentCron] Error: ${err.message}`);
  }
}

module.exports = { runAbandonmentCron };
