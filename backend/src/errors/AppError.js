class AppError extends Error {
  constructor(
    message,
    statusCode = 500,
    code = 'APP_ERROR',
    details = null,
    metadata = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.metadata = metadata;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      details: this.details,
      metadata: this.metadata,
    };
  }

  static badRequest(message, details = null) {
    return new AppError(message, 400, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Unauthorized', details = null) {
    return new AppError(message, 401, 'UNAUTHORIZED', details);
  }

  static notFound(message = 'Resource not found', details = null) {
    return new AppError(message, 404, 'NOT_FOUND', details);
  }

  static internal(message = 'Internal server error', details = null) {
    return new AppError(message, 500, 'INTERNAL_ERROR', details);
  }

  static conflict(message = 'Conflict', details = null) {
    return new AppError(message, 409, 'CONFLICT', details);
  }

  static forbidden(message = 'Forbidden', details = null) {
    return new AppError(message, 403, 'FORBIDDEN', details);
  }
}

module.exports = AppError;
