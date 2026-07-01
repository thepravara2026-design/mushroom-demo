const db = require("../config/db");

/**
 * Middleware: selects the right DB client for the request and attaches it to req.db.
 *
 * - Admins → service_role client (bypasses RLS — full access for admin operations)
 * - Authenticated users → anon-key + user JWT client (RLS-enforced — user sees only own data)
 * - Public/unauthenticated → anon-key client (RLS-enforced — public data only)
 * - Mock mode → always uses the in-memory mock store (no RLS)
 *
 * Route handlers should use req.db instead of the imported `db` for user-facing queries.
 * Admin-only routes that need to bypass RLS should use the imported `db`.
 *
 * Usage: router.get("/orders", authMiddleware, selectDb, handler)
 */
function selectDb(req, res, next) {
  if (db.isMock) {
    req.db = db;
    return next();
  }

  if (req.authDb) {
    // Auth middleware already created an authenticated client (anon key + user JWT)
    req.db = req.authDb;
  } else {
    // No authenticated client — use the shared anon client (public data only)
    const { dbAnon } = require("../config/db");
    req.db = dbAnon || db;
  }

  return next();
}

module.exports = selectDb;
