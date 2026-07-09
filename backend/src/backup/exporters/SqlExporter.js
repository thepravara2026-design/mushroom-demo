const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA_CACHE = {
  users: ["id", "email", "full_name", "phone", "role", "whatsapp_number", "default_address", "default_pincode", "address_line1", "address_line2", "landmark", "city", "state", "avatar_url", "is_guest", "guest_token", "whatsapp_opt_in", "notification_preferences", "created_at"],
  categories: ["category_id", "id", "name", "description", "image_url", "created_at"],
  products: ["id", "created_at", "name", "description", "price", "mrp_price", "image_url", "image_urls", "category", "difficulty", "gst_rate", "stock", "low_stock_threshold", "reserved_quantity", "is_active", "track_inventory", "weight_pricing", "storage_handling", "warranty_policy", "return_policy", "shipping_info", "compliance_info", "highlights", "certificates", "manufacturer_supplier", "scientific_name", "shelf_life", "seo_title", "seo_slug", "version"],
  orders: ["id", "user_id", "email", "customer_email", "phone", "items", "address", "pincode", "total", "subtotal", "shipping_charge", "discount", "coupon_code", "coupon_id", "discount_amount", "payment_method", "payment_status", "status", "delivery_status", "fulfillment_status", "admin_approval_status", "rejection_reason", "cancellation_reason", "cancellation_reason_text", "cancel_window_expires", "return_window_expires", "refund_status", "refund_id", "total_refunded_amount", "refund_type", "refund_initiated_at", "refund_completed_at", "manual_refund_payment_mode", "manual_refund_payment_details", "shipped_at", "delivered_at", "reviewed_at", "rejected_at", "inventory_confirmed", "refund_timeline_communicated", "stock_restored", "restocked", "shipment_id", "guest_token", "version", "created_at"],
  order_items: ["id", "order_id", "product_id", "product_name", "quantity", "price", "total", "created_at"],
  refunds: ["id", "order_id", "amount", "reason", "status", "refund_reason", "admin_note", "initiated_at", "processed_at", "failure_reason", "payment_mode", "payment_details", "refund_type", "transaction_reference", "bank_reference", "gateway_refund_id", "source", "timeline_communicated", "version", "created_at"],
  refund_audits: ["id", "refund_id", "order_id", "action", "performed_by", "timestamp", "metadata"],
  order_status_history: ["id", "order_id", "field_name", "old_value", "new_value", "changed_by", "changed_at"],
  shipments: ["id", "order_id", "shipping_provider_id", "awb_code", "status", "tracking_url", "pickup_scheduled_at", "shipped_at", "delivered_at", "weight", "is_cod", "courier_name", "courier_id", "label_url", "manifest_url", "provider_response", "provider_shipment_id", "service_type", "rate", "estimated_delivery_date", "origin_address", "recipient_address_snapshot", "pickup_requested", "pickup_requested_at", "label_generated", "manifest_generated", "cancelled_at", "cancellation_reason", "ndr_raised_at", "direction", "return_shipment_id", "pickup_request_id", "created_at", "updated_at"],
  shipment_tracking_events: ["id", "shipment_id", "status", "location", "description", "occurred_at", "created_at"],
  fulfillment_tasks: ["id", "order_id", "task_type", "status", "assigned_to", "completed_at", "notes", "created_at", "updated_at"],
  shipping_providers: ["id", "provider_key", "name", "is_active", "is_default", "config", "created_at"],
  refund_queue: ["id", "order_id", "refund_type", "status", "assigned_to", "priority", "notes", "created_at", "updated_at"],
  coupons: ["id", "code", "type", "value", "min_order", "max_discount", "usage_limit", "used_count", "is_active", "is_auto_apply", "customer_id", "starts_at", "expires_at", "description", "created_at", "updated_at"],
  coupon_usage: ["id", "coupon_id", "order_id", "user_id", "discount_amount", "applied_at"],
  returns: ["id", "order_id", "user_id", "reason", "type", "status", "admin_notes", "requested_at", "approved_at", "rejected_at", "rejection_reason", "qc_status", "qc_notes", "qc_performed_by", "qc_performed_at", "pickup_address_id", "pickup_scheduled_at", "pickup_completed_at", "received_at_warehouse", "replacement_order_id", "refund_id", "created_at", "updated_at"],
  return_items: ["id", "return_id", "product_id", "quantity", "condition_note"],
  return_evidence: ["id", "return_id", "image_url", "uploaded_at"],
  inventory_reservations: ["id", "product_id", "cart_id", "user_id", "guest_token", "quantity", "status", "reserved_at", "expires_at", "released_at", "converted_to_order_id"],
  inventory_log: ["id", "product_id", "action", "quantity_change", "new_stock", "new_reserved", "reference_type", "reference_id", "created_at"],
  notify_me_requests: ["id", "product_id", "user_id", "email", "phone", "notified", "notified_at", "created_at"],
  abandoned_carts: ["id", "user_id", "guest_token", "cart_data", "cart_total", "email", "phone", "status", "first_trigger_at", "second_trigger_at", "third_trigger_at", "recovered", "recovered_order_id", "expired_at", "created_at", "updated_at"],
  abandonment_triggers: ["id", "cart_id", "trigger_number", "channel", "sent_at", "clicked", "clicked_at"],
  pincode_serviceability: ["id", "pincode", "courier_id", "cod_available", "estimated_days_min", "estimated_days_max", "is_active", "created_at", "updated_at"],
  order_cod_otps: ["id", "order_id", "otp", "phone", "attempts", "verified", "verified_at", "expires_at", "created_at"],
  notification_triggers: ["id", "event_type", "channels", "delay_minutes", "is_active", "template_id"],
  notification_log: ["id", "user_id", "order_id", "event_type", "channel", "recipient", "status", "sent_at", "error", "created_at"],
  notification_logs: ["id", "order_id", "event_type", "channel", "recipient", "status", "error", "sent_at"],
  notification_preferences: ["id", "user_id", "channel", "enabled"],
  analytics_events: ["id", "event_type", "user_id", "guest_token", "session_id", "page", "metadata", "created_at"],
  analytics_summaries: ["id", "date", "event_type", "count", "unique_users", "unique_sessions", "metadata", "created_at", "updated_at"],
  settings: ["key", "value"],
  blogs: ["id", "title", "slug", "author", "content", "featured_image", "image_source", "status", "published_at", "locked", "created_at", "updated_at"],
  trainings: ["id", "training_id", "title", "description", "category", "difficulty", "price", "image_url", "duration", "highlights", "curriculum", "instructor", "status", "created_at"],
  training_batches: ["id", "training_id", "title", "start_date", "end_date", "capacity", "seats_taken", "price_actual", "price_strikeout", "instructor", "location", "meeting_link", "cancellation_cutoff_days", "status", "created_at", "updated_at"],
  training_enrollments: ["id", "batch_id", "user_id", "status", "role", "attendance", "created_at", "updated_at"],
  training_payments: ["id", "enrollment_id", "razorpay_order_id", "razorpay_payment_id", "amount", "status", "created_at", "updated_at"],
  training_refunds: ["id", "payment_id", "razorpay_refund_id", "amount", "status", "reason", "initiated_at", "processed_at", "created_at"],
  training_offers: ["id", "training_id", "batch_id", "coupon_code", "discount_type", "discount_value", "max_uses", "current_uses", "valid_from", "valid_until", "is_active", "created_at"],
  admin_action_logs: ["id", "admin_id", "action", "target_type", "target_id", "reason", "metadata", "created_at"],
  enrollments: ["id", "training_id", "user_id", "role", "created_at"],
};

const TABLE_ORDER = [
  "users", "categories", "products", "settings", "blogs", "trainings",
  "shipping_providers", "coupons", "notification_triggers", "pincode_serviceability",
  "training_batches", "training_offers", "orders", "order_items",
  "order_status_history", "shipments", "shipment_tracking_events", "fulfillment_tasks",
  "refunds", "refund_audits", "refund_queue", "coupon_usage", "returns", "return_items",
  "return_evidence", "inventory_reservations", "inventory_log", "notify_me_requests",
  "abandoned_carts", "abandonment_triggers", "order_cod_otps", "notification_log",
  "notification_logs", "notification_preferences", "analytics_events", "analytics_summaries",
  "training_enrollments", "training_payments", "training_refunds", "admin_action_logs",
  "enrollments",
];

const INDEX_DEFINITIONS = [
  "CREATE INDEX IF NOT EXISTS idx_notification_logs_order ON notification_logs(order_id, sent_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);",
  "CREATE INDEX IF NOT EXISTS idx_shipments_awb ON shipments(awb_code);",
  "CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON shipment_tracking_events(shipment_id, occurred_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, changed_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_fulfillment_tasks_order ON fulfillment_tasks(order_id);",
  "CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);",
  "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);",
  "CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_status);",
  "CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);",
  "CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status);",
  "CREATE INDEX IF NOT EXISTS idx_orders_admin_approval ON orders(admin_approval_status);",
  "CREATE INDEX IF NOT EXISTS idx_refund_queue_status ON refund_queue(status);",
  "CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_awb_unique ON shipments(awb_code) WHERE awb_code IS NOT NULL;",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_providers_default ON shipping_providers(is_default) WHERE is_default = true;",
  "CREATE INDEX IF NOT EXISTS idx_orders_guest_token ON orders(guest_token);",
  "CREATE INDEX IF NOT EXISTS idx_orders_cancel_window ON orders(cancel_window_expires) WHERE cancel_window_expires IS NOT NULL;",
  "CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);",
  "CREATE INDEX IF NOT EXISTS idx_coupons_auto_apply ON coupons(is_auto_apply) WHERE is_auto_apply = TRUE;",
  "CREATE INDEX IF NOT EXISTS idx_returns_order_id ON returns(order_id);",
  "CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);",
  "CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expires ON inventory_reservations(expires_at) WHERE status = 'active';",
  "CREATE INDEX IF NOT EXISTS idx_inventory_reservations_product ON inventory_reservations(product_id) WHERE status = 'active';",
  "CREATE INDEX IF NOT EXISTS idx_notify_me_product ON notify_me_requests(product_id) WHERE notified = FALSE;",
  "CREATE INDEX IF NOT EXISTS idx_abandoned_carts_status ON abandoned_carts(status);",
  "CREATE INDEX IF NOT EXISTS idx_pincode_serviceability_pincode ON pincode_serviceability(pincode);",
  "CREATE INDEX IF NOT EXISTS idx_order_cod_otps_order ON order_cod_otps(order_id);",
  "CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type, created_at);",
  "CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log(product_id, created_at);",
  "CREATE INDEX IF NOT EXISTS idx_notification_log_event ON notification_log(event_type, created_at);",
];

const RLS_TABLES = [
  "order_status_history", "fulfillment_tasks", "shipping_providers",
  "orders", "order_items", "refunds", "returns", "return_items",
];

function escapeSqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function inferSqlType(value) {
  if (value === null || value === undefined) return "TEXT";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return "INTEGER";
    return "NUMERIC(10,2)";
  }
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "object") return "JSONB";
  return "TEXT";
}

function generateCreateTable(tableName, columns, sampleRow) {
  const lines = [`CREATE TABLE IF NOT EXISTS ${tableName} (`];
  const colDefs = [];

  if (columns && columns.length > 0) {
    for (const col of columns) {
      if (col === "id") {
        colDefs.push(`  ${col} TEXT PRIMARY KEY`);
        continue;
      }
      if (col === "created_at" || col === "updated_at" || col.endsWith("_at")) {
        colDefs.push(`  ${col} TIMESTAMP WITH TIME ZONE DEFAULT NOW()`);
        continue;
      }
      if (col === "version") {
        colDefs.push(`  ${col} INTEGER DEFAULT 1`);
        continue;
      }
      let sqlType = "TEXT";
      if (sampleRow && sampleRow[col] !== undefined) {
        sqlType = inferSqlType(sampleRow[col]);
      }
      colDefs.push(`  ${col} ${sqlType}`);
    }
  } else if (sampleRow) {
    for (const [key, value] of Object.entries(sampleRow)) {
      let sqlType = inferSqlType(value);
      if (key === "id") sqlType += " PRIMARY KEY";
      colDefs.push(`  ${key} ${sqlType}`);
    }
  }

  lines.push(colDefs.join(",\n"));
  lines.push(");");
  return lines.join("\n");
}

function generateInsertStatement(tableName, columns, row) {
  const cols = columns || Object.keys(row);
  const values = cols.map((col) => escapeSqlValue(row[col]));
  return `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${values.join(", ")});`;
}

class SqlExporter {
  constructor(options = {}) {
    this.db = options.db || null;
  }

  async exportAll(outputDir, mockStore, checksums, ctx) {
    const files = [];

    const schemaContent = this._buildSchema(mockStore);
    const schemaFile = this._writeSchemaFile(outputDir, schemaContent, checksums);
    files.push(schemaFile);

    const dataContent = this._buildData(mockStore);
    const dataFile = this._writeDataFile(outputDir, dataContent, checksums, ctx);
    files.push(dataFile);

    return { files, schemaFile, dataFile };
  }

  _getTableNames(mockStore) {
    return Object.keys(mockStore).filter((key) => Array.isArray(mockStore[key]));
  }

  _buildSchema(mockStore) {
    const lines = [];
    lines.push("-- Sporekart Database Schema");
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    lines.push("");

    const tableNames = this._getTableNames(mockStore);
    for (const tableName of tableNames) {
      const rows = mockStore[tableName] || [];
      const sampleRow = rows.length > 0 ? rows[0] : null;
      const columns = SCHEMA_CACHE[tableName] || (sampleRow ? Object.keys(sampleRow) : []);
      lines.push("");
      lines.push(`-- Table: ${tableName}`);
      lines.push(generateCreateTable(tableName, columns, sampleRow));
    }

    lines.push("");
    lines.push("-- Indexes");
    lines.push("");
    lines.push(...INDEX_DEFINITIONS);

    lines.push("");
    lines.push("-- Row Level Security");
    lines.push("");
    for (const tbl of RLS_TABLES) {
      lines.push(`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;`);
    }

    lines.push("");
    return lines.join("\n");
  }

  _buildData(mockStore) {
    const lines = [];
    lines.push("-- Sporekart Full Database Backup");
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push("");

    lines.push("-- DATA");
    lines.push("");
    lines.push("BEGIN;");
    lines.push("");

    const tableNames = this._getTableNames(mockStore);
    const orderedNames = TABLE_ORDER.filter((t) => tableNames.includes(t));
    const remaining = tableNames.filter((t) => !TABLE_ORDER.includes(t));
    const allOrdered = [...orderedNames, ...remaining];

    for (const tableName of allOrdered) {
      const rows = mockStore[tableName] || [];
      if (rows.length === 0) continue;

      const columns = SCHEMA_CACHE[tableName] || (rows.length > 0 ? Object.keys(rows[0]) : []);
      lines.push(`-- ${tableName}: ${rows.length} rows`);
      lines.push(`SET session_replication_role = 'replica';`);

      for (const row of rows) {
        lines.push(generateInsertStatement(tableName, columns, row));
      }

      lines.push(`SET session_replication_role = 'origin';`);
      lines.push("");
    }

    lines.push("COMMIT;");
    lines.push("");

    lines.push("-- INDEXES");
    lines.push("");
    lines.push(...INDEX_DEFINITIONS);

    lines.push("");
    return lines.join("\n");
  }

  _writeSchemaFile(outputDir, content, checksums) {
    const filePath = path.join(outputDir, "schema.sql");
    fs.writeFileSync(filePath, content);
    return this._makeFileInfo("schema.sql", filePath, checksums);
  }

  _writeDataFile(outputDir, content, checksums, ctx) {
    const fullContent = `-- Sporekart Full Database Backup\n-- Backup ID: ${ctx.backupId}\n-- Generated: ${new Date().toISOString()}\n-- Tables: ${this._getTableNames(ctx.mockStore || {}).length}\n\n${content}`;
    const filePath = path.join(outputDir, "database.sql");
    fs.writeFileSync(filePath, fullContent);
    return this._makeFileInfo("database.sql", filePath, checksums);
  }

  _makeFileInfo(filename, absolutePath, checksums) {
    const fileContent = fs.readFileSync(absolutePath);
    const checksum = crypto.createHash("sha256").update(fileContent).digest("hex");
    checksums[filename] = checksum;
    return {
      filename,
      path: filename,
      absolutePath,
      size: fileContent.length,
      sha256: checksum,
    };
  }
}

module.exports = { SqlExporter, SCHEMA_CACHE };
