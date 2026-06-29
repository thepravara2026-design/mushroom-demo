const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const { supabaseAdmin } = require("./supabase");
const logger = require("../utils/logger");
const escapeRegExp = require("../utils/escapeRegExp");

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
  shipping_providers: [
    {
      id: 'sp-shiprocket',
      provider_key: 'shiprocket',
      name: 'Shiprocket',
      is_active: true,
      is_default: true,
      config: { base_url: 'https://apiv2.shiprocket.in/v1/external' },
      created_at: new Date().toISOString(),
    },
    {
      id: 'sp-manual',
      provider_key: 'manual_legacy',
      name: 'Manual / Legacy',
      is_active: false,
      is_default: false,
      config: {},
      created_at: new Date().toISOString(),
    },
  ],
  shipments: [],
  shipment_tracking_events: [],
  order_status_history: [],
  fulfillment_tasks: [],
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
      created_at: "2025-06-01T10:00:00.000Z",
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
      storage_handling: 'Store in a cool, dark place (4-8°C refrigerator recommended). Keep away from heat and moisture. Use within 6 months.',
      warranty_policy: '14-day viability guarantee — free replacement if no germination.',
      return_policy: 'Sealed packs non-returnable for hygiene. Replacement issued for contamination or low viability within 7 days.',
      shipping_info: 'Free shipping on orders above ₹499. Discreet, secure packaging with temperature control.',
      compliance_info: 'Produced in ISO-certified laboratory facility. Meets DBT guidelines for microbial cultures. Lot-wise QC tested.',
      highlights: [
        'Cultured in sterile laboratory conditions',
        'High germination rate — tested for viability',
        'Packaged in sterile, contamination-proof containers',
        'Shelf life: 6 months under proper storage',
        'Suitable for both beginners and experienced growers',
      ],
      certificates: [
        { icon: 'fa-solid fa-microscope', label: 'Lab Tested' },
        { icon: 'fa-solid fa-check-circle', label: 'Contamination-Free' },
        { icon: 'fa-solid fa-flask', label: 'Sterile Pack' },
      ],
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
      created_at: "2025-06-02T10:00:00.000Z",
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
      storage_handling: 'Store in a cool, dark place (4-8°C refrigerator recommended). Keep away from heat and moisture. Use within 6 months.',
      warranty_policy: '14-day viability guarantee — free replacement if no germination.',
      return_policy: 'Sealed packs non-returnable for hygiene. Replacement issued for contamination or low viability within 7 days.',
      shipping_info: 'Free shipping on orders above ₹499. Discreet, secure packaging with temperature control.',
      compliance_info: 'Produced in ISO-certified laboratory facility. Meets DBT guidelines for microbial cultures. Lot-wise QC tested.',
      highlights: [
        'Cultured in sterile laboratory conditions',
        'High germination rate — tested for viability',
        'Packaged in sterile, contamination-proof containers',
        'Shelf life: 6 months under proper storage',
        'Suitable for both beginners and experienced growers',
      ],
      certificates: [
        { icon: 'fa-solid fa-microscope', label: 'Lab Tested' },
        { icon: 'fa-solid fa-check-circle', label: 'Contamination-Free' },
        { icon: 'fa-solid fa-flask', label: 'Sterile Pack' },
      ],
    },
    {
      id: "prod-3",
      created_at: "2025-06-03T10:00:00.000Z",
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
      storage_handling: 'Store in a cool, dark place (4-8°C refrigerator recommended). Keep away from heat and moisture. Use within 6 months.',
      warranty_policy: '14-day viability guarantee — free replacement if no germination.',
      return_policy: 'Sealed packs non-returnable for hygiene. Replacement issued for contamination or low viability within 7 days.',
      shipping_info: 'Free shipping on orders above ₹499. Discreet, secure packaging with temperature control.',
      compliance_info: 'Produced in ISO-certified laboratory facility. Meets DBT guidelines for microbial cultures. Lot-wise QC tested.',
      highlights: [
        'Cultured in sterile laboratory conditions',
        'High germination rate — tested for viability',
        'Packaged in sterile, contamination-proof containers',
        'Shelf life: 6 months under proper storage',
        'Suitable for both beginners and experienced growers',
      ],
      certificates: [
        { icon: 'fa-solid fa-microscope', label: 'Lab Tested' },
        { icon: 'fa-solid fa-check-circle', label: 'Contamination-Free' },
        { icon: 'fa-solid fa-flask', label: 'Sterile Pack' },
      ],
    },
    {
      id: "prod-4",
      created_at: "2025-06-04T10:00:00.000Z",
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
      storage_handling: 'Store in a cool, dark place (4-8°C refrigerator recommended). Keep away from heat and moisture. Use within 6 months.',
      warranty_policy: '14-day viability guarantee — free replacement if no germination.',
      return_policy: 'Sealed packs non-returnable for hygiene. Replacement issued for contamination or low viability within 7 days.',
      shipping_info: 'Free shipping on orders above ₹499. Discreet, secure packaging with temperature control.',
      compliance_info: 'Produced in ISO-certified laboratory facility. Meets DBT guidelines for microbial cultures. Lot-wise QC tested.',
      highlights: [
        'Cultured in sterile laboratory conditions',
        'High germination rate — tested for viability',
        'Packaged in sterile, contamination-proof containers',
        'Shelf life: 6 months under proper storage',
        'Suitable for both beginners and experienced growers',
      ],
      certificates: [
        { icon: 'fa-solid fa-microscope', label: 'Lab Tested' },
        { icon: 'fa-solid fa-check-circle', label: 'Contamination-Free' },
        { icon: 'fa-solid fa-flask', label: 'Sterile Pack' },
      ],
    },
    {
      id: "prod-5",
      created_at: "2025-06-05T10:00:00.000Z",
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
      storage_handling: 'Refrigerate immediately at 2-4°C. Consume within 5-7 days for best quality. Do not freeze. Store in a breathable container.',
      warranty_policy: '7-day freshness guarantee — replace if spoiled on arrival.',
      return_policy: 'Perishable goods non-returnable. Replacement issued for quality issues reported within 24 hrs.',
      shipping_info: 'Free shipping on orders above ₹499. Dispatched in insulated boxes with ice packs.',
      compliance_info: 'Compliant with FSSAI (Food Safety and Standards Authority of India) regulations. Grown under Good Agricultural Practices (GAP). Lot-wise traceability maintained.',
      highlights: [
        'Hand-picked at peak freshness from certified farms',
        'Cold-chain maintained throughout transit (2-4°C)',
        'Shelf life: 5-7 days under refrigeration',
        'Washed and trimmed, ready to cook',
        'Grown using sustainable agricultural practices',
      ],
      certificates: [
        { icon: 'fa-solid fa-certificate', label: 'FSSAI Certified' },
        { icon: 'fa-solid fa-leaf', label: 'Organic Produce' },
        { icon: 'fa-solid fa-check-circle', label: 'Non-GMO' },
      ],
    },
    {
      id: "prod-6",
      created_at: "2025-06-06T10:00:00.000Z",
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
      storage_handling: 'Refrigerate immediately at 2-4°C. Consume within 5-7 days for best quality. Do not freeze. Store in a breathable container.',
      warranty_policy: '7-day freshness guarantee — replace if spoiled on arrival.',
      return_policy: 'Perishable goods non-returnable. Replacement issued for quality issues reported within 24 hrs.',
      shipping_info: 'Free shipping on orders above ₹499. Dispatched in insulated boxes with ice packs.',
      compliance_info: 'Compliant with FSSAI (Food Safety and Standards Authority of India) regulations. Grown under Good Agricultural Practices (GAP). Lot-wise traceability maintained.',
      highlights: [
        'Hand-picked at peak freshness from certified farms',
        'Cold-chain maintained throughout transit (2-4°C)',
        'Shelf life: 5-7 days under refrigeration',
        'Washed and trimmed, ready to cook',
        'Grown using sustainable agricultural practices',
      ],
      certificates: [
        { icon: 'fa-solid fa-certificate', label: 'FSSAI Certified' },
        { icon: 'fa-solid fa-leaf', label: 'Organic Produce' },
        { icon: 'fa-solid fa-check-circle', label: 'Non-GMO' },
      ],
    },
    {
      id: "prod-7",
      created_at: "2025-06-07T10:00:00.000Z",
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
      storage_handling: 'Store in an airtight container in a cool, dry place away from direct sunlight. Refrigeration extends shelf life.',
      warranty_policy: '30-day quality guarantee — replace if damaged or infested.',
      return_policy: 'Unopened packages can be returned within 7 days. Opened packages replaced only if quality issues found.',
      shipping_info: 'Free shipping on orders above ₹499. Lightweight, compact packaging.',
      compliance_info: 'Manufactured in FSSAI-registered facility. Batch-tested for microbial contaminants. Meets food safety standards per FSSAI regulations.',
      highlights: [
        'Premium-grade sun-dried & air-dehydrated mushrooms',
        'No preservatives, no artificial colours',
        'Shelf life: 12 months in proper storage',
        'Rehydrate in warm water for 20 mins before use',
        'Sourced from organic-certified farms in India',
      ],
      certificates: [
        { icon: 'fa-solid fa-certificate', label: 'FSSAI Approved' },
        { icon: 'fa-solid fa-leaf', label: 'Organic Certified' },
        { icon: 'fa-solid fa-shield', label: 'HACCP Compliant' },
      ],
    },
    {
      id: "prod-8",
      created_at: "2025-06-08T10:00:00.000Z",
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
      storage_handling: 'Store in an airtight container in a cool, dry place away from direct sunlight. Refrigeration extends shelf life.',
      warranty_policy: '30-day quality guarantee — replace if damaged or infested.',
      return_policy: 'Unopened packages can be returned within 7 days. Opened packages replaced only if quality issues found.',
      shipping_info: 'Free shipping on orders above ₹499. Lightweight, compact packaging.',
      compliance_info: 'Manufactured in FSSAI-registered facility. Batch-tested for microbial contaminants. Meets food safety standards per FSSAI regulations.',
      highlights: [
        'Premium-grade sun-dried & air-dehydrated mushrooms',
        'No preservatives, no artificial colours',
        'Shelf life: 12 months in proper storage',
        'Rehydrate in warm water for 20 mins before use',
        'Sourced from organic-certified farms in India',
      ],
      certificates: [
        { icon: 'fa-solid fa-certificate', label: 'FSSAI Approved' },
        { icon: 'fa-solid fa-leaf', label: 'Organic Certified' },
        { icon: 'fa-solid fa-shield', label: 'HACCP Compliant' },
      ],
    },
    {
      id: "prod-9",
      created_at: "2025-06-09T10:00:00.000Z",
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
      storage_handling: 'Store at room temperature (20-30°C) away from direct sunlight. Use within 3 months of purchase for best results.',
      warranty_policy: '30-day germination guarantee — free replacement if no growth.',
      return_policy: 'Unused kits can be returned within 7 days. Used kits replaced only under warranty terms.',
      shipping_info: 'Free shipping on all kit orders. Dispatched within 24 hrs in discreet packaging.',
      compliance_info: 'Compliant with BIS standards for educational kits. Non-toxic materials certified. Meets CPCB guidelines for biodegradable packaging.',
      highlights: [
        'Complete DIY mushroom growing kit — ready to use',
        'Includes substrate, spawn, and detailed instruction manual',
        'First harvest in 10-14 days, continues for 2-3 flushes',
        'Compact size — fits on any shelf or countertop',
        '100% biodegradable packaging materials',
      ],
      certificates: [
        { icon: 'fa-solid fa-flask', label: 'Lab Tested' },
        { icon: 'fa-solid fa-child', label: 'Child-Safe Materials' },
        { icon: 'fa-solid fa-recycle', label: 'Eco-Friendly Pack' },
      ],
    },
    {
      id: "prod-10",
      created_at: "2026-06-20T10:00:00.000Z",
      name: "Wild Forest Mushroom Mix (300g)",
      description:
        "A curated blend of hand-foraged wild forest mushrooms including porcini, chanterelles, and morels. Sourced from sustainable forest floors and dried to preserve rich, earthy flavors.",
      price: 650.0,
      mrp_price: 899.0,
      image_url:
        "https://images.unsplash.com/photo-1603791440384-56cd371ee9a4?auto=format&fit=crop&q=80&w=600",
      image_urls: [
        "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1597613214297-9697008d7851?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1559152134-5e022b9a0a77?auto=format&fit=crop&q=80&w=600",
      ],
      category: "fresh",
      difficulty: "intermediate",
      gst_rate: 5,
      stock: 35,
      storage_handling: 'Refrigerate immediately at 2-4°C. Consume within 5-7 days for best quality. Do not freeze. Store in a breathable container.',
      warranty_policy: '7-day freshness guarantee — replace if spoiled on arrival.',
      return_policy: 'Perishable goods non-returnable. Replacement issued for quality issues reported within 24 hrs.',
      shipping_info: 'Free shipping on orders above ₹499. Dispatched in insulated boxes with ice packs.',
      compliance_info: 'Compliant with FSSAI (Food Safety and Standards Authority of India) regulations. Grown under Good Agricultural Practices (GAP). Lot-wise traceability maintained.',
      highlights: [
        'Hand-picked at peak freshness from certified farms',
        'Cold-chain maintained throughout transit (2-4°C)',
        'Shelf life: 5-7 days under refrigeration',
        'Washed and trimmed, ready to cook',
        'Grown using sustainable agricultural practices',
      ],
      certificates: [
        { icon: 'fa-solid fa-certificate', label: 'FSSAI Certified' },
        { icon: 'fa-solid fa-leaf', label: 'Organic Produce' },
        { icon: 'fa-solid fa-check-circle', label: 'Non-GMO' },
      ],
    },
  ],

  refunds: [],
  refund_audits: [],
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
const ADMIN_SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD;
if (!ADMIN_SEED_PASSWORD || ADMIN_SEED_PASSWORD === "admin123") {
  throw new Error(
    'ADMIN_SEED_PASSWORD environment variable must be set to a secure value. The default "admin123" is not allowed in any environment.',
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
        if (this.table === "orders") {
          newRow.payment_status = newRow.payment_status || "pending";
          newRow.refund_status = newRow.refund_status || "none";
          newRow.refund_id = newRow.refund_id || null;
          newRow.total_refunded_amount = newRow.total_refunded_amount || 0.00;
          newRow.fulfillment_status = newRow.fulfillment_status || "pending_fulfillment";
          newRow.restocked = newRow.restocked || false;
        }
        if (this.table === "refunds") {
          newRow.status = newRow.status || newRow.refund_status || "initiated";
          newRow.amount = newRow.amount !== undefined ? newRow.amount : newRow.refund_amount;
          newRow.refund_status = newRow.status;
          newRow.refund_amount = newRow.amount;
          newRow.cancelled_by = newRow.cancelled_by || newRow.initiated_by;
        }
        mockStore[this.table].push(newRow);
        return newRow;
      });

      this.data = inserted;
      this.insertData = null;
    }

    if (this.updateData) {
      let updates = { ...this.updateData };
      if (this.table === "refunds") {
        if (updates.status !== undefined) updates.refund_status = updates.status;
        if (updates.amount !== undefined) updates.refund_amount = updates.amount;
        if (updates.cancelled_by !== undefined) updates.initiated_by = updates.cancelled_by;
      }
      const targetIds = new Set(this.data.map((item) => item.id));
      const safeUpdates = Object.keys(updates).reduce((acc, key) => {
        if (!["__proto__", "constructor", "prototype"].includes(key)) {
          acc[key] = updates[key];
        }
        return acc;
      }, {});
      mockStore[this.table] = mockStore[this.table].map((item) => {
        if (targetIds.has(item.id)) {
          const updatedItem = { ...item, ...safeUpdates };
          return updatedItem;
        }
        return item;
      });
      this.data = this.data.map((item) => {
        if (targetIds.has(item.id)) {
          return { ...item, ...safeUpdates };
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

  or(filterString) {
    // filterString format: "col1.ilike.%val%,col2.ilike.%val%"
    const conditions = filterString.split(",");
    this.data = this.data.filter((item) =>
      conditions.some((cond) => {
        const parts = cond.split(".");
        if (parts.length < 3) return false;
        const column = parts[0];
        const op = parts[1];
        const pattern = parts.slice(2).join(".");
        if (op === "ilike") {
          const escaped = pattern.split("%").map((p) => escapeRegExp(p)).join(".*");
          const regex = new RegExp(escaped, "i");
          return regex.test(item[column] || "");
        }
        return false;
      }),
    );
    return this;
  }

  ilike(column, pattern) {
    const escaped = pattern.split("%").map((p) => escapeRegExp(p)).join(".*");
    const regex = new RegExp(escaped, "i");
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

  select(fields = "*", opts = {}) {
    this.builder = this.builder.select(fields, opts);
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

  or(filterString) {
    this.builder = this.builder.or(filterString);
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

function resetMockStore() {
  mockStore.users = [];
  mockStore.orders = [];
  mockStore.refunds = [];
  mockStore.refund_audits = [];
  mockStore.enrollments = [];
  mockStore.shipments = [];
  mockStore.shipment_tracking_events = [];
  mockStore.order_status_history = [];
  mockStore.fulfillment_tasks = [];
}

module.exports = db;
module.exports._getMockStore = () => mockStore;
module.exports.resetMockStore = resetMockStore;
