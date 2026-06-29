-- Shipping Provider Registry
CREATE TABLE IF NOT EXISTS shipping_providers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT false NOT NULL,
  is_default BOOLEAN DEFAULT false NOT NULL,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Core Shipments Table (order_id is TEXT to match orders.id)
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shipping_provider_id TEXT NOT NULL REFERENCES shipping_providers(id) ON DELETE RESTRICT,
  awb_code TEXT,
  status TEXT DEFAULT 'pending' NOT NULL,
  tracking_url TEXT,
  pickup_scheduled_at TIMESTAMP WITH TIME ZONE,
  shipped_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  weight NUMERIC(10,3),
  is_cod BOOLEAN DEFAULT false NOT NULL,
  courier_name TEXT,
  courier_id TEXT,
  label_url TEXT,
  manifest_url TEXT,
  provider_response JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_awb ON shipments(awb_code);
CREATE INDEX IF NOT EXISTS idx_shipments_provider ON shipments(shipping_provider_id);

-- Tracking Events Timeline
CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  location TEXT,
  description TEXT,
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON shipment_tracking_events(shipment_id, occurred_at DESC);

-- Seed providers
INSERT INTO shipping_providers (provider_key, name, is_active, is_default, config) VALUES
('shiprocket', 'Shiprocket', true, true, '{"base_url": "https://apiv2.shiprocket.in/v1/external"}'::jsonb),
('manual_legacy', 'Manual / Legacy', false, false, '{}'::jsonb)
ON CONFLICT (provider_key) DO NOTHING;
