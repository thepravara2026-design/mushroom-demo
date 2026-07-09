const express = require("express");
const router = express.Router();
const inventoryService = require("../../services/inventoryService");

router.get("/health", (req, res) => res.json({ status: "ok" }));

router.post("/reserve", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ error: "No items provided for reservation." });
    }

    const reservations = [];
    for (const item of items) {
      const quantity = Number(item.quantity || 0);
      if (!item.productId || quantity <= 0) {
        return res.status(400).json({ error: "Each item must include a valid productId and positive quantity." });
      }

      const reservation = await inventoryService.createReservation({
        productId: item.productId,
        quantity,
        userId: req.user?.userId || null,
        guestToken: req.body?.guestToken || null,
      });
      reservations.push(reservation);
    }

    return res.json({ success: true, reservations });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Inventory reservation failed." });
  }
});

module.exports = router;
