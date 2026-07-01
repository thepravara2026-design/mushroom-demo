const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { success, error: respondError } = require("../lib/response");

const FUNNEL_STAGES = ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'];

router.get("/health", (req, res) => res.json({ status: "ok" }));

/**
 * GET /api/analytics/dashboard
 * Returns aggregate metrics: totalOrders, totalRevenue, averageOrderValue,
 * conversionRate, totalPageViews, abandonmentRate, abandonedCarts,
 * recoveredCarts, cancellationRate, returnRate
 */
router.get("/dashboard", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { data: events } = await db.from("analytics_events").select("*");

    let filtered = filterEvents(events, startDate, endDate);

    const pageViews = filtered.filter(e => e.event_type === 'page_view').length;
    const addToCarts = filtered.filter(e => e.event_type === 'add_to_cart').length;
    const beginCheckouts = filtered.filter(e => e.event_type === 'begin_checkout').length;
    const purchases = filtered.filter(e => e.event_type === 'purchase').length;
    const cancellations = filtered.filter(e => e.event_type === 'cancellation').length;

    const purchaseEvents = filtered.filter(e => e.event_type === 'purchase');
    const totalRevenue = purchaseEvents.reduce((sum, e) => sum + (e.metadata?.total || 0), 0);

    const uniqueSessions = new Set(filtered.map(e => e.session_id)).size;

    const totalOrders = purchases;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const conversionRate = pageViews > 0 ? (purchases / pageViews) * 100 : 0;
    const abandonmentRate = beginCheckouts > 0 ? ((beginCheckouts - purchases) / beginCheckouts) * 100 : 0;

    // Recovered carts: sessions that began checkout and purchased
    const checkoutSessions = new Set(filtered.filter(e => e.event_type === 'begin_checkout').map(e => e.session_id));
    const purchasedSessions = new Set(filtered.filter(e => e.event_type === 'purchase').map(e => e.session_id));
    const recoveredCarts = [...purchasedSessions].filter(s => checkoutSessions.has(s)).length;
    const abandonedCarts = checkoutSessions.size - recoveredCarts;

    const cancellationRate = totalOrders > 0 ? (cancellations / totalOrders) * 100 : 0;
    const returnRate = 0; // returns not tracked in analytics events

    return success(res, {
      totalOrders,
      totalRevenue,
      averageOrderValue,
      conversionRate,
      totalPageViews: pageViews,
      abandonmentRate,
      abandonedCarts,
      recoveredCarts,
      cancellationRate,
      returnRate,
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to load dashboard analytics", 500);
  }
});

/**
 * GET /api/analytics/funnel
 * Returns funnel stages and drop-off rates between consecutive stages.
 */
router.get("/funnel", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { data: events } = await db.from("analytics_events").select("*");

    let filtered = filterEvents(events, startDate, endDate);

    // Count unique sessions per stage (a session reaches a stage)
    const stageSessionMap = {};
    for (const stage of FUNNEL_STAGES) {
      const sessions = new Set(filtered.filter(e => e.event_type === stage).map(e => e.session_id));
      stageSessionMap[stage] = sessions;
    }

    // Build stages array for the funnel visualization
    const stages = FUNNEL_STAGES.map(stage => ({
      stage,
      count: stageSessionMap[stage]?.size || 0,
    }));

    // Build drop-off rates between consecutive stages
    const dropOffRates = [];
    for (let i = 0; i < FUNNEL_STAGES.length - 1; i++) {
      const from = FUNNEL_STAGES[i];
      const to = FUNNEL_STAGES[i + 1];
      const entered = stageSessionMap[from]?.size || 0;
      const converted = stageSessionMap[to]?.size || 0;
      const dropOffRate = entered > 0 ? Math.round(((entered - converted) / entered) * 100 * 10) / 10 : 0;
      dropOffRates.push({ from, to, entered, converted, dropOffRate });
    }

    return success(res, { stages, dropOffRates });
  } catch (err) {
    return respondError(res, err.message || "Failed to load funnel analytics", 500);
  }
});

/**
 * GET /api/analytics/recovery
 * Returns abandoned cart and recovery counts.
 */
router.get("/recovery", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { data: events } = await db.from("analytics_events").select("*");

    let filtered = filterEvents(events, startDate, endDate);

    const checkoutSessions = new Set(filtered.filter(e => e.event_type === 'begin_checkout').map(e => e.session_id));
    const purchasedSessions = new Set(filtered.filter(e => e.event_type === 'purchase').map(e => e.session_id));
    const recoveredSessions = [...purchasedSessions].filter(s => checkoutSessions.has(s));
    const recovered = recoveredSessions.length;
    const abandoned = checkoutSessions.size - recovered;

    return success(res, { abandoned, recovered });
  } catch (err) {
    return respondError(res, err.message || "Failed to load recovery data", 500);
  }
});

/**
 * GET /api/analytics/events
 * Returns raw analytics events, most recent first.
 */
router.get("/events", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { data: events } = await db.from("analytics_events").select("*");

    let filtered = filterEvents(events, startDate, endDate);

    // Sort by created_at descending, most recent first
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return success(res, { events: filtered });
  } catch (err) {
    return respondError(res, err.message || "Failed to load events", 500);
  }
});

/**
 * GET /api/analytics/top-products
 * Returns top-selling products by quantity and revenue.
 */
router.get("/top-products", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { data: events } = await db.from("analytics_events").select("*");

    let filtered = filterEvents(events, startDate, endDate);

    // Aggregate product data from purchase event metadata
    const productMap = {};
    const purchaseEvents = filtered.filter(e => e.event_type === 'purchase');
    for (const ev of purchaseEvents) {
      const items = ev.metadata?.items || ev.metadata?.products || [];
      for (const item of items) {
        const key = item.productId || item.product_id;
        if (!key) continue;
        if (!productMap[key]) {
          productMap[key] = { name: item.name || key, quantity: 0, revenue: 0 };
        }
        productMap[key].quantity += item.quantity || 1;
        productMap[key].revenue += item.total || (item.price * (item.quantity || 1));
      }
    }

    // Also aggregate from add_to_cart events
    const addToCartEvents = filtered.filter(e => e.event_type === 'add_to_cart');
    for (const ev of addToCartEvents) {
      const prodId = ev.metadata?.productId;
      if (!prodId || productMap[prodId]) continue;
      if (!productMap[prodId]) {
        productMap[prodId] = { name: prodId, quantity: ev.metadata?.quantity || 0, revenue: 0 };
      }
    }

    const products = Object.entries(productMap)
      .map(([productId, data]) => ({ productId, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return success(res, { products });
  } catch (err) {
    return respondError(res, err.message || "Failed to load top products", 500);
  }
});

/**
 * Filter events by optional startDate / endDate (YYYY-MM-DD)
 */
function filterEvents(events, startDate, endDate) {
  if (!events) return [];
  let filtered = events;
  if (startDate) {
    const start = new Date(startDate);
    filtered = filtered.filter(e => new Date(e.created_at) >= start);
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    filtered = filtered.filter(e => new Date(e.created_at) <= end);
  }
  return filtered;
}

module.exports = router;
