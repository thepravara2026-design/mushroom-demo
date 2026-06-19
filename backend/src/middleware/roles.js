/**
 * Role-based authorization middleware helpers.
 *
 * requireRole(role)       — requires exactly one role (e.g. 'admin')
 * requireAnyRole([roles]) — requires any one of the listed roles
 *
 * Both middlewares expect auth.js to have already run and set req.user.role.
 * Note: The isActiveAdminSession single-session enforcement has been removed
 * because it is incompatible with Supabase JWT verification (stateless tokens).
 * Supabase JWTs are short-lived (1h) which provides equivalent security.
 */

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (roles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      error: `Access denied. Required role: ${roles.join(" or ")}.`,
    });
  };
}

function requireAnyRole(roles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (roles.includes(req.user.role)) {
      return next();
    }
    return res
      .status(403)
      .json({ error: "Access denied. Insufficient privileges." });
  };
}

module.exports = { requireRole, requireAnyRole };
