const logger = require("../utils/logger");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/jwt");

// Map of event names to subscriber callbacks
const subscribers = new Map();
function addSseSubscriber(req, res, user = null) {
  const resId = Math.random().toString(36).substring(2, 9);

  // Set headers for SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");

  // Keep connection alive
  const pingInterval = setInterval(() => {
    try {
      if (res.destroyed || res.writableEnded) {
        clearInterval(pingInterval);
        return;
      }
      res.write(":\n\n");
    } catch (err) {
      logger.warn(`[SSE] Ping failed for subscriber ${resId}: ${err.message}`);
      clearInterval(pingInterval);
    }
  }, 30000);

  const unsubscribe = () => {
    clearInterval(pingInterval);
    try {
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    } catch (e) {
      // ignore
    }
    if (subscribers.has(resId)) {
      subscribers.delete(resId);
    }
  };

  subscribers.set(resId, {
    res,
    unsubscribe,
    user,
    addedAt: new Date(),
    resId,
  });

  logger.info(`[SSE] New subscriber ${resId} added${user ? ` for user ${user.userId}` : " (anonymous)"}`);

  res.on("error", (err) => {
    logger.warn(`[SSE] Response stream error for subscriber ${resId}: ${err.message}`);
    unsubscribe();
  });

  req.on("error", (err) => {
    logger.warn(`[SSE] Request stream error for subscriber ${resId}: ${err.message}`);
    unsubscribe();
  });

  req.on("close", () => {
    unsubscribe();
  });
}
function sendSseEvent(eventName, data, userFilter = null) {
  const event = {
    type: eventName,
    data,
    timestamp: new Date().toISOString(),
  };

  const eventString = `data: ${JSON.stringify(event)}\n\n`;

  // Helper function to broadcast to subscribers
  const broadcast = (sub) => {
    if (!sub || !sub.res || sub.res.destroyed) return false;

    try {
      sub.res.write(eventString);
      logger.debug(`[SSE] Event ${eventName} sent to subscriber ${sub.resId}`);
    } catch (err) {
      // Connection likely closed
      logger.warn(
        `[SSE] Failed to send event to subscriber: ${err.message}`
      );
      sub.unsubscribe();
      return false;
    }
    return true;
  };

  // If userFilter is provided, send only to matching subscribers
  if (userFilter) {
    let matchedCount = 0;
    for (const [resId, sub] of subscribers.entries()) {
      let shouldSend = false;

      if (sub.user) {
        if (typeof userFilter === "function") {
          shouldSend = userFilter(sub);
        }
      } else {
        shouldSend = !userFilter;
      }

      if (shouldSend) {
        broadcast(sub);
        matchedCount++;
      }
    }

    logger.info(
      `[SSE] Event ${eventName} broadcast to ${matchedCount} matching subscribers`
    );
    return matchedCount;
  }

  // If no filter, send to all subscribers
  let sentCount = 0;
  for (const [resId, sub] of subscribers.entries()) {
    if (broadcast(sub)) sentCount++;
  }

  logger.info(
    `[SSE] Event ${eventName} broadcast to all ${sentCount} subscribers`
  );
  return sentCount;
}

module.exports = {
  addSseSubscriber,
  sendSseEvent,
};