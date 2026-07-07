const express = require("express");

const router = express.Router();
const authMiddleware = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");

const adminOnly = requireRole("admin");
const productService = require("../services/productService");
const { success, error: respondError } = require("../lib/response");
const { validateBody, Joi } = require("../middleware/validate");
const escapeRegExp = require("../utils/escapeRegExp");

// GET /api/products
// Fetch products with optional server-side filtering, sorting, and pagination
router.get("/", async (req, res) => {
  try {
    const { sort, category, search, page, limit } = req.query;
    const filters = {};
    if (sort) filters.sort = sort;
    if (category) filters.category = category;
    if (search) filters.search = search;
    if (page) filters.page = parseInt(page, 10);
    if (limit) filters.limit = parseInt(limit, 10);
    const products = await productService.listProducts(filters);
    return success(res, products);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch products",
      error.status || 500,
    );
  }
});

// GET /api/products/next-id
// Compute the next available product ID for a given category (admin preview)
router.get("/next-id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { category } = req.query;
    const productId = await productService.getNextProductId(category || null);
    return success(res, { productId });
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to generate product ID",
      error.status || 500,
    );
  }
});

// GET /api/products/:id
// Fetch single product details with specific cultivation metadata
router.get("/:id", async (req, res) => {
  try {
    const product = await productService.getProduct(req.params.id);
    return success(res, product);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch product",
      error.status || 500,
    );
  }
});

// ADMIN ONLY - POST /api/products
// Add a new product to listing
router.post(
  "/",
  authMiddleware,
  adminOnly,
  validateBody(
    Joi.object({
      id: Joi.string().optional(),
      name: Joi.string().required(),
      description: Joi.string().required(),
      price: Joi.number().optional(),
      category: Joi.string().required(),
      mrp_price: Joi.number().optional(),
      image_url: Joi.string().uri().optional().allow(""),
      image_urls: Joi.array().items(Joi.string().uri()).optional(),
      difficulty: Joi.string().optional(),
      gst_rate: Joi.number().optional(),
      stock: Joi.number().optional(),
      weight_pricing: Joi.array().items(
        Joi.object({
          weight: Joi.number().required(),
          unit: Joi.string().valid("g", "kg", "ml", "l").required(),
          price: Joi.number().required(),
          mrp_price: Joi.number().optional(),
          stock: Joi.number().min(0).optional(),
        }),
      ).min(1).optional(),
      storage_handling: Joi.string().optional().allow(''),
      warranty_policy: Joi.string().optional().allow(''),
      return_policy: Joi.string().optional().allow(''),
      shipping_info: Joi.string().optional().allow(''),
      compliance_info: Joi.string().optional().allow(''),
      highlights: Joi.array().items(Joi.string()).optional(),
      certificates: Joi.array().items(
        Joi.object({
          icon: Joi.string().optional().allow(''),
          label: Joi.string().required(),
        }),
      ).optional(),
      manufacturer_supplier: Joi.string().optional().allow(''),
      scientific_name: Joi.string().optional().allow(''),
      shelf_life: Joi.string().optional().allow(''),
      seo_title: Joi.string().optional().allow(''),
      seo_slug: Joi.string().optional().allow(''),
    }),
  ),
  async (req, res) => {
    try {
      const newProduct = await productService.createProduct(req.body);
      return success(res, newProduct, {}, 201);
    } catch (error) {
      return respondError(
        res,
        error.message || "Failed to create product",
        error.status || 500,
      );
    }
  },
);

const updateProductSchema = Joi.object({
  name: Joi.string().optional(),
  description: Joi.string().optional(),
  price: Joi.number().optional(),
  category: Joi.string().optional(),
  mrp_price: Joi.number().optional(),
  image_url: Joi.string().uri().optional().allow(""),
  image_urls: Joi.array().items(Joi.string().uri()).optional(),
  difficulty: Joi.string().optional(),
  gst_rate: Joi.number().optional(),
  stock: Joi.number().optional(),
  weight_pricing: Joi.array().items(
    Joi.object({
      weight: Joi.number().required(),
      unit: Joi.string().valid("g", "kg", "ml", "l").required(),
      price: Joi.number().required(),
      mrp_price: Joi.number().optional(),
      stock: Joi.number().min(0).optional(),
    }),
  ).optional(),
  storage_handling: Joi.string().optional().allow(''),
  warranty_policy: Joi.string().optional().allow(''),
  return_policy: Joi.string().optional().allow(''),
  shipping_info: Joi.string().optional().allow(''),
  compliance_info: Joi.string().optional().allow(''),
  highlights: Joi.array().items(Joi.string()).optional(),
  certificates: Joi.array().items(
    Joi.object({
      icon: Joi.string().optional().allow(''),
      label: Joi.string().required(),
    }),
  ).optional(),
  manufacturer_supplier: Joi.string().optional().allow(''),
  scientific_name: Joi.string().optional().allow(''),
  shelf_life: Joi.string().optional().allow(''),
  seo_title: Joi.string().optional().allow(''),
  seo_slug: Joi.string().optional().allow(''),
});

// ADMIN ONLY - PUT /api/products/:id
// Update product details (pricing, stock, etc.)
router.put("/:id", authMiddleware, adminOnly, validateBody(updateProductSchema), async (req, res) => {
  try {
    const updated = await productService.updateProduct(req.params.id, req.body);
    return success(res, updated);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to update product",
      error.status || 500,
    );
  }
});

// ADMIN ONLY - DELETE /api/products/:id
// Delete a product from inventory listing
router.delete("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    await productService.deleteProduct(req.params.id);
    return success(res, {
      message: "Product successfully deleted from inventory.",
    });
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to delete product",
      error.status || 500,
    );
  }
});

module.exports = router;
