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
      description: "High-viability Pleurotus djamor spores. Perfect for growers who want fast colonizing spawn and beautiful pink mushroom clusters.",
      price: 350.00,
      image_url: "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600",
      category: "spawn", // Spawn & Seeds
      difficulty: "beginner",
      gst_rate: 5,
      stock: 120
    },
    {
      id: "prod-2",
      name: "Lion's Mane Spore Culture (10ml)",
      description: "Hericium erinaceus liquid culture. High-viability mycelium growth with exceptional yield records.",
      price: 400.00,
      image_url: "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=600",
      category: "spawn", // Spawn & Seeds
      difficulty: "beginner",
      gst_rate: 5,
      stock: 85
    },
    {
      id: "prod-3",
      name: "Shiitake Grain Spawn (1kg)",
      description: "Sterilized organic rye grains fully colonized with premium Lentinula edodes mycelium. Ideal for inoculating sawdust blocks.",
      price: 450.00,
      image_url: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600",
      category: "spawn", // Spawn & Seeds
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 50
    },
    {
      id: "prod-4",
      name: "Reishi Spore Print",
      description: "Dark purple spore print of Ganoderma lucidum collected on sterile foil. Perfect for agar transfers.",
      price: 300.00,
      image_url: "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600",
      category: "spawn", // Spawn & Seeds
      difficulty: "advanced",
      gst_rate: 5,
      stock: 60
    },
    {
      id: "prod-5",
      name: "Fresh Pink Oyster Mushrooms (500g)",
      description: "Freshly harvested organic Pink Oyster mushrooms. Beautiful color with a savory, bacon-like aroma when cooked.",
      price: 500.00,
      image_url: "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600",
      category: "mushrooms", // Mushrooms
      difficulty: "beginner",
      gst_rate: 5,
      stock: 40
    },
    {
      id: "prod-6",
      name: "Fresh King Oyster Mushrooms (500g)",
      description: "Thick, meaty stems with a savory, umami flavor. Harvested fresh daily. Kept chilled during delivery.",
      price: 400.00,
      image_url: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600",
      category: "mushrooms", // Mushrooms
      difficulty: "beginner",
      gst_rate: 5,
      stock: 45
    },
    {
      id: "prod-7",
      name: "Dried Reishi Mushrooms (100g)",
      description: "Premium sun-dried Ganoderma lucidum slices. Used commonly for making herbal teas and immunity decoctions.",
      price: 700.00,
      image_url: "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600",
      category: "mushrooms", // Mushrooms
      difficulty: "advanced",
      gst_rate: 5,
      stock: 100
    },
    {
      id: "prod-8",
      name: "Dried Cordyceps Militaris (50g)",
      description: "Premium lab-grown Cordyceps, dehydrated to preserve active cordycepin content. Excellent for wellness soups.",
      price: 1800.00,
      image_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600",
      category: "mushrooms", // Mushrooms
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 75
    }
  ],
  orders: []
};

// Seed Users for Sporekart
const defaultPasswordHash = bcrypt.hashSync("password123", 10);
const adminPasswordHash = bcrypt.hashSync("admin123", 10);

// Seed Buyer User
mockStore.users.push({
  id: "user-buyer",
  email: "buyer@sporekart.com",
  password_hash: defaultPasswordHash,
  full_name: "John Buyer",
  whatsapp_number: "9876543211",
  role: "buyer", // Customer type: Buyer
  created_at: new Date().toISOString()
});

// Seed Cultivator User
mockStore.users.push({
  id: "user-grower",
  email: "grower@sporekart.com",
  password_hash: defaultPasswordHash,
  full_name: "Sam Grower",
  whatsapp_number: "9876543212",
  role: "grower", // Customer type: Cultivator/Grower
  created_at: new Date().toISOString()
});

// Seed Admin User
mockStore.users.push({
  id: "user-admin",
  email: "admin@sporekart.com",
  password_hash: adminPasswordHash,
  full_name: "Sporekart Admin",
  whatsapp_number: "9876543210",
  role: "admin", // Administrator
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
    mockStore[this.table] = mockStore[this.table].map(item => {
      const matches = this.data.some(d => d.id === item.id);
      if (matches) {
        const updatedItem = { ...item, ...updates };
        this.data = this.data.map(d => d.id === item.id ? updatedItem : d);
        return updatedItem;
      }
      return item;
    });
    return this;
  }

  delete() {
    mockStore[this.table] = mockStore[this.table].filter(item => {
      const matches = this.data.some(d => d.id === item.id);
      return !matches;
    });
    this.data = [];
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
