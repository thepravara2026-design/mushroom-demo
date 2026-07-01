const logger = require("../utils/logger");

async function dispatch(eventType, context) {
  logger.info(`[NotificationEngine] Dispatching ${eventType} for order ${context.orderId}`);
}

module.exports = { dispatch };
