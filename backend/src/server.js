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
const blogRoutes = require("./routes/blogs");
const searchRoutes = require("./routes/search");
const promoRoutes = require("./routes/promo");
const locationRoutes = require("./routes/locations");
const shippingRoutes = require("./routes/shipping");
const shippingWebhookRoutes = require("./routes/shipping-webhooks");
const { startBlogLockScheduler } = require("./services/blogService");
const refundRoutes = require("./modules/refunds/RefundController");
const logger = require("./utils/logger");

// Phase 1 — New module routes (feature-flag gated)
const inventoryModuleRoutes = require("./modules/inventory");
const couponModuleRoutes = require("./modules/coupons");

const pincodeRoutes = require("./routes/pincode");

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

// Rate limiters — higher limits in dev/test/mock for E2E testing, but never fully disabled
const isDevOrTest = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || process.env.FORCE_MOCK === 'true';
const otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDevOrTest ? 50 : 5,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDevOrTest ? 200 : 60,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDevOrTest ? 500 : 200,
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.includes("/webhooks/"),
});

// Apply rate limiters — order matters: more specific paths first, then global
app.use("/api/auth/request-otp", otpLimiter);
app.use("/api/auth/verify-otp", otpLimiter);
app.use("/api/auth/admin-login", otpLimiter);
app.use("/api/auth", authLimiter);
app.use("/api", globalLimiter);

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

// Attach RLS-aware DB client to every request
const selectDb = require("./middleware/selectDb");
app.use(selectDb);

// Routes
app.use("/api/auth", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  next();
});
app.use("/api/auth", authRoutes);
const twoFARoutes = require("./modules/twofa/TwoFAController");
app.use("/api/auth", twoFARoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/trainings", trainingRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/promo", promoRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api", shippingWebhookRoutes);
app.use("/api/refunds", refundRoutes);

// Phase 1 — New feature-flagged routes
app.use("/api/inventory", inventoryModuleRoutes);
app.use("/api/coupons", couponModuleRoutes);

app.use("/api/pincode", pincodeRoutes);

// Phase 3 — Abandonment routes
const abandonmentRoutes = require("./routes/abandonment");
const notifyMeRoutes = require("./routes/notifyMe");
app.use("/api/abandonment", abandonmentRoutes);
app.use("/api/notify-me", notifyMeRoutes);

// Phase 6 — Returns & Exchange
const returnRoutes = require("./routes/returns");
app.use("/api/returns", returnRoutes);

// Phase 8 — Analytics
const analyticsRoutes = require("./routes/analytics");
app.use("/api/analytics", analyticsRoutes);

const bulkImportRoutes = require("./routes/bulkImport");
app.use("/api/bulk-import", bulkImportRoutes);

// ── Backup & Recovery System (Phase 10) ──
// Completely isolated module — zero impact on existing functionality
const backupRoutes = require("./backup/routes/backupAdminRoutes");
app.use("/api/admin/backup", backupRoutes);

// ── Communication Module (Phase 11) ──
// Isolated provider-based communication system (SMS, OTP, WhatsApp, Email)
const communicationRoutes = require("./services/communication/routes/communicationRoutes");
app.use("/api/communication", communicationRoutes);
app.use("/api/admin/communication", communicationRoutes);

// Reset mock database (dev only)
// ── Global unhandled rejection / exception handlers ──
// Prevents process crashes; logs to help debug without losing the request
process.on("unhandledRejection", (reason) => {
  logger.error("[Server] Unhandled Rejection:", reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on("uncaughtException", (err) => {
  logger.error("[Server] Uncaught Exception:", err.stack || err.message);
  // Don't exit — let the process continue; in production, a process manager
  // like PM2 will restart if needed.
});

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
    communicationMode: process.env.COMMUNICATION_PROVIDER === "msg91" ? "MSG91" : "Mock",
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
      `CREATE TABLE IF NOT EXISTS refund_queue (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        refund_type VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL,
        assigned_to VARCHAR(255),
        priority INTEGER DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )`,
      // ── Performance indexes ──
      `CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_admin_approval ON orders(admin_approval_status)`,
      `CREATE INDEX IF NOT EXISTS idx_refund_queue_status ON refund_queue(status)`,
      `CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_awb_unique ON shipments(awb_code) WHERE awb_code IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_providers_default ON shipping_providers(is_default) WHERE is_default = true`,
      // ── Data backfill queries ──
      `UPDATE orders SET admin_approval_status = 'approved' WHERE status IN ('paid', 'cancelled') AND admin_approval_status IS NULL`,
      `UPDATE orders SET admin_approval_status = 'pending' WHERE admin_approval_status IS NULL`,
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
      // ── Phase 1 — New columns ──
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_token TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}'`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_window_expires TIMESTAMPTZ`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_token TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_window_expires TIMESTAMPTZ`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_confirmed BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_timeline_communicated BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER DEFAULT 0`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN DEFAULT TRUE`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'forward'`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS return_shipment_id TEXT`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pickup_scheduled_at TIMESTAMPTZ`,
      `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pickup_request_id TEXT`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS source TEXT`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS timeline_communicated BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS gateway_refund_id TEXT`,
      // ── Phase 1 — New tables ──
      `CREATE TABLE IF NOT EXISTS coupons (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, code TEXT UNIQUE NOT NULL, type TEXT NOT NULL CHECK (type IN ('percentage','fixed','free_shipping')), value NUMERIC NOT NULL, min_order NUMERIC DEFAULT 0, max_discount NUMERIC, usage_limit INTEGER DEFAULT 0, used_count INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE, is_auto_apply BOOLEAN DEFAULT FALSE, customer_id TEXT, starts_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS coupon_usage (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, coupon_id TEXT NOT NULL REFERENCES coupons(id), order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT REFERENCES users(id), discount_amount NUMERIC NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS returns (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('refund','replacement','exchange')), status TEXT NOT NULL DEFAULT 'requested', admin_notes TEXT, requested_at TIMESTAMPTZ DEFAULT NOW(), approved_at TIMESTAMPTZ, rejected_at TIMESTAMPTZ, rejection_reason TEXT, qc_status TEXT, qc_notes TEXT, qc_performed_by TEXT, qc_performed_at TIMESTAMPTZ, pickup_address_id TEXT, pickup_scheduled_at TIMESTAMPTZ, pickup_completed_at TIMESTAMPTZ, received_at_warehouse TIMESTAMPTZ, replacement_order_id TEXT, refund_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS return_items (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, return_id TEXT NOT NULL REFERENCES returns(id), product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL DEFAULT 1, condition_note TEXT)`,
      `CREATE TABLE IF NOT EXISTS return_evidence (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, return_id TEXT NOT NULL REFERENCES returns(id), image_url TEXT NOT NULL, uploaded_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS inventory_reservations (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, product_id TEXT NOT NULL REFERENCES products(id), cart_id TEXT, user_id TEXT, guest_token TEXT, quantity INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', reserved_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, released_at TIMESTAMPTZ, converted_to_order_id TEXT REFERENCES orders(id))`,
      `CREATE TABLE IF NOT EXISTS inventory_log (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, product_id TEXT NOT NULL REFERENCES products(id), action TEXT NOT NULL, quantity_change INTEGER NOT NULL, new_stock INTEGER NOT NULL, new_reserved INTEGER NOT NULL, reference_type TEXT, reference_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS notify_me_requests (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, product_id TEXT NOT NULL REFERENCES products(id), user_id TEXT REFERENCES users(id), email TEXT, phone TEXT, notified BOOLEAN DEFAULT FALSE, notified_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS abandoned_carts (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id TEXT REFERENCES users(id), guest_token TEXT, cart_data JSONB NOT NULL, cart_total NUMERIC, email TEXT, phone TEXT, status TEXT DEFAULT 'active', first_trigger_at TIMESTAMPTZ, second_trigger_at TIMESTAMPTZ, third_trigger_at TIMESTAMPTZ, recovered BOOLEAN DEFAULT FALSE, recovered_order_id TEXT REFERENCES orders(id), expired_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS abandonment_triggers (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, cart_id TEXT NOT NULL REFERENCES abandoned_carts(id), trigger_number INTEGER NOT NULL, channel TEXT NOT NULL, sent_at TIMESTAMPTZ DEFAULT NOW(), clicked BOOLEAN DEFAULT FALSE, clicked_at TIMESTAMPTZ)`,
      `CREATE TABLE IF NOT EXISTS pincode_serviceability (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, pincode TEXT NOT NULL, courier_id TEXT, cod_available BOOLEAN DEFAULT FALSE, estimated_days_min INTEGER, estimated_days_max INTEGER, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(pincode, courier_id))`,
      `CREATE TABLE IF NOT EXISTS order_cod_otps (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, order_id TEXT NOT NULL REFERENCES orders(id), otp TEXT NOT NULL, phone TEXT NOT NULL, attempts INTEGER DEFAULT 0, verified BOOLEAN DEFAULT FALSE, verified_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS notification_triggers (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, event_type TEXT NOT NULL, channels JSONB NOT NULL, delay_minutes INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE, template_id TEXT)`,
      `CREATE TABLE IF NOT EXISTS notification_log (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id TEXT REFERENCES users(id), order_id TEXT REFERENCES orders(id), event_type TEXT NOT NULL, channel TEXT NOT NULL, recipient TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', sent_at TIMESTAMPTZ, error TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, event_type TEXT NOT NULL, user_id TEXT, guest_token TEXT, session_id TEXT, page TEXT, metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS analytics_summaries (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, date TEXT NOT NULL, event_type TEXT NOT NULL, count INTEGER DEFAULT 0, unique_users INTEGER DEFAULT 0, unique_sessions INTEGER DEFAULT 0, metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(date, event_type))`,
      `CREATE TABLE IF NOT EXISTS notification_preferences (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id TEXT NOT NULL REFERENCES users(id), channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','push')), enabled BOOLEAN DEFAULT TRUE, UNIQUE(user_id, channel))`,
      // ── Phase 1 — Indexes ──
      `CREATE INDEX IF NOT EXISTS idx_orders_guest_token ON orders(guest_token)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_cancel_window ON orders(cancel_window_expires) WHERE cancel_window_expires IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)`,
      `CREATE INDEX IF NOT EXISTS idx_coupons_auto_apply ON coupons(is_auto_apply) WHERE is_auto_apply = TRUE`,
      `CREATE INDEX IF NOT EXISTS idx_returns_order_id ON returns(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expires ON inventory_reservations(expires_at) WHERE status = 'active'`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_reservations_product ON inventory_reservations(product_id) WHERE status = 'active'`,
      `CREATE INDEX IF NOT EXISTS idx_notify_me_product ON notify_me_requests(product_id) WHERE notified = FALSE`,
      `CREATE INDEX IF NOT EXISTS idx_abandoned_carts_status ON abandoned_carts(status)`,
      `CREATE INDEX IF NOT EXISTS idx_pincode_serviceability_pincode ON pincode_serviceability(pincode)`,
      `CREATE INDEX IF NOT EXISTS idx_order_cod_otps_order ON order_cod_otps(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log(product_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_notification_log_event ON notification_log(event_type, created_at)`,
      // ── Optimistic concurrency control — version columns ──
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_supplier TEXT DEFAULT 'Shriyap Enterprises, Basavura Village Davangere'`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS scientific_name TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_life TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_title TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_slug TEXT`,
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL`,
      `ALTER TABLE refunds ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL`,
      // ── Phase 1/2 — Seed data ──
      `INSERT INTO notification_triggers (event_type, channels, delay_minutes) VALUES ('payment.success', '["email","whatsapp","sms"]', 0), ('payment.failed', '["sms","whatsapp"]', 0), ('order.confirmed', '["email","whatsapp"]', 0), ('admin.approved', '["email"]', 0), ('order.shipped', '["whatsapp","sms","email"]', 0), ('out.for.delivery', '["whatsapp","sms"]', 0), ('delivered', '["whatsapp","email"]', 0), ('ndr.raised', '["sms","whatsapp"]', 0), ('order.cancelled', '["email","whatsapp"]', 0), ('refund.initiated', '["email","whatsapp"]', 0), ('refund.completed', '["email","sms"]', 0), ('cart.abandoned.1hr', '["whatsapp"]', 60), ('cart.abandoned.12hr', '["email"]', 720), ('cart.abandoned.24hr', '["email","sms"]', 1440) ON CONFLICT DO NOTHING`,
      `INSERT INTO coupons (code, type, value, min_order, max_discount, usage_limit, description, is_active, is_auto_apply, expires_at) VALUES ('SAVE10', 'percentage', 10, 500, 150, 1000, '10% off on orders above Rs500 (max Rs150)', TRUE, TRUE, '2027-12-31'), ('WELCOME5', 'fixed', 5, 0, NULL, 500, 'Rs5 off for new customers', TRUE, TRUE, '2027-12-31'), ('FREESHIP', 'free_shipping', 0, 299, NULL, 500, 'Free shipping on orders above Rs299', TRUE, TRUE, '2027-12-31'), ('SPORE15', 'percentage', 15, 1000, 300, 200, '15% off on orders above Rs1000 (max Rs300)', TRUE, FALSE, '2027-06-30'), ('FIRST50', 'fixed', 50, 200, NULL, 100, 'Rs50 off on first order', TRUE, FALSE, '2027-12-31'), ('MONSOON20', 'percentage', 20, 1500, 500, 50, 'Monsoon special: 20% off above Rs1500', TRUE, FALSE, '2026-09-30') ON CONFLICT (code) DO NOTHING`,
      `INSERT INTO pincode_serviceability (pincode, cod_available, estimated_days_min, estimated_days_max, courier_id) VALUES ('110001', TRUE, 1, 3, 'default'), ('400001', TRUE, 1, 3, 'default'), ('700001', TRUE, 2, 4, 'default'), ('600001', TRUE, 2, 4, 'default'), ('500001', TRUE, 1, 3, 'default'), ('380001', TRUE, 2, 4, 'default'), ('560001', TRUE, 1, 3, 'default'), ('800001', TRUE, 3, 5, 'default'), ('226001', TRUE, 2, 4, 'default'), ('302001', TRUE, 2, 4, 'default') ON CONFLICT (pincode, courier_id) DO NOTHING`,
      // ── Grower Training v2 — Tables ──
      `CREATE TABLE IF NOT EXISTS training_batches (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        training_id TEXT NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        start_date TIMESTAMPTZ NOT NULL,
        end_date TIMESTAMPTZ NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        seats_taken INTEGER DEFAULT 0 CHECK (seats_taken >= 0),
        price_actual NUMERIC(10,2) NOT NULL,
        price_strikeout NUMERIC(10,2),
        instructor TEXT,
        location TEXT,
        meeting_link TEXT,
        cancellation_cutoff_days INTEGER DEFAULT 3 CHECK (cancellation_cutoff_days >= 0),
        status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','completed','cancelled')),
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS training_enrollments (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        batch_id TEXT NOT NULL REFERENCES training_batches(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','confirmed','cancelled','refunded')),
        role TEXT,
        attendance TEXT CHECK (attendance IN ('present','no_show')),
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        UNIQUE(batch_id, user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS training_payments (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        enrollment_id TEXT NOT NULL REFERENCES training_enrollments(id) ON DELETE CASCADE,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        amount NUMERIC(10,2) NOT NULL,
        status TEXT DEFAULT 'created' CHECK (status IN ('created','paid','refunded','failed')),
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS training_refunds (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        payment_id TEXT NOT NULL REFERENCES training_payments(id) ON DELETE CASCADE,
        razorpay_refund_id TEXT,
        amount NUMERIC(10,2) NOT NULL,
        status TEXT DEFAULT 'initiated' CHECK (status IN ('initiated','processed','failed')),
        reason TEXT,
        initiated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS training_offers (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        training_id TEXT REFERENCES trainings(id) ON DELETE CASCADE,
        batch_id TEXT REFERENCES training_batches(id) ON DELETE CASCADE,
        coupon_code TEXT NOT NULL,
        discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed')),
        discount_value NUMERIC(10,2) NOT NULL,
        max_uses INTEGER DEFAULT 0,
        current_uses INTEGER DEFAULT 0,
        valid_from TIMESTAMPTZ,
        valid_until TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS admin_action_logs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        admin_id TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        reason TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
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

function registerQueueWorkers(work, QUEUES) {
  work(QUEUES.ORDER_PROCESSING, async (job) => {
    const { action, orderId, payload } = job.data;
    logger.info(`[QueueWorker] ORDER_PROCESSING: ${action} for ${orderId}`);
    const { withTransaction, optimisticUpdate } = require("./services/TransactionManager");

    if (action === "update_status") {
      await withTransaction(async (client) => {
        await optimisticUpdate(client, "orders", orderId, payload.updates, payload.expectedVersion);
      });
    }
  });

  work(QUEUES.REFUND_PROCESSING, async (job) => {
    const { action, orderId, refundId, payload } = job.data;
    logger.info(`[QueueWorker] REFUND_PROCESSING: ${action} for ${orderId}`);

    if (action === "execute_refund") {
      const RefundService = require("./modules/refunds/RefundService");
      const order = await RefundService.repo.findOrderById(orderId);
      if (order) {
        await RefundService.executeRefundProcess(
          order, payload.amount, payload.initiatedBy,
          payload.reason, payload.adminNote || "", payload.adminUser
        );
      }
    }
  });

  work(QUEUES.NOTIFICATION_DISPATCH, async (job) => {
    const { eventType, orderId, channel, recipient, template } = job.data;
    logger.info(`[QueueWorker] NOTIFICATION: ${eventType} for ${orderId} via ${channel}`);
  });

  work(QUEUES.STOCK_OPERATIONS, async (job) => {
    const { action, productId, quantity, referenceType, referenceId } = job.data;
    logger.info(`[QueueWorker] STOCK: ${action} for ${productId}`);

    const { withTransaction, optimisticUpdate, withRowLock } = require("./services/TransactionManager");

    if (action === "decrement") {
      await withTransaction(async (client) => {
        const product = await withRowLock(client, "products", productId);
        if (!product) throw new Error(`Product ${productId} not found`);
        const newStock = (product.stock || 0) - quantity;
        if (newStock < 0) throw new Error(`Insufficient stock for ${productId}: have ${product.stock}, need ${quantity}`);
        await optimisticUpdate(client, "products", productId, { stock: newStock }, product.version);
      });
    } else if (action === "increment") {
      await withTransaction(async (client) => {
        const product = await withRowLock(client, "products", productId);
        if (!product) throw new Error(`Product ${productId} not found`);
        const newStock = (product.stock || 0) + quantity;
        await optimisticUpdate(client, "products", productId, { stock: newStock }, product.version);
      });
    }
  });
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

    // Start Queue Service for distributed job processing
    const { startQueue, work, QUEUES } = require("./services/QueueService");
    startQueue().then(() => {
      logger.info("[Server] Queue service started, registering workers...");
      registerQueueWorkers(work, QUEUES);
    }).catch(err => logger.warn(`[Server] Queue start skipped: ${err.message}`));

    // Start background Auto-Refund Engine sweep
    const { runAutoRefundSweep } = require("./modules/refunds/RefundService");
    runAutoRefundSweep().catch(err => logger.error(`[Server] Initial Auto-refund sweep error: ${err.message}`));
    setInterval(() => {
      runAutoRefundSweep().catch(err => logger.error(`[Server] Auto-refund sweep error: ${err.message}`));
    }, 5 * 60 * 1000);

    // Phase 3 — Scheduled cron jobs
    const { runAbandonmentCron } = require("./jobs/abandonmentCron");
    const { runReservationCleanup } = require("./jobs/reservationCleanup");
    const { runCodOtpCleanup } = require("./jobs/codOtpCleanup");

    setInterval(() => runAbandonmentCron().catch(() => {}), 15 * 60 * 1000);
    setInterval(() => runReservationCleanup().catch(() => {}), 5 * 60 * 1000);
    setInterval(() => runCodOtpCleanup().catch(() => {}), 30 * 60 * 1000);

    // Phase 5 — Cancel window expiry sweep
    const { runCancelWindowCleanup } = require("./jobs/cancelWindowCleanup");
    setInterval(() => runCancelWindowCleanup().catch(() => {}), 60 * 1000);

    // Phase 5 — Complete refunded orders (REFUND_COMPLETED → COMPLETED, 5 min)
    const { completeRefundedOrders, closeCompletedWindows } = require("./modules/orders/OrderStateService");
    setInterval(() => completeRefundedOrders().catch(() => {}), 5 * 60 * 1000);
    // Phase 5 — Close expired return windows (RETURN_WINDOW → COMPLETED, 5 min)
    setInterval(() => closeCompletedWindows().catch(() => {}), 5 * 60 * 1000);

    // Phase 7 — Notification retry cron
    const { runNotificationRetry } = require("./jobs/notificationRetry");
    setInterval(() => runNotificationRetry().catch(() => {}), 5 * 60 * 1000);

    // Phase 7 — Expire stale pending_payment training enrollments (30 min timeout)
    const { runTrainingPendingPaymentCleanup } = require("./jobs/trainingPendingPaymentCleanup");
    setInterval(() => runTrainingPendingPaymentCleanup().catch(() => {}), 5 * 60 * 1000);

    // Phase 8 — Analytics aggregation (every 6 hours)
    const { runAnalyticsAggregation } = require("./jobs/analyticsAggregation");
    setInterval(() => runAnalyticsAggregation().catch(() => {}), 6 * 60 * 60 * 1000);

    // Phase 10 — Backup system (isolated, non-blocking)
    const { initBackupSystem } = require("./backup");
    initBackupSystem({ db, supabase: null }).catch(err => {
      logger.warn(`[Server] Backup system init skipped: ${err.message}`);
    });

    // Phase 11 — Communication Module (isolated, non-blocking)
    const { initCommunicationModule } = require("./services/communication");
    initCommunicationModule().catch(err => {
      logger.warn(`[Server] Communication module init error: ${err.message}`);
    });

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

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("[Server] SIGTERM received — shutting down...");
  const { stopQueue } = require("./services/QueueService");
  const { closePool } = require("./services/TransactionManager");
  await stopQueue();
  await closePool();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("[Server] SIGINT received — shutting down...");
  const { stopQueue } = require("./services/QueueService");
  const { closePool } = require("./services/TransactionManager");
  await stopQueue();
  await closePool();
  process.exit(0);
});

module.exports = app;
