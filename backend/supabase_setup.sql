-- MYCOFLORA DATABASE SETUP SCRIPT FOR SUPABASE
-- Run this in the Supabase SQL Editor to set up tables and default catalog data

-- 1. DROP EXISTING TABLES IF ANY (CASCADE to handle references)
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS trainings CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 2. CREATE TABLES WITH TEXT IDENTIFIERS FOR COMPATIBILITY

-- Create Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  full_name TEXT NOT NULL,
  whatsapp_number TEXT,
  role TEXT DEFAULT 'buyer' NOT NULL,
  city TEXT,
  state TEXT,
  role_type TEXT,
  login_method TEXT,
  default_address TEXT,
  default_pincode TEXT,
  avatar_url TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  landmark TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create Categories Table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create Products Table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  mrp_price NUMERIC(10, 2) NOT NULL,
  image_url TEXT,
  category TEXT REFERENCES categories(id) ON DELETE SET NULL,
  difficulty TEXT,
  gst_rate INTEGER DEFAULT 5 NOT NULL,
  stock INTEGER DEFAULT 100 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT,
  delivery_address TEXT,
  delivery_phone TEXT,
  items JSONB NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL,
  discount_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
  gst_amount NUMERIC(10, 2) NOT NULL,
  shipping_charge NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
  total NUMERIC(10, 2) NOT NULL,
  promo_code TEXT,
  status TEXT DEFAULT 'pending' NOT NULL,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  payment_method TEXT,
  transaction_id TEXT,
  delivery_status TEXT DEFAULT 'placed' NOT NULL,
  cancel_reason TEXT,
  rating INTEGER,
  review_text TEXT,
  cancelled_by TEXT,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  whatsapp_sent BOOLEAN DEFAULT false NOT NULL,
  invoice_token TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create Settings Table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create Trainings Table
CREATE TABLE IF NOT EXISTS trainings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  description TEXT,
  image_url TEXT,
  content_url TEXT,
  allowed_roles JSONB DEFAULT '[]'::JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create Enrollments Table
CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  training_id TEXT REFERENCES trainings(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'trainee' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 3. SEED INITIAL DATABASE DATA

-- Seed Categories
INSERT INTO categories (id, category_id, name, description) VALUES
('fresh', 'spore-000001', 'Fresh Mushrooms', 'Handpicked & hygienically packed for best taste'),
('dry', 'spore-000002', 'Dry Mushrooms', '100% natural & sun-dried for rich nutrition'),
('spawn', 'spore-000003', 'Spawn Seeds', 'High quality spawn for better yield'),
('kits', 'spore-000004', 'Mushroom Kits', 'Ready-to-grow mushroom fruiting kits')
ON CONFLICT (id) DO NOTHING;

-- Seed Products
INSERT INTO products (id, name, description, price, mrp_price, image_url, category, difficulty, gst_rate, stock) VALUES
(
  'prod-1',
  'Pink Oyster Spore Syringe (10ml)',
  'High-viability Pleurotus djamor spores. Perfect for growers who want fast colonizing spawn and beautiful pink mushroom clusters.',
  350.00,
  499.00,
  'https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600',
  'spawn',
  'beginner',
  5,
  120
),
(
  'prod-2',
  'Lion''s Mane Spore Culture (10ml)',
  'Hericium erinaceus liquid culture. High-viability mycelium growth with exceptional yield records.',
  400.00,
  599.00,
  'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=600',
  'spawn',
  'beginner',
  5,
  85
),
(
  'prod-3',
  'Shiitake Grain Spawn (1kg)',
  'Sterilized organic rye grains fully colonized with premium Lentinula edodes mycelium. Ideal for inoculating sawdust blocks.',
  450.00,
  649.00,
  'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600',
  'spawn',
  'intermediate',
  5,
  50
),
(
  'prod-4',
  'Reishi Spore Print',
  'Dark purple spore print of Ganoderma lucidum collected on sterile foil. Perfect for agar transfers.',
  300.00,
  449.00,
  'https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600',
  'spawn',
  'advanced',
  5,
  60
),
(
  'prod-5',
  'Fresh Pink Oyster Mushrooms (500g)',
  'Freshly harvested organic Pink Oyster mushrooms. Beautiful color with a savory, bacon-like aroma when cooked.',
  500.00,
  699.00,
  'https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600',
  'fresh',
  'beginner',
  5,
  40
),
(
  'prod-6',
  'Fresh King Oyster Mushrooms (500g)',
  'Thick, meaty stems with a savory, umami flavor. Harvested fresh daily. Kept chilled during delivery.',
  400.00,
  549.00,
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600',
  'fresh',
  'beginner',
  5,
  45
),
(
  'prod-7',
  'Dried Reishi Mushrooms (100g)',
  'Premium sun-dried Ganoderma lucidum slices. Used commonly for making herbal teas and immunity decoctions.',
  700.00,
  999.00,
  'https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600',
  'dry',
  'advanced',
  5,
  100
),
(
  'prod-8',
  'Dried Cordyceps Militaris (50g)',
  'Premium lab-grown Cordyceps, dehydrated to preserve active cordycepin content. Excellent for wellness soups.',
  1800.00,
  2499.00,
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600',
  'dry',
  'intermediate',
  5,
  75
),
(
  'prod-9',
  'Oyster Mushroom Grow Kit',
  'Easy-to-use organic mushroom fruiting block. Spray with water daily and watch your delicious mushrooms grow in just 10 days!',
  450.00,
  699.00,
  'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600',
  'kits',
  'beginner',
  5,
  65
)
ON CONFLICT (id) DO NOTHING;

-- Seed Settings
INSERT INTO settings (key, value) VALUES
('shipping_charge', '50'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Seed Trainings
INSERT INTO trainings (id, title, category, description, image_url, content_url, allowed_roles) VALUES
(
  'train-1',
  'Beginner Mushroom Cultivation',
  'Beginner',
  'A hands-on introduction to mushroom farming for new growers.',
  '/images/training_farm.png',
  '',
  '["trainee", "farmer"]'::jsonb
),
(
  'train-2',
  'Commercial Farming for Entrepreneurs',
  'Entrepreneur',
  'Scaling up production, post-harvest handling and business models.',
  '/images/training_business.png',
  '',
  '["entrepreneur"]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Seed Users
-- The password hash for admin123 is: $2a$10$V36GomwF7q.bE8g1tW0Xdu7yTpeGf37Wb/nre2h6K6lqgZ7m99aUq
INSERT INTO users (id, email, password_hash, full_name, whatsapp_number, role) VALUES
('user-buyer', 'buyer@sporekart.com', NULL, 'John Buyer', '9876543211', 'buyer'),
('user-grower', 'grower@sporekart.com', NULL, 'Sam Grower', '9876543212', 'grower'),
('user-admin', 'admin@sporekart.com', '$2a$10$V36GomwF7q.bE8g1tW0Xdu7yTpeGf37Wb/nre2h6K6lqgZ7m99aUq', 'Sporekart Admin', '9876543210', 'admin')
ON CONFLICT (id) DO NOTHING;
