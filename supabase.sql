-- ============================================================
-- SPOREKART / MYCOFLORA — COMPLETE SUPABASE SCHEMA
-- Run this entire file in the Supabase SQL Editor (once).
-- Tables are listed in dependency order (FK-safe).
-- ============================================================

-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,
  full_name       TEXT NOT NULL,
  whatsapp_number TEXT,
  role            TEXT DEFAULT 'buyer' NOT NULL,
  city            TEXT,
  state           TEXT,
  role_type       TEXT,
  login_method    TEXT,
  default_address TEXT,
  default_pincode TEXT,
  avatar_url      TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  landmark        TEXT,
  is_guest        BOOLEAN DEFAULT FALSE,
  guest_token     TEXT,
  whatsapp_opt_in BOOLEAN DEFAULT FALSE,
  notification_preferences JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 2. CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  image_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 3. PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL,
  price              NUMERIC(10,2),
  mrp_price          NUMERIC(10,2),
  image_url          TEXT,
  image_urls         JSONB DEFAULT '[]'::jsonb,
  category           TEXT REFERENCES categories(id) ON DELETE SET NULL,
  difficulty         TEXT,
  gst_rate           INTEGER DEFAULT 5 NOT NULL,
  stock              INTEGER DEFAULT 100 NOT NULL,
  weight_pricing     JSONB,
  storage_handling   TEXT,
  warranty_policy    TEXT,
  return_policy      TEXT,
  shipping_info      TEXT,
  compliance_info    TEXT,
  highlights         JSONB DEFAULT '[]'::jsonb,
  certificates       JSONB DEFAULT '[]'::jsonb,
  reserved_quantity  INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  is_active          BOOLEAN DEFAULT TRUE,
  track_inventory    BOOLEAN DEFAULT TRUE,
  manufacturer_supplier TEXT DEFAULT 'Shriyap Enterprises, Basavura Village Davangere',
  scientific_name    TEXT,
  shelf_life         TEXT,
  seo_title          TEXT,
  seo_slug           TEXT,
  version            INTEGER DEFAULT 1 NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT products_stock_check CHECK (stock >= 0),
  CONSTRAINT products_gst_rate_check CHECK (gst_rate IN (0, 5, 12, 18, 28))
);

-- ============================================================
-- 4. SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 5. TRAININGS
-- ============================================================
CREATE TABLE IF NOT EXISTS trainings (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  category        TEXT,
  description     TEXT,
  image_url       TEXT,
  content_url     TEXT,
  allowed_roles   JSONB DEFAULT '[]'::jsonb NOT NULL,
  price_strikeout NUMERIC(10,2),
  price_actual    NUMERIC(10,2),
  start_date      TIMESTAMPTZ,
  end_date        TIMESTAMPTZ,
  duration_days   INTEGER,
  training_id     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 6. BLOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS blogs (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  slug           TEXT UNIQUE NOT NULL,
  author         TEXT NOT NULL DEFAULT 'Admin',
  content        TEXT NOT NULL,
  featured_image TEXT,
  image_source   TEXT DEFAULT 'upload',
  status         TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'locked')),
  published_at   TIMESTAMPTZ,
  locked         BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 7. ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                              TEXT PRIMARY KEY,
  user_id                         TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer_name                   TEXT,
  customer_email                  TEXT,
  delivery_address                TEXT,
  delivery_phone                  TEXT,
  items                           JSONB NOT NULL,
  subtotal                        NUMERIC(10,2) NOT NULL,
  discount_amount                 NUMERIC(10,2) DEFAULT 0.00 NOT NULL,
  gst_amount                      NUMERIC(10,2) NOT NULL,
  shipping_charge                 NUMERIC(10,2) DEFAULT 0.00 NOT NULL,
  total                           NUMERIC(10,2) NOT NULL,
  promo_code                      TEXT,
  status                          TEXT DEFAULT 'pending' NOT NULL,
  payment_status                  TEXT DEFAULT 'pending' NOT NULL,
  refund_status                   TEXT DEFAULT 'none' NOT NULL,
  refund_id                       TEXT,
  total_refunded_amount           NUMERIC(10,2) DEFAULT 0.00 NOT NULL,
  razorpay_order_id               TEXT,
  razorpay_payment_id             TEXT,
  payment_method                  TEXT,
  transaction_id                  TEXT,
  delivery_status                 TEXT DEFAULT 'placed' NOT NULL,
  cancel_reason                   TEXT,
  rating                          INTEGER,
  review_text                     TEXT,
  cancelled_by                    TEXT,
  cancelled_at                    TIMESTAMPTZ,
  whatsapp_sent                   BOOLEAN DEFAULT false NOT NULL,
  invoice_token                   TEXT,
  expected_delivery_date          TIMESTAMPTZ,
  delivery_days_text              TEXT DEFAULT '',
  shipped_at                      TIMESTAMPTZ,
  delivered_at                    TIMESTAMPTZ,
  fulfillment_status              TEXT DEFAULT 'pending_fulfillment' NOT NULL,
  shipment_id                     TEXT,
  shipment_awb                    TEXT,
  shipment_courier                TEXT,
  shipment_status                 TEXT,
  restocked                       BOOLEAN DEFAULT false NOT NULL,
  admin_approval_status           VARCHAR(50) DEFAULT 'pending',
  rejection_reason                TEXT,
  cancellation_reason             VARCHAR(100),
  cancellation_reason_text        TEXT,
  refund_type                     VARCHAR(20),
  refund_initiated_at             TIMESTAMPTZ,
  refund_completed_at             TIMESTAMPTZ,
  stock_restored                  BOOLEAN DEFAULT FALSE NOT NULL,
  cancel_window_expires           TIMESTAMPTZ,
  guest_token                     TEXT,
  coupon_id                       TEXT,
  coupon_code                     TEXT,
  return_window_expires           TIMESTAMPTZ,
  reviewed_at                     TIMESTAMPTZ,
  rejected_at                     TIMESTAMPTZ,
  inventory_confirmed             BOOLEAN DEFAULT FALSE,
  refund_timeline_communicated    BOOLEAN DEFAULT FALSE,
  manual_refund_payment_mode      TEXT,
  manual_refund_payment_details   TEXT,
  version                         INTEGER DEFAULT 1 NOT NULL,
  created_at                      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at                      TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT orders_total_check CHECK (total >= 0),
  CONSTRAINT orders_subtotal_check CHECK (subtotal >= 0),
  CONSTRAINT orders_shipping_charge_check CHECK (shipping_charge >= 0),
  CONSTRAINT orders_discount_amount_check CHECK (discount_amount >= 0)
);

-- ============================================================
-- 8. REFUNDS
-- ============================================================
CREATE TABLE IF NOT EXISTS refunds (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id              TEXT REFERENCES orders(id) ON DELETE SET NULL,
  user_id               TEXT REFERENCES users(id) ON DELETE SET NULL,
  razorpay_payment_id   TEXT,
  razorpay_refund_id    TEXT UNIQUE,
  amount                NUMERIC(10,2) NOT NULL,
  status                TEXT DEFAULT 'initiated' NOT NULL,
  refund_reason         TEXT,
  cancelled_by          TEXT DEFAULT 'admin' NOT NULL,
  admin_note            TEXT,
  initiated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at          TIMESTAMPTZ,
  failure_reason        TEXT,
  payment_mode          TEXT,
  payment_details       TEXT,
  refund_type           VARCHAR(20) DEFAULT 'auto',
  transaction_reference VARCHAR(255),
  bank_reference        VARCHAR(255),
  source                TEXT,
  timeline_communicated BOOLEAN DEFAULT FALSE,
  gateway_refund_id     TEXT,
  version               INTEGER DEFAULT 1 NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 9. REFUND AUDITS
-- ============================================================
CREATE TABLE IF NOT EXISTS refund_audits (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  refund_id    TEXT,
  order_id     TEXT REFERENCES orders(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  timestamp    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  metadata     JSONB
);

-- ============================================================
-- 10. ORDER STATUS HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS order_status_history (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 11. FULFILLMENT TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS fulfillment_tasks (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  task_type    TEXT NOT NULL CHECK (task_type IN ('packing', 'labeling', 'pickup', 'handover')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  assigned_to  TEXT,
  completed_at TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 12. ORDER AUDIT LOGS
-- ============================================================
-- ============================================================
-- 13. REFUND QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS refund_queue (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  refund_type  VARCHAR(20) NOT NULL,
  status       VARCHAR(30) NOT NULL,
  assigned_to  VARCHAR(255),
  priority     INTEGER DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 14. NOTIFICATION LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_logs (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id   TEXT REFERENCES orders(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  channel    VARCHAR(20) NOT NULL,
  recipient  VARCHAR(255),
  status     VARCHAR(20) DEFAULT 'pending',
  error      TEXT,
  sent_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 15. ENROLLMENTS (legacy)
-- ============================================================
CREATE TABLE IF NOT EXISTS enrollments (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  training_id TEXT REFERENCES trainings(id) ON DELETE CASCADE NOT NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  role        TEXT DEFAULT 'trainee' NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 16. SHIPPING PROVIDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS shipping_providers (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider_key  TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  is_active     BOOLEAN DEFAULT false NOT NULL,
  is_default    BOOLEAN DEFAULT false NOT NULL,
  config        JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 17. SHIPMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS shipments (
  id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id                 TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shipping_provider_id     TEXT NOT NULL REFERENCES shipping_providers(id) ON DELETE RESTRICT,
  awb_code                 TEXT,
  status                   TEXT DEFAULT 'pending' NOT NULL,
  tracking_url             TEXT,
  pickup_scheduled_at      TIMESTAMPTZ,
  shipped_at               TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  weight                   NUMERIC(10,3),
  is_cod                   BOOLEAN DEFAULT false NOT NULL,
  courier_name             TEXT,
  courier_id               TEXT,
  label_url                TEXT,
  manifest_url             TEXT,
  provider_response        JSONB DEFAULT '{}'::jsonb,
  provider_shipment_id     TEXT,
  service_type             TEXT,
  rate                     NUMERIC(10,2),
  estimated_delivery_date  DATE,
  origin_address           TEXT,
  recipient_address_snapshot JSONB,
  pickup_requested         BOOLEAN DEFAULT false NOT NULL,
  pickup_requested_at      TIMESTAMPTZ,
  label_generated          BOOLEAN DEFAULT false NOT NULL,
  manifest_generated       BOOLEAN DEFAULT false NOT NULL,
  cancelled_at             TIMESTAMPTZ,
  cancellation_reason      TEXT,
  ndr_raised_at            TIMESTAMPTZ,
  direction                TEXT DEFAULT 'forward',
  return_shipment_id       TEXT,
  pickup_request_id        TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 18. SHIPMENT TRACKING EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  location    TEXT,
  description TEXT,
  occurred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 19. TRAINING BATCHES
-- ============================================================
CREATE TABLE IF NOT EXISTS training_batches (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  training_id             TEXT NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  start_date              TIMESTAMPTZ NOT NULL,
  end_date                TIMESTAMPTZ NOT NULL,
  capacity                INTEGER NOT NULL CHECK (capacity > 0),
  seats_taken             INTEGER DEFAULT 0 CHECK (seats_taken >= 0),
  price_actual            NUMERIC(10,2) NOT NULL,
  price_strikeout         NUMERIC(10,2),
  instructor              TEXT,
  location                TEXT,
  meeting_link            TEXT,
  cancellation_cutoff_days INTEGER DEFAULT 3 CHECK (cancellation_cutoff_days >= 0),
  status                  TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled')),
  created_at              TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 20. TRAINING ENROLLMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS training_enrollments (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_id   TEXT NOT NULL REFERENCES training_batches(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'refunded')),
  role       TEXT,
  attendance TEXT CHECK (attendance IN ('present', 'no_show')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(batch_id, user_id)
);

-- ============================================================
-- 21. TRAINING PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS training_payments (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  enrollment_id     TEXT NOT NULL REFERENCES training_enrollments(id) ON DELETE CASCADE,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  amount            NUMERIC(10,2) NOT NULL,
  status            TEXT DEFAULT 'created' CHECK (status IN ('created', 'paid', 'refunded', 'failed')),
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 22. TRAINING REFUNDS
-- ============================================================
CREATE TABLE IF NOT EXISTS training_refunds (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  payment_id        TEXT NOT NULL REFERENCES training_payments(id) ON DELETE CASCADE,
  razorpay_refund_id TEXT,
  amount            NUMERIC(10,2) NOT NULL,
  status            TEXT DEFAULT 'initiated' CHECK (status IN ('initiated', 'processed', 'failed')),
  reason            TEXT,
  initiated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 23. TRAINING OFFERS
-- ============================================================
CREATE TABLE IF NOT EXISTS training_offers (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  training_id     TEXT REFERENCES trainings(id) ON DELETE CASCADE,
  batch_id        TEXT REFERENCES training_batches(id) ON DELETE CASCADE,
  coupon_code     TEXT NOT NULL,
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value  NUMERIC(10,2) NOT NULL,
  max_uses        INTEGER DEFAULT 0,
  current_uses    INTEGER DEFAULT 0,
  valid_from      TIMESTAMPTZ,
  valid_until     TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 24. ADMIN ACTION LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_action_logs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  admin_id    TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  reason      TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- 25. COUPONS
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code          TEXT UNIQUE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('percentage', 'fixed', 'free_shipping')),
  value         NUMERIC NOT NULL,
  min_order     NUMERIC DEFAULT 0,
  max_discount  NUMERIC,
  usage_limit   INTEGER DEFAULT 0,
  used_count    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  is_auto_apply BOOLEAN DEFAULT FALSE,
  customer_id   TEXT,
  starts_at     TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 26. COUPON USAGE
-- ============================================================
CREATE TABLE IF NOT EXISTS coupon_usage (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  coupon_id       TEXT NOT NULL REFERENCES coupons(id),
  order_id        TEXT NOT NULL REFERENCES orders(id),
  user_id         TEXT REFERENCES users(id),
  discount_amount NUMERIC NOT NULL,
  applied_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 27. RETURNS
-- ============================================================
CREATE TABLE IF NOT EXISTS returns (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id             TEXT NOT NULL REFERENCES orders(id),
  user_id              TEXT NOT NULL REFERENCES users(id),
  reason               TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('refund', 'replacement', 'exchange')),
  status               TEXT NOT NULL DEFAULT 'requested',
  admin_notes          TEXT,
  requested_at         TIMESTAMPTZ DEFAULT NOW(),
  approved_at          TIMESTAMPTZ,
  rejected_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  qc_status            TEXT,
  qc_notes             TEXT,
  qc_performed_by      TEXT,
  qc_performed_at      TIMESTAMPTZ,
  pickup_address_id    TEXT,
  pickup_scheduled_at  TIMESTAMPTZ,
  pickup_completed_at  TIMESTAMPTZ,
  received_at_warehouse TIMESTAMPTZ,
  replacement_order_id TEXT,
  refund_id            TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 28. RETURN ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS return_items (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  return_id       TEXT NOT NULL REFERENCES returns(id),
  product_id      TEXT NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL DEFAULT 1,
  condition_note  TEXT
);

-- ============================================================
-- 29. RETURN EVIDENCE
-- ============================================================
CREATE TABLE IF NOT EXISTS return_evidence (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  return_id   TEXT NOT NULL REFERENCES returns(id),
  image_url   TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 30. INVENTORY RESERVATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id           TEXT NOT NULL REFERENCES products(id),
  cart_id              TEXT,
  user_id              TEXT,
  guest_token          TEXT,
  quantity             INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  reserved_at          TIMESTAMPTZ DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL,
  released_at          TIMESTAMPTZ,
  converted_to_order_id TEXT REFERENCES orders(id)
);

-- ============================================================
-- 31. INVENTORY LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_log (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id      TEXT NOT NULL REFERENCES products(id),
  action          TEXT NOT NULL,
  quantity_change INTEGER NOT NULL,
  new_stock       INTEGER NOT NULL,
  new_reserved    INTEGER NOT NULL,
  reference_type  TEXT,
  reference_id    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 32. NOTIFY ME REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS notify_me_requests (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id  TEXT NOT NULL REFERENCES products(id),
  user_id     TEXT REFERENCES users(id),
  email       TEXT,
  phone       TEXT,
  notified    BOOLEAN DEFAULT FALSE,
  notified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 33. ABANDONED CARTS
-- ============================================================
CREATE TABLE IF NOT EXISTS abandoned_carts (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           TEXT REFERENCES users(id),
  guest_token       TEXT,
  cart_data         JSONB NOT NULL,
  cart_total        NUMERIC,
  email             TEXT,
  phone             TEXT,
  status            TEXT DEFAULT 'active',
  first_trigger_at  TIMESTAMPTZ,
  second_trigger_at TIMESTAMPTZ,
  third_trigger_at  TIMESTAMPTZ,
  recovered         BOOLEAN DEFAULT FALSE,
  recovered_order_id TEXT REFERENCES orders(id),
  expired_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 34. ABANDONMENT TRIGGERS
-- ============================================================
CREATE TABLE IF NOT EXISTS abandonment_triggers (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cart_id         TEXT NOT NULL REFERENCES abandoned_carts(id),
  trigger_number  INTEGER NOT NULL,
  channel         TEXT NOT NULL,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  clicked         BOOLEAN DEFAULT FALSE,
  clicked_at      TIMESTAMPTZ
);

-- ============================================================
-- 35. PINCODE SERVICEABILITY
-- ============================================================
CREATE TABLE IF NOT EXISTS pincode_serviceability (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pincode            TEXT NOT NULL,
  courier_id         TEXT,
  cod_available      BOOLEAN DEFAULT FALSE,
  estimated_days_min INTEGER,
  estimated_days_max INTEGER,
  is_active          BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pincode, courier_id)
);

-- ============================================================
-- 36. ORDER COD OTPS
-- ============================================================
CREATE TABLE IF NOT EXISTS order_cod_otps (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  otp         TEXT NOT NULL,
  phone       TEXT NOT NULL,
  attempts    INTEGER DEFAULT 0,
  verified    BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 37. COD OTPS (used by otpService.js)
-- ============================================================
CREATE TABLE IF NOT EXISTS cod_otps (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  phone      TEXT NOT NULL,
  otp        TEXT NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 38. NOTIFICATION TRIGGERS
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_triggers (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type    TEXT NOT NULL,
  channels      JSONB NOT NULL,
  delay_minutes INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  template_id   TEXT
);

-- ============================================================
-- 39. NOTIFICATION LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_log (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT REFERENCES users(id),
  order_id   TEXT REFERENCES orders(id),
  event_type TEXT NOT NULL,
  channel    TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  sent_at    TIMESTAMPTZ,
  error      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 40. ANALYTICS EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type  TEXT NOT NULL,
  user_id     TEXT,
  guest_token TEXT,
  session_id  TEXT,
  page        TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 41. ANALYTICS SUMMARIES
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_summaries (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date            TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  count           INTEGER DEFAULT 0,
  unique_users    INTEGER DEFAULT 0,
  unique_sessions INTEGER DEFAULT 0,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, event_type)
);

-- ============================================================
-- 42. NOTIFICATION PREFERENCES
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id  TEXT NOT NULL REFERENCES users(id),
  channel  TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'push')),
  enabled  BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id, channel)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_admin_approval ON orders(admin_approval_status);
CREATE INDEX IF NOT EXISTS idx_orders_guest_token ON orders(guest_token);
CREATE INDEX IF NOT EXISTS idx_orders_cancel_window ON orders(cancel_window_expires) WHERE cancel_window_expires IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_awb ON shipments(awb_code);
CREATE INDEX IF NOT EXISTS idx_shipments_provider ON shipments(shipping_provider_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_awb_unique ON shipments(awb_code) WHERE awb_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON shipment_tracking_events(shipment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fulfillment_tasks_order ON fulfillment_tasks(order_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_order ON notification_logs(order_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_queue_status ON refund_queue(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_providers_default ON shipping_providers(is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_training_batches_training ON training_batches(training_id);
CREATE INDEX IF NOT EXISTS idx_training_batches_status ON training_batches(status);
CREATE INDEX IF NOT EXISTS idx_training_batches_start ON training_batches(start_date);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_batch ON training_enrollments(batch_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_user ON training_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_status ON training_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_training_payments_enrollment ON training_payments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_training_refunds_payment ON training_refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_target ON admin_action_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_auto_apply ON coupons(is_auto_apply) WHERE is_auto_apply = TRUE;
CREATE INDEX IF NOT EXISTS idx_returns_order_id ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expires ON inventory_reservations(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_product ON inventory_reservations(product_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_notify_me_product ON notify_me_requests(product_id) WHERE notified = FALSE;
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_status ON abandoned_carts(status);
CREATE INDEX IF NOT EXISTS idx_pincode_serviceability_pincode ON pincode_serviceability(pincode);
CREATE INDEX IF NOT EXISTS idx_order_cod_otps_order ON order_cod_otps(order_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_event ON notification_log(event_type, created_at);

-- ============================================================
-- STORED FUNCTION: decrement_stock
-- ============================================================
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
-- ROW LEVEL SECURITY (RLS) POLICIES
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
ALTER TABLE refund_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_me_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE abandonment_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pincode_serviceability ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_cod_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE cod_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- ── PRODUCTS ──
DROP POLICY IF EXISTS "Public can read products" ON products;
CREATE POLICY "Public can read products" ON products FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage products" ON products;
CREATE POLICY "Admins can manage products" ON products FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── CATEGORIES ──
DROP POLICY IF EXISTS "Public can read categories" ON categories;
CREATE POLICY "Public can read categories" ON categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage categories" ON categories;
CREATE POLICY "Admins can manage categories" ON categories FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── ORDERS ──
DROP POLICY IF EXISTS "Users view own orders" ON orders;
CREATE POLICY "Users view own orders" ON orders FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Users create own orders" ON orders;
CREATE POLICY "Users create own orders" ON orders FOR INSERT WITH CHECK (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Admins manage all orders" ON orders;
CREATE POLICY "Admins manage all orders" ON orders FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── BLOGS ──
DROP POLICY IF EXISTS "Public can read published blogs" ON blogs;
CREATE POLICY "Public can read published blogs" ON blogs FOR SELECT USING (status = 'published');
DROP POLICY IF EXISTS "Admins can manage blogs" ON blogs;
CREATE POLICY "Admins can manage blogs" ON blogs FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── TRAININGS ──
DROP POLICY IF EXISTS "Authenticated users can view trainings" ON trainings;
CREATE POLICY "Authenticated users can view trainings" ON trainings FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can manage trainings" ON trainings;
CREATE POLICY "Admins can manage trainings" ON trainings FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── ENROLLMENTS (legacy) ──
DROP POLICY IF EXISTS "Users view own enrollments" ON enrollments;
CREATE POLICY "Users view own enrollments" ON enrollments FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Users create own enrollments" ON enrollments;
CREATE POLICY "Users create own enrollments" ON enrollments FOR INSERT WITH CHECK (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Admins manage all enrollments" ON enrollments;
CREATE POLICY "Admins manage all enrollments" ON enrollments FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── USERS ──
DROP POLICY IF EXISTS "Users view own profile" ON users;
CREATE POLICY "Users view own profile" ON users FOR SELECT USING (auth.uid()::text = id);
DROP POLICY IF EXISTS "Users update own profile" ON users;
CREATE POLICY "Users update own profile" ON users FOR UPDATE USING (auth.uid()::text = id);
DROP POLICY IF EXISTS "Admins manage all users" ON users;
CREATE POLICY "Admins manage all users" ON users FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── REFUNDS ──
DROP POLICY IF EXISTS "Users view own refunds" ON refunds;
CREATE POLICY "Users view own refunds" ON refunds FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Admins manage all refunds" ON refunds;
CREATE POLICY "Admins manage all refunds" ON refunds FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── REFUND AUDITS ──
DROP POLICY IF EXISTS "Admins manage all audits" ON refund_audits;
CREATE POLICY "Admins manage all audits" ON refund_audits FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
DROP POLICY IF EXISTS "Users view own audits" ON refund_audits;
CREATE POLICY "Users view own audits" ON refund_audits FOR SELECT USING (auth.uid()::text = performed_by OR EXISTS (SELECT 1 FROM orders WHERE orders.id = refund_audits.order_id AND orders.user_id = auth.uid()::text));

-- ── SETTINGS ──
DROP POLICY IF EXISTS "Admins manage settings" ON settings;
CREATE POLICY "Admins manage settings" ON settings FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── SHIPPING PROVIDERS ──
DROP POLICY IF EXISTS "Admins manage shipping providers" ON shipping_providers;
CREATE POLICY "Admins manage shipping providers" ON shipping_providers FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
DROP POLICY IF EXISTS "Anyone can view active shipping providers" ON shipping_providers;
CREATE POLICY "Anyone can view active shipping providers" ON shipping_providers FOR SELECT USING (is_active = true);

-- ── SHIPMENTS ──
DROP POLICY IF EXISTS "Users view own shipments" ON shipments;
CREATE POLICY "Users view own shipments" ON shipments FOR SELECT USING (auth.uid()::text IN (SELECT user_id FROM orders WHERE id = order_id));
DROP POLICY IF EXISTS "Admins manage shipments" ON shipments;
CREATE POLICY "Admins manage shipments" ON shipments FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── SHIPMENT TRACKING EVENTS ──
DROP POLICY IF EXISTS "Users view own tracking events" ON shipment_tracking_events;
CREATE POLICY "Users view own tracking events" ON shipment_tracking_events FOR SELECT USING (auth.uid()::text IN (SELECT o.user_id FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id = shipment_id));
DROP POLICY IF EXISTS "Admins manage tracking events" ON shipment_tracking_events;
CREATE POLICY "Admins manage tracking events" ON shipment_tracking_events FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── ORDER STATUS HISTORY ──
DROP POLICY IF EXISTS "Users view own order status history" ON order_status_history;
CREATE POLICY "Users view own order status history" ON order_status_history FOR SELECT USING (auth.uid()::text IN (SELECT user_id FROM orders WHERE id = order_id));
DROP POLICY IF EXISTS "Admins manage order status history" ON order_status_history;
CREATE POLICY "Admins manage order status history" ON order_status_history FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── FULFILLMENT TASKS ──
DROP POLICY IF EXISTS "Admins manage fulfillment tasks" ON fulfillment_tasks;
CREATE POLICY "Admins manage fulfillment tasks" ON fulfillment_tasks FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── REFUND QUEUE ──
DROP POLICY IF EXISTS "Admins manage refund queue" ON refund_queue;
CREATE POLICY "Admins manage refund queue" ON refund_queue FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── NOTIFICATION LOGS ──
DROP POLICY IF EXISTS "Admins manage notification logs" ON notification_logs;
CREATE POLICY "Admins manage notification logs" ON notification_logs FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── TRAINING BATCHES ──
DROP POLICY IF EXISTS "Public can view active training batches" ON training_batches;
CREATE POLICY "Public can view active training batches" ON training_batches FOR SELECT USING (status IN ('upcoming', 'active'));
DROP POLICY IF EXISTS "Admins manage training batches" ON training_batches;
CREATE POLICY "Admins manage training batches" ON training_batches FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── TRAINING ENROLLMENTS ──
DROP POLICY IF EXISTS "Users view own training enrollments" ON training_enrollments;
CREATE POLICY "Users view own training enrollments" ON training_enrollments FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Users create own training enrollments" ON training_enrollments;
CREATE POLICY "Users create own training enrollments" ON training_enrollments FOR INSERT WITH CHECK (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Admins manage training enrollments" ON training_enrollments;
CREATE POLICY "Admins manage training enrollments" ON training_enrollments FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── TRAINING PAYMENTS ──
DROP POLICY IF EXISTS "Users view own training payments" ON training_payments;
CREATE POLICY "Users view own training payments" ON training_payments FOR SELECT USING (auth.uid()::text IN (SELECT te.user_id FROM training_enrollments te WHERE te.id = enrollment_id));
DROP POLICY IF EXISTS "Admins manage training payments" ON training_payments;
CREATE POLICY "Admins manage training payments" ON training_payments FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── TRAINING REFUNDS ──
DROP POLICY IF EXISTS "Users view own training refunds" ON training_refunds;
CREATE POLICY "Users view own training refunds" ON training_refunds FOR SELECT USING (auth.uid()::text IN (SELECT te.user_id FROM training_payments tp JOIN training_enrollments te ON te.id = tp.enrollment_id WHERE tp.id = payment_id));
DROP POLICY IF EXISTS "Admins manage training refunds" ON training_refunds;
CREATE POLICY "Admins manage training refunds" ON training_refunds FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── TRAINING OFFERS ──
DROP POLICY IF EXISTS "Admins manage training offers" ON training_offers;
CREATE POLICY "Admins manage training offers" ON training_offers FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── ADMIN ACTION LOGS ──
DROP POLICY IF EXISTS "Admins manage action logs" ON admin_action_logs;
CREATE POLICY "Admins manage action logs" ON admin_action_logs FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── COUPONS ──
DROP POLICY IF EXISTS "Admins manage coupons" ON coupons;
CREATE POLICY "Admins manage coupons" ON coupons FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── COUPON USAGE ──
DROP POLICY IF EXISTS "Admins manage coupon usage" ON coupon_usage;
CREATE POLICY "Admins manage coupon usage" ON coupon_usage FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── RETURNS ──
DROP POLICY IF EXISTS "Users view own returns" ON returns;
CREATE POLICY "Users view own returns" ON returns FOR SELECT USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Admins manage returns" ON returns;
CREATE POLICY "Admins manage returns" ON returns FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── RETURN ITEMS / RETURN EVIDENCE ──
DROP POLICY IF EXISTS "Admins manage return items" ON return_items;
CREATE POLICY "Admins manage return items" ON return_items FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
DROP POLICY IF EXISTS "Admins manage return evidence" ON return_evidence;
CREATE POLICY "Admins manage return evidence" ON return_evidence FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── INVENTORY RESERVATIONS / LOG ──
DROP POLICY IF EXISTS "Admins manage inventory reservations" ON inventory_reservations;
CREATE POLICY "Admins manage inventory reservations" ON inventory_reservations FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
DROP POLICY IF EXISTS "Admins manage inventory log" ON inventory_log;
CREATE POLICY "Admins manage inventory log" ON inventory_log FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── NOTIFY ME ──
DROP POLICY IF EXISTS "Public can create notify requests" ON notify_me_requests;
CREATE POLICY "Public can create notify requests" ON notify_me_requests FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Admins manage notify requests" ON notify_me_requests;
CREATE POLICY "Admins manage notify requests" ON notify_me_requests FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── ABANDONED CARTS / TRIGGERS ──
DROP POLICY IF EXISTS "Admins manage abandoned carts" ON abandoned_carts;
CREATE POLICY "Admins manage abandoned carts" ON abandoned_carts FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
DROP POLICY IF EXISTS "Admins manage abandonment triggers" ON abandonment_triggers;
CREATE POLICY "Admins manage abandonment triggers" ON abandonment_triggers FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── PINCODE SERVICEABILITY ──
DROP POLICY IF EXISTS "Public can read pincode serviceability" ON pincode_serviceability;
CREATE POLICY "Public can read pincode serviceability" ON pincode_serviceability FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage pincode serviceability" ON pincode_serviceability;
CREATE POLICY "Admins manage pincode serviceability" ON pincode_serviceability FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── ORDER COD OTPS / COD OTPS ──
DROP POLICY IF EXISTS "Admins manage order cod otps" ON order_cod_otps;
CREATE POLICY "Admins manage order cod otps" ON order_cod_otps FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
DROP POLICY IF EXISTS "Admins manage cod otps" ON cod_otps;
CREATE POLICY "Admins manage cod otps" ON cod_otps FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── NOTIFICATION TRIGGERS / LOG ──
DROP POLICY IF EXISTS "Admins manage notification triggers" ON notification_triggers;
CREATE POLICY "Admins manage notification triggers" ON notification_triggers FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
DROP POLICY IF EXISTS "Admins manage notification log" ON notification_log;
CREATE POLICY "Admins manage notification log" ON notification_log FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── ANALYTICS ──
DROP POLICY IF EXISTS "Admins manage analytics events" ON analytics_events;
CREATE POLICY "Admins manage analytics events" ON analytics_events FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
DROP POLICY IF EXISTS "Admins manage analytics summaries" ON analytics_summaries;
CREATE POLICY "Admins manage analytics summaries" ON analytics_summaries FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ── NOTIFICATION PREFERENCES ──
DROP POLICY IF EXISTS "Users manage own notification preferences" ON notification_preferences;
CREATE POLICY "Users manage own notification preferences" ON notification_preferences FOR ALL USING (auth.uid()::text = user_id);
DROP POLICY IF EXISTS "Admins manage notification preferences" ON notification_preferences;
CREATE POLICY "Admins manage notification preferences" ON notification_preferences FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================
-- SEED DATA
-- ============================================================

-- Categories
INSERT INTO categories (id, category_id, name, description) VALUES
('fresh', 'spore-000001', 'Fresh Mushrooms', 'Handpicked & hygienically packed for best taste'),
('dry', 'spore-000002', 'Dry Mushrooms', '100% natural & sun-dried for rich nutrition'),
('spawn', 'spore-000003', 'Spawn Seeds', 'High quality spawn for better yield'),
('kits', 'spore-000004', 'Mushroom Kits', 'Ready-to-grow mushroom fruiting kits')
ON CONFLICT (id) DO NOTHING;

-- Products
INSERT INTO products (id, name, description, price, mrp_price, image_url, category, difficulty, gst_rate, stock, weight_pricing) VALUES
('prod-1', 'Pink Oyster Spore Syringe (10ml)', 'High-viability Pleurotus djamor spores.', 350.00, 499.00, 'https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600', 'spawn', 'beginner', 5, 120, '[{"weight":100,"unit":"g","price":100,"mrp_price":149},{"weight":200,"unit":"g","price":180,"mrp_price":269},{"weight":250,"unit":"g","price":220,"mrp_price":329},{"weight":400,"unit":"g","price":320,"mrp_price":479},{"weight":500,"unit":"g","price":350,"mrp_price":499},{"weight":1,"unit":"kg","price":650,"mrp_price":929},{"weight":2,"unit":"kg","price":1200,"mrp_price":1699},{"weight":5,"unit":"kg","price":2800,"mrp_price":3899}]'::jsonb),
('prod-2', 'Lion''s Mane Spore Culture (10ml)', 'Hericium erinaceus liquid culture.', 400.00, 599.00, 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=600', 'spawn', 'beginner', 5, 85, NULL),
('prod-3', 'Shiitake Grain Spawn (1kg)', 'Sterilized organic rye grains fully colonized.', 450.00, 649.00, 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600', 'spawn', 'intermediate', 5, 50, NULL),
('prod-4', 'Reishi Spore Print', 'Dark purple spore print of Ganoderma lucidum.', 300.00, 449.00, 'https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600', 'spawn', 'advanced', 5, 60, NULL),
('prod-5', 'Fresh Pink Oyster Mushrooms (500g)', 'Freshly harvested organic Pink Oyster mushrooms.', 500.00, 699.00, 'https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600', 'fresh', 'beginner', 5, 40, NULL),
('prod-6', 'Fresh King Oyster Mushrooms (500g)', 'Thick, meaty stems with a savory, umami flavor.', 400.00, 549.00, 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600', 'fresh', 'beginner', 5, 45, NULL),
('prod-7', 'Dried Reishi Mushrooms (100g)', 'Premium sun-dried Ganoderma lucidum slices.', 700.00, 999.00, 'https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600', 'dry', 'advanced', 5, 100, NULL),
('prod-8', 'Dried Cordyceps Militaris (50g)', 'Premium lab-grown Cordyceps, dehydrated.', 1800.00, 2499.00, 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600', 'dry', 'intermediate', 5, 75, NULL),
('prod-9', 'Oyster Mushroom Grow Kit', 'Easy-to-use organic mushroom fruiting block.', 450.00, 699.00, 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600', 'kits', 'beginner', 5, 65, NULL)
ON CONFLICT (id) DO NOTHING;

-- Settings
INSERT INTO settings (key, value) VALUES ('shipping_charge', '50'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Trainings
INSERT INTO trainings (id, title, category, description, image_url, content_url, allowed_roles) VALUES
('train-1', 'Beginner Mushroom Cultivation', 'Beginner', 'A hands-on introduction to mushroom farming for new growers.', '/images/training_farm.png', '', '["trainee", "farmer"]'::jsonb),
('train-2', 'Commercial Farming for Entrepreneurs', 'Entrepreneur', 'Scaling up production, post-harvest handling and business models.', '/images/training_business.png', '', '["entrepreneur"]'::jsonb),
('train-3', 'Mushroom Product Mastery for Buyers', 'Buyer', 'Learn to identify, select, and store the freshest mushrooms.', '/images/training_business.png', '', '["buyer"]'::jsonb),
('train-4', 'Advanced Grower Certification', 'Grower', 'Master sterile techniques, spawn run optimization.', '/images/training_farm.png', '', '["grower"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Training Batches
INSERT INTO training_batches (id, training_id, title, start_date, end_date, capacity, seats_taken, price_actual, price_strikeout, instructor, location, meeting_link, cancellation_cutoff_days, status) VALUES
('batch-seed-1', 'train-1', 'Beginner Cultivation — July Cohort', NOW() + INTERVAL '14 days', NOW() + INTERVAL '35 days', 20, 0, 999, 1999, 'Dr. Radha Sharma', 'Sporekart Learning Center, Pune', '', 3, 'upcoming'),
('batch-seed-2', 'train-2', 'Entrepreneur Bootcamp — August Cohort', NOW() + INTERVAL '45 days', NOW() + INTERVAL '70 days', 15, 0, 2999, 4999, 'Anita Verma', 'Online (Zoom)', 'https://zoom.us/j/entrepreneur-bootcamp', 7, 'upcoming'),
('batch-seed-3', 'train-3', 'Buyer''s Guide to Mushrooms — August Session', NOW() + INTERVAL '21 days', NOW() + INTERVAL '28 days', 30, 0, 499, 999, 'Chef Meera Iyer', 'Online (Zoom)', 'https://zoom.us/j/buyers-guide', 2, 'upcoming'),
('batch-seed-4', 'train-4', 'Advanced Grower Lab — September Intensive', NOW() + INTERVAL '60 days', NOW() + INTERVAL '75 days', 10, 0, 5999, 9999, 'Dr. Suresh Kulkarni', 'Lab Facility, Mumbai', '', 5, 'upcoming')
ON CONFLICT (id) DO NOTHING;

-- Blogs
INSERT INTO blogs (id, title, slug, author, content, featured_image, image_source, status, published_at) VALUES
('blog-1', 'How AI is Transforming E-Commerce', 'how-ai-is-transforming-ecommerce', 'Admin', '<h2>Introduction</h2><p>AI is revolutionizing e-commerce.</p>', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800', 'url', 'published', NOW() - INTERVAL '2 days'),
('blog-2', 'The Future of Mushroom Farming', 'future-of-mushroom-farming', 'Admin', '<h2>Sustainable Agriculture</h2><p>Mushroom farming is a key player in sustainable agriculture.</p>', 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=800', 'url', 'published', NOW() - INTERVAL '5 days'),
('blog-3', '5 Tips for Successful Spawn Production', '5-tips-successful-spawn-production', 'Admin', '<h2>Tip 1: Sterile Environment</h2><p>Maintain a completely sterile workspace.</p>', 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=800', 'url', 'published', NOW() - INTERVAL '10 days')
ON CONFLICT (id) DO NOTHING;

-- Users (password hash for "admin123")
INSERT INTO users (id, email, password_hash, full_name, whatsapp_number, role) VALUES
('user-buyer', 'buyer@sporekart.com', NULL, 'John Buyer', '9876543211', 'buyer'),
('user-grower', 'grower@sporekart.com', NULL, 'Sam Grower', '9876543212', 'grower'),
('user-admin', 'admin@sporekart.com', '$2a$10$V36GomwF7q.bE8g1tW0Xdu7yTpeGf37Wb/nre2h6K6lqgZ7m99aUq', 'Sporekart Admin', '9876543210', 'admin')
ON CONFLICT (id) DO NOTHING;

-- Shipping Providers
INSERT INTO shipping_providers (provider_key, name, is_active, is_default, config) VALUES
('shiprocket', 'Shiprocket', true, true, '{"base_url": "https://apiv2.shiprocket.in/v1/external"}'::jsonb),
('manual_legacy', 'Manual / Legacy', false, false, '{}'::jsonb)
ON CONFLICT (provider_key) DO NOTHING;

-- Notification Triggers
INSERT INTO notification_triggers (event_type, channels, delay_minutes) VALUES
('payment.success', '["email","whatsapp","sms"]', 0),
('payment.failed', '["sms","whatsapp"]', 0),
('order.confirmed', '["email","whatsapp"]', 0),
('admin.approved', '["email"]', 0),
('order.shipped', '["whatsapp","sms","email"]', 0),
('out.for.delivery', '["whatsapp","sms"]', 0),
('delivered', '["whatsapp","email"]', 0),
('ndr.raised', '["sms","whatsapp"]', 0),
('order.cancelled', '["email","whatsapp"]', 0),
('refund.initiated', '["email","whatsapp"]', 0),
('refund.completed', '["email","sms"]', 0),
('cart.abandoned.1hr', '["whatsapp"]', 60),
('cart.abandoned.12hr', '["email"]', 720),
('cart.abandoned.24hr', '["email","sms"]', 1440)
ON CONFLICT DO NOTHING;

-- Coupons
INSERT INTO coupons (code, type, value, min_order, max_discount, usage_limit, description, is_active, is_auto_apply, expires_at) VALUES
('SAVE10', 'percentage', 10, 500, 150, 1000, '10% off on orders above Rs500 (max Rs150)', TRUE, TRUE, '2027-12-31'),
('WELCOME5', 'fixed', 5, 0, NULL, 500, 'Rs5 off for new customers', TRUE, TRUE, '2027-12-31'),
('FREESHIP', 'free_shipping', 0, 299, NULL, 500, 'Free shipping on orders above Rs299', TRUE, TRUE, '2027-12-31'),
('SPORE15', 'percentage', 15, 1000, 300, 200, '15% off on orders above Rs1000 (max Rs300)', TRUE, FALSE, '2027-06-30'),
('FIRST50', 'fixed', 50, 200, NULL, 100, 'Rs50 off on first order', TRUE, FALSE, '2027-12-31'),
('MONSOON20', 'percentage', 20, 1500, 500, 50, 'Monsoon special: 20% off above Rs1500', TRUE, FALSE, '2026-09-30')
ON CONFLICT (code) DO NOTHING;

-- Pincode Serviceability
INSERT INTO pincode_serviceability (pincode, cod_available, estimated_days_min, estimated_days_max, courier_id) VALUES
('110001', TRUE, 1, 3, 'default'),
('400001', TRUE, 1, 3, 'default'),
('700001', TRUE, 2, 4, 'default'),
('600001', TRUE, 2, 4, 'default'),
('500001', TRUE, 1, 3, 'default'),
('380001', TRUE, 2, 4, 'default'),
('560001', TRUE, 1, 3, 'default'),
('800001', TRUE, 3, 5, 'default'),
('226001', TRUE, 2, 4, 'default'),
('302001', TRUE, 2, 4, 'default')
ON CONFLICT (pincode, courier_id) DO NOTHING;
