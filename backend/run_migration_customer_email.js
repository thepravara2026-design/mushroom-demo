require('dotenv').config();
const { Client } = require('pg');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ref = url.match(/https:\/\/(.+)\.supabase\.co/)?.[1];

if (!ref) {
  console.error('Could not parse project ref from SUPABASE_URL');
  process.exit(1);
}

const conn = `postgresql://postgres:${encodeURIComponent(key)}@db.${ref}.supabase.co:5432/postgres`;

(async () => {
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ Connected to Supabase PostgreSQL');

  // Add customer_email column to orders table
  await client.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
  `);
  console.log('✅ customer_email column added to orders table (or already existed)');

  // Refresh PostgREST schema cache so Supabase sees the new column immediately
  try {
    await client.query("NOTIFY pgrst, 'reload schema'");
    console.log('✅ PostgREST schema cache refresh requested');
  } catch (e) {
    console.log('⚠️  Could not notify pgrst:', e.message);
  }

  await client.end();
  console.log('🎉 Migration complete! The customer_email column is now live.');
})().catch(e => {
  console.error('❌ Migration failed:', e.message);
  process.exit(1);
});
