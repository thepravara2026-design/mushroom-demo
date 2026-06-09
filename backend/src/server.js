require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./config/db');
const razorpay = require('./config/razorpay');

const authRoutes = require('./controllers/authController');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const categoryRoutes = require('./routes/categories');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: '*', // For development, allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    databaseMode: db.isMock ? 'Mock In-Memory' : 'Production Supabase',
    paymentMode: razorpay.isMock ? 'Mock Simulator' : 'Production Razorpay',
    timestamp: new Date().toISOString()
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🍄 Sporekart Backend running on port ${PORT}`);
  console.log(`🗄️  Database Mode: ${db.isMock ? '⚠️  MOCK (In-Memory)' : '✅ Supabase'}`);
  console.log(`💳 Payment Mode:  ${razorpay.isMock ? '⚠️  MOCK (Simulator)' : '✅ Razorpay'}`);
  console.log(`==================================================`);
});
