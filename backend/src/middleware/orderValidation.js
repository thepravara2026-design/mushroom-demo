const Joi = require("joi");

const cancelRequestSchema = Joi.object({
  reason: Joi.string().min(1).max(255).required().messages({
    "string.min": "Cancellation reason is required",
    "string.max": "Cancellation reason must be at most 255 characters",
    "any.required": "Cancellation reason is required",
  }),
});

function validateCancelRequest(req, res, next) {
  const { error } = cancelRequestSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ error: error.details.map((d) => d.message).join(", ") });
  }
  next();
}

const manualRefundInitiateSchema = Joi.object({
  paymentMode: Joi.string()
    .valid("bank_transfer", "upi", "cash", "cheque", "other")
    .required()
    .messages({
      "any.required": "Payment mode is required for manual refund.",
      "any.only": "Payment mode must be one of: bank_transfer, upi, cash, cheque, other",
    }),
  paymentDetails: Joi.string().trim().max(500).optional().allow(""),
  adminNote: Joi.string().trim().max(500).optional().allow(""),
});

const manualRefundCompleteSchema = Joi.object({
  adminNote: Joi.string().trim().max(500).optional().allow(""),
});

function validateManualRefundInitiate(req, res, next) {
  const { error } = manualRefundInitiateSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ error: error.details.map((d) => d.message).join(", ") });
  }
  next();
}

function validateManualRefundComplete(req, res, next) {
  const { error } = manualRefundCompleteSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ error: error.details.map((d) => d.message).join(", ") });
  }
  next();
}

module.exports = { validateCancelRequest, validateManualRefundInitiate, validateManualRefundComplete };
