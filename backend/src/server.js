require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const db = require("./config/db");
const razorpay = require("./config/razorpay");
const AppError = require("./errors/AppError");
const handleError = require("./utils/errorHandler");

const authRoutes = require("./controllers/authController");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");
const categoryRoutes = require("./routes/categories");
const trainingRoutes = require("./routes/trainings");
const traineeRoutes = require("./routes/trainee");
const blogRoutes = require("./routes/blogs");
const searchRoutes = require("./routes/search");
const promoRoutes = require("./routes/promo");
const locationRoutes = require("./routes/locations");
const shippingRoutes = require("./routes/shipping");
const shippingWebhookRoutes = require("./routes/shipping-webhooks");
const { startBlogLockScheduler } = require("./services/blogService");
const refundRoutes = require("./modules/refunds/RefundController");
const logger = require("./utils/logger");

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : process.env.NODE_ENV === "production"
    ? process.env.CORS_ORIGIN_PRODUCTION
      ? process.env.CORS_ORIGIN_PRODUCTION.split(",").map((s) => s.trim())
      : false
    : [
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
    ];

// Security headers
app.use(helmet());

// Cookie parser for HTTP-only JWT cookies
app.use(cookieParser());

// Enable CORS (with credentials for cookie-based auth)
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Rate limiters — disabled in dev/test/mock mode for easier E2E testing
const isDevOrTest = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || process.env.FORCE_MOCK === 'true';
const otpLimiter = isDevOrTest
  ? (req, res, next) => next()
  : rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: "Too many requests. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
  });

const authLimiter = isDevOrTest
  ? (req, res, next) => next()
  : rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: "Too many requests. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
  });

// Apply rate limiters — order matters: more specific paths first
app.use("/api/auth/request-otp", otpLimiter);
app.use("/api/auth/verify-otp", otpLimiter);
app.use("/api/auth/admin-login", otpLimiter);
app.use("/api/auth", authLimiter);

// Increase JSON body size limit to allow large image data URLs (base64) from admin uploads
// Capture raw body for webhook signature verification
app.use(express.json({
  limit: "50mb",
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.includes("webhook")) {
      req.rawBody = buf;
    }
  }
}));
// Also support large URL-encoded payloads if used
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return next(
      AppError.badRequest("Malformed JSON request body.", {
        message: err.message,
      }),
    );
  }
  next(err);
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/trainings", trainingRoutes);
app.use("/api/trainee", traineeRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/promo", promoRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api", shippingWebhookRoutes);
app.use("/api/refunds", refundRoutes);

// Reset mock database (dev only)
app.post("/api/reset", (req, res) => {
  if (!db.isMock) {
    return res.status(400).json({ error: "Reset is only available in mock mode" });
  }
  db.resetMockStore();
  logger.info(" Mock database reset — users, orders, refunds, enrollments cleared");
  res.json({ success: true, message: "Mock database reset. Users, orders, refunds, and enrollments cleared." });
});

// Health Check
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    databaseMode: db.isMock ? "Mock In-Memory" : "Production Supabase",
    paymentMode: razorpay.isMock ? "Mock Simulator" : "Production Razorpay",
    timestamp: new Date().toISOString(),
  });
});

// Catch unknown routes and send a consistent error payload
app.use((req, res, next) => {
  next(
    AppError.notFound(`Cannot ${req.method} ${req.originalUrl}`, {
      originalUrl: req.originalUrl,
    }),
  );
});

// Centralized error handler (must be after routes)
app.use(handleError);

// Start Server with port fallback
const DEFAULT_PORT = Number(process.env.PORT) || 5000;
const MAX_PORT_TRIES = 10;

// ── Run all schema migrations against live Supabase DB ───────────────────────
async function runMigrations() {
  if (db.isMock) return; // No-op in mock/test mode
  try {
    const { Client } = require("pg");
    const supabaseUrl = process.env.SUPABASE_URL || "";
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const ref = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
    if (!ref || !serviceKey) return;

    const pgClient = new Client({
      host: `db.${ref}.supabase.co`,
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: serviceKey,
      ssl: { rejectUnauthorized: false },
    });
    await pgClient.connect();

    // All columns the backend references that may be absent in older database setups
    const statements = [
      // ── Existing columns (preserved) ──
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending' NOT NULL`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status TEXT DEFAULT 'none' NOT NULL`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_refunded_amount NUMERIC(10,2) DEFAULT 0.00 NOT NULL`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_refund_payment_mode TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_refund_payment_details TEXT`,
      // ── New state-machine columns ──
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_approval_status VARCHAR(50) DEFAULT 'pending'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(100)`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason_text TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_type VARCHAR(20)`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_initiated_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_completed_at TIMESTAMP WITH TIME ZONE`,
      // ── order_audit_logs (immutable audit trail) ──
      `CREATE TABLE IF NOT EXISTS order_audit_logs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        performed_by VARCHAR(255) NOT NULL,
        previous_state JSONB,
        new_state JSONB,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_order ON order_audit_logs(order_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON order_audit_logs(action)`,
      // ── notification_logs (delivery tracking) ──
      `CREATE TABLE IF NOT EXISTS notification_logs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        channel VARCHAR(20) NOT NULL,
        recipient VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        error TEXT,
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_notification_logs_order ON notification_logs(order_id, sent_at DESC)`,
      // ── Existing refund tables (preserved) ──
      `CREATE TABLE IF NOT EXISTS refund_audits (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        refund_id TEXT,
        order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        metadata JSONB
      )`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refund_reason TEXT`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS admin_note TEXT`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS failure_reason TEXT`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS payment_mode TEXT`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS payment_details TEXT`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refund_type VARCHAR(20) DEFAULT 'auto'`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(255)`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS bank_reference VARCHAR(255)`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN DEFAULT FALSE NOT NULL`,
      // ── Shipping tables ──
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
      // ── Fulfillment pipeline columns & tables ──
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT 'pending_fulfillment' NOT NULL`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_id TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS restocked BOOLEAN DEFAULT false NOT NULL`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS provider_shipment_id TEXT`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS service_type TEXT`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS rate NUMERIC(10,2)`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_address TEXT`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS recipient_address_snapshot JSONB`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pickup_requested BOOLEAN DEFAULT false NOT NULL`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pickup_requested_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS label_generated BOOLEAN DEFAULT false NOT NULL`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS manifest_generated BOOLEAN DEFAULT false NOT NULL`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ndr_raised_at TIMESTAMP WITH TIME ZONE`,
      `CREATE TABLE IF NOT EXISTS order_status_history (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, changed_at DESC)`,
      `CREATE TABLE IF NOT EXISTS fulfillment_tasks (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        task_type TEXT NOT NULL CHECK (task_type IN ('packing', 'labeling', 'pickup', 'handover')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
        assigned_to TEXT,
        completed_at TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_fulfillment_tasks_order ON fulfillment_tasks(order_id)`,
      // ── Performance indexes ──
      `CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status)`,
      `CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_awb_unique ON shipments(awb_code) WHERE awb_code IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_providers_default ON shipping_providers(is_default) WHERE is_default = true`,
      // ── Seed shipping providers ──
      `INSERT INTO shipping_providers (provider_key, name, is_active, is_default, config) VALUES
        ('shiprocket', 'Shiprocket', true, true, '{"base_url": "https://apiv2.shiprocket.in/v1/external"}'::jsonb),
        ('manual_legacy', 'Manual / Legacy', false, false, '{}'::jsonb)
       ON CONFLICT (provider_key) DO NOTHING`,
      // ── RLS policies for fulfillment pipeline ──
      `ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE fulfillment_tasks ENABLE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS "Users view own order status history" ON order_status_history`,
      `CREATE POLICY "Users view own order status history" ON order_status_history FOR SELECT
        USING (auth.uid()::text IN (SELECT user_id FROM orders WHERE id = order_id))`,
      `DROP POLICY IF EXISTS "Admins manage order status history" ON order_status_history`,
      `CREATE POLICY "Admins manage order status history" ON order_status_history FOR ALL
        USING (auth.jwt() ->> 'role' = 'admin')`,
      `DROP POLICY IF EXISTS "Admins manage fulfillment tasks" ON fulfillment_tasks`,
      `CREATE POLICY "Admins manage fulfillment tasks" ON fulfillment_tasks FOR ALL
        USING (auth.jwt() ->> 'role' = 'admin')`,
      `DROP POLICY IF EXISTS "Anyone can view active shipping providers" ON shipping_providers`,
      `CREATE POLICY "Anyone can view active shipping providers" ON shipping_providers FOR SELECT
        USING (is_active = true)`,
    ];

    for (const sql of statements) {
      await pgClient.query(sql).catch(e => logger.warn(`[Migration] ${e.message}`));
    }

    // Reload PostgREST schema cache — makes new columns immediately queryable
    await pgClient.query("NOTIFY pgrst, 'reload schema'").catch(() => {});
    await pgClient.end();
    logger.info("✅ [Migration] All schema migrations applied successfully");
  } catch (err) {
    logger.warn(`[Migration] Could not run migrations: ${err.message}`);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function startServer(port, attempts = 0) {
  const server = app.listen(port, () => {
    logger.info("==================================================");
    logger.info(`🍄 Sporekart Backend running on port ${port}`);
    logger.info(
      `🗄️  Database Mode: ${db.isMock ? "⚠️  MOCK (In-Memory)" : "✅ Supabase"}`,
    );
    logger.info(
      `💳 Payment Mode:  ${razorpay.isMock ? "⚠️  MOCK (Simulator)" : "✅ Razorpay"}`,
    );
    if (!db.isMock) {
      startBlogLockScheduler();
    }

    // Start background Auto-Refund Engine sweep
    const { runAutoRefundSweep } = require("./modules/refunds/RefundService");
    runAutoRefundSweep().catch(err => logger.error(`[Server] Initial Auto-refund sweep error: ${err.message}`));
    setInterval(() => {
      runAutoRefundSweep().catch(err => logger.error(`[Server] Auto-refund sweep error: ${err.message}`));
    }, 5 * 60 * 1000);

    logger.info("==================================================");
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < MAX_PORT_TRIES) {
      const nextPort = port + 1;
      logger.warn(`Port ${port} is in use, trying port ${nextPort}...`);
      startServer(nextPort, attempts + 1);
    } else {
      logger.error("Failed to start backend server:", error);
      process.exit(1);
    }
  });
}

if (require.main === module) {
  // Run migrations first, then start the server so schema is ready before first request
  runMigrations().finally(() => startServer(DEFAULT_PORT));
}

module.exports = app;
