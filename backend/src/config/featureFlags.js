module.exports = {
  ENABLE_NEW_STATE_MACHINE: process.env.FF_NEW_STATE_MACHINE === "true",
  SELF_CANCEL_WINDOW: process.env.FF_SELF_CANCEL_WINDOW === "true",
  INVENTORY_SERVICE: process.env.FF_INVENTORY_SERVICE === "true",
  ENFORCE_FORWARD_ONLY: process.env.FF_ENFORCE_FORWARD_ONLY === "true",
  NOTIFICATION_TRIGGERS: process.env.FF_NOTIFICATION_TRIGGERS === "true",
  GUEST_CHECKOUT: process.env.FF_GUEST_CHECKOUT === "true",

  // Concurrency control (Phase 9) — opt-in via env vars
  ENABLE_QUEUE: process.env.FF_ENABLE_QUEUE === "true",
  ENABLE_TRANSACTIONS: process.env.FF_ENABLE_TRANSACTIONS === "true",
  ENABLE_OPTIMISTIC_LOCKING: process.env.FF_ENABLE_OPTIMISTIC_LOCKING === "true",
};
