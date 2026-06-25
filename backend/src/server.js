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

// Rate limiters — disabled in dev/test mode for easier E2E testing
const isDevOrTest = process.env.NODE_ENV === 'test';
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

    const pgConn = `postgresql://postgres:${encodeURIComponent(serviceKey)}@db.${ref}.supabase.co:5432/postgres`;
    const pgClient = new Client({ connectionString: pgConn, ssl: { rejectUnauthorized: false } });
    await pgClient.connect();

    // All columns the backend references that may be absent in older database setups
    const statements = [
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending' NOT NULL`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status TEXT DEFAULT 'none' NOT NULL`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_refunded_amount NUMERIC(10,2) DEFAULT 0.00 NOT NULL`,
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
