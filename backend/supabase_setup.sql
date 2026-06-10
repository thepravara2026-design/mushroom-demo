-- MYCOFLORA DATABASE SETUP SCRIPT FOR SUPABASE
-- Run this in the Supabase SQL Editor to set up tables and default catalog data

-- 1. Create Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  whatsapp_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. Create Products Table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  image_url TEXT,
  category TEXT NOT NULL, -- 'spawn', 'kits', 'mushrooms', 'tools'
  difficulty TEXT,        -- 'beginner', 'intermediate', 'advanced'
  gst_rate INTEGER,       -- 5 (spawn, fresh mushrooms), 12 (kits), 18 (tools)
  stock INTEGER DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. Create Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  items JSONB NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL,
  discount_amount NUMERIC(10, 2) DEFAULT 0.00,
  gst_amount NUMERIC(10, 2) NOT NULL,
  total NUMERIC(10, 2) NOT NULL,
  promo_code TEXT,
  status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'paid', 'failed'
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  payment_method TEXT,
  transaction_id TEXT,
  delivery_status TEXT DEFAULT 'placed' NOT NULL, -- 'placed', 'inoculating', 'shipped', 'delivered'
  cancel_reason TEXT,
  whatsapp_sent BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row Level Security (RLS) if desired, or leave open for simple client usage.
-- Below is a seed block for initial products

INSERT INTO products (name, description, price, image_url, category, difficulty, gst_rate, stock)
VALUES 
(
  'Pink Oyster Spore Syringe (10ml)', 
  'High-viability Pleurotus djamor spores. Fast-colonizing, heat-tolerant, and perfect for beginners who want to see beautiful pink blooms in just 2 weeks.', 
  350.00, 
  'https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600', 
  'spawn', 
  'beginner', 
  5, 
  120
),
(
  'Lion''s Mane Fruiting Block Kit', 
  'An all-in-one ready-to-fruit block. Just mist with water and watch the shaggy, brain-boosting Hericium erinaceus teeth grow.', 
  750.00, 
  'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=600', 
  'kits', 
  'beginner', 
  12, 
  85
),
(
  'Shiitake Grain Spawn (1kg)', 
  'Sterilized organic rye grains fully colonized with premium Lentinula edodes mycelium. Ideal for inoculating sawdust substrates or logs.', 
  450.00, 
  'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600', 
  'spawn', 
  'intermediate', 
  5, 
  50
),
(
  'Reishi Medicinal Grow Kit', 
  'Cultivate the ''Mushroom of Immortality'' (Ganoderma lucidum). Produces beautiful varnished red-orange antlers. Requires patience and humidity control.', 
  950.00, 
  'https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600', 
  'kits', 
  'advanced', 
  12, 
  30
),
(
  'Premium Fresh King Oyster (500g)', 
  'Thick, meaty stems with a savory, umami flavor. Harvested fresh daily. Kept chilled during delivery.', 
  400.00, 
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600', 
  'mushrooms', 
  'beginner', 
  5, 
  40
),
(
  'Dried Cordyceps Militaris (50g)', 
  'Premium lab-grown Cordyceps, dehydrated to preserve active cordycepin content. Used commonly in teas and wellness soups.', 
  1800.00, 
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600', 
  'mushrooms', 
  'intermediate', 
  5, 
  75
),
(
  'Mycology Scalpel & Dissection Set', 
  'Stainless steel surgical scalpel with 10 replaceable blades, tweezers, and inoculation loops. Perfect for sterile agar work and transfers.', 
  650.00, 
  'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&q=80&w=600', 
  'tools', 
  'intermediate', 
  18, 
  100
),
(
  'HEPA Flow Hood Fan & Filter', 
  'A compact laminar flow hood unit. Provides a sterile stream of HEPA-filtered air to perform agar and spawn work without contamination.', 
  14500.00, 
  'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=600', 
  'tools', 
  'advanced', 
  18, 
  10
)
ON CONFLICT DO NOTHING;
