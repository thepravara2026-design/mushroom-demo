const express = require("express");

const router = express.Router();
const authMiddleware = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");
const { validateBody, Joi } = require("../middleware/validate");

const adminOnly = requireRole("admin");
const db = require("../config/db");
const { success, error: respondError } = require("../lib/response");

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

    const inserted = await db
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
router.get("/my-enrollments", authMiddleware, async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return respondError(res, "Authentication required", 401);

    const rows = await db
      .from("enrollments")
      .select("*")
      .eq("user_id", userId)
      .then((r) => r);
    const data = rows.data || rows;
    return success(res, data);
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

// GET /api/trainings
router.get("/", async (req, res) => {
  try {
    const result = await db
      .from("trainings")
      .select("*")
      .then((r) => r);
    const data = result.data || result;
    return success(res, data);
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

module.exports = router;
