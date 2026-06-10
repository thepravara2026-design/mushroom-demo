const Joi = require('joi');
const { error: respondError } = require('../lib/response');

function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const message = error.details.map((d) => d.message).join('; ');
      return respondError(res, message, 400);
    }
    req.body = value;
    return next();
  };
}

module.exports = { validateBody, Joi };
