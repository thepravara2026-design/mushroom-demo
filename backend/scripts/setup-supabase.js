require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || SUPABASE_URL.includes("your-") || !SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function execSql(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL error (${res.status}): ${text}`);
  }
  return res;
}

async function runMigrations() {
  console.log("📦 Running database migrations...");
  const sqlFile = path.resolve(__dirname, "..", "supabase_setup.sql");
  if (!fs.existsSync(sqlFile)) {
    throw new Error(`SQL file not found: ${sqlFile}`);
  }
  const sql = fs.readFileSync(sqlFile, "utf8");
  try {
    await execSql(sql);
    console.log("✅ Migrations applied successfully.");
  } catch (err) {
    console.warn("⚠️  Could not apply SQL via API. Trying JS client fallback...");
    throw err;
  }
}

async function seedData() {
  console.log("🌱 Seeding data...");

  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPassword) throw new Error('ADMIN_SEED_PASSWORD environment variable must be set');
  const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);

  // Check if data already exists
  const { data: existingCats } = await supabase.from("categories").select("id");
  if (existingCats && existingCats.length > 0) {
    console.log("ℹ️  Data already exists, skipping seed.");
    return;
  }

  const categories = [
    { category_id: "spore-000001", id: "fresh", name: "Fresh Mushrooms", description: "Handpicked & hygienically packed for best taste" },
    { category_id: "spore-000002", id: "dry", name: "Dry Mushrooms", description: "100% natural & sun-dried for rich nutrition" },
    { category_id: "spore-000003", id: "spawn", name: "Spawn Seeds", description: "High quality spawn for better yield" },
    { category_id: "spore-000004", id: "kits", name: "Mushroom Kits", description: "Ready-to-grow mushroom fruiting kits" },
  ];

  const products = [
    { id: "prod-1", name: "Pink Oyster Spore Syringe (10ml)", description: "High-viability Pleurotus djamor spores. Perfect for growers who want fast colonizing spawn and beautiful pink mushroom clusters.", price: 350, mrp_price: 499, image_url: "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600", category: "spawn", difficulty: "beginner", gst_rate: 5, stock: 120 },
    { id: "prod-2", name: "Lion's Mane Spore Culture (10ml)", description: "Hericium erinaceus liquid culture. High-viability mycelium growth with exceptional yield records.", price: 400, mrp_price: 599, image_url: "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&q=80&w=600", category: "spawn", difficulty: "beginner", gst_rate: 5, stock: 85 },
    { id: "prod-3", name: "Shiitake Grain Spawn (1kg)", description: "Sterilized organic rye grains fully colonized with premium Lentinula edodes mycelium.", price: 450, mrp_price: 649, image_url: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600", category: "spawn", difficulty: "intermediate", gst_rate: 5, stock: 50 },
    { id: "prod-4", name: "Reishi Spore Print", description: "Dark purple spore print of Ganoderma lucidum collected on sterile foil.", price: 300, mrp_price: 449, image_url: "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600", category: "spawn", difficulty: "advanced", gst_rate: 5, stock: 60 },
    { id: "prod-5", name: "Fresh Pink Oyster Mushrooms (500g)", description: "Freshly harvested organic Pink Oyster mushrooms.", price: 500, mrp_price: 699, image_url: "https://images.unsplash.com/photo-1628352081506-83c43123ed6d?auto=format&fit=crop&q=80&w=600", category: "fresh", difficulty: "beginner", gst_rate: 5, stock: 40 },
    { id: "prod-6", name: "Fresh King Oyster Mushrooms (500g)", description: "Thick, meaty stems with a savory, umami flavor.", price: 400, mrp_price: 549, image_url: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600", category: "fresh", difficulty: "beginner", gst_rate: 5, stock: 45 },
    { id: "prod-7", name: "Dried Reishi Mushrooms (100g)", description: "Premium sun-dried Ganoderma lucidum slices.", price: 700, mrp_price: 999, image_url: "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=600", category: "dry", difficulty: "advanced", gst_rate: 5, stock: 100 },
    { id: "prod-8", name: "Dried Cordyceps Militaris (50g)", description: "Premium lab-grown Cordyceps, dehydrated to preserve active cordycepin content.", price: 1800, mrp_price: 2499, image_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600", category: "dry", difficulty: "intermediate", gst_rate: 5, stock: 75 },
    { id: "prod-9", name: "Oyster Mushroom Grow Kit", description: "Easy-to-use organic mushroom fruiting block.", price: 450, mrp_price: 699, image_url: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600", category: "kits", difficulty: "beginner", gst_rate: 5, stock: 65 },
  ];

  const settings = [
    { key: "shipping_charge", value: 50 },
  ];

  const trainings = [
    { id: "train-1", title: "Beginner Mushroom Cultivation", category: "Beginner", description: "A hands-on introduction to mushroom farming for new growers.", image_url: "/images/training_farm.png", content_url: "", allowed_roles: ["trainee", "farmer"] },
    { id: "train-2", title: "Commercial Farming for Entrepreneurs", category: "Entrepreneur", description: "Scaling up production, post-harvest handling and business models.", image_url: "/images/training_business.png", content_url: "", allowed_roles: ["entrepreneur"] },
  ];

  const users = [
    { id: "user-buyer", email: "buyer@sporekart.com", full_name: "John Buyer", whatsapp_number: "9876543211", role: "buyer" },
    { id: "user-grower", email: "grower@sporekart.com", full_name: "Sam Grower", whatsapp_number: "9876543212", role: "grower" },
    { id: "user-admin", email: "admin@sporekart.com", password_hash: adminPasswordHash, full_name: "Sporekart Admin", whatsapp_number: "9876543210", role: "admin" },
  ];

  try {
    console.log("  Categories...");
    const { error: e1 } = await supabase.from("categories").upsert(categories, { onConflict: "id" });
    if (e1) throw e1;

    console.log("  Products...");
    const { error: e2 } = await supabase.from("products").upsert(products, { onConflict: "id" });
    if (e2) throw e2;

    console.log("  Settings...");
    const { error: e3 } = await supabase.from("settings").upsert(settings, { onConflict: "key" });
    if (e3) throw e3;

    console.log("  Trainings...");
    const { error: e4 } = await supabase.from("trainings").upsert(trainings, { onConflict: "id" });
    if (e4) throw e4;

    console.log("  Users...");
    const { error: e5 } = await supabase.from("users").upsert(users, { onConflict: "id" });
    if (e5) throw e5;

    console.log("✅ Seed completed successfully.");
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    throw err;
  }
}

(async () => {
  try {
    console.log("🚀 Supabase Setup\n");
    await runMigrations();
    await seedData();
    console.log("\n🎉 Setup complete! Your Supabase database is ready.");
    console.log(`   Admin login: admin@sporekart.com / ${process.env.ADMIN_SEED_PASSWORD ? '(env var ADMIN_SEED_PASSWORD)' : 'not set'}`);
    console.log("   Buyer login: buyer@sporekart.com (OTP-based)");
    console.log("   Grower login: grower@sporekart.com (OTP-based)\n");
  } catch (err) {
    console.error("\n❌ Setup failed:", err.message);
    console.log("\n▶ To apply manually:\n  1. Go to your Supabase Dashboard → SQL Editor\n  2. Open and run: backend/supabase_setup.sql\n  3. Then run: node backend/scripts/setup-supabase.js\n");
    process.exit(1);
  }
})();
