const express = require("express");
const crypto = require("crypto");

const router = express.Router();
const db = require("../config/db");
const razorpay = require("../config/razorpay");
const authMiddleware = require("../middleware/auth");
const { validateBody, Joi } = require("../middleware/validate");
const { validateCancelRequest } = require("../middleware/orderValidation");
const { requireRole } = require("../middleware/roles");
const { success, error: respondError } = require("../lib/response");
const { validatePromoCode } = require("../services/promoService");
const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");
const { sendInvoiceWhatsApp } = require("../services/notificationService");
const { JWT_SECRET } = require("../config/jwt");
const refundService = require("../modules/refunds/RefundService");
const { OrderStates, assertCancellable, resolveState, selfCancel, getCancelWindow, adminReject, adminApprove, startReturnWindow } = require("../modules/orders/OrderStateService");
const { logAuditAction, AUDIT_ACTIONS } = require("../services/AuditLogService");
const { notify } = require("../services/notificationService");
const logger = require("../utils/logger");
const { sendSseEvent, addSseSubscriber } = require("../lib/sse");
const FEATURE_FLAGS = require("../config/featureFlags");
const inventoryService = require("../services/inventoryService");
const { withTransaction, withRowLocks } = require("../services/TransactionManager");
const { isValidIndianPhone, normalizePhoneToE164 } = require("../utils/phoneValidation");

function buildInvoiceData(order, user) {
  const gstSummary = {
    slab5: { taxableAmount: 0, gstAmount: 0 },
    slab12: { taxableAmount: 0, gstAmount: 0 },
    slab18: { taxableAmount: 0, gstAmount: 0 },
  };

  (order.items || []).forEach((item) => {
    const taxable = item.price * item.quantity - item.discountAmount;
    const key = `slab${item.gstRate}`;
    if (gstSummary[key]) {
      gstSummary[key].taxableAmount += taxable;
      gstSummary[key].gstAmount += item.gstAmount;
    }
  });

  return {
    invoiceNumber: `INV-${order.id.substring(0, 8).toUpperCase()}-${new Date(order.created_at).getFullYear()}`,
    invoiceDate: order.created_at,
    seller: {
      name: "Sporekart Store Private Limited",
      address:
        "4th Genetic Floor, Agritech Park, Phase 2, Bangalore, Karnataka, 560064",
      gstin: "29SPKRT9876A1Z0",
      email: "support@sporekart.com",
      phone: "+91 80 4991 3800",
    },
    buyer: {
      name:
        order.customer_name || (user ? user.full_name : "Valued Cultivator"),
      email: order.customer_email || (user ? user.email : ""),
      phone: order.delivery_phone || (user ? user.whatsapp_number : ""),
      address: order.delivery_address || "Not Specified",
    },
    paymentMethod:
      order.payment_method ||
      (order.razorpay_order_id ? "Razorpay" : "Pending"),
    paymentId: order.razorpay_payment_id || "",
    transactionId: order.transaction_id || order.razorpay_payment_id || "",
    items: order.items || [],
    totals: {
      subtotal: order.subtotal,
      discount: order.discount_amount,
      gstAmount: order.gst_amount,
      shippingCharge: order.shipping_charge || 0,
      total: order.total,
      promoCode: order.promo_code,
    },
    gstSummary: {
      slab5: {
        taxable: parseFloat(gstSummary.slab5.taxableAmount.toFixed(2)),
        cgst: parseFloat((gstSummary.slab5.gstAmount / 2).toFixed(2)),
        sgst: parseFloat((gstSummary.slab5.gstAmount / 2).toFixed(2)),
        totalGst: parseFloat(gstSummary.slab5.gstAmount.toFixed(2)),
      },
      slab12: {
        taxable: parseFloat(gstSummary.slab12.taxableAmount.toFixed(2)),
        cgst: parseFloat((gstSummary.slab12.gstAmount / 2).toFixed(2)),
        sgst: parseFloat((gstSummary.slab12.gstAmount / 2).toFixed(2)),
        totalGst: parseFloat(gstSummary.slab12.gstAmount.toFixed(2)),
      },
      slab18: {
        taxable: parseFloat(gstSummary.slab18.taxableAmount.toFixed(2)),
        cgst: parseFloat((gstSummary.slab18.gstAmount / 2).toFixed(2)),
        sgst: parseFloat((gstSummary.slab18.gstAmount / 2).toFixed(2)),
        totalGst: parseFloat(gstSummary.slab18.gstAmount.toFixed(2)),
      },
    },
    paymentStatus: order.status,
    invoiceToken: order.invoice_token || null,
  };
}

let _cachedShippingCharge = null;
let _lastFetch = 0;
const CACHE_TTL = 60000;

async function getShippingCharge() {
  if (_cachedShippingCharge !== null && Date.now() - _lastFetch < CACHE_TTL) {
    return _cachedShippingCharge;
  }
  try {
    const { data: setting } = await db
      .from("settings")
      .select("value")
      .eq("key", "shipping_charge")
      .single();
    _cachedShippingCharge = setting ? Number(setting.value) : 0;
    _lastFetch = Date.now();
    return _cachedShippingCharge;
  } catch {
    return _cachedShippingCharge ?? 0;
  }
}

const checkoutSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        quantity: Joi.number().integer().min(1).required(),
        weight: Joi.number().optional(),
        unit: Joi.string().valid("g", "kg").optional(),
      }),
    )
    .min(1)
    .required()
    .messages({
      "array.min": "At least one item is required.",
      "any.required": "Items are required.",
    }),
  promoCode: Joi.string().allow("", null).optional(),
  customer_name: Joi.string().allow("").max(100).optional(),
  customer_email: Joi.string().email().allow("").optional(),
  delivery_phone: Joi.string()
    .allow("")
    .optional()
    .custom((value) => {
      try {
        if (value && String(value).trim()) {
          if (!isValidIndianPhone(value)) {
            throw new Error('Enter a valid Indian phone number (10 digits starting with 6-9).');
          }
        }
      } catch (err) {
        if (err.message && err.message.includes('phone')) {
          throw err;
        }
        // Silently allow on unexpected errors to not break flow
        return;
      }
    })
    .messages({
      "any.invalid": "Enter a valid Indian phone number (10 digits starting with 6-9).",
    }),
  delivery_address: Joi.string().allow("").optional(),
  address_line1: Joi.string().allow("").optional(),
  address_line2: Joi.string().allow("").optional(),
  landmark: Joi.string().allow("").optional(),
  city: Joi.string().allow("").optional(),
  state: Joi.string().allow("").optional(),
  pincode: Joi.string()
    .pattern(/^\d{6}$/)
    .allow("")
    .optional(),
});

const orderPreviewSchema = Joi.object({
  items: Joi.array().items(
    Joi.object({
      id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      quantity: Joi.number().integer().min(1).required(),
      weight: Joi.number().optional(),
      unit: Joi.string().valid("g", "kg").optional(),
    }),
  ).min(1).required(),
  promoCode: Joi.string().allow("", null).optional(),
  pincode: Joi.string().pattern(/^\d{6}$/).allow("").optional(),
});

// POST /api/orders/review — Generate order preview (Phase 2)
router.post(
  "/review",
  authMiddleware,
  requireRole("buyer"),
  validateBody(orderPreviewSchema),
  async (req, res) => {
    try {
      const { items, promoCode, pincode } = req.body;
      if (!items || !items.length) return respondError(res, "Cart is empty.", 400);

      const { data: dbProducts } = await db.from("products").select("*");
      let subtotal = 0;
      let gstAmount = 0;
      let discountPercent = 0;
      let discountAmount = 0;
      const reviewItems = [];

      for (const cartItem of items) {
        const product = dbProducts.find(p => p.id === cartItem.id);
        if (!product) return respondError(res, `Product ${cartItem.id} not found.`, 400);
        const qty = parseInt(cartItem.quantity, 10) || 1;
        const price = product.price || 0;
        const lineTotal = price * qty;
        const gstRate = product.gst_rate || 5;
        const lineGst = +(lineTotal * (gstRate / 100)).toFixed(2);
        subtotal += lineTotal;
        gstAmount += lineGst;
        reviewItems.push({
          id: product.id,
          name: product.name,
          quantity: qty,
          price,
          lineTotal,
          gstRate,
          gstAmount: lineGst,
          image: product.image_url || null,
        });
      }

      if (promoCode) {
        const result = validatePromoCode(promoCode);
        if (result.valid) discountPercent = result.discountPercent;
        discountAmount = +(subtotal * discountPercent / 100).toFixed(2);
      }

      const gst = +gstAmount.toFixed(2);
      const shipping = 0;
      const total = +(subtotal + gst + shipping - discountAmount).toFixed(2);

      let deliveryEstimate = null;
      if (pincode) {
        const { data: pinData } = await db.from("pincode_serviceability").select("*").eq("pincode", pincode).single().catch(() => ({}));
        if (pinData) {
          deliveryEstimate = { min: pinData.estimated_days_min, max: pinData.estimated_days_max };
        }
      }

      return success(res, {
        items: reviewItems,
        subtotal: +subtotal.toFixed(2),
        gst,
        shipping,
        discount: discountAmount,
        discountPercent,
        total: +total.toFixed(2),
        promoCode: promoCode || null,
        deliveryEstimate,
      });
    } catch (err) {
      return respondError(res, err.message || "Review failed", 500);
    }
  },
);

// POST /api/orders/checkout
// Create order and Razorpay order ID
router.post(
  "/checkout",
  authMiddleware,
  requireRole("buyer"),
  validateBody(checkoutSchema),
  async (req, res) => {
    try {
      const {
        items,
        promoCode,
        customer_email,
        delivery_phone,
        address_line1,
        address_line2,
        landmark,
        city,
        state,
        pincode,
      } = req.body; // items: [{ id, quantity, weight?, unit? }]

      if (!items || !items.length) {
        return respondError(res, "Cart is empty.", 400);
      }

      // Build the combined delivery address
      const addressParts = [
        address_line1,
        address_line2,
        landmark,
        city,
        state,
        pincode ? `Pincode: ${pincode}` : "",
      ].filter(Boolean);

      let rawAddress = addressParts.join(", ");
      if (!rawAddress) {
        rawAddress = String(
          req.body.delivery_address || (req.user && req.user.address) || "",
        ).trim();
      }

      const rawPhone = String(
        delivery_phone || (req.user && req.user.whatsapp_number) || "",
      ).trim();

      // Do not require address/phone for checkout in mock/e2e flows; prefer user data if present.
      let deliveryPhone = "";
      if (rawPhone) {
        if (!isValidIndianPhone(rawPhone)) {
          return respondError(
            res,
            "Enter a valid Indian phone number (10 digits starting with 6-9).",
            400,
          );
        }
        deliveryPhone = normalizePhoneToE164(rawPhone);
      } else if (req.user && req.user.whatsapp_number) {
        deliveryPhone = req.user.whatsapp_number;
      }

      // ── PHASE 1: Fetch products & validate stock for ALL items upfront ──
      const { data: dbProducts } = await db.from("products").select("*");

      // Determine discount percentage
      let discountPercent = 0;
      if (promoCode) {
        const result = validatePromoCode(promoCode);
        if (result.valid) discountPercent = result.discountPercent;
      }

      let subtotal = 0;
      let discountAmount = 0;
      let gstAmount = 0;
      const orderItems = [];
      const stockDeductions = []; // { productId, quantity, name }

      // First pass: validate all items for stock
      for (const cartItem of items) {
        const product = dbProducts.find((p) => p.id === cartItem.id);
        if (!product) {
          return respondError(
            res,
            `Product with id ${cartItem.id} not found.`,
            400,
          );
        }

        const quantity = parseInt(cartItem.quantity, 10) || 1;

        // Check if inventory tracking is enabled for this product
        const trackInventory = product.track_inventory !== false;

        if (trackInventory) {
          let currentStock;
          let reservedQty = 0;
          let resultWeight;
          let resultUnit;

          // Check per-variant stock if item has weight/unit and variant has stock
          if (cartItem.weight !== undefined && cartItem.unit && Array.isArray(product.weight_pricing)) {
            const variant = product.weight_pricing.find(
              (v) => Number(v.weight) === Number(cartItem.weight) && v.unit === cartItem.unit
            );
            if (variant && variant.stock !== undefined && variant.stock !== null) {
              currentStock = variant.stock;
              resultWeight = Number(cartItem.weight);
              resultUnit = cartItem.unit;
            }
          }

          if (currentStock === undefined) {
            // Fallback to top-level stock
            const { data: freshProduct } = await db
              .from("products")
              .select("stock, reserved_quantity")
              .eq("id", product.id)
              .single();

            currentStock = freshProduct ? (freshProduct.stock || 0) : 0;
            reservedQty = freshProduct ? (freshProduct.reserved_quantity || 0) : 0;
          }

          const available = currentStock - reservedQty;

          if (quantity > available) {
            return respondError(
              res,
              `Insufficient stock for ${product.name}${resultWeight ? ` (${resultWeight}${resultUnit})` : ''}. Only ${Math.max(0, available)} unit(s) available.`,
              400,
            );
          }

          stockDeductions.push({
            productId: product.id,
            name: product.name,
            quantity,
            currentStock,
            ...(resultWeight ? { weight: resultWeight, unit: resultUnit } : {}),
          });
        }

        // Determine base price — use weight variant price if applicable
        let basePrice = product.price;
        let variantLabel = "";
        if (cartItem.weight !== undefined && cartItem.unit && Array.isArray(product.weight_pricing)) {
          const variant = product.weight_pricing.find(
            (v) => Number(v.weight) === Number(cartItem.weight) && v.unit === cartItem.unit,
          );
          if (variant) {
            basePrice = variant.price;
            variantLabel = ` (${cartItem.weight}${cartItem.unit})`;
          }
        }
        const lineSubtotal = basePrice * quantity;

        const lineDiscount = lineSubtotal * discountPercent;
        const lineDiscountedSubtotal = lineSubtotal - lineDiscount;
        const lineGst = lineDiscountedSubtotal * (product.gst_rate / 100);
        const lineTotal = lineDiscountedSubtotal + lineGst;

        subtotal += lineSubtotal;
        discountAmount += lineDiscount;
        gstAmount += lineGst;

        orderItems.push({
          productId: product.id,
          name: product.name + variantLabel,
          price: basePrice,
          quantity,
          gstRate: product.gst_rate,
          gstAmount: lineGst,
          discountAmount: lineDiscount,
          total: lineTotal,
          weight: cartItem.weight || null,
          unit: cartItem.unit || null,
        });
      }

      const shippingCharge = await getShippingCharge();
      const total = subtotal - discountAmount + gstAmount + shippingCharge;

      const generatedOrderId = `spore-ord-${crypto.randomUUID().slice(0, 8)}`;

      // Insert order in 'pending' status
      const invoiceToken = crypto.randomBytes(12).toString("hex");
      const customerEmail = req.body.customer_email || req.user.email || "";
      const insertPayload = {
        id: generatedOrderId,
        user_id: req.user.userId,
        customer_name: req.body.customer_name || req.user.fullName || req.user.email || "Customer",
        customer_email: customerEmail,
        delivery_address: rawAddress,
        delivery_phone: deliveryPhone,
        items: orderItems,
        subtotal: parseFloat(subtotal.toFixed(2)),
        discount_amount: parseFloat(discountAmount.toFixed(2)),
        gst_amount: parseFloat(gstAmount.toFixed(2)),
        shipping_charge: parseFloat(shippingCharge.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        promo_code: promoCode || "",
        status: FEATURE_FLAGS.SELF_CANCEL_WINDOW ? OrderStates.ORDER_CREATED : "pending",
        delivery_status: "placed",
        invoice_token: invoiceToken,
      };

      let newOrder, dbError;

      // First attempt: insert with customer_email
      ({ data: newOrder, error: dbError } = await db
        .from("orders")
        .insert(insertPayload)
        .single());

      // If the column doesn't exist yet in the DB schema cache, retry without it
      // and schedule an async migration to add it so future inserts succeed
      if (dbError && dbError.message && dbError.message.includes("customer_email")) {
        logger.warn('[checkout] customer_email column missing in DB — retrying without it and triggering migration');

        // Retry without the missing column
        const { customer_email: _omit, ...payloadWithoutEmail } = insertPayload;
        ({ data: newOrder, error: dbError } = await db
          .from("orders")
          .insert(payloadWithoutEmail)
          .single());

        // Auto-apply the migration in the background so next inserts work
        setImmediate(async () => {
          try {
            const { createClient } = require("@supabase/supabase-js");
            const adminClient = createClient(
              process.env.SUPABASE_URL,
              process.env.SUPABASE_SERVICE_ROLE_KEY,
              { auth: { autoRefreshToken: false, persistSession: false } }
            );
            await adminClient.rpc("exec_sql", {
              sql: "ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT;"
            }).catch(() => { }); // rpc may not exist — that's fine, column will be added next startup
          } catch (_) { }
        });
      }

      if (dbError || !newOrder) {
        logger.error('[checkout] DB insert failed:', { dbError: dbError?.message, insertPayload });
        return respondError(res, dbError?.message || 'Failed to create order', 500);
      }

      // ── PHASE 2: Decrement stock for all validated items ──
      // Use transactional stock decrement with row-level locks when enabled
      const decrementedProducts = [];

      if (FEATURE_FLAGS.ENABLE_TRANSACTIONS && !db.isMock) {
        try {
          await withTransaction(async (client) => {
            const productIds = [...new Set(stockDeductions.map(sd => sd.productId))];
            const locked = await withRowLocks(client, "products", productIds, "UPDATE");
            const lockMap = {};
            for (const p of locked) lockMap[p.id] = p;

            for (const sd of stockDeductions) {
              const product = lockMap[sd.productId];
              if (!product) throw new Error(`Product ${sd.productId} not found or locked`);

              if (sd.weight && sd.unit) {
                // Variant-level stock decrement via JSONB
                const variantIdx = (product.weight_pricing || []).findIndex(
                  v => Number(v.weight) === sd.weight && v.unit === sd.unit && v.stock !== undefined
                );
                if (variantIdx === -1) continue; // no variant stock field — skip
                const variantStock = (product.weight_pricing[variantIdx].stock || 0);
                if (sd.quantity > variantStock) {
                  throw new Error(`Insufficient variant stock for ${sd.name}`);
                }
                const r = await client.query(
                  `UPDATE products SET weight_pricing = (
                    SELECT jsonb_agg(
                      CASE
                        WHEN (elem->>'weight')::numeric = $4 AND elem->>'unit' = $5 AND elem ? 'stock'
                        THEN jsonb_set(elem, '{stock}', to_jsonb(COALESCE((elem->>'stock')::int, 0) - $2))
                        ELSE elem
                      END
                    )
                    FROM jsonb_array_elements(weight_pricing) AS elem
                    WHERE id = $3
                  ), version = version + 1, updated_at = $6
                  WHERE id = $3 AND (
                    SELECT COALESCE((elem->>'stock')::int, 0)
                    FROM jsonb_array_elements(weight_pricing) AS elem
                    WHERE (elem->>'weight')::numeric = $4 AND elem->>'unit' = $5
                    LIMIT 1
                  ) >= $2`,
                  [sd.quantity, sd.quantity, sd.productId, sd.weight, sd.unit, new Date().toISOString()]
                );
                if (r.rowCount === 0) {
                  throw new Error(`Variant stock decrement failed for ${sd.name} — concurrent modification`);
                }
              } else {
                const newStock = (product.stock || 0) - sd.quantity;
                if (newStock < 0) {
                  throw new Error(`Insufficient stock for ${sd.name}. Available: ${product.stock}, requested: ${sd.quantity}`);
                }
                const r = await client.query(
                  `UPDATE products SET stock = stock - $1, version = version + 1, updated_at = $2 WHERE id = $3 AND stock >= $1`,
                  [sd.quantity, new Date().toISOString(), sd.productId]
                );
                if (r.rowCount === 0) {
                  throw new Error(`Stock decrement failed for ${sd.name} — concurrent modification`);
                }
              }
              decrementedProducts.push(sd);
            }
          });
        } catch (txErr) {
          logger.error(`[checkout] Transactional stock decrement failed: ${txErr.message}. Rolling back order creation.`);
          await db.from("orders").delete().eq("id", generatedOrderId).catch(() => {});
          return respondError(res, `Failed to reserve stock: ${txErr.message}`, 500);
        }
      } else {
        for (const sd of stockDeductions) {
          try {
            if (sd.weight && sd.unit) {
              // Variant-level stock decrement
              const { data: freshProduct } = await db
                .from("products")
                .select("weight_pricing, version")
                .eq("id", sd.productId)
                .single();
              if (freshProduct && Array.isArray(freshProduct.weight_pricing)) {
                const variant = freshProduct.weight_pricing.find(
                  v => Number(v.weight) === sd.weight && v.unit === sd.unit && v.stock !== undefined
                );
                if (variant) {
                  const newStock = variant.stock - sd.quantity;
                  if (newStock < 0) throw new Error(`Insufficient variant stock for ${sd.name}`);
                  const updatedWp = freshProduct.weight_pricing.map(v => {
                    if (Number(v.weight) === sd.weight && v.unit === sd.unit && v.stock !== undefined) {
                      return { ...v, stock: newStock };
                    }
                    return v;
                  });
                  await db.from("products").update({
                    weight_pricing: updatedWp,
                    ...(!db.isMock ? { version: (freshProduct.version || 0) + 1 } : {}),
                    updated_at: new Date().toISOString(),
                  }).eq("id", sd.productId);
                } else {
                  // Variant has no stock field — fallback to top-level stock decrement
                  if (!db.isMock) {
                    await supabaseAdmin.rpc("decrement_stock", {
                      p_product_id: sd.productId,
                      p_quantity: sd.quantity,
                    });
                  } else {
                    const { data: fp } = await db.from("products").select("stock").eq("id", sd.productId).single();
                    const cur = fp ? (fp.stock || 0) : 0;
                    await db.from("products").update({ stock: cur - sd.quantity }).eq("id", sd.productId);
                  }
                }
              }
            } else if (!db.isMock) {
              await supabaseAdmin.rpc("decrement_stock", {
                p_product_id: sd.productId,
                p_quantity: sd.quantity,
              });
            } else {
              const { data: freshProduct } = await db
                .from("products")
                .select("stock")
                .eq("id", sd.productId)
                .single();
              const currentStock = freshProduct ? (freshProduct.stock || 0) : 0;
              await db
                .from("products")
                .update({ stock: currentStock - sd.quantity })
                .eq("id", sd.productId);
            }
            decrementedProducts.push(sd);
          } catch (dedErr) {
            logger.error(`[checkout] Stock decrement failed for ${sd.productId}: ${dedErr.message}. Rolling back...`);
            for (const done of decrementedProducts) {
              try {
                if (!db.isMock) {
                  if (done.weight && done.unit) {
                    const { data: pf } = await db.from("products").select("weight_pricing").eq("id", done.productId).single();
                    if (pf && Array.isArray(pf.weight_pricing)) {
                      const restoredWp = pf.weight_pricing.map(v => {
                        if (Number(v.weight) === done.weight && v.unit === done.unit && v.stock !== undefined) {
                          return { ...v, stock: (v.stock || 0) + done.quantity };
                        }
                        return v;
                      });
                      await db.from("products").update({ weight_pricing: restoredWp }).eq("id", done.productId);
                    }
                  } else {
                    const { data: pf } = await db.from("products").select("stock").eq("id", done.productId).single();
                    if (pf) await db.from("products").update({ stock: (pf.stock || 0) + done.quantity }).eq("id", done.productId);
                  }
                } else {
                  if (done.weight && done.unit) {
                    const { data: pf } = await db.from("products").select("weight_pricing").eq("id", done.productId).single();
                    if (pf && Array.isArray(pf.weight_pricing)) {
                      const restoredWp = pf.weight_pricing.map(v => {
                        if (Number(v.weight) === done.weight && v.unit === done.unit && v.stock !== undefined) {
                          return { ...v, stock: (v.stock || 0) + done.quantity };
                        }
                        return v;
                      });
                      await db.from("products").update({ weight_pricing: restoredWp }).eq("id", done.productId);
                    }
                  } else {
                    const { data: pf } = await db.from("products").select("stock").eq("id", done.productId).single();
                    if (pf) await db.from("products").update({ stock: (pf.stock || 0) + done.quantity }).eq("id", done.productId);
                  }
                }
              } catch (rollbackErr) {
                logger.error(`[checkout] Rollback failed for ${done.productId}: ${rollbackErr.message}`);
              }
            }
            await db.from("orders").delete().eq("id", generatedOrderId).catch(() => {});
            return respondError(res, `Failed to reserve stock for ${sd.name}. Please try again.`, 500);
          }
        }
      }

      // Store product IDs in order metadata for potential restock later
      newOrder._decrementedProducts = decrementedProducts;

      // ── Fire-and-forget low-stock alert for admin ──
      setImmediate(async () => {
        try {
          for (const sd of stockDeductions) {
            const { data: p } = await db.from("products").select("stock, low_stock_threshold, name").eq("id", sd.productId).single();
            if (p && p.stock <= (p.low_stock_threshold || 10)) {
              const adminMsg = `⚠️ Low Stock Alert: "${p.name}" has only ${p.stock} unit(s) left (threshold: ${p.low_stock_threshold || 10}).`;
              logger.warn(`[Inventory] ${adminMsg}`);
              try {
                const { notify } = require("../services/notificationService");
                await notify("ORDER_PLACED", newOrder, { role: "admin" }, { alert: adminMsg, _adminOnly: true });
              } catch (_) {}
            }
          }
        } catch (_) {}
      });

      // Phase 5: Auto-start cancellation window on order creation
      if (FEATURE_FLAGS.SELF_CANCEL_WINDOW) {
        try {
          const { setCancelWindow } = require("../modules/orders/OrderStateService");
          await setCancelWindow(generatedOrderId, 30);
          logger.info(`[checkout] Cancel window set for order ${generatedOrderId}`);
        } catch (cwErr) {
          logger.warn(`[checkout] Failed to set cancel window for ${generatedOrderId}: ${cwErr.message}`);
        }
      }

      // Backfill customer_email via an immediate UPDATE if the column now exists
      if (customerEmail && newOrder && newOrder.id) {
        db.from("orders")
          .update({ customer_email: customerEmail })
          .eq("id", newOrder.id)
          .then(() => { })
          .catch(() => { });
      }

      // Call Razorpay API to generate order
      // Razorpay amount is in paise (1 INR = 100 paise)
      const amountInPaise = Math.round(total * 100);
      const rzpOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: "INR",
        receipt: `receipt_${newOrder.id}`,
        notes: {
          orderId: newOrder.id,
          userId: req.user.userId,
        },
      });

      // Update order with Razorpay Order ID
      await db
        .from("orders")
        .update({ razorpay_order_id: rzpOrder.id })
        .eq("id", newOrder.id);

      newOrder.razorpay_order_id = rzpOrder.id;

      // Sync address back to user profile
      if (req.user && req.user.userId && rawAddress) {
        const addressUpdates = { default_address: rawAddress };
        if (address_line1) addressUpdates.address_line1 = address_line1;
        if (address_line2) addressUpdates.address_line2 = address_line2;
        if (landmark) addressUpdates.landmark = landmark;
        if (city) addressUpdates.city = city;
        if (state) addressUpdates.state = state;
        if (pincode) addressUpdates.default_pincode = pincode;

        await db.from("users").update(addressUpdates).eq("id", req.user.userId);
      }

      return success(res, {
        order: newOrder,
        razorpay: {
          orderId: rzpOrder.id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
          keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_mockKey",
        },
      });
    } catch (error) {
      return respondError(res, error.message || "Checkout failed", 500);
    }
  },
);

const verifyPaymentSchema = Joi.object({
  razorpay_order_id: Joi.string()
    .required()
    .messages({ "any.required": "Razorpay order ID is required." }),
  razorpay_payment_id: Joi.string()
    .required()
    .messages({ "any.required": "Razorpay payment ID is required." }),
  razorpay_signature: Joi.string()
    .required()
    .messages({ "any.required": "Razorpay signature is required." }),
});

// POST /api/orders/confirm-upi-payment
// Called when user pays directly via UPI QR (no Razorpay payment ID generated).
// Marks order as paid with pending admin approval so it shows up in New Orders tab.
router.post(
  "/confirm-upi-payment",
  authMiddleware,
  requireRole("buyer"),
  validateBody(
    Joi.object({
      razorpay_order_id: Joi.string().required(),
      upi_ref: Joi.string().allow('', null).optional(),
    }),
  ),
  async (req, res) => {
    try {
      const { razorpay_order_id, upi_ref } = req.body;

      // Mark as paid with pending admin approval so the order shows up in New Orders.
      const paymentId = upi_ref || `UPI-${Date.now()}`;
      const transactionId = `TXN-${paymentId}`;

      const { data: existingOrder } = await db
        .from("orders")
        .select("invoice_token")
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      const invoiceToken =
        existingOrder?.invoice_token || crypto.randomBytes(12).toString("hex");

      const upiUpdatePayload = {
        status: FEATURE_FLAGS.SELF_CANCEL_WINDOW ? OrderStates.PAYMENT_VERIFIED : "paid",
        delivery_status: "placed",
        admin_approval_status: "pending",
        payment_method: "UPI QR",
        razorpay_payment_id: paymentId,
        transaction_id: transactionId,
        invoice_token: invoiceToken,
        updated_at: new Date().toISOString(),
      };
      if (FEATURE_FLAGS.SELF_CANCEL_WINDOW) {
        upiUpdatePayload.cancel_window_expires = null;
      }

      const { data: updatedOrder, error } = await db
        .from("orders")
        .update(upiUpdatePayload)
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      if (error) {
        return respondError(res, error.message || "Failed to update order", 500);
      }

      // Phase 4: Deduct inventory for UPI orders
      if (FEATURE_FLAGS.INVENTORY_SERVICE) {
        try {
          const { data: reservations } = await db
            .from("inventory_reservations")
            .select("id, product_id, quantity")
            .eq("order_id", updatedOrder.id)
            .eq("status", "active");
          if (reservations && reservations.length > 0) {
            for (const res of reservations) {
              await inventoryService.confirmReservation(res.id, updatedOrder.id);
              await inventoryService.deductStock(res.product_id, res.quantity, updatedOrder.id);
            }
          }
        } catch (invErr) {
          logger.warn(`[orders] Inventory deduction failed for UPI order ${updatedOrder.id}: ${invErr.message}`);
        }
      }

      try {
        sendSseEvent(
          "order:updated",
          { order: updatedOrder },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === updatedOrder.user_id),
        );
      } catch (e) { /* ignore SSE errors */ }

      // Send WhatsApp invoice on order placement
      try {
        const { data: user } = await db
          .from("users")
          .select("*")
          .eq("id", updatedOrder.user_id)
          .single();
        if (user) {
          sendInvoiceWhatsApp(updatedOrder, user, req).catch(() => { });
        }
      } catch (e) {
        // ignore WhatsApp errors
      }

      return success(res, {
        message: "UPI payment confirmed successfully.",
        status: "paid",
        order: updatedOrder,
      });
    } catch (err) {
      return respondError(res, err.message || "Failed to confirm UPI payment", 500);
    }
  },
);

// POST /api/orders/confirm-cod-payment
// Called when user selects Cash on Delivery.
// Marks order as placed, sets payment_method to COD, status to placed (representing unpaid), and pending admin approval.
router.post(
  "/confirm-cod-payment",
  authMiddleware,
  requireRole("buyer"),
  validateBody(
    Joi.object({
      razorpay_order_id: Joi.string().required(),
    }),
  ),
  async (req, res) => {
    try {
      const { razorpay_order_id } = req.body;

      const paymentId = `COD-${Date.now()}`;
      const transactionId = `TXN-${paymentId}`;

      const { data: existingOrder } = await db
        .from("orders")
        .select("invoice_token")
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      const invoiceToken =
        existingOrder?.invoice_token || crypto.randomBytes(12).toString("hex");

      const { data: updatedOrder, error } = await db
        .from("orders")
        .update({
          status: "placed", // COD order is placed but unpaid yet
          delivery_status: "placed",
          admin_approval_status: "pending",
          payment_method: "COD",
          razorpay_payment_id: paymentId,
          transaction_id: transactionId,
          invoice_token: invoiceToken,
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      if (error) {
        return respondError(res, error.message || "Failed to update order", 500);
      }

      // Phase 4: Deduct inventory for COD orders
      if (FEATURE_FLAGS.INVENTORY_SERVICE) {
        try {
          const { data: reservations } = await db
            .from("inventory_reservations")
            .select("id, product_id, quantity")
            .eq("order_id", updatedOrder.id)
            .eq("status", "active");
          if (reservations && reservations.length > 0) {
            for (const res of reservations) {
              await inventoryService.confirmReservation(res.id, updatedOrder.id);
              await inventoryService.deductStock(res.product_id, res.quantity, updatedOrder.id);
            }
          }
        } catch (invErr) {
          logger.warn(`[orders] Inventory deduction failed for COD order ${updatedOrder.id}: ${invErr.message}`);
        }
      }

      try {
        sendSseEvent(
          "order:updated",
          { order: updatedOrder },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === updatedOrder.user_id),
        );
      } catch (e) { /* ignore SSE errors */ }

      // Send WhatsApp invoice on order placement
      try {
        const { data: user } = await db
          .from("users")
          .select("*")
          .eq("id", updatedOrder.user_id)
          .single();
        if (user) {
          sendInvoiceWhatsApp(updatedOrder, user, req).catch(() => { });
        }
      } catch (e) {
        // ignore WhatsApp errors
      }

      return success(res, {
        message: "COD order confirmed successfully.",
        status: "placed",
        order: updatedOrder,
      });
    } catch (err) {
      return respondError(res, err.message || "Failed to confirm COD payment", 500);
    }
  },
);

// POST /api/orders/verify-payment
// Confirm signature & finalize order
router.post(
  "/verify-payment",
  authMiddleware,
  requireRole("buyer"),
  validateBody(verifyPaymentSchema),
  async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
        req.body;

      const isValid = razorpay.payments.verifySignature({
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      });

      if (isValid) {
        // Re-check stock availability before confirming payment
        const { data: pendingOrder } = await db
          .from("orders")
          .select("id, items, total")
          .eq("razorpay_order_id", razorpay_order_id)
          .single();

        if (pendingOrder && Array.isArray(pendingOrder.items)) {
          for (const item of pendingOrder.items) {
            const qty = parseInt(item.quantity, 10) || 0;
            if (qty <= 0 || !item.productId) continue;
            const { data: prod } = await db
              .from("products")
              .select("stock, reserved_quantity, weight_pricing")
              .eq("id", item.productId)
              .single();

            if (prod) {
              let available;
              let labelSuffix = '';

              // Check variant-level stock if item has weight/unit
              if (item.weight !== undefined && item.unit !== undefined && Array.isArray(prod.weight_pricing)) {
                const variant = prod.weight_pricing.find(
                  v => Number(v.weight) === Number(item.weight) && v.unit === item.unit && v.stock !== undefined
                );
                if (variant) {
                  available = variant.stock;
                  labelSuffix = ` (${item.weight}${item.unit})`;
                }
              }

              if (available === undefined) {
                available = prod.stock - (prod.reserved_quantity || 0);
              }

              if (available < qty) {
                await db.from("orders").update({ status: "failed" }).eq("razorpay_order_id", razorpay_order_id);
                try {
                  await razorpay.payments.refund(razorpay_payment_id, {
                    amount: Math.round(Number(pendingOrder.total || 0) * 100),
                    notes: { reason: "Stock unavailable at payment confirmation", order_id: pendingOrder.id },
                  });
                } catch (refundErr) {
                  logger.warn(`[verify-payment] Auto-refund failed for order ${pendingOrder.id}: ${refundErr.message}`);
                }
                return respondError(res, `Sorry, "${item.name || item.productId}${labelSuffix}" is now out of stock. Your payment will be refunded.`, 409);
              }
            }
          }
        }

        // Update order status to paid and record payment details
        const transactionId = `TXN-${razorpay_payment_id}`;
        const { data: existingOrder } = await db
          .from("orders")
          .select("invoice_token")
          .eq("razorpay_order_id", razorpay_order_id)
          .single();
        const invoiceToken =
          existingOrder && existingOrder.invoice_token
            ? existingOrder.invoice_token
            : crypto.randomBytes(12).toString("hex");
        const updatePayload = {
          status: FEATURE_FLAGS.SELF_CANCEL_WINDOW ? OrderStates.PAYMENT_VERIFIED : "paid",
          delivery_status: "placed",
          admin_approval_status: "pending",
          payment_method: "Razorpay",
          razorpay_payment_id,
          transaction_id: transactionId,
          invoice_token: invoiceToken,
          updated_at: new Date().toISOString(),
        };
        if (FEATURE_FLAGS.SELF_CANCEL_WINDOW) {
          updatePayload.cancel_window_expires = null;
        }

        const { data: updatedOrder, error } = await db
          .from("orders")
          .update(updatePayload)
          .eq("razorpay_order_id", razorpay_order_id)
          .single();

        if (error) {
          return respondError(
            res,
            error.message || "Failed to update order",
            500,
          );
        }

        // Phase 4: Confirm reservation + hard-deduct stock
        if (FEATURE_FLAGS.INVENTORY_SERVICE) {
          try {
            const { data: reservations } = await db
              .from("inventory_reservations")
              .select("id, product_id, quantity")
              .eq("order_id", updatedOrder.id)
              .eq("status", "active");
            if (reservations && reservations.length > 0) {
              for (const res of reservations) {
                await inventoryService.confirmReservation(res.id, updatedOrder.id);
                await inventoryService.deductStock(res.product_id, res.quantity, updatedOrder.id);
              }
            }
          } catch (invErr) {
            logger.warn(`[orders] Inventory reservation/deduction failed for order ${updatedOrder.id}: ${invErr.message}`);
          }
        }

        // Emit SSE event for updated order (admins + order owner)
        try {
          sendSseEvent(
            "order:updated",
            { order: updatedOrder },
            (sub) =>
              (sub.user && sub.user.role === "admin") ||
              (sub.user && sub.user.userId === updatedOrder.user_id),
          );
        } catch (e) {
          // ignore SSE errors
        }

        // Send WhatsApp invoice on order placement
        try {
          const { data: user } = await db
            .from("users")
            .select("*")
            .eq("id", updatedOrder.user_id)
            .single();
          if (user) {
            sendInvoiceWhatsApp(updatedOrder, user, req).catch(() => { });
          }
        } catch (e) {
          // ignore WhatsApp errors
        }

        return success(res, {
          message: "Payment verified successfully.",
          order: updatedOrder,
        });
      }
      // Only mark as failed if order is still in a pending state.
      // This prevents overwriting statuses like CANCEL_REQUESTED,
      // CANCEL_APPROVED, or REFUND_* that may have been set by a
      // concurrent cancel/refund flow.
      const { data: currentOrder } = await db
        .from("orders")
        .select("*")
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      if (currentOrder && ["pending", "pending_upi_verification"].includes(currentOrder.status)) {
        // Restock items since stock was decremented during checkout but payment failed
        if (Array.isArray(currentOrder.items) && currentOrder.items.length > 0) {
          setImmediate(async () => {
            for (const item of currentOrder.items) {
              try {
                const qty = parseInt(item.quantity, 10) || 0;
                if (qty <= 0 || !item.productId) continue;
                const { data: prod } = await db.from("products").select("stock").eq("id", item.productId).single();
                if (prod) {
                  await db.from("products").update({ stock: (prod.stock || 0) + qty }).eq("id", item.productId);
                  logger.info(`[verify-payment] Restocked ${item.productId} x${qty} due to payment failure for order ${currentOrder.id}`);
                }
              } catch (restockErr) {
                logger.error(`[verify-payment] Failed to restock ${item.productId}: ${restockErr.message}`);
              }
            }
          });
        }

        // Use version-based optimistic update to prevent overwriting concurrent status changes
        const version = Number(currentOrder.version || 0);
        const { data: failedOrder } = await db
          .from("orders")
          .update({ status: "failed", version: version + 1 })
          .eq("razorpay_order_id", razorpay_order_id)
          .eq("version", version)
          .single();

        // If no rows were updated (version mismatch due to concurrent change), skip SSE broadcast
        if (!failedOrder) {
          logger.warn(`[verify-payment] Skipped status update for order ${currentOrder.id} — concurrent status change detected`);
          return respondError(res, "Payment verification failed.", 400);
        }

        // Broadcast failure via SSE so frontends update in real-time
        try {
          if (failedOrder) {
            sendSseEvent(
              "order:updated",
              { order: failedOrder },
              (sub) =>
                (sub.user && sub.user.role === "admin") ||
                (sub.user && sub.user.userId === currentOrder.user_id),
            );
          }
        } catch (e) { /* ignore SSE errors */ }
      }

      return respondError(res, "Payment verification failed.", 400);
    } catch (error) {
      return respondError(
        res,
        error.message || "Payment verification failed",
        500,
      );
    }
  },
);

// GET /api/orders/shipping-settings
// Fetch global shipping charge for cart and checkout
router.get("/shipping-settings", async (req, res) => {
  try {
    const { data: setting } = await db
      .from("settings")
      .select("value")
      .eq("key", "shipping_charge")
      .single();
    const shippingCharge = setting ? Number(setting.value) : 0;
    return success(res, { shipping_charge: shippingCharge });
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch shipping settings",
      500,
    );
  }
});

// PUT /api/orders/shipping-settings
// Admin updates global shipping charge
router.put("/shipping-settings", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const shipping_charge = Number(req.body.shipping_charge);
    if (Number.isNaN(shipping_charge) || shipping_charge < 0) {
      return respondError(
        res,
        "Shipping charge must be a non-negative number.",
        400,
      );
    }

    const { data: existingSetting, error: selectError } = await db
      .from("settings")
      .select("*")
      .eq("key", "shipping_charge")
      .single();
    if (selectError || !existingSetting) {
      const { data: insertedSetting, error: insertError } = await db
        .from("settings")
        .insert({
          key: "shipping_charge",
          value: shipping_charge,
        })
        .single();
      if (insertError) {
        return respondError(
          res,
          insertError.message || "Failed to create setting",
          500,
        );
      }
      return success(res, {
        shipping_charge: Number(insertedSetting.value) || 0,
      });
    }

    const { data: updatedSetting, error: updateError } = await db
      .from("settings")
      .update({ value: shipping_charge })
      .eq("key", "shipping_charge")
      .single();

    if (updateError) {
      return respondError(
        res,
        updateError.message || "Failed to update setting",
        500,
      );
    }

    return success(res, { shipping_charge: Number(updatedSetting.value) || 0 });
  } catch (error) {
    return respondError(
      res,
      error.message || "Shipping settings update failed",
      500,
    );
  }
});

// GET /api/orders/my-orders
// Fetch all orders of authenticated user with resolved state
router.get("/my-orders", authMiddleware, async (req, res) => {
  try {
    const { data: orders, error } = await req.db
      .from("orders")
      .select("*")
      .eq("user_id", req.user.userId)
      .order("created_at", { ascending: false });

    if (error) {
      return respondError(res, error.message || "Failed to fetch orders", 500);
    }

    const enriched = (orders || []).map(o => ({
      ...o,
      resolved_state: resolveState(o),
      cancellable: !['shipped', 'in_transit', 'delivered'].includes(o.delivery_status) &&
        !['cancelled', 'refunded', 'CANCEL_REQUESTED', 'REFUND_FAILED', 'REFUND_COMPLETED', 'MANUAL_REFUND_INITIATED', 'MANUAL_REFUND_COMPLETED'].includes(o.status),
      invoice_accessible: (['shipped', 'in_transit', 'delivered'].includes(o.delivery_status)),
    }));

    return success(res, enriched);
  } catch (error) {
    return respondError(res, error.message || "Failed to fetch orders", 500);
  }
});

// GET /api/orders/all-orders
// Fetch all orders in the system (admin only)
router.get("/all-orders", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { data: orders, error: ordersErr } = await db
      .from("orders")
      .select("*");
    if (ordersErr) {
      return respondError(
        res,
        ordersErr.message || "Failed to fetch orders",
        500,
      );
    }

    const { data: users } = await db.from("users").select("*");
    const userMap = {};
    if (users) {
      users.forEach((u) => {
        userMap[u.id] = u.email;
      });
    }

    const enrichedOrders = orders.map((o) => ({
      ...o,
      user_email: userMap[o.user_id] || "unknown@sporekart.com",
      resolved_state: resolveState(o),
      cancellable: !['shipped', 'in_transit', 'delivered'].includes(o.delivery_status) &&
        !['cancelled', 'refunded', 'CANCEL_REQUESTED', 'REFUND_FAILED', 'REFUND_COMPLETED', 'MANUAL_REFUND_INITIATED', 'MANUAL_REFUND_COMPLETED'].includes(o.status),
      invoice_accessible_admin: (['shipped', 'in_transit', 'delivered'].includes(o.delivery_status)) ||
        (o.delivery_status === 'cancelled' && o.status === 'paid'),
    }));

    // Sort descending by created_at
    enrichedOrders.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    return success(res, enrichedOrders);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch all orders",
      500,
    );
  }
});

// PUT /api/orders/:id/fulfillment
// Update fulfillment status (admin only) — replaces manual delivery_status progression
router.put("/:id/fulfillment", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { fulfillment_status } = req.body;
    if (!fulfillment_status) {
      return respondError(res, "Fulfillment status is required.", 400);
    }

    const validStatuses = ['pending_fulfillment', 'packing_required', 'packing', 'packed', 'awaiting_pickup', 'ready_to_ship', 'with_carrier', 'delivered', 'shipment_failed'];
    if (!validStatuses.includes(fulfillment_status)) {
      return respondError(res, `Invalid fulfillment status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (orderErr || !order) {
      return respondError(res, "Order not found.", 404);
    }

    if (order.status === "cancelled" || order.status === "refunded") {
      return respondError(res, "Cannot change fulfillment of a cancelled or refunded order.", 400);
    }

    if (order.refund_status === "initiated" || order.refund_status === "processed") {
      return respondError(res, "Cannot change fulfillment of an order with an active refund.", 400);
    }

    const previousFulfillment = order.fulfillment_status;

    const updatePayload = {
      fulfillment_status,
      updated_at: new Date().toISOString(),
    };

    // Set shipped_at/delivered_at when transitioning
    if (fulfillment_status === 'with_carrier' && !order.shipped_at) {
      updatePayload.shipped_at = new Date().toISOString();
    }
    if (fulfillment_status === 'delivered' && !order.delivered_at) {
      updatePayload.delivered_at = new Date().toISOString();
    }

    if (!order.invoice_token) {
      updatePayload.invoice_token = crypto.randomBytes(12).toString("hex");
    }

    const { data: updatedOrder, error } = await db
      .from("orders")
      .update(updatePayload)
      .eq("id", req.params.id)
      .single();

    if (error) {
      return respondError(res, error.message || "Failed to update fulfillment", 500);
    }

    // Log to order_status_history
    await db.from("order_status_history").insert({
      order_id: order.id,
      field_name: "fulfillment_status",
      old_value: previousFulfillment,
      new_value: fulfillment_status,
      changed_by: req.user.userId || req.user.id || "admin",
      changed_at: new Date().toISOString(),
    });

    let finalOrder = updatedOrder;

    // If transitioning to ready_to_ship, auto-create shipment via default provider
    if (fulfillment_status === 'ready_to_ship') {
      try {
        const { getDefaultProvider } = require("../services/shipping/ProviderRegistry");
        const provider = await getDefaultProvider();
        if (provider) {
          const { data: providerRecord } = await db
            .from("shipping_providers")
            .select("id")
            .eq("provider_key", provider.provider.provider_key)
            .single();

          if (providerRecord) {
            const shipmentPayload = {
              order_id: order.id,
              order_date: order.created_at,
              pickup_location: "Primary",
              billing_customer_name: order.customer_name || "Customer",
              billing_last_name: "",
              billing_address: order.delivery_address || "",
              billing_phone: order.delivery_phone || "",
              billing_email: order.customer_email || "",
              shipping_is_billing: true,
              order_items: (order.items || []).map((item) => ({
                name: item.name || "Item",
                quantity: item.quantity || 1,
                price: item.price || 0,
              })),
              payment_method: order.payment_method === "COD" ? "COD" : "Prepaid",
              sub_total: order.subtotal || 0,
              weight: 0.5,
            };

            const shipmentResult = await provider.adapter.createShipment(shipmentPayload);
            let awbResult = null;
            if (shipmentResult.shipment_id) {
              awbResult = await provider.adapter.assignCourier(shipmentResult.shipment_id);
              await provider.adapter.schedulePickup(shipmentResult.shipment_id);
              await provider.adapter.generateLabel(shipmentResult.shipment_id);
            }

            const providerShipmentId = shipmentResult.shipment_id ? String(shipmentResult.shipment_id) : null;

            const { data: newShipment } = await db.from("shipments").insert({
              order_id: order.id,
              shipping_provider_id: providerRecord.id,
              awb_code: awbResult?.awb_code || null,
              status: "pending",
              weight: 0.5,
              is_cod: order.payment_method === "COD",
              courier_name: awbResult?.courier_name || null,
              provider_shipment_id: providerShipmentId,
              service_type: awbResult?.courier_name ? 'standard' : null,
              provider_response: shipmentResult,
              pickup_requested: true,
              pickup_requested_at: new Date().toISOString(),
              label_generated: true,
              origin_address: process.env.SHOP_ADDRESS || 'Primary Warehouse',
              recipient_address_snapshot: JSON.parse(JSON.stringify({
                name: order.customer_name,
                phone: order.delivery_phone,
                address: order.delivery_address,
              })),
            }).single();

            // Link shipment to order and advance to with_carrier
            if (newShipment) {
              const { data: linkedOrder } = await db.from("orders").update({
                shipment_id: newShipment.id,
                fulfillment_status: "with_carrier",
                shipped_at: order.shipped_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }).eq("id", order.id).single();

              await db.from("order_status_history").insert({
                order_id: order.id,
                field_name: "shipment_id",
                old_value: null,
                new_value: newShipment.id,
                changed_by: "system",
                changed_at: new Date().toISOString(),
              });

              if (linkedOrder) finalOrder = linkedOrder;
            }
          }
        }
      } catch (shipErr) {
        logger.error(`[orders] Auto-shipment creation failed for ${order.id}: ${shipErr.message}`);
      }
    }

    // Notify on delivered
    if (fulfillment_status === 'delivered') {
      const { data: user } = await db
        .from("users")
        .select("*")
        .eq("id", order.user_id)
        .single()
        .catch(() => ({}));
      if (user) {
        notify('ORDER_DELIVERED', finalOrder, user, {}).catch(() => { });
      }

      // Phase 5: Auto-start return window on delivery
      try {
        const { startReturnWindow } = require("../modules/orders/OrderStateService");
        await startReturnWindow(order.id);
        logger.info(`[fulfillment] Return window started for order ${order.id}`);
      } catch (rwErr) {
        logger.warn(`[fulfillment] Failed to start return window for ${order.id}: ${rwErr.message}`);
      }
    }

    // SSE broadcast
    try {
      sendSseEvent("order:updated", { order: finalOrder },
        (sub) => (sub.user && sub.user.role === "admin") || (sub.user && sub.user.userId === finalOrder.user_id));
    } catch (e) { /* ignore */ }

    return success(res, {
      message: fulfillment_status === 'ready_to_ship'
        ? "Shipment created. Order moved to With Carrier."
        : "Fulfillment status updated successfully.",
      order: finalOrder,
    });
  } catch (error) {
    return respondError(res, error.message || "Fulfillment update failed", 500);
  }
});

// PUT /api/orders/:id/status — DEPRECATED
// Manual delivery_status updates are replaced by the fulfillment pipeline.
// Returns guidance on using PUT /orders/:id/fulfillment instead.
router.put("/:id/status", authMiddleware, async (req, res) => {
  return respondError(res,
    "Manual delivery_status updates are deprecated. Use PUT /orders/:id/fulfillment with fulfillment_status " +
    "(packing_required, packed, ready_to_ship, with_carrier, delivered) instead.", 400);
});
const cancelSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(255).required().messages({
    "string.empty": "Cancellation reason is required.",
    "any.required": "Cancellation reason is required."
  }),
  adminNote: Joi.string().trim().max(500).optional()
});

// PUT /api/orders/:id/cancel
// Allow admins to cancel an order — delegates to RefundService
// Customers should use POST /:id/request-cancel instead
router.put("/:id/cancel", authMiddleware, validateBody(cancelSchema), async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    if (!isAdmin) {
      return respondError(
        res,
        "Customers must use the 'Request Cancellation' option. Admins only for direct cancel.",
        403,
      );
    }

    const { data: beforeOrder } = await db
      .from("orders")
      .select("status, delivery_status, fulfillment_status")
      .eq("id", req.params.id)
      .single();

    const { reason, adminNote } = req.body;
    const result = await refundService.adminDirectCancellation(req.params.id, reason, adminNote, req.user);

    // Note: adminDirectCancellation handles carrier cancellation, restock, and refund internally.
    // Log to order_status_history
    if (beforeOrder) {
      await db.from("order_status_history").insert({
        order_id: req.params.id,
        field_name: "status",
        old_value: beforeOrder.status,
        new_value: "cancelled",
        changed_by: req.user.userId || req.user.id || "admin",
        changed_at: new Date().toISOString(),
      }).catch(() => {});
    }

    // SSE broadcast
    try {
      sendSseEvent(
        "order:updated",
        { order: result.order, refund: result.refund },
        (sub) =>
          (sub.user && sub.user.role === "admin") ||
          (sub.user && sub.user.userId === result.order.user_id),
      );
    } catch (e) {
      /* ignore */
    }

    return success(res, {
      message: result.refund
        ? "Order cancelled. Refund initiated — expect 5–7 business days."
        : "Order cancelled successfully. No auto-refund — admin will process refund manually.",
      order: result.order,
      refund: result.refund,
    });
  } catch (error) {
    return respondError(res, error.message || "Order cancellation failed", 500);
  }
});

//refund implementation-pravara
// GET /api/orders/:id/refund
// Fetch refund details for an order (owner or admin)
router.get("/:id/refund", authMiddleware, async (req, res) => {
  try {
    const { data: order, error: orderErr } = await req.db
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (orderErr || !order) return respondError(res, "Order not found.", 404);

    const isAdmin = req.user.role === "admin";
    const isOwner = order.user_id === req.user.userId;

    if (!isAdmin && !isOwner) {
      return respondError(res, "Access denied.", 403);
    }

    if (!order.refund_id) {
      return success(res, {
        refund: null,
        message: "No refund associated with this order.",
      });
    }

    const { data: refund, error: refundErr } = await req.db
      .from("refunds")
      .select("*")
      .eq("id", order.refund_id)
      .single();

    if (refundErr) return respondError(res, "Failed to fetch refund.", 500);

    return success(res, { refund });
  } catch (error) {
    return respondError(res, error.message || "Failed to fetch refund", 500);
  }
});

// GET /api/orders/admin/refunds
// Admin: list all refunds across all orders
router.get("/admin/refunds", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { data: refunds, error } = await db
      .from("refunds")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return respondError(res, error.message, 500);

    // Enrich with order and user info
    const enriched = await Promise.all(
      refunds.map(async (r) => {
        const { data: user } = await db
          .from("users")
          .select("email, full_name")
          .eq("id", r.user_id)
          .single();
        return { ...r, user_email: user?.email, user_name: user?.full_name };
      }),
    );

    return success(res, enriched);
  } catch (error) {
    return respondError(res, error.message || "Failed to fetch refunds", 500);
  }
});

// GET /api/orders/:id/invoice
// Generate detailed invoice data
router.get("/:id/invoice", authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await req.db
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error || !order) {
      return respondError(res, "Order not found.", 404);
    }

    // Ownership check: user must own the order or be admin
    const isOwner =
      String(order.user_id) === String(req.user.userId || req.user.id);
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return respondError(
        res,
        "Access denied. You do not have permission to view this invoice.",
        403,
      );
    }

    // Invoice visibility rules (see implementation plan §10)
    const isShippedOrLater = ["shipped", "in_transit", "delivered"].includes(order.delivery_status);
    const isCancelledPaid = order.delivery_status === "cancelled" && order.status === "paid";

    if (!isShippedOrLater && !(isAdmin && isCancelledPaid)) {
      return respondError(
        res,
        "Invoice is not yet available for this order.",
        403,
      );
    }

    // Fetch user details for invoice billing info
    const { data: user } = await db
      .from("users")
      .select("*")
      .eq("id", order.user_id)
      .single();
    const invoice = buildInvoiceData(order, user);
    return success(res, invoice);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to generate invoice",
      500,
    );
  }
});

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Public invoice share endpoint for copyable/downloadable links
router.get("/share/:token", async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).send("Invoice token is missing.");
    }

    const { data: order, error } = await db
      .from("orders")
      .select("*")
      .eq("invoice_token", token)
      .single();
    if (error || !order) {
      return res.status(404).send("Invoice not found for this token.");
    }

    if (
      !["shipped", "in_transit", "delivered"].includes(order.delivery_status)
    ) {
      return res
        .status(403)
        .send(
          "Invoice is not yet available for this order.",
        );
    }

    const { data: user } = await db
      .from("users")
      .select("*")
      .eq("id", order.user_id)
      .single();
    const inv = buildInvoiceData(order, user);
    const shareUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const isDownload = req.query.download === "1";
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${escapeHtml(inv.invoiceNumber)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f4f7fb; color: #1d2939; }
    .page { max-width: 960px; margin: 24px auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08); }
    h1, h2, h3, h4 { margin: 0 0 12px; }
    .topbar { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
    .section { margin-top: 24px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .invoice-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    .invoice-table th, .invoice-table td { border: 1px solid #e2e8f0; padding: 12px; }
    .invoice-table th { background: #f8fafc; text-align: left; }
    .text-right { text-align: right; }
    .summary { margin-top: 16px; display: grid; grid-template-columns: 1fr auto; gap: 12px; }
    .summary div { padding: 12px; background: #f8fafc; border-radius: 10px; }
    .invoice-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    .invoice-actions a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; text-decoration: none; background: #0f766e; color: #fff; border-radius: 8px; cursor: pointer; }
    .invoice-actions a.secondary { background: #1d4ed8; }
    .invoice-actions a.download { background: #7c3aed; }
    @media print { .invoice-actions { display: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="topbar">
      <div>
        <h1>Sporekart Store</h1>
        <p>4th Genetic Floor, Agritech Park, Phase 2, Bangalore, Karnataka, 560064</p>
        <p>GSTIN: 29SPKRT9876A1Z0</p>
      </div>
      <div>
        <h2>Tax Invoice</h2>
        <p><strong>Invoice No:</strong> ${escapeHtml(inv.invoiceNumber)}</p>
        <p><strong>Date:</strong> ${new Date(inv.invoiceDate).toLocaleDateString("en-IN")}</p>
        <p><strong>Status:</strong> ${escapeHtml(inv.paymentStatus)}</p>
      </div>
    </div>

    <div class="section grid-2">
      <div>
        <h3>Billed To</h3>
        <p><strong>${escapeHtml(inv.buyer.name)}</strong></p>
        <p>Email: ${escapeHtml(inv.buyer.email || "N/A")}</p>
        <p>Phone: ${escapeHtml(inv.buyer.phone || "N/A")}</p>
      </div>
      <div>
        <h3>Delivery</h3>
        <p>${escapeHtml(inv.buyer.address || "N/A")}</p>
        ${order.expected_delivery_date ? `<p style="margin-top:8px;"><strong>Expected delivery:</strong> ${new Date(order.expected_delivery_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}${order.delivery_days_text ? ` (${order.delivery_days_text})` : ""}</p>` : ""}
      </div>
    </div>

    <div class="section">
      <table class="invoice-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th class="text-right">Unit Price</th>
            <th class="text-center">Qty</th>
            <th class="text-right">GST</th>
            <th class="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${inv.items
        .map(
          (item, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td>${escapeHtml(item.name)}</td>
              <td class="text-right">₹${item.price.toFixed(2)}</td>
              <td class="text-center">${item.quantity}</td>
              <td class="text-right">₹${item.gstAmount.toFixed(2)}</td>
              <td class="text-right">₹${item.total.toFixed(2)}</td>
            </tr>
          `,
        )
        .join("")}
        </tbody>
      </table>
    </div>

    <div class="summary">
      <div>
        <p><strong>Payment Method:</strong> ${escapeHtml(inv.paymentMethod)}</p>
        <p><strong>Transaction ID:</strong> ${escapeHtml(inv.transactionId || "N/A")}</p>
      </div>
      <div>
        <p><strong>Subtotal:</strong> ₹${inv.totals.subtotal.toFixed(2)}</p>
        <p><strong>Discount:</strong> -₹${inv.totals.discount.toFixed(2)}</p>
        <p><strong>GST:</strong> ₹${inv.totals.gstAmount.toFixed(2)}</p>
        <p><strong>Shipping:</strong> ₹${(inv.totals.shippingCharge || 0).toFixed(2)}</p>
        <p><strong>Total:</strong> ₹${inv.totals.total.toFixed(2)}</p>
      </div>
    </div>

    <div class="invoice-actions">
      <a href="javascript:window.print()">🖨️ Print Invoice</a>
      <a class="secondary" href="${escapeHtml(shareUrl)}">🔄 Reload Share Link</a>
      <a class="download" href="${escapeHtml(shareUrl)}?download=1">⬇️ Download Invoice</a>
    </div>
  </div>
  <script>
    ${isDownload ? "window.onload = function () { setTimeout(function () { window.print(); }, 500); };" : ""}
  </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// GET /api/orders/:id/track
// Get tracking status. Uses real shipment data if available, falls back to simulated tracking.
router.get("/:id/track", authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await req.db
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error || !order) {
      return respondError(res, "Order not found.", 404);
    }

    // Ownership check: user must own the order or be admin
    const isOwner =
      String(order.user_id) === String(req.user.userId || req.user.id);
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return respondError(
        res,
        "Access denied. You do not have permission to track this order.",
        403,
      );
    }

    // Admins bypass RLS for shipments/events
    const trackDb = isAdmin ? db : req.db;

    // Try to fetch real shipment tracking data
    const { data: shipment } = await trackDb
      .from("shipments")
      .select("*, shipping_provider_id")
      .eq("order_id", order.id)
      .single();

    if (shipment) {
      // Real shipment exists — build tracking from events
      const { data: events } = await trackDb
        .from("shipment_tracking_events")
        .select("*")
        .eq("shipment_id", shipment.id)
        .order("occurred_at", { ascending: true });

      const timeline = [
        {
          status: "placed",
          label: "Order Placed",
          done: true,
          time: order.created_at,
        },
      ];

      if (events && events.length > 0) {
        for (const ev of events) {
          timeline.push({
            status: ev.status,
            label: ev.description || ev.status,
            done: true,
            time: ev.occurred_at,
            location: ev.location,
          });
        }
      }

      const progressMap = {
        pending: 10,
        pickup_scheduled: 25,
        picked_up: 40,
        shipped: 60,
        in_transit: 75,
        out_for_delivery: 90,
        delivered: 100,
        cancelled: 0,
        returned: 0,
      };

      return success(res, {
        orderId: order.id,
        paymentStatus: order.status,
        paymentMethod: order.payment_method || (order.razorpay_order_id ? "Razorpay" : "Pending"),
        refundStatus: order.refund_status || "none",
        refundAmount: order.total_refunded_amount || 0,
        paymentId: order.razorpay_payment_id || "",
        transactionId: order.transaction_id || order.razorpay_payment_id || "",
        deliveryStatus: shipment.status,
        fulfillmentStatus: order.fulfillment_status || null,
        shippedAt: order.shipped_at || null,
        deliveredAt: order.delivered_at || null,
        cancelledAt: order.cancelled_at || null,
        cancelledBy: order.cancelled_by || null,
        progressPercent: progressMap[shipment.status] || 10,
        trackingMessage: `Shipment is ${shipment.status}. Courier: ${shipment.courier_name || "N/A"}${shipment.awb_code ? `. AWB: ${shipment.awb_code}` : ""}`,
        cancelReason: order.cancel_reason || "",
        cancelWindowExpires: order.cancel_window_expires || null,
        returnWindowExpires: order.return_window_expires || null,
        timestamp: new Date().toISOString(),
        timeline,
        hasRealTracking: true,
      });
    }

    // Fallback: simulated tracking (for demo / legacy orders)
    const diffMs = Date.now() - new Date(order.created_at).getTime();
    const diffMin = diffMs / (1000 * 60);

    let calculatedStatus = "placed";

    if (diffMin >= 1 && diffMin < 2) {
      calculatedStatus = "inoculating";
    } else if (diffMin >= 2 && diffMin < 4) {
      calculatedStatus = "shipped";
    } else if (diffMin >= 4) {
      calculatedStatus = "delivered";
    }

    const STATUS_INDEX = {
      placed: 0,
      inoculating: 1,
      processing: 1,
      shipped: 2,
      in_transit: 3,
      delivered: 4,
      cancelled: 5,
    };

    const statusResult =
      order.delivery_status === "cancelled" ? "cancelled" : calculatedStatus;
    const currentIdx = STATUS_INDEX[order.delivery_status] || 0;
    const simulatedIdx = STATUS_INDEX[statusResult] || 0;

    let responseStatus = order.delivery_status;

    if (
      order.status === "paid" &&
      order.delivery_status !== "cancelled" &&
      simulatedIdx > currentIdx
    ) {
      responseStatus = statusResult;
      // NOTE: Simulated tracking no longer writes to DB.
      // Real tracking is driven by carrier webhooks.
    }

    const getStatusDetails = (statusVal) => {
      switch (statusVal) {
        case "placed":
          return {
            progress: 10,
            msg: "Spores picked & prepped. Sterilization check in progress.",
          };
        case "inoculating":
        case "processing":
          return {
            progress: 40,
            msg: "Inoculation complete. Grains seeded with liquid mycelium under laminar flow.",
          };
        case "shipped":
          return {
            progress: 75,
            msg: "Mycelium fully colonised! Substrate block packaged in thermal safety bag and shipped.",
          };
        case "in_transit":
          return {
            progress: 85,
            msg: "Fruiting kit is in transit. Package has left the hub and is on its way to your location.",
          };
        case "delivered":
          return {
            progress: 100,
            msg: "Delivered! Arrived at your facility. Time to slit the bag, mist daily, and start fruiting.",
          };
        case "cancelled":
          return {
            progress: 0,
            msg: "Order was cancelled. Thank you for shopping with us.",
          };
        default:
          return {
            progress: 10,
            msg: "Spores picked & prepped. Sterilization check in progress.",
          };
      }
    };

    const details = getStatusDetails(responseStatus);
    const responseProgress = details.progress;
    const responseMessage = details.msg;

    const timeline = [
      {
        status: "placed",
        label: "Spores Selected",
        done: true,
        time: order.created_at,
      },
    ];

    if (order.delivery_status === "cancelled") {
      timeline.push({
        status: "cancelled",
        label: "Order cancelled",
        done: true,
        time:
          order.updated_at || order.cancelled_at || new Date().toISOString(),
      });
    } else {
      timeline.push({
        status: "inoculating",
        label: "Mycelium Inoculated (1 min elapsed)",
        done:
          diffMin >= 1 ||
          STATUS_INDEX[responseStatus] >= STATUS_INDEX["inoculating"],
      });
      timeline.push({
        status: "shipped",
        label: "Fruiting Kit Dispatched (2 mins elapsed)",
        done:
          diffMin >= 2 ||
          STATUS_INDEX[responseStatus] >= STATUS_INDEX["shipped"],
      });
      timeline.push({
        status: "delivered",
        label: "Ready to Harvest! (4 mins elapsed)",
        done:
          diffMin >= 4 ||
          STATUS_INDEX[responseStatus] >= STATUS_INDEX["delivered"],
      });
    }

    return success(res, {
      orderId: order.id,
      paymentStatus: order.status,
      paymentMethod: order.razorpay_order_id ? "Razorpay" : "Pending",
      refundStatus: order.refund_status || "none",
      refundAmount: order.total_refunded_amount || 0,
      paymentId: order.razorpay_payment_id || "",
      transactionId: order.transaction_id || order.razorpay_payment_id || "",
      deliveryStatus: responseStatus,
      fulfillmentStatus: order.fulfillment_status || null,
      shippedAt: order.shipped_at || null,
      deliveredAt: order.delivered_at || null,
      cancelledAt: order.cancelled_at || null,
      cancelledBy: order.cancelled_by || null,
      progressPercent: responseProgress,
      trackingMessage: responseMessage,
      cancelReason: order.cancel_reason || "",
      cancelWindowExpires: order.cancel_window_expires || null,
      returnWindowExpires: order.return_window_expires || null,
      timestamp: new Date().toISOString(),
      timeline,
      hasRealTracking: false,
    });
  } catch (error) {
    return respondError(res, error.message || "Order tracking failed", 500);
  }
});

// SSE: /api/orders/events
// Clients may connect with Authorization: Bearer <token>. Admins receive all order events.
router.get("/events", (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  let user = null;
  if (token) {
    try {
      user = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      // ignore invalid token; allow anonymous connections as read-only (no admin privileges)
      user = null;
    }
  }

  addSseSubscriber(req, res, user);
});

const reviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required().messages({
    "number.min": "Rating must be at least 1.",
    "number.max": "Rating must be at most 5.",
    "any.required": "Rating is required.",
  }),
  reviewText: Joi.string().allow("").max(1000).optional(),
});

// POST /api/orders/:id/review
// Add a rating and review text to a delivered order
router.post(
  "/:id/review",
  authMiddleware,
  validateBody(reviewSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { rating, reviewText } = req.body;

      const { data: order, error } = await req.db
        .from("orders")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !order) {
        return respondError(res, "Order not found", 404);
      }

      if (order.user_id !== req.user.userId) {
        return respondError(res, "Unauthorized to review this order", 403);
      }

      if (order.delivery_status !== "delivered") {
        return respondError(res, "Only delivered orders can be reviewed", 400);
      }

      await req.db
        .from("orders")
        .update({
          rating,
          review_text: reviewText || "",
        })
        .eq("id", id);

      return success(res, { message: "Review saved successfully" });
    } catch (error) {
      return respondError(res, error.message || "Failed to save review", 500);
    }
  },
);

const requestCancelSchema = Joi.object({
  reason: Joi.string().trim().min(1).required().messages({
    "any.required": "Cancellation reason is required.",
    "string.empty": "Cancellation reason is required.",
  }),
});

// POST /api/orders/:id/request-cancel
// Customer requests order cancellation before shipment
router.post(
  "/:id/request-cancel",
  authMiddleware,
  validateCancelRequest,
  async (req, res) => {
    try {
      const { reason } = req.body;

      // Lock check: cannot cancel shipped orders
      const { data: order } = await db
        .from("orders")
        .select("*")
        .eq("id", req.params.id)
        .single();
      if (order) {
        assertCancellable(order);
      }

      const { requestCustomerCancellation } = require("../modules/refunds/RefundService");
      const updatedOrder = await requestCustomerCancellation(req.params.id, req.user.userId, reason);

      // Emit SSE event for updated order (admins + order owner)
      try {
        sendSseEvent(
          "order:updated",
          { order: updatedOrder },
          (sub) =>
            (sub.user && sub.user.role === "admin") ||
            (sub.user && sub.user.userId === updatedOrder.user_id),
        );
      } catch (e) {
        // ignore SSE errors
      }

      return success(res, {
        message: "Cancellation request submitted. Pending admin approval.",
        order: updatedOrder
      });
    } catch (err) {
      return respondError(res, err.message, 400);
    }
  }
);

// Webhook consolidated in RefundController.js at POST /api/refunds/webhook

// GET /api/orders/:id
// Fetch a single order by ID (owner or admin)
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    // Use req.db for user queries (RLS-enforced) — admins use req.db too
    // because the order is shared between owner and admin in RLS policies
    const { data: order, error } = await req.db
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !order) return respondError(res, "Order not found.", 404);

    const isAdmin = req.user.role === "admin";
    const isOwner = order.user_id === req.user.userId;

    if (!isAdmin && !isOwner) {
      return respondError(res, "Access denied.", 403);
    }

    return success(res, order);
  } catch (error) {
    return respondError(res, error.message || "Failed to fetch order", 500);
  }
});

// POST /api/orders/admin/approve/:id
// Admin approves a PENDING_APPROVAL order → PLACED, triggers shipment creation
router.post("/admin/approve/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { adminNote } = req.body;

    const { data: order } = await db
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (!order) {
      return respondError(res, "Order not found.", 404);
    }

    if (order.admin_approval_status !== "pending") {
      return respondError(res, "Order is not pending approval.", 400);
    }

    const { data: updatedOrder, error: updateError } = await db
      .from("orders")
      .update({
        status: FEATURE_FLAGS.SELF_CANCEL_WINDOW ? OrderStates.APPROVED : "paid",
        admin_approval_status: "approved",
        fulfillment_status: "pending_fulfillment",
        version: (order.version || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .eq("version", order.version || 0)
      .select()
      .single();

    if (updateError) {
      if (updateError.code === "PGRST116") {
        return respondError(res, "Order was modified by another admin. Please refresh and try again.", 409);
      }
      return respondError(res, updateError.message || "Failed to approve order", 500);
    }

    await logAuditAction({
      orderId: order.id,
      action: AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
      performedBy: req.user,
      previousState: "pending",
      newState: "approved",
      metadata: { adminNote }
    });

    await db.from("order_status_history").insert({
      order_id: order.id,
      field_name: "admin_approval_status",
      old_value: "pending",
      new_value: "approved",
      changed_by: req.user.userId || req.user.id || "admin",
      changed_at: new Date().toISOString(),
    });

    const { data: user } = await db
      .from("users")
      .select("*")
      .eq("id", order.user_id)
      .single();

    await notify("ORDER_APPROVED", updatedOrder, user, { adminNote });

    // NOTE: Shipment creation no longer happens at approval.
    // Admin must move through fulfillment: approve → pack → ready_to_ship
    // Shipment auto-creates at ready_to_ship transition.

    // SSE broadcast
    try {
      sendSseEvent(
        "order:updated",
        { order: updatedOrder },
        (sub) =>
          (sub.user && sub.user.role === "admin") ||
          (sub.user && sub.user.userId === updatedOrder.user_id),
      );
    } catch (e) { /* ignore */ }

    return success(res, {
      message: "Order approved successfully.",
      order: updatedOrder,
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to approve order", 500);
  }
});

// POST /api/orders/admin/reject/:id
// Admin rejects a PENDING_APPROVAL order → REJECTED
const rejectOrderSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(500).required().messages({
    "string.empty": "Rejection reason is required.",
    "any.required": "Rejection reason is required."
  }),
  adminNote: Joi.string().trim().max(500).optional()
});

router.post("/admin/reject/:id", authMiddleware, requireRole("admin"), validateBody(rejectOrderSchema), async (req, res) => {
  try {
    const { reason, adminNote } = req.body;

    const { data: order } = await db
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (!order) {
      return respondError(res, "Order not found.", 404);
    }

    if (order.admin_approval_status !== "pending") {
      return respondError(res, "Only orders pending approval can be rejected.", 400);
    }

    const paidStatuses = ["paid", OrderStates.PAYMENT_VERIFIED, OrderStates.APPROVED].filter(Boolean);
    const isPaid = paidStatuses.includes(order.status) && (order.razorpay_payment_id || order.payment_method === "UPI QR");

    const { data: updatedOrder, error: updateError } = await db
      .from("orders")
      .update({
        status: FEATURE_FLAGS.SELF_CANCEL_WINDOW ? OrderStates.ADMIN_REJECTED : "cancelled",
        delivery_status: FEATURE_FLAGS.SELF_CANCEL_WINDOW ? "rejected" : "cancelled",
        admin_approval_status: "rejected",
        cancel_reason: reason,
        cancelled_by: "admin",
        cancelled_at: new Date().toISOString(),
        refund_status: isPaid ? "pending" : "none",
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .single();

    if (updateError) {
      return respondError(res, updateError.message || "Failed to reject order", 500);
    }

    await logAuditAction({
      orderId: order.id,
      action: AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
      performedBy: req.user,
      previousState: "pending",
      newState: "rejected",
      metadata: { reason, adminNote }
    });

    if (isPaid && order.razorpay_payment_id) {
      try {
        const { executeRefundProcess } = require("../modules/refunds/RefundService");
        await executeRefundProcess(order, order.total, "admin", reason, adminNote, req.user);
      } catch (refundErr) {
        logger.error(`[orders] Auto-refund failed for rejected order ${order.id}: ${refundErr.message}`);
      }
    } else {
      const { restockOrderItems } = require("../modules/orders/OrderStateService");
      await restockOrderItems(order);
    }

    const { data: user } = await db
      .from("users")
      .select("*")
      .eq("id", order.user_id)
      .single();

    await notify("ORDER_REJECTED", updatedOrder, user, { reason, adminNote });

    // SSE broadcast
    try {
      sendSseEvent(
        "order:updated",
        { order: updatedOrder },
        (sub) =>
          (sub.user && sub.user.role === "admin") ||
          (sub.user && sub.user.userId === updatedOrder.user_id),
      );
    } catch (e) { /* ignore */ }

    return success(res, {
      message: "Order rejected.",
      order: updatedOrder,
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to reject order", 500);
  }
});

// GET /api/orders/admin/:id/audit-logs
// Admin: get audit logs for a specific order
router.get("/admin/:id/audit-logs", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { getAuditLogs } = require("../services/AuditLogService");
    const logs = await getAuditLogs(req.params.id);
    return success(res, logs || []);
  } catch (err) {
    return respondError(res, err.message || "Failed to fetch audit logs", 500);
  }
});

// ==========================================================================
// Phase 3 — COD OTP & Payment Retry
// ==========================================================================

const otpService = require("../services/otpService");
const FEATURE_FLAGS_PHASE3 = require("../config/featureFlags");

// POST /api/orders/send-cod-otp — Send OTP for COD order
router.post("/send-cod-otp", authMiddleware, async (req, res) => {
  if (!FEATURE_FLAGS_PHASE3.COD_OTP) return respondError(res, "COD OTP disabled", 404);
  try {
    const { orderId, phone } = req.body;
    if (!orderId || !phone) return respondError(res, "orderId and phone are required", 400);
    const result = await otpService.sendCodOtp(orderId, phone);
    if (result.error) return respondError(res, result.error.message, 400);
    return success(res, result.data);
  } catch (err) {
    return respondError(res, err.message || "Failed to send COD OTP", 500);
  }
});

// POST /api/orders/verify-cod-otp — Verify OTP
router.post("/verify-cod-otp", authMiddleware, async (req, res) => {
  if (!FEATURE_FLAGS_PHASE3.COD_OTP) return respondError(res, "COD OTP disabled", 404);
  try {
    const { orderId, otp } = req.body;
    if (!orderId || !otp) return respondError(res, "orderId and otp are required", 400);
    const result = await otpService.verifyCodOtp(orderId, otp);
    if (result.error) return respondError(res, result.error.message, 400, { ...result });
    // OTP verified — confirm the order
    const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
    if (order && order.payment_method === "cod") {
      await db.from("orders").update({ status: "confirmed", delivery_status: "placed" }).eq("id", orderId);
    }
    return success(res, { verified: true, message: "Order confirmed!" });
  } catch (err) {
    return respondError(res, err.message || "Failed to verify COD OTP", 500);
  }
});

// POST /api/orders/retry-payment — Retry with different payment method
router.post("/retry-payment", authMiddleware, requireRole("buyer"), async (req, res) => {
  if (!FEATURE_FLAGS_PHASE3.PAYMENT_RETRY) return respondError(res, "Payment retry disabled", 404);
  try {
    const { orderId, method } = req.body;
    if (!orderId) return respondError(res, "orderId is required", 400);

    const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
    if (!order) return respondError(res, "Order not found", 404);
    if (order.status === "paid" || order.status === "confirmed") return respondError(res, "Order is already paid", 400);

    // Mark old payment attempt as failed
    if (order.razorpay_order_id) {
      await db.from("orders").update({ payment_status: OrderStates.FAILED }).eq("id", orderId);
    }

    if (method === "cod") {
      await db.from("orders").update({ payment_method: "cod", status: "pending" }).eq("id", orderId);
      return success(res, { method: "cod", message: "Switched to COD. Please proceed." });
    }

    // Create new Razorpay order for online payment
    const razorpay = require("../config/razorpay");
    const amount = (order.total || order.amount || 0) * 100; // paise
    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(amount),
      currency: "INR",
      receipt: `retry_${orderId}_${Date.now()}`,
      notes: { orderId },
    });

    await db.from("orders").update({
      razorpay_order_id: rzpOrder.id,
      payment_method: method || "online",
      payment_status: "pending",
      status: "pending",
    }).eq("id", orderId);

    return success(res, {
      razorpay_order_id: rzpOrder.id,
      amount: rzpOrder.amount,
      method: method || "online",
      keyId: razorpay.key_id || process.env.RAZORPAY_KEY_ID || "",
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to retry payment", 500);
  }
});

// ==========================================================================
// Phase 5 — Order Lifecycle: Self-Cancel, Admin Reject, Return Window
// ==========================================================================

// POST /api/orders/:id/self-cancel — Customer self-cancel within cancellation window
router.post("/:id/self-cancel", authMiddleware, async (req, res) => {
  if (!FEATURE_FLAGS.SELF_CANCEL_WINDOW) return respondError(res, "Self-cancellation window is disabled", 404);
  try {
    const result = await selfCancel(req.params.id, req.user.userId);
    try {
      const { data: updated } = await db.from("orders").select("*").eq("id", req.params.id).single();
      if (updated) {
        sendSseEvent("order:updated", { order: updated },
          (sub) => (sub.user && sub.user.role === "admin") || (sub.user && sub.user.userId === updated.user_id));
      }
    } catch (_) { }
    return success(res, result);
  } catch (err) {
    return respondError(res, err.message, 400);
  }
});

// GET /api/orders/:id/cancel-window — Check cancellation window status
router.get("/:id/cancel-window", authMiddleware, async (req, res) => {
  try {
    const { data: order } = await req.db.from("orders").select("user_id").eq("id", req.params.id).single();
    if (!order) return respondError(res, "Order not found.", 404);
    const isOwner = String(order.user_id) === String(req.user.userId || req.user.id);
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) return respondError(res, "Access denied.", 403);

    const result = await getCancelWindow(req.params.id);
    return success(res, result);
  } catch (err) {
    return respondError(res, err.message, 400);
  }
});

// POST /api/orders/admin/order-reject/:id — Admin rejects an order (v3: admin_pending/paid/cancel_requested → ADMIN_REJECTED)
// NOTE: This differs from POST /api/refunds/cancel-requests/:id/reject which handles legacy CANCEL_REQUESTED → PAID revert.
const orderRejectSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(500).required().messages({
    "string.empty": "Rejection reason is required.",
    "any.required": "Rejection reason is required."
  }),
});

router.post("/admin/order-reject/:id", authMiddleware, requireRole("admin"), validateBody(orderRejectSchema), async (req, res) => {
  try {
    const result = await adminReject(req.params.id, req.body.reason, req.user);

    await logAuditAction({
      orderId: req.params.id,
      action: AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
      performedBy: req.user,
      previousState: "pending",
      newState: "rejected",
      metadata: { reason: req.body.reason, source: "v3_reject" }
    }).catch(() => {});

    try {
      const { data: updated } = await db.from("orders").select("*").eq("id", req.params.id).single();
      if (updated) {
        sendSseEvent("order:updated", { order: updated },
          (sub) => (sub.user && sub.user.role === "admin") || (sub.user && sub.user.userId === updated.user_id));
      }
    } catch (_) { }
    return success(res, result);
  } catch (err) {
    return respondError(res, err.message, 400);
  }
});

// POST /api/orders/admin/order-approve/:id — Admin approves an order (v3)
router.post("/admin/order-approve/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const result = await adminApprove(req.params.id);

    await logAuditAction({
      orderId: req.params.id,
      action: AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
      performedBy: req.user,
      previousState: "pending",
      newState: "approved",
      metadata: { source: "v3_approve" }
    }).catch(() => {});

    try {
      const { data: user } = await db.from("users").select("*").eq("id", result.order.user_id).single();
      if (user) {
        notify("ORDER_APPROVED", result.order, user, {}).catch(() => {});
      }
    } catch (_) {}

    try {
      sendSseEvent("order:updated", { order: result.order },
        (sub) => (sub.user && sub.user.role === "admin") || (sub.user && sub.user.userId === result.order.user_id));
    } catch (_) { }
    return success(res, result);
  } catch (err) {
    return respondError(res, err.message, 400);
  }
});

// POST /api/orders/:id/request-return — Customer requests a return for a delivered order
router.post("/:id/request-return", authMiddleware, async (req, res) => {
  try {
    const { data: order } = await req.db.from("orders").select("user_id, status, delivery_status, return_window_expires").eq("id", req.params.id).single();
    if (!order) return respondError(res, "Order not found.", 404);
    const isOwner = String(order.user_id) === String(req.user.userId || req.user.id);
    if (!isOwner) return respondError(res, "Access denied.", 403);
    if (order.delivery_status !== "delivered" && order.status !== OrderStates.DELIVERED) {
      return respondError(res, "Return can only be requested for delivered orders.", 400);
    }
    if (order.return_window_expires && new Date(order.return_window_expires) < new Date()) {
      return respondError(res, "Return window has expired.", 400);
    }
    await db.from("orders").update({
      status: OrderStates.RETURN_REQUESTED,
      return_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", req.params.id);
    try {
      sendSseEvent("order:updated", { order: { id: req.params.id, status: OrderStates.RETURN_REQUESTED } },
        (sub) => (sub.user && sub.user.role === "admin") || (sub.user && sub.user.userId === order.user_id));
    } catch (_) {}
    return success(res, { message: "Return request submitted. Admin will review shortly." });
  } catch (err) {
    return respondError(res, err.message || "Failed to request return", 400);
  }
});

// POST /api/orders/:id/return-window — Start return window for delivered orders
router.post("/:id/return-window", authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    if (!isAdmin) return respondError(res, "Access denied. Admins only.", 403);

    const result = await startReturnWindow(req.params.id);
    try {
      const { data: updated } = await db.from("orders").select("*").eq("id", req.params.id).single();
      if (updated) {
        sendSseEvent("order:updated", { order: updated },
          (sub) => (sub.user && sub.user.role === "admin") || (sub.user && sub.user.userId === updated.user_id));
      }
    } catch (_) { }
    return success(res, result);
  } catch (err) {
    return respondError(res, err.message, 400);
  }
});

module.exports = router;
