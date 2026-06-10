const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const adminOnly = requireRole('admin');

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
    const { category_id, id, name, description, image_url } = req.body;

    if (!id || !name) {
      return res.status(400).json({ error: 'Please provide category slug and name.' });
    }

    const normalizedSlug = id.toLowerCase().replace(/\s+/g, '-');
    const normalizedCid = category_id ? category_id.toLowerCase() : null;

    // Validate slug uniqueness
    const { data: existingSlug } = await db.from('categories').eq('id', normalizedSlug).single();
    if (existingSlug) {
      return res.status(400).json({ error: `Category with slug "${normalizedSlug}" already exists.` });
    }

    // Validate category_id uniqueness if provided
    if (normalizedCid) {
      const { data: existingCid } = await db.from('categories').eq('category_id', normalizedCid).single();
      if (existingCid) {
        return res.status(400).json({ error: `Category with UID "${normalizedCid}" already exists.` });
      }
    }

    const cid = normalizedCid || await generateNextCategoryUid();

    const { data: newCategory, error } = await db.from('categories').insert({
      category_id: cid,
      id: normalizedSlug,
      name,
      description: description || '',
      image_url: image_url || ''
    }).single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function generateNextCategoryUid() {
  const { data: categories } = await db.from('categories').select('category_id');
  const next = categories
    .map(c => c.category_id)
    .filter(Boolean)
    .map(uid => {
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
    const { name, description, image_url } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (image_url !== undefined) updates.image_url = image_url;

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
