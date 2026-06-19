require("dotenv").config();
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
const { startBlogLockScheduler } = require("./services/blogService");
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
app.use(express.json({ limit: "10mb" }));
// Also support large URL-encoded payloads if used
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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
  startServer(DEFAULT_PORT);
}

module.exports = app;
