const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Client } = require("pg");

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ref = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
  if (!ref || !serviceKey) {
    console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const pgClient = new Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: serviceKey,
    ssl: { rejectUnauthorized: false },
  });

  await pgClient.connect();

  const sqls = [
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_supplier TEXT DEFAULT 'Shriyap Enterprises, Basavura Village Davangere'`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS scientific_name TEXT`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_life TEXT`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_title TEXT`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_slug TEXT`,
  ];

  for (const sql of sqls) {
    await pgClient.query(sql).catch((e) => console.log("WARN:", e.message));
    console.log("OK:", sql.substring(0, 65));
  }

  await pgClient.query("NOTIFY pgrst, 'reload schema'").catch(() => {});
  await pgClient.end();
  console.log("\nMigration complete. Now inserting product...");

  // Now use Supabase client to insert the product
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceKey);

  const product = {
    id: "prod-10",
    name: "Fresh Shiitake Mushrooms",
    description:
      "Premium organic fresh Shiitake mushrooms (Lentinula edodes). Harvested at peak ripeness. Cold-chain packed and delivered within 24 hours.",
    price: 180.0,
    mrp_price: 249.0,
    image_url:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600",
    image_urls: [
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600",
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600",
    ],
    category: "fresh",
    difficulty: "beginner",
    gst_rate: 5,
    stock: 59,
    weight_pricing: [
      { weight: 100, unit: "g", price: 180, mrp_price: 249, stock: 2 },
      { weight: 200, unit: "g", price: 320, mrp_price: 449, stock: 7 },
      { weight: 500, unit: "g", price: 720, mrp_price: 999, stock: 50 },
    ],
    storage_handling: "Refrigerate immediately at 2-4C. Consume within 5-7 days.",
    warranty_policy: "100% freshness guarantee - replacement if spoilage reported within 24 hours.",
    return_policy: "Perishable goods non-returnable. Quality replacements within 24 hrs.",
    shipping_info: "Free shipping above Rs499. Dispatched in insulated cold-boxes.",
    compliance_info: "FSSAI licensed. Grown under GAP. Pesticide-free.",
    highlights: [
      "Hand-picked at peak freshness",
      "Cold-chain maintained throughout transit",
      "Rich in vitamin D and B-vitamins",
      "Premium Japanese Kuroko variety",
    ],
    certificates: [
      { icon: "fa-solid fa-certificate", label: "FSSAI Certified" },
      { icon: "fa-solid fa-leaf", label: "Organic Produce" },
    ],
    manufacturer_supplier: "Shriyap Enterprises, Basavura Village Davangere",
    scientific_name: "Lentinula edodes",
    shelf_life: "5-7 days under refrigeration",
    seo_title: "Buy Fresh Shiitake Mushrooms Online | Premium Grade | Spore Kings",
    seo_slug: "fresh-shiitake-mushrooms",
  };

  const { data, error } = await supabase
    .from("products")
    .upsert(product, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    console.error("INSERT ERROR:", error.message);
    process.exit(1);
  }

  console.log(`\n✅ Product added: ${data.id} - ${data.name}`);
  console.log(
    "   Variants:",
    data.weight_pricing.map((v) => `${v.weight}${v.unit}(stock:${v.stock})`).join(", ")
  );
  console.log("   Scientific name:", data.scientific_name);
  console.log("   Shelf life:", data.shelf_life);
  console.log("   Manufacturer:", data.manufacturer_supplier);
  console.log("   SEO title:", data.seo_title);
  console.log("   SEO slug:", data.seo_slug);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
