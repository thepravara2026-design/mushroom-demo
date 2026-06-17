/**
 * Migration runner for Supabase.
 * Applies backend/supabase_setup.sql to your Supabase database.
 *
 * Usage:
 *   node scripts/run-migrations.js
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.
 * The script connects via psql (PostgreSQL client) using the connection
 * derived from SUPABASE_URL.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sqlFile = path.resolve(__dirname, '..', 'supabase_setup.sql');

if (!fs.existsSync(sqlFile)) {
  console.error(`❌ SQL file not found: ${sqlFile}`);
  process.exit(1);
}

const url = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || url.includes('your-') || !serviceRoleKey || serviceRoleKey.includes('your-')) {
  console.log('');
  console.log('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env');
  console.log('');
  console.log('   Manual steps:');
  console.log(`   1. Go to your Supabase project → SQL Editor`);
  console.log(`   2. Open and run: ${sqlFile}`);
  console.log('');
  process.exit(1);
}

function buildConnectionString(supabaseUrl, serviceRoleKey) {
  const ref = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
  if (!ref) return null;
  return `postgresql://postgres:${encodeURIComponent(serviceRoleKey)}@db.${ref}.supabase.co:5432/postgres`;
}

const connString = buildConnectionString(url, serviceRoleKey);

if (!connString) {
  console.error('❌ Could not parse connection string from SUPABASE_URL');
  process.exit(1);
}

const sql = fs.readFileSync(sqlFile, 'utf8');

try {
  execSync(`psql "${connString}" -f "${sqlFile}"`, {
    stdio: 'inherit',
    timeout: 30000,
  });
  console.log('✅ Migrations applied successfully');
} catch (err) {
  console.error('');
  console.error('⚠️  Could not run via psql. Apply manually:');
  console.error(`   Go to Supabase Dashboard → SQL Editor → paste contents of ${sqlFile}`);
  console.error('');
  process.exit(1);
}
