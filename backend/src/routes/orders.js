const express = require("express");
const crypto = require("crypto");

const router = express.Router();
const db = require("../config/db");
const razorpay = require("../config/razorpay");
const authMiddleware = require("../middleware/auth");
const { validateBody, Joi } = require("../middleware/validate");
const { success, error: respondError } = require("../lib/response");
const { validatePromoCode } = require("../services/promoService");
const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");
const { sendInvoiceWhatsApp } = require("../services/notificationService");
const { JWT_SECRET } = require("../config/jwt");
const refundService = require("../modules/refunds/RefundService");
const { OrderStates, assertForwardOnly, assertCancellable, resolveState } = require("../modules/orders/OrderStateService");
const { logAuditAction, AUDIT_ACTIONS } = require("../services/AuditLogService");
const { notify } = require("../services/NotificationService");
const logger = require("../utils/logger");
const { sendSseEvent, addSseSubscriber } = require("../lib/sse");

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

async function getShippingCharge() {
  // Delivery is always free
  return 0;
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
  delivery_phone: Joi.string().allow("").optional(),
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

// POST /api/orders/checkout
// Create order and Razorpay order ID
router.post(
  "/checkout",
  authMiddleware,
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
      const sanitizedPhone = rawPhone.replace(/\D/g, "");

      // Do not require address/phone for checkout in mock/e2e flows; prefer user data if present.
      let deliveryPhone = "";
      if (rawPhone) {
        if (sanitizedPhone.length < 10 || sanitizedPhone.length > 15) {
          return respondError(
            res,
            "Valid delivery phone number is required.",
            400,
          );
        }
        deliveryPhone = rawPhone.startsWith("+")
          ? `+${sanitizedPhone}`
          : sanitizedPhone;
      } else if (req.user && req.user.whatsapp_number) {
        deliveryPhone = req.user.whatsapp_number;
      }

      // Fetch products to verify pricing & tax rates
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

      // Calculate itemized details
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
        if (product.stock !== undefined && quantity > product.stock) {
          return respondError(
            res,
            `Insufficient stock for ${product.name}. Only ${product.stock} unit(s) available.`,
            400,
          );
        }

        // Reserve stock immediately to prevent overselling
        const newStock = (product.stock || 0) - quantity;
        if (!db.isMock) {
          try {
            await supabaseAdmin.rpc("decrement_stock", {
              p_product_id: product.id,
              p_quantity: quantity,
            });
          } catch (rpcErr) {
            logger.error(`[orders] decrement_stock RPC failed for ${product.id}:`, rpcErr.message);
          }
        } else {
          const { data: freshProduct } = await db
            .from("products")
            .select("stock")
            .eq("id", product.id)
            .single();
          const currentStock = freshProduct ? (freshProduct.stock || 0) : 0;
          if (quantity > currentStock) {
            return respondError(
              res,
              `Insufficient stock for ${product.name}. Only ${currentStock} unit(s) available.`,
              400,
            );
          }
          await db
            .from("products")
            .update({ stock: currentStock - quantity })
            .eq("id", product.id);
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
          status: "pending",
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
            }).catch(() => {}); // rpc may not exist — that's fine, column will be added next startup
          } catch (_) {}
        });
      }

      if (dbError || !newOrder) {
        logger.error('[checkout] DB insert failed:', { dbError: dbError?.message, insertPayload });
        return respondError(res, dbError?.message || 'Failed to create order', 500);
      }

      // Backfill customer_email via an immediate UPDATE if the column now exists
      if (customerEmail && newOrder && newOrder.id) {
        db.from("orders")
          .update({ customer_email: customerEmail })
          .eq("id", newOrder.id)
          .then(() => {})
          .catch(() => {});
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

      const { data: updatedOrder, error } = await db
        .from("orders")
        .update({
          status: "paid",
          delivery_status: "placed",
          admin_approval_status: "pending",
          payment_method: "UPI QR",
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
          sendInvoiceWhatsApp(updatedOrder, user, req).catch(() => {});
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

// POST /api/orders/verify-payment
// Confirm signature & finalize order
router.post(
  "/verify-payment",
  authMiddleware,
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
        const { data: updatedOrder, error } = await db
          .from("orders")
          .update({
            status: "paid",
            delivery_status: "placed",
            admin_approval_status: "pending",
            payment_method: "Razorpay",
            razorpay_payment_id,
            transaction_id: transactionId,
            invoice_token: invoiceToken,
            updated_at: new Date().toISOString(),
          })
          .eq("razorpay_order_id", razorpay_order_id)
          .single();

        if (error) {
          return respondError(
            res,
            error.message || "Failed to update order",
            500,
          );
        }

        // Stock was already reserved at checkout time — no additional decrement needed.

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
            sendInvoiceWhatsApp(updatedOrder, user, req).catch(() => {});
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
        .select("status, user_id")
        .eq("razorpay_order_id", razorpay_order_id)
        .single();

      if (currentOrder && ["pending", "pending_upi_verification"].includes(currentOrder.status)) {
        const { data: failedOrder } = await db
          .from("orders")
          .update({ status: "failed" })
          .eq("razorpay_order_id", razorpay_order_id)
          .single();

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
router.put("/shipping-settings", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return respondError(res, "Access denied. Admins only.", 403);
    }

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
    const { data: orders, error } = await db
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
router.get("/all-orders", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return respondError(res, "Access denied. Admins only.", 403);
    }

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

// PUT /api/orders/:id/status
// Update delivery status of an order (admin only)
router.put("/:id/status", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return respondError(res, "Access denied. Admins only.", 403);
    }

    const { delivery_status, delivery_days_text } = req.body;
    if (!delivery_status) {
      return respondError(res, "Delivery status is required.", 400);
    }

    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (orderErr || !order) {
      return respondError(res, "Order not found.", 404);
    }

    const previousState = { ...order };

    // Enforce forward-only transitions on delivery_status
    assertForwardOnly(order.delivery_status || 'placed', delivery_status);

    // Enforce shipping lock (cannot change status of shipped+ orders backward)
    if (['shipped', 'in_transit', 'delivered'].includes(order.delivery_status)) {
      assertCancellable(order);
    }

    if (order.status === "cancelled" || order.status === "refunded") {
      return respondError(
        res,
        "Cannot change status of a cancelled or refunded order.",
        400,
      );
    }

    if (
      order.refund_status === "initiated" ||
      order.refund_status === "processed"
    ) {
      return respondError(
        res,
        "Cannot change status of an order with an active refund.",
        400,
      );
    }

    const updatePayload = {
      delivery_status,
      updated_at: new Date().toISOString(),
    };

    if (delivery_days_text) {
      updatePayload.delivery_days_text = delivery_days_text
        .trim()
        .slice(0, 100);
      const daysMatch = delivery_days_text.match(/(\d+)/);
      if (daysMatch) {
        const days = parseInt(daysMatch[1], 10);
        if (!isNaN(days) && days > 0) {
          const expectedDate = new Date();
          expectedDate.setDate(expectedDate.getDate() + days);
          updatePayload.expected_delivery_date = expectedDate.toISOString();
        }
      }
    }

    // Track shipped_at and delivered_at timestamps
    if (delivery_status === 'shipped' && !order.shipped_at) {
      updatePayload.shipped_at = new Date().toISOString();
    }
    if (delivery_status === 'delivered' && !order.delivered_at) {
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
      return respondError(res, error.message || "Failed to update order", 500);
    }

    const newState = { ...updatedOrder };

    // Audit log
    logAuditAction({
      orderId: order.id,
      action: AUDIT_ACTIONS.STATUS_CHANGED,
      performedBy: req.user,
      previousState: { delivery_status: previousState.delivery_status },
      newState: { delivery_status: delivery_status },
      metadata: { delivery_days_text },
    }).catch(() => {});

    // Notification
    const eventMap = {
      'shipped': 'ORDER_SHIPPED',
      'delivered': 'ORDER_DELIVERED',
    };
    if (eventMap[delivery_status]) {
      const { data: user } = await db
        .from("users")
        .select("*")
        .eq("id", order.user_id)
        .single()
        .catch(() => ({}));
      if (user) {
        notify(eventMap[delivery_status], updatedOrder, user, {
          eta: delivery_days_text,
        }).catch(() => {});
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

    // Send invoice via WhatsApp when order is shipped or first confirmed
    const shouldSendWhatsApp =
      (delivery_status === "shipped" && !order.whatsapp_sent) ||
      (["placed", "processing"].includes(delivery_status) &&
       ["pending", "pending_upi_verification"].includes(order.delivery_status) &&
       !order.whatsapp_sent);

    if (shouldSendWhatsApp) {
      try {
        const { data: user } = await db
          .from("users")
          .select("*")
          .eq("id", order.user_id)
          .single();
        if (user) {
          const result = await sendInvoiceWhatsApp(updatedOrder, user, req);
          if (result.success) {
            await db
              .from("orders")
              .update({
                whatsapp_sent: true,
                updated_at: new Date().toISOString(),
              })
              .eq("id", order.id);
          }
        }
      } catch (waErr) {
        logger.error(
          "[orders] Failed to send WhatsApp invoice:",
          waErr.message,
        );
      }
    }

    return success(res, {
      message: "Order status updated successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    return respondError(
      res,
      error.message || "Order status update failed",
      500,
    );
  }
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

    const { reason, adminNote } = req.body;
    const result = await refundService.adminDirectCancellation(req.params.id, reason, adminNote, req.user);

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
        : "Order cancelled successfully.",
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
    const { data: order, error: orderErr } = await db
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

    const { data: refund, error: refundErr } = await db
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
router.get("/admin/refunds", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return respondError(res, "Access denied. Admins only.", 403);
    }

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
    const { data: order, error } = await db
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
// Get tracking status. Simulates shipping status over time!
router.get("/:id/track", authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await db
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

    // Time difference in minutes since order creation
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
      await db
        .from("orders")
        .update({ delivery_status: statusResult })
        .eq("id", order.id);
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
      progressPercent: responseProgress,
      trackingMessage: responseMessage,
      cancelReason: order.cancel_reason || "",
      timestamp: new Date().toISOString(),
      timeline,
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

  // Set headers for SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");

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

      const { data: order, error } = await db
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

      await db
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
  validateBody(requestCancelSchema),
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
    const { data: order, error } = await db
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
// Admin approves a PENDING_APPROVAL order → PLACED
router.post("/admin/approve/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return respondError(res, "Access denied. Admins only.", 403);
    }

    const { adminNote } = req.body;
    const updatedOrder = await refundService.approveOrder(req.params.id, adminNote || "", req.user);

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

router.post("/admin/reject/:id", authMiddleware, validateBody(rejectOrderSchema), async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return respondError(res, "Access denied. Admins only.", 403);
    }

    const { reason, adminNote } = req.body;
    const updatedOrder = await refundService.rejectOrder(req.params.id, reason, adminNote || "", req.user);

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
router.get("/admin/:id/audit-logs", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return respondError(res, "Access denied. Admins only.", 403);
    }

    const { getAuditLogs } = require("../services/AuditLogService");
    const logs = await getAuditLogs(req.params.id);
    return success(res, logs || []);
  } catch (err) {
    return respondError(res, err.message || "Failed to fetch audit logs", 500);
  }
});

module.exports = router;
