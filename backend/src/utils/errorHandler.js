const AppError = require('../errors/AppError');

function handleError(err, req, res, next) {
  if (res.headersSent) return next(err);

  const payload = {
    error: err.message || 'Internal Server Error',
    code: err.code || 'UNEXPECTED_ERROR',
    details: err.details || null,
    path: req.originalUrl,
    method: req.method,
  };

  if (process.env.NODE_ENV === 'development') {
    payload.stack = err.stack;
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(payload);
  }

  console.error(err);
  return res.status(500).json(payload);
}

module.exports = handleError;
