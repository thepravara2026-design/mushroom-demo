const express = require("express");

const router = express.Router();
const { success, error: respondError } = require("../lib/response");

// GET /api/search?q=query
// Search across products, categories, and trainings
router.get("/", async (req, res) => {
  try {
    const query = (req.query.q || "").trim().toLowerCase();
    if (!query) {
      return success(res, { products: [], categories: [], trainings: [] });
    }

    const [productsResult, categoriesResult, trainingsResult] =
      await Promise.all([
        req.db.from("products").select("*").then((r) => r),
        req.db.from("categories").select("*").then((r) => r),
        req.db.from("trainings").select("*").then((r) => r),
      ]);

    const allProducts = productsResult.data || productsResult;
    const allCategories = categoriesResult.data || categoriesResult;
    const allTrainings = trainingsResult.data || trainingsResult;

    const products = (Array.isArray(allProducts) ? allProducts : [])
      .filter(
        (p) =>
          (p.name && p.name.toLowerCase().includes(query)) ||
          (p.description && p.description.toLowerCase().includes(query)),
      )
      .slice(0, 10);

    const categories = (Array.isArray(allCategories) ? allCategories : [])
      .filter(
        (c) =>
          (c.name && c.name.toLowerCase().includes(query)) ||
          (c.description && c.description.toLowerCase().includes(query)),
      )
      .slice(0, 10);

    const trainings = (Array.isArray(allTrainings) ? allTrainings : [])
      .filter(
        (t) =>
          (t.title && t.title.toLowerCase().includes(query)) ||
          (t.description && t.description.toLowerCase().includes(query)) ||
          (t.category && t.category.toLowerCase().includes(query)),
      )
      .slice(0, 10);

    return success(res, { products, categories, trainings });
  } catch (error) {
    return respondError(
      res,
      error.message || "Search failed",
      error.status || 500,
    );
  }
});

module.exports = router;
