const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

const isMock = !supabaseUrl || supabaseUrl.includes('your-supabase-url') || !supabaseKey;

let supabaseInstance = null;
if (!isMock) {
  supabaseInstance = createClient(supabaseUrl, supabaseKey);
}

// In-memory data store for Mock Mode
const mockStore = {
  users: [],
  products: [
    {
      id: "prod-1",
      name: "Pink Oyster Spore Syringe (10ml)",
      description: "High-viability Pleurotus djamor spores. Fast-colonizing, heat-tolerant, and perfect for beginners who want to see beautiful pink blooms in just 2 weeks.",
      price: 350.00,
      image_url: "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 120
    },
    {
      id: "prod-2",
      name: "Lion's Mane Fruiting Block Kit",
      description: "An all-in-one ready-to-fruit block. Just mist with water and watch the shaggy, brain-boosting Hericium erinaceus teeth grow.",
      price: 750.00,
      image_url: "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=600",
      category: "kits",
      difficulty: "beginner",
      gst_rate: 12,
      stock: 85
    },
    {
      id: "prod-3",
      name: "Shiitake Grain Spawn (1kg)",
      description: "Sterilized organic rye grains fully colonized with premium Lentinula edodes mycelium. Ideal for inoculating sawdust substrates or logs.",
      price: 450.00,
      image_url: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 50
    },
    {
      id: "prod-4",
      name: "Reishi Medicinal Grow Kit",
      description: "Cultivate the 'Mushroom of Immortality' (Ganoderma lucidum). Produces beautiful varnished red-orange antlers. Requires patience and humidity control.",
      price: 950.00,
      image_url: "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600",
      category: "kits",
      difficulty: "advanced",
      gst_rate: 12,
      stock: 30
    },
    {
      id: "prod-5",
      name: "Premium Fresh King Oyster (500g)",
      description: "Thick, meaty stems with a savory, umami flavor. Harvested fresh daily. Kept chilled during delivery.",
      price: 400.00,
      image_url: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600",
      category: "mushrooms",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 40
    },
    {
      id: "prod-6",
      name: "Dried Cordyceps Militaris (50g)",
      description: "Premium lab-grown Cordyceps, dehydrated to preserve active cordycepin content. Used commonly in teas and wellness soups.",
      price: 1800.00,
      image_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600",
      category: "mushrooms",
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 75
    },
    {
      id: "prod-7",
      name: "Mycology Scalpel & Dissection Set",
      description: "Stainless steel surgical scalpel with 10 replaceable blades, tweezers, and inoculation loops. Perfect for sterile agar work and transfers.",
      price: 650.00,
      image_url: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&q=80&w=600",
      category: "tools",
      difficulty: "intermediate",
      gst_rate: 18,
      stock: 100
    },
    {
      id: "prod-8",
      name: "HEPA Flow Hood Fan & Filter",
      description: "A compact laminar flow hood unit. Provides a sterile stream of HEPA-filtered air to perform agar and spawn work without contamination.",
      price: 14500.00,
      image_url: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=600",
      category: "tools",
      difficulty: "advanced",
      gst_rate: 18,
      stock: 10
    }
  ],
  orders: []
};

// Seed an admin/test user in mock store
const defaultPasswordHash = bcrypt.hashSync("password123", 10);
mockStore.users.push({
  id: "user-1",
  email: "grower@shroom.com",
  password_hash: defaultPasswordHash,
  full_name: "Shroom Grower",
  whatsapp_number: "9876543210",
  created_at: new Date().toISOString()
});

/**
 * Mock Query Builder to replicate Supabase Client Syntax
 */
class MockQueryBuilder {
  constructor(table) {
    this.table = table;
    this.data = [...mockStore[table]];
    this.error = null;
  }

  select(fields = '*') {
    // Basic select, does not filter columns for simplicity, just returns whole objects
    return this;
  }

  eq(column, value) {
    this.data = this.data.filter(item => item[column] === value);
    return this;
  }

  single() {
    if (this.data.length === 0) {
      return Promise.resolve({ data: null, error: { message: "No rows found" } });
    }
    return Promise.resolve({ data: this.data[0], error: null });
  }

  insert(rows) {
    const isArray = Array.isArray(rows);
    const rowsToInsert = isArray ? rows : [rows];
    
    const inserted = rowsToInsert.map(row => {
      const newRow = {
        id: row.id || `${this.table.slice(0,-1)}-${Math.random().toString(36).substr(2, 9)}`,
        created_at: new Date().toISOString(),
        ...row
      };
      mockStore[this.table].push(newRow);
      return newRow;
    });

    this.data = inserted;
    return this;
  }

  update(updates) {
    // Apply updates to filtered items
    mockStore[this.table] = mockStore[this.table].map(item => {
      const matches = this.data.some(d => d.id === item.id);
      if (matches) {
        const updatedItem = { ...item, ...updates };
        // Update our local query array as well
        this.data = this.data.map(d => d.id === item.id ? updatedItem : d);
        return updatedItem;
      }
      return item;
    });
    return this;
  }

  then(onfulfilled) {
    return Promise.resolve({ data: this.data, error: this.error }).then(onfulfilled);
  }
}

const db = {
  isMock,
  from: (table) => {
    if (!isMock) {
      return supabaseInstance.from(table);
    }
    return new MockQueryBuilder(table);
  }
};

module.exports = db;
