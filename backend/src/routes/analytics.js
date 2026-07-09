const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");
const { success, error: respondError } = require("../lib/response");
const logger = require("../utils/logger");

const adminOnly = requireRole("admin");
const FUNNEL_STAGES = ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'];
const MAX_DATE_RANGE_DAYS = 365;
const DEFAULT_DATE_RANGE_DAYS = 90;
const MAX_RECORDS = 10000;

function buildDateFilter(startDate, endDate) {
  const now = new Date();
  let start = startDate ? new Date(startDate) : new Date(now.getTime() - DEFAULT_DATE_RANGE_DAYS * 86400000);
  let end = endDate ? new Date(endDate) : now;
  if (end > now) end = now;
  const rangeDays = (end - start) / 86400000;
  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    start = new Date(end.getTime() - MAX_DATE_RANGE_DAYS * 86400000);
  }
  return { start, end };
}

router.get("/health", (req, res) => res.json({ status: "ok" }));

router.use(authMiddleware, adminOnly);

router.get("/dashboard", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { start, end } = buildDateFilter(startDate, endDate);
    let query = db.from("analytics_events").select("*").gte("created_at", start.toISOString()).lte("created_at", end.toISOString()).range(0, MAX_RECORDS - 1);
    const { data: events } = await query;

    const pageViews = events?.filter(e => e.event_type === 'page_view').length || 0;
    const addToCarts = events?.filter(e => e.event_type === 'add_to_cart').length || 0;
    const beginCheckouts = events?.filter(e => e.event_type === 'begin_checkout').length || 0;
    const purchases = events?.filter(e => e.event_type === 'purchase').length || 0;
    const cancellations = events?.filter(e => e.event_type === 'cancellation').length || 0;

    const purchaseEvents = events?.filter(e => e.event_type === 'purchase') || [];
    const totalRevenue = purchaseEvents.reduce((sum, e) => sum + (e.metadata?.total || 0), 0);

    const uniqueSessions = new Set(events?.map(e => e.session_id) || []).size;

    const totalOrders = purchases;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const conversionRate = pageViews > 0 ? (purchases / pageViews) * 100 : 0;
    const abandonmentRate = beginCheckouts > 0 ? ((beginCheckouts - purchases) / beginCheckouts) * 100 : 0;

    const checkoutSessions = new Set(events?.filter(e => e.event_type === 'begin_checkout').map(e => e.session_id) || []);
    const purchasedSessions = new Set(events?.filter(e => e.event_type === 'purchase').map(e => e.session_id) || []);
    const recoveredCarts = [...purchasedSessions].filter(s => checkoutSessions.has(s)).length;
    const abandonedCarts = checkoutSessions.size - recoveredCarts;

    const cancellationRate = totalOrders > 0 ? (cancellations / totalOrders) * 100 : 0;
    const returnRate = 0;

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
    logger.error("[Analytics] Dashboard error: " + err.message);
    return respondError(res, err.message || "Failed to load dashboard analytics", 500);
  }
});

router.get("/funnel", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { start, end } = buildDateFilter(startDate, endDate);
    let query = db.from("analytics_events").select("*").gte("created_at", start.toISOString()).lte("created_at", end.toISOString()).range(0, MAX_RECORDS - 1);
    const { data: events } = await query;

    const stageSessionMap = {};
    for (const stage of FUNNEL_STAGES) {
      const sessions = new Set(events?.filter(e => e.event_type === stage).map(e => e.session_id) || []);
      stageSessionMap[stage] = sessions;
    }

    const stages = FUNNEL_STAGES.map(stage => ({
      stage,
      count: stageSessionMap[stage]?.size || 0,
    }));

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
    logger.error("[Analytics] Funnel error: " + err.message);
    return respondError(res, err.message || "Failed to load funnel analytics", 500);
  }
});

router.get("/recovery", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { start, end } = buildDateFilter(startDate, endDate);
    let query = db.from("analytics_events").select("*").gte("created_at", start.toISOString()).lte("created_at", end.toISOString()).range(0, MAX_RECORDS - 1);
    const { data: events } = await query;

    const checkoutSessions = new Set(events?.filter(e => e.event_type === 'begin_checkout').map(e => e.session_id) || []);
    const purchasedSessions = new Set(events?.filter(e => e.event_type === 'purchase').map(e => e.session_id) || []);
    const recoveredSessions = [...purchasedSessions].filter(s => checkoutSessions.has(s));
    const recovered = recoveredSessions.length;
    const abandoned = checkoutSessions.size - recovered;

    return success(res, { abandoned, recovered });
  } catch (err) {
    logger.error("[Analytics] Recovery error: " + err.message);
    return respondError(res, err.message || "Failed to load recovery data", 500);
  }
});

router.get("/events", async (req, res) => {
  try {
    const { startDate, endDate, page: pageStr, limit: limitStr } = req.query;
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const pageLimit = Math.min(500, Math.max(1, parseInt(limitStr, 10) || 100));
    const offset = (page - 1) * pageLimit;
    const { start, end } = buildDateFilter(startDate, endDate);

    let query = db.from("analytics_events").select("*", { count: "exact" }).gte("created_at", start.toISOString()).lte("created_at", end.toISOString()).order("created_at", { ascending: false }).range(offset, offset + pageLimit - 1);
    const { data: events, count } = await query;

    return success(res, {
      events: events || [],
      pagination: { page, limit: pageLimit, total: count || 0 },
    });
  } catch (err) {
    logger.error("[Analytics] Events error: " + err.message);
    return respondError(res, err.message || "Failed to load events", 500);
  }
});

router.get("/top-products", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { start, end } = buildDateFilter(startDate, endDate);
    let query = db.from("analytics_events").select("*").gte("created_at", start.toISOString()).lte("created_at", end.toISOString()).range(0, MAX_RECORDS - 1);
    const { data: events } = await query;

    const productMap = {};
    const purchaseEvents = events?.filter(e => e.event_type === 'purchase') || [];
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

    const addToCartEvents = events?.filter(e => e.event_type === 'add_to_cart') || [];
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
    logger.error("[Analytics] Top products error: " + err.message);
    return respondError(res, err.message || "Failed to load top products", 500);
  }
});

module.exports = router;
