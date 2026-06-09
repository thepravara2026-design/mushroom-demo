const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

// Admin Authorization Helper
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
  }
};

// GET /api/categories
// Fetch all categories
router.get('/', async (req, res) => {
  try {
    const { data: categories, error } = await db.from('categories').select('*');
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN ONLY - POST /api/categories
// Create a new category
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id, name, description } = req.body;

    if (!id || !name) {
      return res.status(400).json({ error: 'Please provide category ID/slug and name.' });
    }

    // Check if category already exists
    const { data: existing } = await db.from('categories').eq('id', id).single();
    if (existing) {
      return res.status(400).json({ error: `Category with ID/slug "${id}" already exists.` });
    }

    const { data: newCategory, error } = await db.from('categories').insert({
      id: id.toLowerCase().replace(/\s+/g, '-'),
      name,
      description: description || ''
    }).single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN ONLY - PUT /api/categories/:id
// Update category details
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, description } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const { data: updatedCategory, error } = await db.from('categories')
      .update(updates)
      .eq('id', req.params.id)
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(updatedCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN ONLY - DELETE /api/categories/:id
// Delete a category and set related products category to 'uncategorized'
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const catId = req.params.id;

    // Delete category
    const { error } = await db.from('categories').delete().eq('id', catId);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Set products belonging to this category to 'uncategorized'
    // First, find products with this category
    const { data: products } = await db.from('products').eq('category', catId);
    if (products && products.length > 0) {
      for (const p of products) {
        await db.from('products').update({ category: 'uncategorized' }).eq('id', p.id);
      }
    }

    res.json({ message: `Category "${catId}" successfully deleted.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
