const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { JWT_SECRET } = require("../config/jwt");
const logger = require("../utils/logger");

/**
 * Authentication middleware.
 *
 * Dual-mode:
 *  - Mock mode (db.isMock = true): verifies our own JWT (jsonwebtoken) which encodes
 *    { userId, email, role } — used in tests and local dev without Supabase.
 *  - Live Supabase mode: verifies the Supabase JWT via supabaseAdmin.auth.getUser().
 *    Then does a DB lookup to attach the full user profile (role, etc.) to req.user.
 */
module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token = authHeader && authHeader.split(" ")[1];

  // Fallback to HTTP-only cookie if no Authorization header
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  // ── MOCK MODE ────────────────────────────────────────────────────────────────
  if (db.isMock) {
    try {
      const verified = jwt.verify(token, JWT_SECRET);
      const { data: dbUser } = await db
        .from("users")
        .select("*")
        .eq("email", verified.email)
        .single();
      req.user = {
        userId: verified.userId,
        email: verified.email,
        role: verified.role,
        fullName: verified.fullName || (dbUser ? dbUser.full_name : "") || "",
        address: dbUser ? dbUser.default_address || "" : "",
        whatsapp_number: dbUser ? dbUser.whatsapp_number || "" : "",
        default_address: dbUser ? dbUser.default_address || "" : "",
        default_pincode: dbUser ? dbUser.default_pincode || "" : "",
        address_line1: dbUser ? dbUser.address_line1 || "" : "",
        address_line2: dbUser ? dbUser.address_line2 || "" : "",
        landmark: dbUser ? dbUser.landmark || "" : "",
        city: dbUser ? dbUser.city || "" : "",
        state: dbUser ? dbUser.state || "" : "",
      };
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid authentication token." });
    }
  }

  // ── SUPABASE LIVE MODE ───────────────────────────────────────────────────────
  try {
    const { supabaseAdmin } = require("../config/supabase");

    // First try: verify as a Supabase JWT
    const {
      data: { user: supaUser },
      error: supaError,
    } = await supabaseAdmin.auth.getUser(token);

    if (supaUser && !supaError) {
      // Look up the full user profile from our custom users table
      // This gives us: role, full_name, whatsapp_number, etc.
      const { data: dbUser } = await db
        .from("users")
        .select("*")
        .eq("email", supaUser.email)
        .single();

      req.user = {
        userId: supaUser.id,
        email: supaUser.email,
        role: supaUser.app_metadata?.role || (dbUser ? dbUser.role : "buyer"),
        fullName: dbUser
          ? dbUser.full_name
          : supaUser.user_metadata?.name || "",
        whatsapp_number: dbUser ? dbUser.whatsapp_number : "",
        // Expose the raw Supabase user for any code that needs it
        supaUser,
      };
      return next();
    }

    // Fallback: verify as our own JWT (handles tokens issued by OTP/admin-login flow)
    try {
      const verified = jwt.verify(token, JWT_SECRET);
      req.user = verified;
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token." });
    }
  } catch (err) {
    logger.error("[auth middleware] Unexpected error:", err.message);
    return res.status(401).json({ error: "Authentication failed." });
  }
};
