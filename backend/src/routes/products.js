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

// ADMIN ONLY - POST /api/products
// Add a new product to listing
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, description, price, image_url, category, difficulty, gst_rate, stock } = req.body;

    if (!name || !description || price === undefined || !category) {
      return res.status(400).json({ error: 'Please provide name, description, price, and category.' });
    }

    if (category !== 'spawn' && category !== 'mushrooms') {
      return res.status(400).json({ error: 'Category must be either "spawn" or "mushrooms".' });
    }

    const { data: newProduct, error } = await db.from('products').insert({
      name,
      description,
      price: parseFloat(price),
      image_url: image_url || 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600',
      category,
      difficulty: difficulty || 'beginner',
      gst_rate: parseInt(gst_rate, 10) || 5,
      stock: parseInt(stock, 10) || 100
    }).single();

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
    const { name, description, price, image_url, category, difficulty, gst_rate, stock } = req.body;
    
    // Build update object dynamically
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = parseFloat(price);
    if (image_url !== undefined) updates.image_url = image_url;
    if (category !== undefined) {
      if (category !== 'spawn' && category !== 'mushrooms') {
        return res.status(400).json({ error: 'Category must be either "spawn" or "mushrooms".' });
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
