const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const logger = require("../utils/logger");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes("your-supabase-url")) {
  logger.error(
    "❌ Error: Supabase credentials are missing or default in .env file.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const categories = [
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
];

const products = [
  {
    id: "prod-1",
    name: "Pink Oyster Spore Syringe (10ml)",
    description:
      "High-viability Pleurotus djamor spores. Perfect for growers who want fast colonizing spawn and beautiful pink mushroom clusters.",
    price: 350.0,
    mrp_price: 499.0,
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
    image_url:
      "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600",
    category: "spawn",
    difficulty: "beginner",
    gst_rate: 5,
    stock: 120,
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
];

const settings = [
  {
    key: "shipping_charge",
    value: 50,
  },
];

const trainings = [
  {
    id: "train-1",
    title: "Beginner Mushroom Cultivation",
    category: "Beginner",
    description: "A hands-on introduction to mushroom farming for new growers.",
    image_url: "/images/training_farm.png",
    content_url: "",
    allowed_roles: ["trainee", "farmer"],
  },
  {
    id: "train-2",
    title: "Commercial Farming for Entrepreneurs",
    category: "Entrepreneur",
    description:
      "Scaling up production, post-harvest handling and business models.",
    image_url: "/images/training_business.png",
    content_url: "",
    allowed_roles: ["entrepreneur"],
  },
  {
    id: "train-3",
    title: "Mushroom Product Mastery for Buyers",
    category: "Buyer",
    description:
      "Learn to identify, select, and store the freshest mushrooms. Perfect for chefs, retailers, and home cooks.",
    image_url: "/images/training_business.png",
    content_url: "",
    allowed_roles: ["buyer"],
  },
  {
    id: "train-4",
    title: "Advanced Grower Certification",
    category: "Grower",
    description:
      "Master sterile techniques, spawn run optimization, and high-yield fruiting for commercial growers.",
    image_url: "/images/training_farm.png",
    content_url: "",
    allowed_roles: ["grower"],
  },
];

const trainingBatches = [
  {
    id: "batch-seed-1",
    training_id: "train-1",
    title: "Beginner Cultivation — July Cohort",
    start_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString(),
    capacity: 20,
    seats_taken: 0,
    price_actual: 999,
    price_strikeout: 1999,
    instructor: "Dr. Radha Sharma",
    location: "Sporekart Learning Center, Pune",
    meeting_link: "",
    cancellation_cutoff_days: 3,
    status: "upcoming",
  },
  {
    id: "batch-seed-2",
    training_id: "train-2",
    title: "Entrepreneur Bootcamp — August Cohort",
    start_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(Date.now() + 70 * 24 * 60 * 60 * 1000).toISOString(),
    capacity: 15,
    seats_taken: 0,
    price_actual: 2999,
    price_strikeout: 4999,
    instructor: "Anita Verma",
    location: "Online (Zoom)",
    meeting_link: "https://zoom.us/j/entrepreneur-bootcamp",
    cancellation_cutoff_days: 7,
    status: "upcoming",
  },
  {
    id: "batch-seed-3",
    training_id: "train-3",
    title: "Buyer's Guide to Mushrooms — August Session",
    start_date: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString(),
    capacity: 30,
    seats_taken: 0,
    price_actual: 499,
    price_strikeout: 999,
    instructor: "Chef Meera Iyer",
    location: "Online (Zoom)",
    meeting_link: "https://zoom.us/j/buyers-guide",
    cancellation_cutoff_days: 2,
    status: "upcoming",
  },
  {
    id: "batch-seed-4",
    training_id: "train-4",
    title: "Advanced Grower Lab — September Intensive",
    start_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(Date.now() + 75 * 24 * 60 * 60 * 1000).toISOString(),
    capacity: 10,
    seats_taken: 0,
    price_actual: 5999,
    price_strikeout: 9999,
    instructor: "Dr. Suresh Kulkarni",
    location: "Lab Facility, Mumbai",
    meeting_link: "",
    cancellation_cutoff_days: 5,
    status: "upcoming",
  },
];

const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
if (!adminSeedPassword || adminSeedPassword === "admin123") {
  logger.error(
    'ADMIN_SEED_PASSWORD must be set to a secure value. The default "admin123" is not allowed.',
  );
  process.exit(1);
}
const adminPassword = adminSeedPassword;
const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
const users = [
  {
    id: "user-buyer",
    email: "buyer@sporekart.com",
    full_name: "John Buyer",
    whatsapp_number: "9876543211",
    role: "buyer",
    created_at: new Date().toISOString(),
  },
  {
    id: "user-grower",
    email: "grower@sporekart.com",
    full_name: "Sam Grower",
    whatsapp_number: "9876543212",
    role: "grower",
    created_at: new Date().toISOString(),
  },
  {
    id: "user-admin",
    email: "admin@sporekart.com",
    password_hash: adminPasswordHash,
    full_name: "Sporekart Admin",
    whatsapp_number: "9876543210",
    role: "admin",
    created_at: new Date().toISOString(),
  },
];

async function seed() {
  try {
    logger.info("🌱 Starting database seeding...");

    // 1. Seed Categories
    logger.info("Categories seeding...");
    const { error: catErr } = await supabase
      .from("categories")
      .upsert(categories);
    if (catErr) throw new Error(`Categories error: ${catErr.message}`);
    logger.info("✅ Categories seeded successfully.");

    // 2. Seed Products
    logger.info("Products seeding...");
    const { error: prodErr } = await supabase.from("products").upsert(products);
    if (prodErr) throw new Error(`Products error: ${prodErr.message}`);
    logger.info("✅ Products seeded successfully.");

    // 3. Seed Settings
    logger.info("Settings seeding...");
    const { error: setErr } = await supabase.from("settings").upsert(settings);
    if (setErr) throw new Error(`Settings error: ${setErr.message}`);
    logger.info("✅ Settings seeded successfully.");

    // 4. Seed Trainings
    logger.info("Trainings seeding...");
    const { error: trainErr } = await supabase
      .from("trainings")
      .upsert(trainings);
    if (trainErr) throw new Error(`Trainings error: ${trainErr.message}`);
    logger.info("✅ Trainings seeded successfully.");

    // 5. Seed Training Batches
    logger.info("Training batches seeding...");
    const { error: batchErr } = await supabase
      .from("training_batches")
      .upsert(trainingBatches, { onConflict: "id" });
    if (batchErr) throw new Error(`Training batches error: ${batchErr.message}`);
    logger.info("✅ Training batches seeded successfully.");

    // 6. Seed Users
    logger.info("Users seeding...");
    const { error: userErr } = await supabase.from("users").upsert(users);
    if (userErr) throw new Error(`Users error: ${userErr.message}`);
    logger.info("✅ Users seeded successfully.");

    logger.info("🎉 Seeding completed successfully!");
  } catch (error) {
    logger.error("❌ Seeding failed:", error.message);
    process.exit(1);
  }
}

seed();
