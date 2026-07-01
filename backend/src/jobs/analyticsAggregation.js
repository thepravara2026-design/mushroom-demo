const db = require("../config/db");
const logger = require("../utils/logger");

async function runAnalyticsAggregation() {
  try {
    const { data: events } = await db.from("analytics_events").select("*").then();
    if (!events || events.length === 0) {
      logger.debug("[AnalyticsAggregation] No events to aggregate");
      return;
    }

    const groups = {};
    for (const ev of events) {
      const date = (ev.created_at || "").substring(0, 10);
      if (!date) continue;
      const key = `${date}|${ev.event_type}`;
      if (!groups[key]) {
        groups[key] = { date, event_type: ev.event_type, count: 0, users: new Set(), sessions: new Set() };
      }
      groups[key].count++;
      if (ev.user_id) groups[key].users.add(ev.user_id);
      if (ev.session_id) groups[key].sessions.add(ev.session_id);
    }

    let aggregatedCount = 0;

    for (const key of Object.keys(groups)) {
      const g = groups[key];
      const { data: existing } = await db.from("analytics_summaries")
        .select("*")
        .eq("date", g.date)
        .eq("event_type", g.event_type)
        .then();

      const summary = {
        count: g.count,
        unique_users: g.users.size,
        unique_sessions: g.sessions.size,
        metadata: { last_aggregated_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      };

      if (existing && existing.length > 0) {
        const row = existing[0];
        summary.count += row.count || 0;
        summary.unique_users = Math.max(summary.unique_users, row.unique_users || 0);
        summary.unique_sessions = Math.max(summary.unique_sessions, row.unique_sessions || 0);
        await db.from("analytics_summaries")
          .update(summary)
          .eq("id", row.id)
          .then();
      } else {
        await db.from("analytics_summaries").insert({
          date: g.date,
          event_type: g.event_type,
          ...summary,
        }).then();
      }

      aggregatedCount++;
    }

    if (aggregatedCount > 0) {
      logger.info(`[AnalyticsAggregation] Aggregated ${aggregatedCount} event types across ${Object.keys(groups).length} date-groups from ${events.length} raw events`);
    }
  } catch (err) {
    logger.error(`[AnalyticsAggregation] Error: ${err.message}`);
  }
}

module.exports = { runAnalyticsAggregation };
