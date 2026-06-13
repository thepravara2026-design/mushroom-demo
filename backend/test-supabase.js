const { createClient } = require('@supabase/supabase-js');
const url = 'https://nqpjzxzrdeucherewatt.supabase.co';
const key = 'sb_publishable_xILd5WQWPK19mu7-9ar-jw_no0MZ6aj';
const supabase = createClient(url, key);

async function test() {
  console.log("Testing 'users' table...");
  const res1 = await supabase.from('users').select('*').limit(1);
  console.log(JSON.stringify(res1));

  console.log("Testing 'user' table...");
  const res2 = await supabase.from('user').select('*').limit(1);
  console.log(JSON.stringify(res2));
}
test();
