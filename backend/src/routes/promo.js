const express = require("express");

const router = express.Router();
const promoService = require("../services/promoService");
const { success, error: respondError } = require("../lib/response");

// GET /api/promo/validate?code=XXXX
router.get("/validate", async (req, res) => {
  try {
    const { code } = req.query;
    const result = promoService.validatePromoCode(code);
    return success(res, result);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to validate promo code",
      error.status || 500,
    );
  }
});

module.exports = router;
