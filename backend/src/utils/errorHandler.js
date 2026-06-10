const AppError = require('../errors/AppError');

function handleError(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code, details: err.details });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal Server Error' });
}

module.exports = handleError;
