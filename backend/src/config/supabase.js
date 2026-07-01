const { createClient } = require("@supabase/supabase-js");
const logger = require("../utils/logger");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

let supabaseAdmin = null;
let supabaseAnon = null;

if (!SUPABASE_URL || SUPABASE_URL.includes("your-supabase-url")) {
  module.exports = { supabaseAdmin: null, supabaseAnon: null, createUserClient: () => null };
} else {
  if (!SERVICE_ROLE_KEY) {
    logger.warn(
      "[Supabase] Missing SUPABASE_SERVICE_ROLE_KEY — backend DB calls will fail.",
    );
  }

  supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  supabaseAnon = ANON_KEY
    ? createClient(SUPABASE_URL, ANON_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

  module.exports = { supabaseAdmin, supabaseAnon };
}

/**
 * Create a Supabase client using the ANON key + user's JWT.
 * This client triggers Row-Level Security because PostgreSQL
 * sees the user's JWT and can evaluate auth.uid() / auth.jwt().
 *
 * Use this for user-facing queries that should be RLS-restricted.
 * Use supabaseAdmin (service_role) for admin operations.
 */
function createUserClient(jwt) {
  if (!SUPABASE_URL || SUPABASE_URL.includes("your-supabase-url") || !ANON_KEY || !jwt) {
    return null;
  }
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

module.exports.createUserClient = createUserClient;
