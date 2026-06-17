const express = require('express');

const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const adminOnly = requireRole('admin');
const categoryService = require('../services/categoryService');
const { success, error: respondError } = require('../lib/response');
const { validateBody, Joi } = require('../middleware/validate');
const db = require('../config/db');

// GET /api/categories
// Fetch all categories
router.get('/', async (req, res) => {
  try {
    const categories = await categoryService.listCategories();
    return success(res, categories);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to fetch categories',
      error.status || 500,
    );
  }
});

// ADMIN ONLY - POST /api/categories
// Create a new category
router.post(
  '/',
  authMiddleware,
  adminOnly,
  validateBody(
    Joi.object({
      id: Joi.string().required(),
      category_id: Joi.string().optional(),
      name: Joi.string().required(),
      description: Joi.string().allow('', null),
    }),
  ),
  async (req, res) => {
    try {
      const newCat = await categoryService.createCategory(req.body);
      return success(res, newCat, {}, 201);
    } catch (error) {
      return respondError(
        res,
        error.message || 'Failed to create category',
        error.status || 500,
      );
    }
  },
);

async function generateNextCategoryUid() {
  const { data: categories } = await db
    .from('categories')
    .select('category_id')
    .execute();
  const next = categories
    .map((c) => c.category_id)
    .filter(Boolean)
    .map((uid) => {
      const match = String(uid).match(/^spore-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .reduce((max, n) => Math.max(max, n), 0) + 1;
  return `spore-${String(next).padStart(6, '0')}`;
}

// ADMIN ONLY - PUT /api/categories/:id
// Update category details
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const updated = await categoryService.updateCategory(
      req.params.id,
      req.body,
    );
    return success(res, updated);
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to update category',
      error.status || 500,
    );
  }
});

// ADMIN ONLY - DELETE /api/categories/:id
// Delete a category and set related products category to 'uncategorized'
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await categoryService.deleteCategory(req.params.id);
    return success(res, {
      message: `Category "${req.params.id}" successfully deleted.`,
    });
  } catch (error) {
    return respondError(
      res,
      error.message || 'Failed to delete category',
      error.status || 500,
    );
  }
});

module.exports = router;
