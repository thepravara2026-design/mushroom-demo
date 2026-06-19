const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const { supabaseAdmin } = require("./supabase");
const logger = require("../utils/logger");

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Mock mode: no real Supabase credentials present, or FORCE_MOCK=true
const isMock =
  process.env.FORCE_MOCK === "true" ||
  !supabaseUrl ||
  supabaseUrl.includes("your-supabase-url") ||
  supabaseUrl.includes("placeholder") ||
  !supabaseServiceKey ||
  supabaseServiceKey.includes("your-supabase") ||
  !supabaseAdmin;

let supabaseInstance = null;
if (!isMock) {
  // Use the admin client — service_role key bypasses RLS; safe because this only runs server-side
  supabaseInstance = supabaseAdmin;
}

// In-memory data store for Mock Mode
const mockStore = {
  users: [],
  categories: [
    {
      category_id: "spore-000001",
      id: "fresh",
      name: "Fresh Mushrooms",
      description: "Handpicked & hygienically packed for best taste",
    },
    {
      category_id: "spore-000002",
      id: "dry",
      name: "Dry Mushrooms",
      description: "100% natural & sun-dried for rich nutrition",
    },
    {
      category_id: "spore-000003",
      id: "spawn",
      name: "Spawn Seeds",
      description: "High quality spawn for better yield",
    },
    {
      category_id: "spore-000004",
      id: "kits",
      name: "Mushroom Kits",
      description: "Ready-to-grow mushroom fruiting kits",
    },
  ],
  products: [
    {
      id: "prod-1",
      name: "Pink Oyster Spore Syringe (10ml)",

      description:
        "High-viability Pleurotus djamor spores. Perfect for growers who want fast colonizing spawn and beautiful pink mushroom clusters.",
      price: 350.0,
      mrp_price: 499.0,
      image_url:
        "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 120,
      weight_pricing: [
        { weight: 100, unit: "g", price: 100, mrp_price: 149 },
        { weight: 200, unit: "g", price: 180, mrp_price: 269 },
        { weight: 250, unit: "g", price: 220, mrp_price: 329 },
        { weight: 400, unit: "g", price: 320, mrp_price: 479 },
        { weight: 500, unit: "g", price: 350, mrp_price: 499 },
        { weight: 1, unit: "kg", price: 650, mrp_price: 929 },
        { weight: 2, unit: "kg", price: 1200, mrp_price: 1699 },
        { weight: 5, unit: "kg", price: 2800, mrp_price: 3899 },
      ],
    },
    {
      id: "prod-2",
      name: "Lion's Mane Spore Culture (10ml)",
      description:
        "Hericium erinaceus liquid culture. High-viability mycelium growth with exceptional yield records.",
      price: 400.0,
      mrp_price: 599.0,
      image_url:
        "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 85,
    },
    {
      id: "prod-3",
      name: "Shiitake Grain Spawn (1kg)",
      description:
        "Sterilized organic rye grains fully colonized with premium Lentinula edodes mycelium. Ideal for inoculating sawdust blocks.",
      price: 450.0,
      mrp_price: 649.0,
      image_url:
        "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 50,
    },
    {
      id: "prod-4",
      name: "Reishi Spore Print",
      description:
        "Dark purple spore print of Ganoderma lucidum collected on sterile foil. Perfect for agar transfers.",
      price: 300.0,
      mrp_price: 449.0,
      image_url:
        "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600",
      category: "spawn",
      difficulty: "advanced",
      gst_rate: 5,
      stock: 60,
    },
    {
      id: "prod-5",
      name: "Fresh Pink Oyster Mushrooms (500g)",
      description:
        "Freshly harvested organic Pink Oyster mushrooms. Beautiful color with a savory, bacon-like aroma when cooked.",
      price: 500.0,
      mrp_price: 699.0,
      image_url:
        "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600",
      category: "fresh",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 40,
    },
    {
      id: "prod-6",
      name: "Fresh King Oyster Mushrooms (500g)",
      description:
        "Thick, meaty stems with a savory, umami flavor. Harvested fresh daily. Kept chilled during delivery.",
      price: 400.0,
      mrp_price: 549.0,
      image_url:
        "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600",
      category: "fresh",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 45,
    },
    {
      id: "prod-7",
      name: "Dried Reishi Mushrooms (100g)",
      description:
        "Premium sun-dried Ganoderma lucidum slices. Used commonly for making herbal teas and immunity decoctions.",
      price: 700.0,
      mrp_price: 999.0,
      image_url:
        "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600",
      category: "dry",
      difficulty: "advanced",
      gst_rate: 5,
      stock: 100,
    },
    {
      id: "prod-8",
      name: "Dried Cordyceps Militaris (50g)",
      description:
        "Premium lab-grown Cordyceps, dehydrated to preserve active cordycepin content. Excellent for wellness soups.",
      price: 1800.0,
      mrp_price: 2499.0,
      image_url:
        "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600",
      category: "dry",
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 75,
    },
    {
      id: "prod-9",
      name: "Oyster Mushroom Grow Kit",
      description:
        "Easy-to-use organic mushroom fruiting block. Spray with water daily and watch your delicious mushrooms grow in just 10 days!",
      price: 450.0,
      mrp_price: 699.0,
      image_url:
        "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600",
      category: "kits",
      difficulty: "beginner",
      gst_rate: 5,
      stock: 65,
    },
  ],

  refunds: [],
  settings: [
    {
      key: "shipping_charge",
      value: 50,
    },
  ],
  orders: [],
  enrollments: [
    {
      id: "enroll-1",
      training_id: "train-1",
      user_id: "user-buyer",
      role: "trainee",
      created_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "enroll-2",
      training_id: "train-5",
      user_id: "user-buyer",
      role: "trainee",
      created_at: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
  blogs: [
    {
      id: "blog-1",
      title: "How AI is Transforming E-Commerce",
      slug: "how-ai-is-transforming-ecommerce",
      author: "Admin",
      content:
        "<h2>Introduction</h2><p>Artificial Intelligence is revolutionizing the way we shop online.</p>",
      featured_image:
        "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800",
      image_source: "url",
      status: "published",
      published_at: new Date(
        Date.now() - 2 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      locked: false,
    },
    {
      id: "blog-2",
      title: "The Future of Mushroom Farming",
      slug: "future-of-mushroom-farming",
      author: "Admin",
      content:
        "<h2>Sustainable Agriculture</h2><p>Mushroom farming is emerging as a key player in sustainable agriculture.</p>",
      featured_image:
        "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=800",
      image_source: "url",
      status: "published",
      published_at: new Date(
        Date.now() - 5 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      locked: false,
    },
    {
      id: "blog-3",
      title: "5 Tips for Successful Spawn Production",
      slug: "5-tips-successful-spawn-production",
      author: "Admin",
      content:
        "<h2>Tip 1: Sterile Environment</h2><p>Maintain a completely sterile workspace to prevent contamination.</p>",
      featured_image:
        "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=800",
      image_source: "url",
      status: "published",
      published_at: new Date(
        Date.now() - 10 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      locked: true,
    },
  ],
  trainings: [
    {
      id: "train-1",
      training_id: "spore-a1b2c3d4",
      title: "Mushroom Cultivation Fundamentals",
      category: "Beginner",
      description:
        "A hands-on introduction to mushroom farming for new growers. Covers spawn preparation, substrate management, and harvesting techniques.",
      image_url: "/images/training_farm.png",
      content_url: "",
      allowed_roles: ["trainee", "farmer"],
      start_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      end_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      duration_days: 31,
      price_strikeout: 1999,
      price_actual: 999,
    },
    {
      id: "train-2",
      training_id: "spore-e5f6g7h8",
      title: "Commercial Mushroom Farming",
      category: "Farmer",
      description:
        "Scale up your production with advanced growing rooms, climate control, bulk substrate preparation and disease management.",
      image_url: "/images/training_farm.png",
      content_url: "",
      allowed_roles: ["farmer"],
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      end_date: new Date(Date.now() + 54 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      duration_days: 25,
      price_strikeout: 4999,
      price_actual: 2999,
    },
    {
      id: "train-3",
      training_id: "spore-i9j0k1l2",
      title: "Mushroom Business Masterclass",
      category: "Entrepreneur",
      description:
        "Business models, marketing strategies, distribution channels and financial planning for mushroom entrepreneurs.",
      image_url: "/images/training_business.png",
      content_url: "",
      allowed_roles: ["entrepreneur"],
      start_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      end_date: new Date(Date.now() + 76 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      duration_days: 32,
      price_strikeout: 6999,
      price_actual: 3999,
    },
    {
      id: "train-4",
      training_id: "spore-m3n4o5p6",
      title: "Certified Mushroom Grower Program",
      category: "Certification",
      description:
        "Comprehensive certification covering end-to-end mushroom production. Includes lab work, farm visit and final assessment.",
      image_url: "/images/training_farm.png",
      content_url: "",
      allowed_roles: ["trainee", "farmer", "entrepreneur"],
      start_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      end_date: new Date(Date.now() + 74 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      duration_days: 15,
      price_strikeout: 12999,
      price_actual: 7999,
    },
    {
      id: "train-5",
      training_id: "spore-q7r8s9t0",
      title: "Intro to Mushroom Growing",
      category: "Beginner",
      description:
        "Perfect for hobbyists. Learn the complete lifecycle from spore to harvest with hands-on demonstrations.",
      image_url: "/images/training_farm.png",
      content_url: "",
      allowed_roles: ["trainee"],
      start_date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      end_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      duration_days: 16,
      price_strikeout: 1499,
      price_actual: 799,
    },
    {
      id: "train-6",
      training_id: "spore-u1v2w3x4",
      title: "Advanced Spawn Production Lab",
      category: "Certification",
      description:
        "Master sterile techniques, culture isolation, grain spawn production and quality testing in a professional lab setting.",
      image_url: "/images/training_business.png",
      content_url: "",
      allowed_roles: ["farmer", "entrepreneur"],
      start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      end_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      duration_days: 16,
      price_strikeout: 5999,
      price_actual: 3499,
    },
  ],
};

// Seed Users for Sporekart
const ADMIN_SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD || "admin123";
if (!process.env.ADMIN_SEED_PASSWORD && process.env.NODE_ENV === "production") {
  throw new Error(
    "ADMIN_SEED_PASSWORD environment variable is required in production.",
  );
}
const adminPasswordHash = bcrypt.hashSync(ADMIN_SEED_PASSWORD, 10);

// Seed Buyer User
mockStore.users.push({
  id: "user-buyer",
  email: "buyer@sporekart.com",
  full_name: "John Buyer",
  whatsapp_number: "9876543211",
  role: "buyer", // Customer type: Buyer
  created_at: new Date().toISOString(),
});

// Seed Buyer User (no .com)
mockStore.users.push({
  id: "user-buyer-short",
  email: "buyer@sporekart.com",
  full_name: "John Buyer",
  whatsapp_number: "9876543211",
  role: "buyer", // Customer type: Buyer
  created_at: new Date().toISOString(),
});

// Seed Cultivator User
mockStore.users.push({
  id: "user-grower",
  email: "grower@sporekart.com",
  full_name: "Sam Grower",
  whatsapp_number: "9876543212",
  role: "grower", // Customer type: Cultivator/Grower
  created_at: new Date().toISOString(),
});

// Seed Admin User
mockStore.users.push({
  id: "user-admin",
  email: "admin@sporekart.com",
  password_hash: adminPasswordHash,
  full_name: "Sporekart Admin",
  whatsapp_number: "9876543210",
  role: "admin", // Administrator
  created_at: new Date().toISOString(),
});

// Seed Admin User (no .com)
mockStore.users.push({
  id: "user-admin-short",
  email: "admin@sporekart.com",
  password_hash: adminPasswordHash,
  full_name: "Sporekart Admin",
  whatsapp_number: "9876543210",
  role: "admin", // Administrator
  created_at: new Date().toISOString(),
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

  select(fields = "*", opts = {}) {
    this._count = opts.count || null;
    return this;
  }

  eq(column, value) {
    this.data = this.data.filter((item) => item[column] === value);
    return this;
  }

  execute() {
    if (this.insertData) {
      const rows = this.insertData;
      const isArray = Array.isArray(rows);
      const rowsToInsert = isArray ? rows : [rows];

      const inserted = rowsToInsert.map((row) => {
        const newRow = {
          id:
            row.id ||
            `${this.table.slice(0, -1)}-${Math.random().toString(36).substr(2, 9)}`,
          created_at: new Date().toISOString(),
          ...row,
        };
        mockStore[this.table].push(newRow);
        return newRow;
      });

      this.data = inserted;
      this.insertData = null;
    }

    if (this.updateData) {
      const updates = this.updateData;
      const targetIds = new Set(this.data.map((item) => item.id));
      mockStore[this.table] = mockStore[this.table].map((item) => {
        if (targetIds.has(item.id)) {
          const updatedItem = { ...item, ...updates };
          return updatedItem;
        }
        return item;
      });
      this.data = this.data.map((item) => {
        if (targetIds.has(item.id)) {
          return { ...item, ...updates };
        }
        return item;
      });
      this.updateData = null;
    }

    if (this.shouldDelete) {
      const targetIds = new Set(this.data.map((item) => item.id));
      const deletedItems = mockStore[this.table].filter((item) =>
        targetIds.has(item.id),
      );
      mockStore[this.table] = mockStore[this.table].filter(
        (item) => !targetIds.has(item.id),
      );
      this.data = deletedItems; // return deleted rows for single()/then()
      this.shouldDelete = false;
    }
  }

  single() {
    this.execute();
    if (this.data.length === 0) {
      return Promise.resolve({
        data: null,
        error: { message: "No rows found" },
      });
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

  order(column, opts = { ascending: true }) {
    const { ascending = true, nullsFirst = false } = opts;
    this.data.sort((a, b) => {
      const valA = a[column];
      const valB = b[column];
      const aIsNull = valA === null || valA === undefined;
      const bIsNull = valB === null || valB === undefined;
      if (aIsNull && bIsNull) return 0;
      if (aIsNull) return nullsFirst ? -1 : 1;
      if (bIsNull) return nullsFirst ? 1 : -1;
      if (valA < valB) return ascending ? -1 : 1;
      if (valA > valB) return ascending ? 1 : -1;
      return 0;
    });
    return this;
  }

  range(from, to) {
    this.data = this.data.slice(from, to + 1);
    return this;
  }

  ilike(column, pattern) {
    const regex = new RegExp(pattern.replace(/%/g, ".*"), "i");
    this.data = this.data.filter((item) => regex.test(item[column] || ""));
    return this;
  }

  neq(column, value) {
    this.data = this.data.filter((item) => item[column] !== value);
    return this;
  }

  lt(column, value) {
    this.data = this.data.filter((item) => item[column] < value);
    return this;
  }

  gt(column, value) {
    this.data = this.data.filter((item) => item[column] > value);
    return this;
  }

  delete() {
    this.shouldDelete = true;
    return this;
  }

  then(onfulfilled) {
    this.execute();
    const result = { data: this.data, error: this.error };
    if (this._count === "exact") {
      result.count = this.data.length;
    }
    return Promise.resolve(result).then(onfulfilled);
  }
}

/**
 * Supabase Query Builder Wrapper to make mutations return data transparently in Supabase JS client v2
 */
class SupabaseQueryBuilderWrapper {
  constructor(builder) {
    this.builder = builder;
    this.hasMutated = false;
  }

  select(fields = "*") {
    this.builder = this.builder.select(fields);
    return this;
  }

  insert(rows) {
    this.builder = this.builder.insert(rows);
    this.hasMutated = true;
    return this;
  }

  update(updates) {
    this.builder = this.builder.update(updates);
    this.hasMutated = true;
    return this;
  }

  delete() {
    this.builder = this.builder.delete();
    this.hasMutated = true;
    return this;
  }

  eq(column, value) {
    this.builder = this.builder.eq(column, value);
    return this;
  }

  neq(column, value) {
    this.builder = this.builder.neq(column, value);
    return this;
  }

  lt(column, value) {
    this.builder = this.builder.lt(column, value);
    return this;
  }

  gt(column, value) {
    this.builder = this.builder.gt(column, value);
    return this;
  }

  ilike(column, pattern) {
    this.builder = this.builder.ilike(column, pattern);
    return this;
  }

  order(column, opts) {
    this.builder = this.builder.order(column, opts);
    return this;
  }

  range(from, to) {
    this.builder = this.builder.range(from, to);
    return this;
  }

  single() {
    if (this.hasMutated) {
      this.hasMutated = false;
      this.builder = this.builder.select().single();
    } else {
      this.builder = this.builder.single();
    }
    return this.builder;
  }

  then(onfulfilled, onrejected) {
    if (this.hasMutated) {
      this.hasMutated = false;
      this.builder = this.builder.select();
    }
    return this.builder.then(onfulfilled, onrejected);
  }
}

const db = {
  isMock,
  from: (table) => {
    if (!isMock) {
      return new SupabaseQueryBuilderWrapper(supabaseInstance.from(table));
    }
    return new MockQueryBuilder(table);
  },
};

module.exports = db;
