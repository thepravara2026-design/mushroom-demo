const express = require('express');
const router = express.Router();
const db = require('../config/db');

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
    if (product.category === 'spawn' || product.category === 'kits') {
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
          incubationTime: "60-90 days (long browning phase)",
          fruitingTime: "7-14 days",
          substrate: "Oak Logs, Supplemented Sawdust Blocks",
          difficulty: "Intermediate"
        };
      } else if (product.name.toLowerCase().includes('reishi')) {
        growthMetadata = {
          tempRange: "21°C - 27°C",
          humidity: "90% - 95% (high CO2 for antlers)",
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

module.exports = router;
