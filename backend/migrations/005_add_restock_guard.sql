-- 005_add_restock_guard.sql
-- Adds restocked boolean to orders to prevent double-restock on retry.
-- Depends on: 004_add_fulfillment_pipeline.sql

ALTER TABLE orders ADD COLUMN IF NOT EXISTS restocked BOOLEAN DEFAULT false NOT NULL;
