-- 004_add_fulfillment_pipeline.sql
-- Adds fulfillment pipeline tables and columns to replace manual delivery_status progression.
-- Depends on: 003_add_shipping_tables.sql

-- ============================================================
-- 1. New columns on orders
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT 'pending_fulfillment' NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_id TEXT;

-- ============================================================
-- 2. New columns on shipments
-- ============================================================
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS provider_shipment_id TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS rate NUMERIC(10,2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_address TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS recipient_address_snapshot JSONB;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pickup_requested BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pickup_requested_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS label_generated BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS manifest_generated BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ndr_raised_at TIMESTAMP WITH TIME ZONE;

-- ============================================================
-- 3. New table: order_status_history (immutable audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS order_status_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, changed_at DESC);

-- ============================================================
-- 4. New table: fulfillment_tasks (replaces manual status steps)
-- ============================================================
CREATE TABLE IF NOT EXISTS fulfillment_tasks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('packing', 'labeling', 'pickup', 'handover')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  assigned_to TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_tasks_order ON fulfillment_tasks(order_id);

-- ============================================================
-- 5. Indexes and constraints
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_awb_unique ON shipments(awb_code) WHERE awb_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_providers_default ON shipping_providers(is_default) WHERE is_default = true;

-- ============================================================
-- 6. RLS policies
-- ============================================================
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own order status history" ON order_status_history;
CREATE POLICY "Users view own order status history"
  ON order_status_history FOR SELECT
  USING (auth.uid()::text IN (SELECT user_id FROM orders WHERE id = order_id));

DROP POLICY IF EXISTS "Admins manage order status history" ON order_status_history;
CREATE POLICY "Admins manage order status history"
  ON order_status_history FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

DROP POLICY IF EXISTS "Admins manage fulfillment tasks" ON fulfillment_tasks;
CREATE POLICY "Admins manage fulfillment tasks"
  ON fulfillment_tasks FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- Allow anyone to see active providers (needed for checkout serviceability check)
DROP POLICY IF EXISTS "Anyone can view active shipping providers" ON shipping_providers;
CREATE POLICY "Anyone can view active shipping providers"
  ON shipping_providers FOR SELECT
  USING (is_active = true);
