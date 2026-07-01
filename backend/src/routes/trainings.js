const express = require("express");

const router = express.Router();
const authMiddleware = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");
const { validateBody, Joi } = require("../middleware/validate");

const adminOnly = requireRole("admin");
const db = require("../config/db");
const razorpay = require("../config/razorpay");
const { success, error: respondError } = require("../lib/response");
const { sendSseEvent } = require("../lib/sse");

const createTrainingSchema = Joi.object({
  title: Joi.string().required(),
  category: Joi.string().required(),
  description: Joi.string().required(),
  image_url: Joi.string().allow("").optional(),
  content_url: Joi.string().allow("").optional(),
  allowed_roles: Joi.array().items(Joi.string()).optional(),
  start_date: Joi.date().iso().optional(),
  end_date: Joi.date().iso().optional(),
  price_strikeout: Joi.number().min(0).optional(),
  price_actual: Joi.number().min(0).optional(),
});

const updateTrainingSchema = Joi.object({
  title: Joi.string().optional(),
  category: Joi.string().optional(),
  description: Joi.string().optional(),
  image_url: Joi.string().allow("").optional(),
  content_url: Joi.string().allow("").optional(),
  allowed_roles: Joi.array().items(Joi.string()).optional(),
  start_date: Joi.date().iso().optional(),
  end_date: Joi.date().iso().optional(),
  price_strikeout: Joi.number().min(0).optional(),
  price_actual: Joi.number().min(0).optional(),
});

const enrollSchema = Joi.object({
  role: Joi.string().valid("buyer", "grower", "trainee").optional(),
});

// POST /api/trainings/:id/enroll (requires auth)
router.post("/:id/enroll", authMiddleware, validateBody(enrollSchema), async (req, res) => {
  try {
    const trainingId = req.params.id;
    const userId = req.user && req.user.userId;
    if (!userId)
      return respondError(res, "Authentication required to enroll", 401);

    const payload = {
      training_id: trainingId,
      user_id: userId,
      role: req.body.role || req.user.role || "trainee",
      created_at: new Date().toISOString(),
    };

    const inserted = await req.db
      .from("enrollments")
      .insert(payload)
      .then((r) => r);
    const data = inserted.data || inserted;
    return success(res, data[0] || data);
  } catch (err) {
    return respondError(res, err.message || "Failed to enroll", 500);
  }
});

// GET /api/trainings/my-enrollments (requires auth)
// Returns legacy enrollments + v2 training_enrollments enriched with batch details
router.get("/my-enrollments", authMiddleware, async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return respondError(res, "Authentication required", 401);

    const [legacyRows, v2Rows, allBatches] = await Promise.all([
      req.db.from("enrollments").select("*").eq("user_id", userId).then(r => r.data || r),
      req.db.from("training_enrollments").select("*").eq("user_id", userId).then(r => r.data || r),
      req.db.from("training_batches").select("*").then(r => r.data || r),
    ]);

    // Enrich v2 enrollments with batch details
    const batchMap = {};
    for (const b of allBatches) batchMap[b.id] = b;

    const v2Enriched = v2Rows.map(e => ({
      ...e,
      is_v2: true,
      batch: batchMap[e.batch_id] || null,
      seats_left: batchMap[e.batch_id]
        ? Math.max(0, batchMap[e.batch_id].capacity - batchMap[e.batch_id].seats_taken)
        : 0,
    }));

    return success(res, {
      legacy: legacyRows,
      v2: v2Enriched,
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to load enrollments", 500);
  }
});

// GET /api/trainings/enrollments (admin only) - list all enrollments
router.get("/enrollments", authMiddleware, adminOnly, async (req, res) => {
  try {
    const rows = await db
      .from("enrollments")
      .select("*")
      .then((r) => r);
    const data = rows.data || rows;
    return success(res, data);
  } catch (err) {
    return respondError(res, err.message || "Failed to load enrollments", 500);
  }
});

// GET /api/trainings (public) — returns trainings with nested active/upcoming batches
router.get("/", async (req, res) => {
  try {
    const result = await req.db
      .from("trainings")
      .select("*")
      .then((r) => r);
    let trainings = result.data || result;

    // Enrich each training with its active/upcoming batches
    const allBatches = await req.db
      .from("training_batches")
      .select("*")
      .then((r) => r);
    const batches = (allBatches.data || allBatches)
      .filter(b => b.status === "upcoming" || b.status === "active");
    const batchMap = {};
    for (const b of batches) {
      if (!batchMap[b.training_id]) batchMap[b.training_id] = [];
      batchMap[b.training_id].push({
        ...b,
        seats_left: Math.max(0, b.capacity - b.seats_taken),
      });
    }
    trainings = trainings.map(t => ({
      ...t,
      batches: batchMap[t.id] || [],
    }));

    return success(res, trainings);
  } catch (err) {
    return respondError(res, err.message || "Failed to load trainings", 500);
  }
});

function generateTrainingId() {
  const uuid = Math.random().toString(36).substr(2, 8);
  return `spore-${uuid}`;
}

function validateTrainingDates(startDate, endDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    if (start < today) {
      return "Start date cannot be in the past.";
    }
  }

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (end < start) {
      return "End date must be on or after the start date.";
    }
  }

  return null;
}

function validateTrainingPrices(priceStrikeout, priceActual) {
  if (priceStrikeout == null && priceActual == null) return null;
  const strikeout = Number(priceStrikeout);
  const actual = Number(priceActual);
  if (isNaN(strikeout) || isNaN(actual)) {
    return "Price values must be valid numbers.";
  }
  if (strikeout < 0 || actual < 0) {
    return "Price values cannot be negative.";
  }
  if (strikeout < actual * 1.1) {
    return "Strikeout price must be at least 10% higher than the actual price.";
  }
  return null;
}

function calculateDurationDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

// POST /api/trainings (admin only)
router.post("/", authMiddleware, adminOnly, validateBody(createTrainingSchema), async (req, res) => {
  try {
    const { start_date, end_date, price_strikeout, price_actual } =
      req.body || {};

    const dateErr = validateTrainingDates(start_date, end_date);
    if (dateErr) return respondError(res, dateErr, 400);

    const priceErr = validateTrainingPrices(price_strikeout, price_actual);
    if (priceErr) return respondError(res, priceErr, 400);

    const payload = {
      ...req.body,
      price_strikeout: Number(price_strikeout),
      price_actual: Number(price_actual),
      training_id: generateTrainingId(),
      duration_days: calculateDurationDays(start_date, end_date),
    };

    const inserted = await db
      .from("trainings")
      .insert(payload)
      .then((r) => r);
    const data = inserted.data || inserted;
    return success(res, data[0] || data, {}, 201);
  } catch (err) {
    return respondError(res, err.message || "Failed to create training", 500);
  }
});

// PUT /api/trainings/:id (admin only)
router.put("/:id", authMiddleware, adminOnly, validateBody(updateTrainingSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date, price_strikeout, price_actual } =
      req.body || {};

    const dateErr = validateTrainingDates(start_date, end_date);
    if (dateErr) return respondError(res, dateErr, 400);

    const priceErr = validateTrainingPrices(price_strikeout, price_actual);
    if (priceErr) return respondError(res, priceErr, 400);

    const payload = {
      ...req.body,
      price_strikeout: Number(price_strikeout),
      price_actual: Number(price_actual),
      duration_days: calculateDurationDays(start_date, end_date),
    };

    const target = await db
      .from("trainings")
      .eq("id", id)
      .select("*")
      .then((r) => r);
    if (!target || (target.data && target.data.length === 0)) {
      return respondError(res, "Training not found", 404);
    }
    await db
      .from("trainings")
      .eq("id", id)
      .update(payload)
      .then((r) => r);
    const updated = await db
      .from("trainings")
      .eq("id", id)
      .select("*")
      .then((r) => r);
    const data = updated.data || updated;
    return success(res, data[0] || data);
  } catch (err) {
    return respondError(res, err.message || "Failed to update training", 500);
  }
});

// DELETE /api/trainings/:id (admin only)
router.delete("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const exists = await db
      .from("trainings")
      .eq("id", id)
      .select("*")
      .then((r) => r);
    if (!exists || (exists.data && exists.data.length === 0)) {
      return respondError(res, "Training not found", 404);
    }
    await db
      .from("trainings")
      .eq("id", id)
      .delete()
      .then((r) => r);
    return success(res, { message: "Training deleted" });
  } catch (err) {
    return respondError(res, err.message || "Failed to delete training", 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Grower Training v2 — Batch Routes
// ═══════════════════════════════════════════════════════════════

const registerSchema = Joi.object({
  role: Joi.string().optional(),
});

const verifyPaymentSchema = Joi.object({
  razorpay_order_id: Joi.string().required(),
  razorpay_payment_id: Joi.string().required(),
  razorpay_signature: Joi.string().required(),
  enrollment_id: Joi.string().required(),
});

const cancelEnrollmentSchema = Joi.object({
  reason: Joi.string().max(500).optional(),
});

// GET /api/trainings/batches/:id — fetch batch details with seat availability
router.get("/batches/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db
      .from("training_batches")
      .select("*")
      .eq("id", id)
      .then(r => r.data || r);

    if (!rows || rows.length === 0) {
      return respondError(res, "Batch not found", 404);
    }

    const batch = { ...rows[0], seats_left: Math.max(0, rows[0].capacity - rows[0].seats_taken) };
    return success(res, batch);
  } catch (err) {
    return respondError(res, err.message || "Failed to load batch", 500);
  }
});

// POST /api/trainings/batches/:id/register — register for a batch with Razorpay payment
router.post("/batches/:id/register", authMiddleware, validateBody(registerSchema), async (req, res) => {
  try {
    const batchId = req.params.id;
    const userId = req.user.userId;
    if (!userId) return respondError(res, "Authentication required", 401);

    // Fetch batch
    const batchRows = await req.db
      .from("training_batches")
      .select("*")
      .eq("id", batchId)
      .then(r => r.data || r);
    if (!batchRows || batchRows.length === 0) {
      return respondError(res, "Batch not found", 404);
    }
    const batch = batchRows[0];
    if (batch.status !== "upcoming" && batch.status !== "active") {
      return respondError(res, "This batch is no longer accepting registrations", 400);
    }
    if (batch.seats_taken >= batch.capacity) {
      return respondError(res, "Batch is full", 400);
    }

    // Check for existing enrollment
    const existing = await req.db
      .from("training_enrollments")
      .select("*")
      .eq("batch_id", batchId)
      .eq("user_id", userId)
      .then(r => r.data || r);
    if (existing.length > 0) {
      return respondError(res, "You are already registered for this batch", 409);
    }

    // Create enrollment (pending_payment)
    const enrollmentPayload = {
      batch_id: batchId,
      user_id: userId,
      status: "pending_payment",
      role: req.body.role || req.user.role || "grower",
    };
    const inserted = await req.db
      .from("training_enrollments")
      .insert(enrollmentPayload)
      .then(r => r.data || r);
    const enrollment = inserted[0] || inserted;

    // Create Razorpay order
    const amountInPaise = Math.round(batch.price_actual * 100);
    const rzpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `trn-batch-${batchId}-${userId.slice(-6)}`,
      notes: {
        type: "training_batch",
        batch_id: batchId,
        enrollment_id: enrollment.id,
        user_id: userId,
      },
    });

    // Insert payment record
    await req.db
      .from("training_payments")
      .insert({
        enrollment_id: enrollment.id,
        razorpay_order_id: rzpOrder.id,
        amount: batch.price_actual,
        status: "created",
      })
      .then(r => r.data || r);

    return success(res, {
      enrollment_id: enrollment.id,
      razorpay_order_id: rzpOrder.id,
      amount: batch.price_actual,
      key_id: razorpay.key_id || process.env.RAZORPAY_KEY_ID || "",
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to register for batch", 500);
  }
});

// POST /api/trainings/verify-payment — verify Razorpay signature and confirm enrollment
router.post("/verify-payment", authMiddleware, validateBody(verifyPaymentSchema), async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, enrollment_id } = req.body;
    const userId = req.user.userId;
    if (!userId) return respondError(res, "Authentication required", 401);

    // Verify signature
    const isValid = razorpay.payments.verifySignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });
    if (!isValid) {
      return respondError(res, "Payment verification failed — invalid signature", 400);
    }

    // Find enrollment
    const enrollmentRows = await req.db
      .from("training_enrollments")
      .select("*")
      .eq("id", enrollment_id)
      .eq("user_id", userId)
      .then(r => r.data || r);
    if (!enrollmentRows || enrollmentRows.length === 0) {
      return respondError(res, "Enrollment not found", 404);
    }
    const enrollment = enrollmentRows[0];
    if (enrollment.status !== "pending_payment") {
      return respondError(res, `Enrollment is already ${enrollment.status}`, 400);
    }

    // Find payment record
    const paymentRows = await req.db
      .from("training_payments")
      .select("*")
      .eq("enrollment_id", enrollment_id)
      .eq("razorpay_order_id", razorpay_order_id)
      .then(r => r.data || r);
    if (!paymentRows || paymentRows.length === 0) {
      return respondError(res, "Payment record not found", 404);
    }
    const payment = paymentRows[0];

    // Update payment to paid
    await req.db
      .from("training_payments")
      .eq("id", payment.id)
      .update({
        razorpay_payment_id,
        status: "paid",
      })
      .then(r => r.data || r);

    // Update enrollment to confirmed
    await req.db
      .from("training_enrollments")
      .eq("id", enrollment_id)
      .update({ status: "confirmed" })
      .then(r => r.data || r);

    // Increment seats_taken on batch
    const batchRows = await req.db
      .from("training_batches")
      .select("*")
      .eq("id", enrollment.batch_id)
      .then(r => r.data || r);
    if (batchRows && batchRows.length > 0) {
      const batch = batchRows[0];
      await req.db
        .from("training_batches")
        .eq("id", enrollment.batch_id)
        .update({ seats_taken: batch.seats_taken + 1 })
        .then(r => r.data || r);
    }

    // Broadcast SSE event
    sendSseEvent("training_enrollment:updated", {
      enrollment_id,
      status: "confirmed",
      userId,
    });

    return success(res, {
      enrollment_id,
      status: "confirmed",
      razorpay_payment_id,
    });
  } catch (err) {
    return respondError(res, err.message || "Payment verification failed", 500);
  }
});

// POST /api/trainings/enrollments/:id/cancel — self-cancel within cancellation window
router.post("/enrollments/:id/cancel", authMiddleware, validateBody(cancelEnrollmentSchema), async (req, res) => {
  try {
    const enrollmentId = req.params.id;
    const userId = req.user.userId;
    if (!userId) return respondError(res, "Authentication required", 401);

    // Find enrollment
    const enrollmentRows = await req.db
      .from("training_enrollments")
      .select("*")
      .eq("id", enrollmentId)
      .eq("user_id", userId)
      .then(r => r.data || r);
    if (!enrollmentRows || enrollmentRows.length === 0) {
      return respondError(res, "Enrollment not found", 404);
    }
    const enrollment = enrollmentRows[0];
    if (enrollment.status !== "confirmed") {
      return respondError(res, `Cannot cancel enrollment with status "${enrollment.status}"`, 400);
    }

    // Find batch and check cancellation window
    const batchRows = await req.db
      .from("training_batches")
      .select("*")
      .eq("id", enrollment.batch_id)
      .then(r => r.data || r);
    if (!batchRows || batchRows.length === 0) {
      return respondError(res, "Batch not found", 404);
    }
    const batch = batchRows[0];
    const cutoffDays = batch.cancellation_cutoff_days || 3;
    const startDate = new Date(batch.start_date);
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilStart = (startDate - now) / msPerDay;

    if (daysUntilStart < cutoffDays) {
      return respondError(
        res,
        `Cancellation window has closed. Cutoff is ${cutoffDays} day(s) before start.`,
        400,
      );
    }

    // Find payment to refund
    const paymentRows = await req.db
      .from("training_payments")
      .select("*")
      .eq("enrollment_id", enrollmentId)
      .eq("status", "paid")
      .then(r => r.data || r);
    if (!paymentRows || paymentRows.length === 0) {
      return respondError(res, "No paid payment found for this enrollment", 400);
    }
    const payment = paymentRows[0];

    // Initiate Razorpay refund
    const amountInPaise = Math.round(payment.amount * 100);
    let rzpRefund;
    try {
      rzpRefund = await razorpay.payments.refund(payment.razorpay_payment_id, {
        amount: amountInPaise,
        notes: { reason: "Training enrollment self-cancellation" },
      });
    } catch (refundErr) {
      return respondError(res, `Refund initiation failed: ${refundErr.message}`, 500);
    }

    // Update enrollment to cancelled
    await req.db
      .from("training_enrollments")
      .eq("id", enrollmentId)
      .update({ status: "cancelled" })
      .then(r => r.data || r);

    // Decrement seats_taken
    await req.db
      .from("training_batches")
      .eq("id", enrollment.batch_id)
      .update({ seats_taken: Math.max(0, batch.seats_taken - 1) })
      .then(r => r.data || r);

    // Update payment to refunded
    await req.db
      .from("training_payments")
      .eq("id", payment.id)
      .update({ status: "refunded" })
      .then(r => r.data || r);

    // Create training_refund record
    await req.db
      .from("training_refunds")
      .insert({
        payment_id: payment.id,
        razorpay_refund_id: rzpRefund.id,
        amount: payment.amount,
        status: "initiated",
        reason: req.body.reason || "Self-cancellation",
      })
      .then(r => r.data || r);

    // Broadcast SSE event
    sendSseEvent("training_enrollment:updated", {
      enrollment_id: enrollmentId,
      status: "cancelled",
      userId,
    });

    return success(res, {
      enrollment_id: enrollmentId,
      status: "cancelled",
      refund_id: rzpRefund.id,
      refund_amount: payment.amount,
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to cancel enrollment", 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Grower Training v2 — Admin Console Routes
// ═══════════════════════════════════════════════════════════════

const createBatchSchema = Joi.object({
  training_id: Joi.string().required(),
  title: Joi.string().required(),
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().required(),
  capacity: Joi.number().integer().min(1).required(),
  price_actual: Joi.number().min(0).required(),
  price_strikeout: Joi.number().min(0).optional(),
  instructor: Joi.string().optional().allow(""),
  location: Joi.string().optional().allow(""),
  meeting_link: Joi.string().optional().allow(""),
  cancellation_cutoff_days: Joi.number().integer().min(0).optional(),
});

const updateBatchSchema = Joi.object({
  title: Joi.string().optional(),
  start_date: Joi.date().iso().optional(),
  end_date: Joi.date().iso().optional(),
  capacity: Joi.number().integer().min(1).optional(),
  price_actual: Joi.number().min(0).optional(),
  price_strikeout: Joi.number().min(0).optional(),
  instructor: Joi.string().optional().allow(""),
  location: Joi.string().optional().allow(""),
  meeting_link: Joi.string().optional().allow(""),
  cancellation_cutoff_days: Joi.number().integer().min(0).optional(),
  status: Joi.string().valid("upcoming", "active", "completed", "cancelled").optional(),
});

const attendanceSchema = Joi.object({
  attendance: Joi.string().valid("present", "no_show").required(),
});

const manualRefundSchema = Joi.object({
  reason: Joi.string().required().min(10).max(1000),
});

// GET /api/trainings/admin/dashboard — stats for training console
router.get("/admin/dashboard", authMiddleware, adminOnly, async (req, res) => {
  try {
    const [batches, enrollments, payments, refunds] = await Promise.all([
      db.from("training_batches").select("*").then(r => r.data || r),
      db.from("training_enrollments").select("*").then(r => r.data || r),
      db.from("training_payments").select("*").then(r => r.data || r),
      db.from("training_refunds").select("*").then(r => r.data || r),
    ]);

    const now = new Date();
    const upcomingBatches = batches.filter(b => b.status === "upcoming");
    const activeEnrollments = enrollments.filter(e => e.status === "confirmed");
    const totalRevenue = payments
      .filter(p => p.status === "paid")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const pendingRefunds = refunds.filter(r => r.status === "initiated");

    return success(res, {
      total_batches: batches.length,
      upcoming_batches: upcomingBatches.length,
      active_enrollments: activeEnrollments.length,
      total_revenue: totalRevenue,
      pending_refunds: pendingRefunds.length,
      attention_alerts: [
        ...batches
          .filter(b => b.status === "upcoming" && b.seats_taken >= b.capacity - 2)
          .map(b => ({ type: "batch_nearly_full", batch_id: b.id, title: b.title })),
        ...pendingRefunds.map(r => ({ type: "refund_pending", refund_id: r.id })),
      ],
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to load dashboard", 500);
  }
});

// POST /api/trainings/admin/batches — create a batch
router.post("/admin/batches", authMiddleware, adminOnly, validateBody(createBatchSchema), async (req, res) => {
  try {
    const { start_date, end_date } = req.body;
    const dateErr = validateTrainingDates(start_date, end_date);
    if (dateErr) return respondError(res, dateErr, 400);

    const payload = {
      ...req.body,
      seats_taken: 0,
      status: "upcoming",
    };
    const inserted = await db
      .from("training_batches")
      .insert(payload)
      .then(r => r.data || r);
    const batch = inserted[0] || inserted;

    // Log admin action
    await db
      .from("admin_action_logs")
      .insert({
        admin_id: req.user.userId,
        action: "CREATE_BATCH",
        target_type: "training_batch",
        target_id: batch.id || batch,
        reason: `Created batch for training ${req.body.training_id}`,
      })
      .then(r => r.data || r);

    return success(res, batch, {}, 201);
  } catch (err) {
    return respondError(res, err.message || "Failed to create batch", 500);
  }
});

// PUT /api/trainings/admin/batches/:id — update a batch
router.put("/admin/batches/:id", authMiddleware, adminOnly, validateBody(updateBatchSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db
      .from("training_batches")
      .select("*")
      .eq("id", id)
      .then(r => r.data || r);
    if (!rows || rows.length === 0) {
      return respondError(res, "Batch not found", 404);
    }

    const { start_date, end_date } = req.body;
    if (start_date || end_date) {
      const dateErr = validateTrainingDates(
        start_date || rows[0].start_date,
        end_date || rows[0].end_date,
      );
      if (dateErr) return respondError(res, dateErr, 400);
    }

    await db
      .from("training_batches")
      .eq("id", id)
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .then(r => r.data || r);

    const updated = await db
      .from("training_batches")
      .select("*")
      .eq("id", id)
      .then(r => r.data || r);

    // Log admin action
    await db
      .from("admin_action_logs")
      .insert({
        admin_id: req.user.userId,
        action: "UPDATE_BATCH",
        target_type: "training_batch",
        target_id: id,
        reason: `Updated batch ${id}`,
        metadata: { changes: Object.keys(req.body) },
      })
      .then(r => r.data || r);

    return success(res, updated[0] || updated);
  } catch (err) {
    return respondError(res, err.message || "Failed to update batch", 500);
  }
});

// POST /api/trainings/admin/batches/:id/clone — clone a batch's settings
router.post("/admin/batches/:id/clone", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db
      .from("training_batches")
      .select("*")
      .eq("id", id)
      .then(r => r.data || r);
    if (!rows || rows.length === 0) {
      return respondError(res, "Batch not found", 404);
    }
    const source = rows[0];

    // Shift dates by 30 days
    const msPerDay = 24 * 60 * 60 * 1000;
    const shiftMs = (req.body.shift_days || 30) * msPerDay;
    const newBatch = {
      training_id: source.training_id,
      title: source.title.replace(/Batch$/, "").trim() + " — Cloned Batch",
      start_date: new Date(new Date(source.start_date).getTime() + shiftMs).toISOString(),
      end_date: new Date(new Date(source.end_date).getTime() + shiftMs).toISOString(),
      capacity: source.capacity,
      price_actual: source.price_actual,
      price_strikeout: source.price_strikeout,
      instructor: source.instructor,
      location: source.location,
      meeting_link: source.meeting_link,
      cancellation_cutoff_days: source.cancellation_cutoff_days,
      seats_taken: 0,
      status: "upcoming",
    };

    const inserted = await db
      .from("training_batches")
      .insert(newBatch)
      .then(r => r.data || r);
    const clone = inserted[0] || inserted;

    // Log admin action
    await db
      .from("admin_action_logs")
      .insert({
        admin_id: req.user.userId,
        action: "CLONE_BATCH",
        target_type: "training_batch",
        target_id: clone.id || clone,
        reason: `Cloned from batch ${id}`,
        metadata: { source_batch_id: id, shift_days: req.body.shift_days || 30 },
      })
      .then(r => r.data || r);

    return success(res, clone, {}, 201);
  } catch (err) {
    return respondError(res, err.message || "Failed to clone batch", 500);
  }
});

// POST /api/trainings/admin/batches/:id/force-cancel — cancel all confirmed registrations with refund
router.post("/admin/batches/:id/force-cancel", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const batchRows = await db
      .from("training_batches")
      .select("*")
      .eq("id", id)
      .then(r => r.data || r);
    if (!batchRows || batchRows.length === 0) {
      return respondError(res, "Batch not found", 404);
    }
    const batch = batchRows[0];
    if (batch.status === "cancelled") {
      return respondError(res, "Batch is already cancelled", 400);
    }

    // Find all confirmed enrollments
    const enrollmentRows = await db
      .from("training_enrollments")
      .select("*")
      .eq("batch_id", id)
      .eq("status", "confirmed")
      .then(r => r.data || r);

    const refundResults = [];
    for (const enrollment of enrollmentRows) {
      // Find payment
      const paymentRows = await db
        .from("training_payments")
        .select("*")
        .eq("enrollment_id", enrollment.id)
        .eq("status", "paid")
        .then(r => r.data || r);

      if (paymentRows.length > 0) {
        const payment = paymentRows[0];
        try {
          const rzpRefund = await razorpay.payments.refund(payment.razorpay_payment_id, {
            amount: Math.round(payment.amount * 100),
            notes: { reason: "Admin force-cancelled batch" },
          });
          await db
            .from("training_refunds")
            .insert({
              payment_id: payment.id,
              razorpay_refund_id: rzpRefund.id,
              amount: payment.amount,
              status: "initiated",
              reason: "Admin force-cancelled batch",
            })
            .then(r => r.data || r);
          await db
            .from("training_payments")
            .eq("id", payment.id)
            .update({ status: "refunded" })
            .then(r => r.data || r);
          refundResults.push({ enrollment_id: enrollment.id, status: "refund_initiated" });
        } catch (refundErr) {
          refundResults.push({ enrollment_id: enrollment.id, status: "refund_failed", error: refundErr.message });
        }
      }

      // Update enrollment to cancelled
      await db
        .from("training_enrollments")
        .eq("id", enrollment.id)
        .update({ status: "cancelled" })
        .then(r => r.data || r);
    }

    // Update batch to cancelled
    await db
      .from("training_batches")
      .eq("id", id)
      .update({ status: "cancelled", seats_taken: 0 })
      .then(r => r.data || r);

    // Log admin action
    await db
      .from("admin_action_logs")
      .insert({
        admin_id: req.user.userId,
        action: "FORCE_CANCEL_BATCH",
        target_type: "training_batch",
        target_id: id,
        reason: req.body.reason || "Admin force-cancelled batch",
        metadata: { total_enrollments: enrollmentRows.length, refund_results: refundResults },
      })
      .then(r => r.data || r);

    // Broadcast SSE events
    for (const enrollment of enrollmentRows) {
      sendSseEvent("training_enrollment:updated", {
        enrollment_id: enrollment.id,
        status: "cancelled",
      });
    }

    return success(res, {
      batch_id: id,
      status: "cancelled",
      enrollments_affected: enrollmentRows.length,
      refunds: refundResults,
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to force-cancel batch", 500);
  }
});

// POST /api/trainings/admin/enrollments/:id/manual-refund — override policy for manual refund
router.post("/admin/enrollments/:id/manual-refund", authMiddleware, adminOnly, validateBody(manualRefundSchema), async (req, res) => {
  try {
    const enrollmentId = req.params.id;
    const { reason } = req.body;

    const enrollmentRows = await db
      .from("training_enrollments")
      .select("*")
      .eq("id", enrollmentId)
      .then(r => r.data || r);
    if (!enrollmentRows || enrollmentRows.length === 0) {
      return respondError(res, "Enrollment not found", 404);
    }
    const enrollment = enrollmentRows[0];

    const paymentRows = await db
      .from("training_payments")
      .select("*")
      .eq("enrollment_id", enrollmentId)
      .eq("status", "paid")
      .then(r => r.data || r);
    if (!paymentRows || paymentRows.length === 0) {
      return respondError(res, "No paid payment found for this enrollment", 400);
    }
    const payment = paymentRows[0];

    // Initiate refund
    let rzpRefund;
    try {
      rzpRefund = await razorpay.payments.refund(payment.razorpay_payment_id, {
        amount: Math.round(payment.amount * 100),
        notes: { reason: `Manual refund: ${reason}` },
      });
    } catch (refundErr) {
      return respondError(res, `Refund failed: ${refundErr.message}`, 500);
    }

    await db
      .from("training_enrollments")
      .eq("id", enrollmentId)
      .update({ status: "cancelled" })
      .then(r => r.data || r);

    await db
      .from("training_payments")
      .eq("id", payment.id)
      .update({ status: "refunded" })
      .then(r => r.data || r);

    await db
      .from("training_refunds")
      .insert({
        payment_id: payment.id,
        razorpay_refund_id: rzpRefund.id,
        amount: payment.amount,
        status: "initiated",
        reason: `Manual refund: ${reason}`,
      })
      .then(r => r.data || r);

    // Update batch seats
    const batchRows = await db
      .from("training_batches")
      .select("*")
      .eq("id", enrollment.batch_id)
      .then(r => r.data || r);
    if (batchRows.length > 0) {
      await db
        .from("training_batches")
        .eq("id", enrollment.batch_id)
        .update({ seats_taken: Math.max(0, batchRows[0].seats_taken - 1) })
        .then(r => r.data || r);
    }

    // Log admin action
    await db
      .from("admin_action_logs")
      .insert({
        admin_id: req.user.userId,
        action: "MANUAL_REFUND",
        target_type: "training_enrollment",
        target_id: enrollmentId,
        reason,
        metadata: { amount: payment.amount, refund_id: rzpRefund.id },
      })
      .then(r => r.data || r);

    sendSseEvent("training_enrollment:updated", {
      enrollment_id: enrollmentId,
      status: "cancelled",
    });

    return success(res, {
      enrollment_id: enrollmentId,
      status: "cancelled",
      refund_id: rzpRefund.id,
      refund_amount: payment.amount,
    });
  } catch (err) {
    return respondError(res, err.message || "Failed to process manual refund", 500);
  }
});

// POST /api/trainings/admin/enrollments/:id/attendance — mark attendance
router.post("/admin/enrollments/:id/attendance", authMiddleware, adminOnly, validateBody(attendanceSchema), async (req, res) => {
  try {
    const enrollmentId = req.params.id;
    const { attendance } = req.body;

    const enrollmentRows = await db
      .from("training_enrollments")
      .select("*")
      .eq("id", enrollmentId)
      .then(r => r.data || r);
    if (!enrollmentRows || enrollmentRows.length === 0) {
      return respondError(res, "Enrollment not found", 404);
    }
    const enrollment = enrollmentRows[0];
    if (enrollment.status !== "confirmed") {
      return respondError(res, `Cannot mark attendance for enrollment with status "${enrollment.status}"`, 400);
    }

    await db
      .from("training_enrollments")
      .eq("id", enrollmentId)
      .update({ attendance })
      .then(r => r.data || r);

    // Log admin action
    await db
      .from("admin_action_logs")
      .insert({
        admin_id: req.user.userId,
        action: "MARK_ATTENDANCE",
        target_type: "training_enrollment",
        target_id: enrollmentId,
        reason: `Marked as ${attendance}`,
      })
      .then(r => r.data || r);

    return success(res, { enrollment_id: enrollmentId, attendance });
  } catch (err) {
    return respondError(res, err.message || "Failed to mark attendance", 500);
  }
});

// GET /api/trainings/admin/action-logs — view admin audit logs
router.get("/admin/action-logs", authMiddleware, adminOnly, async (req, res) => {
  try {
    const rows = await db
      .from("admin_action_logs")
      .select("*")
      .then(r => r.data || r);
    return success(res, rows);
  } catch (err) {
    return respondError(res, err.message || "Failed to load action logs", 500);
  }
});

module.exports = router;
