/**
 * Sets an HTTP-only JWT cookie on the response.
 */
function setAuthCookie(res, token) {
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
  });
}

/**
 * Clears the auth cookie.
 */
function clearAuthCookie(res) {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

module.exports = { setAuthCookie, clearAuthCookie };
