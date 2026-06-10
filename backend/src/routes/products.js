const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const adminOnly = requireRole('admin');

// GET /api/products
// Fetch all products
router.get('/', async (req, res) => {
  try {
    const { data: products, error } = await db.from('products').select('*');
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/:id
// Fetch single product details with specific cultivation metadata
router.get('/:id', async (req, res) => {
  try {
    const { data: product, error } = await db.from('products').select('*').eq('id', req.params.id).single();
    if (error || !product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    // Dynamic cultivation tips based on species category
    let growthMetadata = {};
    if (product.category === 'spawn') {
      if (product.name.toLowerCase().includes('oyster')) {
        growthMetadata = {
          tempRange: "18°C - 24°C",
          humidity: "85% - 95%",
          incubationTime: "10-14 days",
          fruitingTime: "7-10 days",
          substrate: "Straw, Hardwood Sawdust, Coffee Grounds",
          difficulty: "Beginner"
        };
      } else if (product.name.toLowerCase().includes('lion')) {
        growthMetadata = {
          tempRange: "16°C - 20°C",
          humidity: "90% - 95%",
          incubationTime: "16-20 days",
          fruitingTime: "12-18 days",
          substrate: "Hardwood Sawdust, Wheat Bran",
          difficulty: "Beginner"
        };
      } else if (product.name.toLowerCase().includes('shiitake')) {
        growthMetadata = {
          tempRange: "15°C - 21°C",
          humidity: "80% - 85%",
          incubationTime: "60-90 days",
          fruitingTime: "7-14 days",
          substrate: "Oak Logs, Sawdust Blocks",
          difficulty: "Intermediate"
        };
      } else if (product.name.toLowerCase().includes('reishi')) {
        growthMetadata = {
          tempRange: "21°C - 27°C",
          humidity: "90% - 95%",
          incubationTime: "21-30 days",
          fruitingTime: "30-60 days",
          substrate: "Oak/Hardwood Sawdust",
          difficulty: "Advanced"
        };
      }
    }

    res.json({ ...product, growthMetadata });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ADMIN ONLY - POST /api/products
// Add a new product to listing
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id, name, description, price, mrp_price, image_url, category, difficulty, gst_rate, stock } = req.body;

    if (!name || !description || price === undefined || !category) {
      return res.status(400).json({ error: 'Please provide name, description, price, and category.' });
    }

    const numericPrice = parseFloat(price);
    const numericMrp = mrp_price !== undefined ? parseFloat(mrp_price) : undefined;
    if (numericMrp !== undefined && numericMrp < numericPrice) {
      return res.status(400).json({ error: 'MRP must be greater than or equal to actual price.' });
    }

    // Dynamic category validation
    const { data: categoriesList, error: categoryError } = await db.from('categories').select('id');
    if (categoryError) {
      return res.status(500).json({ error: categoryError.message });
    }

    const validCategoryIds = categoriesList ? categoriesList.map(c => c.id) : [];
    if (!validCategoryIds.includes(category)) {
      return res.status(400).json({ error: `Invalid category "${category}".` });
    }

    let categoryUid = null;
    if (Array.isArray(categoriesList)) {
      const categoryRow = categoriesList.find(c => c.id === category);
      categoryUid = categoryRow ? categoryRow.category_id || categoryRow.categoryId : null;
    }

    if (id) {
      const expectedPrefix = categoryUid || category;
      const idPattern = new RegExp(`^${escapeRegExp(expectedPrefix)}-pid-\\d{5}$`);
      if (!idPattern.test(id)) {
        return res.status(400).json({ error: `Product ID must be formatted as ${expectedPrefix}-pid-00001.` });
      }

      const { data: existingProduct, error: existingError } = await db.from('products').select('id').eq('id', id);
      if (existingError) {
        return res.status(500).json({ error: existingError.message });
      }
      if (existingProduct && existingProduct.length > 0) {
        return res.status(400).json({ error: `Product ID "${id}" is already in use.` });
      }
    }

    const insertData = {
      ...(id ? { id } : {}),
      name,
      description,
      price: parseFloat(price),
      mrp_price: mrp_price ? parseFloat(mrp_price) : parseFloat(price) * 1.4,
      image_url: image_url || 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600',
      category,
      difficulty: difficulty || 'beginner',
      gst_rate: parseInt(gst_rate, 10) || 5,
      stock: parseInt(stock, 10) || 100
    };

    const { data: newProduct, error } = await db.from('products').insert(insertData).single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN ONLY - PUT /api/products/:id
// Update product details (pricing, stock, etc.)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id, name, description, price, mrp_price, image_url, category, difficulty, gst_rate, stock } = req.body;

    if (id !== undefined) {
      return res.status(400).json({ error: 'Product ID cannot be modified once created.' });
    }

    const { data: existingProduct, error: fetchError } = await db.from('products').select('id, category').eq('id', req.params.id).single();
    if (fetchError || !existingProduct) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    // Build update object dynamically
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = parseFloat(price);
    if (mrp_price !== undefined) updates.mrp_price = parseFloat(mrp_price);
    if (image_url !== undefined) updates.image_url = image_url;
    if (category !== undefined) {
      const { data: categoriesList } = await db.from('categories').select('id, category_id');
      const validCategoryIds = categoriesList ? categoriesList.map(c => c.id) : [];
      if (!validCategoryIds.includes(category)) {
        return res.status(400).json({ error: `Invalid category "${category}".` });
      }
      const categoryRow = categoriesList.find(c => c.id === category);
      const expectedPrefix = categoryRow ? categoryRow.category_id || categoryRow.categoryId : category;
      const newPattern = new RegExp(`^${escapeRegExp(expectedPrefix)}-pid-\\d{5}$`);
      if (!newPattern.test(existingProduct.id)) {
        return res.status(400).json({ error: 'Category change is not allowed because the existing product ID prefix must match the selected category UID.' });
      }
      updates.category = category;
    }
    if (difficulty !== undefined) updates.difficulty = difficulty;
    if (gst_rate !== undefined) updates.gst_rate = parseInt(gst_rate, 10);
    if (stock !== undefined) updates.stock = parseInt(stock, 10);

    const { data: updatedProduct, error } = await db.from('products')
      .update(updates)
      .eq('id', req.params.id)
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN ONLY - DELETE /api/products/:id
// Delete a product from inventory listing
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { error } = await db.from('products').delete().eq('id', req.params.id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json({ message: 'Product successfully deleted from inventory.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
