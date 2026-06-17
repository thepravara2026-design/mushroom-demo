const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';

if (!url || !key || url.includes('your-')) {
  console.error('❌ Set SUPABASE_URL and SUPABASE_ANON_KEY env vars (copy from backend/.env)');
  process.exit(1);
}

const supabase = createClient(url, key);

async function test() {
  console.log("Testing 'users' table...");
  const { data, error } = await supabase.from('users').select('*').limit(1);
  if (error) console.error('users error:', error);
  else console.log('users data:', JSON.stringify(data));

  console.log("Testing 'user' table...");
  const res2 = await supabase.from('user').select('*').limit(1);
  console.log(JSON.stringify(res2));
}
test();
