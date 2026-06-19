require('dotenv').config();
const { Client } = require('pg');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ref = url.match(/https:\/\/(.+)\.supabase\.co/)?.[1];

if (!ref) {
  console.error('Could not parse project ref from SUPABASE_URL');
  process.exit(1);
}

const conn = `postgresql://postgres:${encodeURIComponent(key)}@db.${ref}.supabase.co:5432/postgres`;

const createBlogsTable = `
CREATE TABLE IF NOT EXISTS blogs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  author TEXT NOT NULL DEFAULT 'Admin',
  content TEXT NOT NULL,
  featured_image TEXT,
  image_source TEXT DEFAULT 'upload',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'locked')),
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  locked BOOLEAN DEFAULT FALSE
);
`;

(async () => {
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Supabase PostgreSQL');
  await client.query(createBlogsTable);
  console.log('blogs table created (or already exists)');

  // Refresh PostgREST schema cache
  try {
    await client.query("NOTIFY pgrst, 'reload schema'");
    console.log('PostgREST schema cache refresh requested');
  } catch (e) {
    console.log('Could not notify pgrst (may not have permission)');
  }

  await client.end();
  console.log('Done');
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
