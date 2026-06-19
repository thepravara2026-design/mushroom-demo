function success(res, data = {}, meta = {}, status = 200) {
  return res.status(status).json({ success: true, data, meta });
}

function error(
  res,
  message = "Internal Server Error",
  status = 500,
  code = "SERVER_ERROR",
) {
  return res.status(status).json({ success: false, error: message, code });
}

module.exports = { success, error };
