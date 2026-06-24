-- Migration: Add image_urls column to products table
-- Run this in Supabase SQL Editor if the column is missing

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::JSONB;

-- Verify the column was added
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'image_urls';