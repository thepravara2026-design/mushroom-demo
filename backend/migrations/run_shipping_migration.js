/**
 * run_shipping_migration.js
 *
 * One-time setup script for shipping integration:
 * 1. Runs database table creation (shipping_providers, shipments, shipment_tracking_events)
 * 2. Backfills legacy orders that have delivery/dispatch timestamps into the shipments table
 *    under the manual_legacy provider.
 *
 * Usage: node migrations/run_shipping_migration.js
 * Safe to re-run — uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Client } = require("pg");
const logger = require("../src/utils/logger");

const supabaseUrl = process.env.SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function run() {
  if (!supabaseUrl || supabaseUrl.includes("your-supabase-url") || !serviceKey) {
    logger.info("[shipping-migration] No real Supabase credentials — skipping. Run with FORCE_MOCK=true for mock mode testing.");
    return;
  }

  const ref = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
  if (!ref) {
    logger.error("[shipping-migration] Could not parse Supabase project ref from URL.");
    return;
  }

  const pgClient = new Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: serviceKey,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pgClient.connect();
    logger.info("[shipping-migration] Connected to database.");

    // ── Step 1: Create tables ──
    const ddl = [
      `CREATE TABLE IF NOT EXISTS shipping_providers (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        provider_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT false NOT NULL,
        is_default BOOLEAN DEFAULT false NOT NULL,
        config JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS shipments (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        shipping_provider_id TEXT NOT NULL REFERENCES shipping_providers(id) ON DELETE RESTRICT,
        awb_code TEXT,
        status TEXT DEFAULT 'pending' NOT NULL,
        tracking_url TEXT,
        pickup_scheduled_at TIMESTAMP WITH TIME ZONE,
        shipped_at TIMESTAMP WITH TIME ZONE,
        delivered_at TIMESTAMP WITH TIME ZONE,
        weight NUMERIC(10,3),
        is_cod BOOLEAN DEFAULT false NOT NULL,
        courier_name TEXT,
        courier_id TEXT,
        label_url TEXT,
        manifest_url TEXT,
        provider_response JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_shipments_awb ON shipments(awb_code)`,
      `CREATE TABLE IF NOT EXISTS shipment_tracking_events (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        location TEXT,
        description TEXT,
        occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON shipment_tracking_events(shipment_id, occurred_at DESC)`,
    ];

    for (const sql of ddl) {
      await pgClient.query(sql).catch(e => logger.warn(`[shipping-migration] DDL: ${e.message}`));
    }

    // ── Step 2: Seed providers ──
    await pgClient.query(`
      INSERT INTO shipping_providers (provider_key, name, is_active, is_default, config) VALUES
      ('shiprocket', 'Shiprocket', true, true, '{"base_url": "https://apiv2.shiprocket.in/v1/external"}'::jsonb),
      ('manual_legacy', 'Manual / Legacy', false, false, '{}'::jsonb)
      ON CONFLICT (provider_key) DO NOTHING
    `);

    // ── Step 3: Backfill legacy orders ──
    const { rows: legacyOrders } = await pgClient.query(`
      SELECT id, created_at, shipped_at, delivered_at, delivery_status, payment_method
      FROM orders
      WHERE shipped_at IS NOT NULL OR delivered_at IS NOT NULL
    `);

    const { rows: manualProvider } = await pgClient.query(`
      SELECT id FROM shipping_providers WHERE provider_key = 'manual_legacy' LIMIT 1
    `);

    if (manualProvider.length === 0) {
      logger.warn("[shipping-migration] manual_legacy provider not found, skipping backfill.");
      return;
    }

    const manualProviderId = manualProvider[0].id;
    let backfillCount = 0;

    for (const order of legacyOrders) {
      const statusMap = {
        placed: 'pending',
        processing: 'processing',
        inoculating: 'processing',
        shipped: 'shipped',
        in_transit: 'in_transit',
        delivered: 'delivered',
        cancelled: 'cancelled',
      };
      const shipmentStatus = statusMap[order.delivery_status] || 'pending';

      const { rowCount } = await pgClient.query(`
        INSERT INTO shipments (order_id, shipping_provider_id, status, is_cod, shipped_at, delivered_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT DO NOTHING
      `, [
        order.id,
        manualProviderId,
        shipmentStatus,
        order.payment_method === 'COD',
        order.shipped_at || null,
        order.delivered_at || null,
        order.created_at,
      ]);

      if (rowCount > 0) {
        // Add tracking event for shipped/delivered
        if (order.shipped_at) {
          await pgClient.query(`
            INSERT INTO shipment_tracking_events (shipment_id, status, description, occurred_at)
            SELECT id, 'shipped', 'Legacy backfill: order shipped', $1
            FROM shipments WHERE order_id = $2
          `, [order.shipped_at, order.id]);
        }
        if (order.delivered_at) {
          await pgClient.query(`
            INSERT INTO shipment_tracking_events (shipment_id, status, description, occurred_at)
            SELECT id, 'delivered', 'Legacy backfill: order delivered', $1
            FROM shipments WHERE order_id = $2
          `, [order.delivered_at, order.id]);
        }
        backfillCount++;
      }
    }

    logger.info(`[shipping-migration] Backfilled ${backfillCount} legacy orders into shipments table.`);

    // Reload PostgREST schema cache
    await pgClient.query("NOTIFY pgrst, 'reload schema'").catch(() => {});

    logger.info("[shipping-migration] Complete.");
  } catch (err) {
    logger.error(`[shipping-migration] Failed: ${err.message}`);
  } finally {
    await pgClient.end();
  }
}

run();
