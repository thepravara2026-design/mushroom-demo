// Role-based authorization middleware helpers

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.user.role === role) return next();
    return res
      .status(403)
      .json({ error: 'Access denied. Insufficient privileges.' });
  };
}

function requireAnyRole(roles = []) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (roles.includes(req.user.role)) return next();
    return res
      .status(403)
      .json({ error: 'Access denied. Insufficient privileges.' });
  };
}

module.exports = { requireRole, requireAnyRole };
