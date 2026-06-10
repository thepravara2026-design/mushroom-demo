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
  categories: [
    {
      category_id: "spore-000001",
      id: "fresh",
      name: "Fresh Mushrooms",
      description: "Handpicked & hygienically packed for best taste"
    },
    {
      category_id: "spore-000002",
      id: "dry",
      name: "Dry Mushrooms",
      description: "100% natural & sun-dried for rich nutrition"
    },
    {
      category_id: "spore-000003",
      id: "spawn",
      name: "Spawn Seeds",
      description: "High quality spawn for better yield"
    },
    {
      category_id: "spore-000004",
      id: "kits",
      name: "Mushroom Kits",
      description: "Ready-to-grow mushroom fruiting kits"
    }
  ],
  products: [
    {
      id: "prod-1",
      name: "Pink Oyster Spore Syringe (10ml)",
      description: "High-viability Pleurotus djamor spores. Perfect for growers who want fast colonizing spawn and beautiful pink mushroom clusters.",
      price: 350.00,
      mrp_price: 499.00,
      image_url: "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 120
    },
    {
      id: "prod-2",
      name: "Lion's Mane Spore Culture (10ml)",
      description: "Hericium erinaceus liquid culture. High-viability mycelium growth with exceptional yield records.",
      price: 400.00,
      mrp_price: 599.00,
      image_url: "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 85
    },
    {
      id: "prod-3",
      name: "Shiitake Grain Spawn (1kg)",
      description: "Sterilized organic rye grains fully colonized with premium Lentinula edodes mycelium. Ideal for inoculating sawdust blocks.",
      price: 450.00,
      mrp_price: 649.00,
      image_url: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 50
    },
    {
      id: "prod-4",
      name: "Reishi Spore Print",
      description: "Dark purple spore print of Ganoderma lucidum collected on sterile foil. Perfect for agar transfers.",
      price: 300.00,
      mrp_price: 449.00,
      image_url: "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "advanced",
      gst_rate: 5,
      stock: 60
    },
    {
      id: "prod-5",
      name: "Fresh Pink Oyster Mushrooms (500g)",
      description: "Freshly harvested organic Pink Oyster mushrooms. Beautiful color with a savory, bacon-like aroma when cooked.",
      price: 500.00,
      mrp_price: 699.00,
      image_url: "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600",
      category: "fresh",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 40
    },
    {
      id: "prod-6",
      name: "Fresh King Oyster Mushrooms (500g)",
      description: "Thick, meaty stems with a savory, umami flavor. Harvested fresh daily. Kept chilled during delivery.",
      price: 400.00,
      mrp_price: 549.00,
      image_url: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600",
      category: "fresh",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 45
    },
    {
      id: "prod-7",
      name: "Dried Reishi Mushrooms (100g)",
      description: "Premium sun-dried Ganoderma lucidum slices. Used commonly for making herbal teas and immunity decoctions.",
      price: 700.00,
      mrp_price: 999.00,
      image_url: "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600",
      category: "dry",
      difficulty: "advanced",
      gst_rate: 5,
      stock: 100
    },
    {
      id: "prod-8",
      name: "Dried Cordyceps Militaris (50g)",
      description: "Premium lab-grown Cordyceps, dehydrated to preserve active cordycepin content. Excellent for wellness soups.",
      price: 1800.00,
      mrp_price: 2499.00,
      image_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600",
      category: "dry",
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 75
    },
    {
      id: "prod-9",
      name: "Oyster Mushroom Grow Kit",
      description: "Easy-to-use organic mushroom fruiting block. Spray with water daily and watch your delicious mushrooms grow in just 10 days!",
      price: 450.00,
      mrp_price: 699.00,
      image_url: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600",
      category: "kits",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 65
    }
  ],
  settings: [
    {
      key: 'shipping_charge',
      value: 50
    }
  ],
  orders: []
};

// Seed Users for Sporekart
const adminPasswordHash = bcrypt.hashSync("admin123", 10);

// Seed Buyer User
mockStore.users.push({
  id: "user-buyer",
  email: "buyer@sporekart.com",
  full_name: "John Buyer",
  whatsapp_number: "9876543211",
  role: "buyer", // Customer type: Buyer
  created_at: new Date().toISOString()
});

// Seed Cultivator User
mockStore.users.push({
  id: "user-grower",
  email: "grower@sporekart.com",
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
    this.insertData = null;
    this.updateData = null;
    this.shouldDelete = false;
  }

  select(fields = '*') {
    return this;
  }

  eq(column, value) {
    this.data = this.data.filter(item => item[column] === value);
    return this;
  }

  execute() {
    if (this.insertData) {
      const rows = this.insertData;
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
      this.insertData = null;
    }

    if (this.updateData) {
      const updates = this.updateData;
      const targetIds = new Set(this.data.map(item => item.id));
      mockStore[this.table] = mockStore[this.table].map(item => {
        if (targetIds.has(item.id)) {
          const updatedItem = { ...item, ...updates };
          return updatedItem;
        }
        return item;
      });
      this.data = this.data.map(item => {
        if (targetIds.has(item.id)) {
          return { ...item, ...updates };
        }
        return item;
      });
      this.updateData = null;
    }

    if (this.shouldDelete) {
      const targetIds = new Set(this.data.map(item => item.id));
      mockStore[this.table] = mockStore[this.table].filter(item => !targetIds.has(item.id));
      this.data = [];
      this.shouldDelete = false;
    }
  }

  single() {
    this.execute();
    if (this.data.length === 0) {
      return Promise.resolve({ data: null, error: { message: "No rows found" } });
    }
    return Promise.resolve({ data: this.data[0], error: null });
  }

  insert(rows) {
    this.insertData = rows;
    return this;
  }

  update(updates) {
    this.updateData = updates;
    return this;
  }

  delete() {
    this.shouldDelete = true;
    return this;
  }

  then(onfulfilled) {
    this.execute();
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
