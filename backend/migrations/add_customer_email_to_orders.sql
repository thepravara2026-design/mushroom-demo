-- Migration: Add customer_email column to orders table
-- Run this in the Supabase SQL Editor if you already have an existing orders table.
-- Safe to run multiple times (IF NOT EXISTS guard).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- Optional: Backfill existing orders with the buyer email from the users table
-- UPDATE orders o
-- SET customer_email = u.email
-- FROM users u
-- WHERE o.user_id = u.id
--   AND o.customer_email IS NULL;
