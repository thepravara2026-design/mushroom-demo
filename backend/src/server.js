require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./config/db');
const razorpay = require('./config/razorpay');
const AppError = require('./errors/AppError');
const handleError = require('./utils/errorHandler');

const authRoutes = require('./controllers/authController');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const categoryRoutes = require('./routes/categories');
const trainingRoutes = require('./routes/trainings');
const traineeRoutes = require('./routes/trainee');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(
  cors({
    origin: '*', // For development, allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Increase JSON body size limit to allow large image data URLs (base64) from admin uploads
app.use(express.json({ limit: '50mb' }));
// Also support large URL-encoded payloads if used
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return next(
      AppError.badRequest('Malformed JSON request body.', {
        message: err.message,
      }),
    );
  }
  next(err);
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/trainings', trainingRoutes);
app.use('/api/trainee', traineeRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    databaseMode: db.isMock ? 'Mock In-Memory' : 'Production Supabase',
    paymentMode: razorpay.isMock ? 'Mock Simulator' : 'Production Razorpay',
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
    console.log('==================================================');
    console.log(`🍄 Sporekart Backend running on port ${port}`);
    console.log(
      `🗄️  Database Mode: ${db.isMock ? '⚠️  MOCK (In-Memory)' : '✅ Supabase'}`,
    );
    console.log(
      `💳 Payment Mode:  ${razorpay.isMock ? '⚠️  MOCK (Simulator)' : '✅ Razorpay'}`,
    );
    console.log('==================================================');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempts < MAX_PORT_TRIES) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is in use, trying port ${nextPort}...`);
      startServer(nextPort, attempts + 1);
    } else {
      console.error('Failed to start backend server:', error);
      process.exit(1);
    }
  });
}

if (require.main === module) {
  startServer(DEFAULT_PORT);
}

module.exports = app;
