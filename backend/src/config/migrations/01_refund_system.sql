-- 1. Extend orders table without breaking existing records
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status TEXT DEFAULT 'none' NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_refunded_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL;

-- Populate existing records
UPDATE orders SET payment_status = status WHERE payment_status = 'pending' AND status != 'pending';
UPDATE orders SET refund_status = 'processed' WHERE status = 'refunded';

-- 2. Ensure refunds table matches required schema
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  razorpay_payment_id TEXT NOT NULL,
  razorpay_refund_id TEXT UNIQUE,
  refund_amount NUMERIC(10, 2) NOT NULL,
  refund_reason TEXT,
  refund_status TEXT DEFAULT 'initiated' NOT NULL, -- 'initiated', 'processed', 'failed'
  initiated_by TEXT NOT NULL, -- 'user', 'admin', 'system'
  failure_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 3. Create Refund Audit table
CREATE TABLE IF NOT EXISTS refund_audits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  refund_id TEXT,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- e.g., 'CANCELLATION_REQUESTED', 'APPROVED', 'REJECTED', 'REFUND_INITIATED', 'REFUND_COMPLETED', 'REFUND_FAILED'
  performed_by TEXT NOT NULL, -- user ID, or 'SYSTEM' or 'ADMIN'
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  metadata JSONB
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE refund_audits ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DROP POLICY IF EXISTS "Admins manage all audits" ON refund_audits;
CREATE POLICY "Admins manage all audits"
  ON refund_audits FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

DROP POLICY IF EXISTS "Users view own audits" ON refund_audits;
CREATE POLICY "Users view own audits"
  ON refund_audits FOR SELECT
  USING (auth.uid()::text = performed_by OR EXISTS (
    SELECT 1 FROM orders WHERE orders.id = refund_audits.order_id AND orders.user_id = auth.uid()::text
  ));
