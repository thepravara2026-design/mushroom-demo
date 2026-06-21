const express = require("express");

const router = express.Router();
const locationService = require("../services/locationService");
const { success, error: respondError } = require("../lib/response");

// GET /api/locations/states
router.get("/states", async (req, res) => {
  try {
    const states = locationService.listStates();
    return success(res, states);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch states",
      error.status || 500,
    );
  }
});

// GET /api/locations/states/:stateName/cities
router.get("/states/:stateName/cities", async (req, res) => {
  try {
    const cities = locationService.getCities(req.params.stateName);
    if (cities === null) {
      return respondError(res, "State not found", 404);
    }
    return success(res, cities);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch cities",
      error.status || 500,
    );
  }
});

module.exports = router;
