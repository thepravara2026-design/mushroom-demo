const express = require('express');

const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const adminOnly = requireRole('admin');
const productService = require('../services/productService');
const { success, error: respondError } = require('../lib/response');
const { validateBody, Joi } = require('../middleware/validate');

// GET /api/products
// Fetch all products
router.get('/', async (req, res) => {
  try {
    const products = await productService.listProducts();
    return success(res, products);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to fetch products',
      error.status || 500,
    );
  }
});

// GET /api/products/:id
// Fetch single product details with specific cultivation metadata
router.get('/:id', async (req, res) => {
  try {
    const product = await productService.getProduct(req.params.id);
    return success(res, product);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to fetch product',
      error.status || 500,
    );
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ADMIN ONLY - POST /api/products
// Add a new product to listing
router.post(
  '/',
  authMiddleware,
  adminOnly,
  validateBody(
    Joi.object({
      name: Joi.string().required(),
      description: Joi.string().required(),
      price: Joi.number().required(),
      category: Joi.string().required(),
      mrp_price: Joi.number().optional(),
      image_url: Joi.string().uri().optional(),
      difficulty: Joi.string().optional(),
      gst_rate: Joi.number().optional(),
      stock: Joi.number().optional(),
    }),
  ),
  async (req, res) => {
    try {
      const newProduct = await productService.createProduct(req.body);
      return success(res, newProduct, {}, 201);
    } catch (error) {
      return respondError(
        res,
        error.message || 'Failed to create product',
        error.status || 500,
      );
    }
  },
);

// ADMIN ONLY - PUT /api/products/:id
// Update product details (pricing, stock, etc.)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const updated = await productService.updateProduct(req.params.id, req.body);
    return success(res, updated);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to update product',
      error.status || 500,
    );
  }
});

// ADMIN ONLY - DELETE /api/products/:id
// Delete a product from inventory listing
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await productService.deleteProduct(req.params.id);
    return success(res, {
      message: 'Product successfully deleted from inventory.',
    });
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to delete product',
      error.status || 500,
    );
  }
});

module.exports = router;
