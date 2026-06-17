const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || SUPABASE_URL.includes('your-supabase-url')) {
  module.exports = { supabaseAdmin: null, supabaseAnon: null };
} else {
  if (!SERVICE_ROLE_KEY) {
    console.warn('[Supabase] Missing SUPABASE_SERVICE_ROLE_KEY — backend DB calls will fail.');
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const supabaseAnon = ANON_KEY
    ? createClient(SUPABASE_URL, ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
    : null;

  module.exports = { supabaseAdmin, supabaseAnon };
}
