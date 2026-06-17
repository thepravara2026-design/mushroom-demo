-- MYCOFLORA DATABASE SETUP SCRIPT FOR SUPABASE
-- Run this in the Supabase SQL Editor to set up tables and default catalog data

-- 1. DROP EXISTING TABLES IF ANY (CASCADE to handle references)
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS trainings CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS blogs CASCADE;
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
  expected_delivery_date TIMESTAMP WITH TIME ZONE,
  delivery_days_text TEXT DEFAULT '',
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

-- Create Blogs Table
CREATE TABLE IF NOT EXISTS blogs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  author TEXT NOT NULL DEFAULT 'Admin',
  content TEXT NOT NULL,
  featured_image TEXT,
  image_source TEXT DEFAULT 'upload',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'locked')),
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  locked BOOLEAN DEFAULT FALSE
);

-- Create Refunds Table
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  razorpay_payment_id TEXT,
  razorpay_refund_id TEXT,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT DEFAULT 'initiated' NOT NULL,
  cancelled_by TEXT,
  admin_note TEXT,
  initiated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
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

-- Seed Blogs
INSERT INTO blogs (id, title, slug, author, content, featured_image, image_source, status, published_at) VALUES
(
  'blog-1',
  'How AI is Transforming E-Commerce',
  'how-ai-is-transforming-ecommerce',
  'Admin',
  '<h2>Introduction</h2><p>Artificial Intelligence is revolutionizing the way we shop online. From personalized recommendations to intelligent chatbots, AI is making e-commerce more efficient and customer-centric.</p><h2>Key AI Applications</h2><ul><li><strong>Personalization:</strong> AI algorithms analyze user behavior to deliver tailored product recommendations.</li><li><strong>Chatbots:</strong> 24/7 customer support without human operators on duty.</li><li><strong>Inventory Management:</strong> Predictive analytics optimize stock levels.</li><li><strong>Dynamic Pricing:</strong> Real-time price adjustments based on demand.</li></ul><h2>Conclusion</h2><p>Businesses that embrace AI will have a competitive advantage in the digital marketplace.</p>',
  'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800',
  'url',
  'published',
  NOW() - INTERVAL '2 days'
),
(
  'blog-2',
  'The Future of Mushroom Farming',
  'future-of-mushroom-farming',
  'Admin',
  '<h2>Sustainable Agriculture</h2><p>Mushroom farming is emerging as a key player in sustainable agriculture. With minimal land and water requirements, mushrooms offer high nutritional value per square foot.</p><h2>Technological Advances</h2><p>Modern cultivation techniques include climate-controlled environments, automated substrate preparation, and IoT monitoring systems.</p><h2>Market Growth</h2><p>The global mushroom market is projected to reach $80 billion by 2028, driven by increasing demand for plant-based proteins.</p>',
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=800',
  'url',
  'published',
  NOW() - INTERVAL '5 days'
),
(
  'blog-3',
  '5 Tips for Successful Spawn Production',
  '5-tips-successful-spawn-production',
  'Admin',
  '<h2>Tip 1: Sterile Environment</h2><p>Maintain a completely sterile workspace to prevent contamination.</p><h2>Tip 2: Quality Substrate</h2><p>Use high-quality grains or sawdust as your substrate base.</p><h2>Tip 3: Proper Incubation</h2><p>Control temperature and humidity for optimal mycelium growth.</p><h2>Tip 4: Regular Monitoring</h2><p>Check your cultures daily for signs of contamination or healthy growth.</p><h2>Tip 5: Documentation</h2><p>Keep detailed records of each batch for continuous improvement.</p>',
  'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=800',
  'url',
  'published',
  NOW() - INTERVAL '10 days'
)
ON CONFLICT (id) DO NOTHING;

-- Seed Users
-- The password hash for admin123 is: $2a$10$V36GomwF7q.bE8g1tW0Xdu7yTpeGf37Wb/nre2h6K6lqgZ7m99aUq
INSERT INTO users (id, email, password_hash, full_name, whatsapp_number, role) VALUES
('user-buyer', 'buyer@sporekart.com', NULL, 'John Buyer', '9876543211', 'buyer'),
('user-grower', 'grower@sporekart.com', NULL, 'Sam Grower', '9876543212', 'grower'),
('user-admin', 'admin@sporekart.com', '$2a$10$V36GomwF7q.bE8g1tW0Xdu7yTpeGf37Wb/nre2h6K6lqgZ7m99aUq', 'Sporekart Admin', '9876543210', 'admin')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. ROW LEVEL SECURITY (RLS) — Defense in depth
-- The service_role key (used by Express backend) bypasses these.
-- These policies protect tables if ever called directly with anon key.
-- Run this section separately after table creation if needed.
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

-- ── PRODUCTS ─────────────────────────────────────────────────
-- Public can read all active products (no auth required)
DROP POLICY IF EXISTS "Public can read products" ON products;
CREATE POLICY "Public can read products"
  ON products FOR SELECT USING (true);

-- Only admins can create/update/delete products
DROP POLICY IF EXISTS "Admins can manage products" ON products;
CREATE POLICY "Admins can manage products"
  ON products FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── CATEGORIES ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read categories" ON categories;
CREATE POLICY "Public can read categories"
  ON categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage categories" ON categories;
CREATE POLICY "Admins can manage categories"
  ON categories FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── ORDERS ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users view own orders" ON orders;
CREATE POLICY "Users view own orders"
  ON orders FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users create own orders" ON orders;
CREATE POLICY "Users create own orders"
  ON orders FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins manage all orders" ON orders;
CREATE POLICY "Admins manage all orders"
  ON orders FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── BLOGS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read published blogs" ON blogs;
CREATE POLICY "Public can read published blogs"
  ON blogs FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Admins can manage blogs" ON blogs;
CREATE POLICY "Admins can manage blogs"
  ON blogs FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── TRAININGS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can view trainings" ON trainings;
CREATE POLICY "Authenticated users can view trainings"
  ON trainings FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage trainings" ON trainings;
CREATE POLICY "Admins can manage trainings"
  ON trainings FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── ENROLLMENTS ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Users view own enrollments" ON enrollments;
CREATE POLICY "Users view own enrollments"
  ON enrollments FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users create own enrollments" ON enrollments;
CREATE POLICY "Users create own enrollments"
  ON enrollments FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins manage all enrollments" ON enrollments;
CREATE POLICY "Admins manage all enrollments"
  ON enrollments FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── USERS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users view own profile" ON users;
CREATE POLICY "Users view own profile"
  ON users FOR SELECT USING (auth.uid()::text = id);

DROP POLICY IF EXISTS "Users update own profile" ON users;
CREATE POLICY "Users update own profile"
  ON users FOR UPDATE USING (auth.uid()::text = id);

DROP POLICY IF EXISTS "Admins manage all users" ON users;
CREATE POLICY "Admins manage all users"
  ON users FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── REFUNDS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users view own refunds" ON refunds;
CREATE POLICY "Users view own refunds"
  ON refunds FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Admins manage all refunds" ON refunds;
CREATE POLICY "Admins manage all refunds"
  ON refunds FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ── SETTINGS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage settings" ON settings;
CREATE POLICY "Admins manage settings"
  ON settings FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================
-- 5. STORED FUNCTIONS
-- ============================================================

-- Atomic stock decrement with insufficient-stock guard.
-- Called via: supabaseAdmin.rpc('decrement_stock', { p_product_id, p_quantity })
-- SECURITY DEFINER: runs with table-owner privileges, bypasses RLS.
CREATE OR REPLACE FUNCTION decrement_stock(p_product_id TEXT, p_quantity INT)
RETURNS void AS $$
BEGIN
  UPDATE products
  SET stock = stock - p_quantity
  WHERE id = p_product_id AND stock >= p_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient stock for product %', p_product_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. SET ADMIN ROLE IN SUPABASE AUTH (run once per admin user)
-- Replace the email below with your actual admin email.
-- ============================================================
-- UPDATE auth.users
-- SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
-- WHERE email = 'admin@sporekart.com';

