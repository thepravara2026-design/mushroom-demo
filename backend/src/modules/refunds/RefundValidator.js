const Joi = require("joi");

const cancelRequestSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .min(5)
    .max(255)
    .required()
    .messages({
      "string.empty": "Cancellation reason is required.",
      "string.min": "Cancellation reason must be at least 5 characters.",
      "string.max": "Cancellation reason cannot exceed 255 characters."
    })
});

const adminApproveRejectSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .max(500)
    .optional(),
  adminNote: Joi.string()
    .trim()
    .max(500)
    .optional(),
  refundType: Joi.string()
    .valid("auto", "manual")
    .optional()
    .default("auto")
});

const adminCancelSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .min(1)
    .max(255)
    .required()
    .messages({
      "string.empty": "Cancellation reason is required.",
      "any.required": "Cancellation reason is required."
    }),
  adminNote: Joi.string()
    .trim()
    .max(500)
    .optional(),
  refundAmount: Joi.number()
    .precision(2)
    .positive()
    .optional() // If empty, defaults to full order amount
});

const partialRefundSchema = Joi.object({
  refundAmount: Joi.number()
    .precision(2)
    .positive()
    .required()
    .messages({
      "number.base": "Refund amount must be a number.",
      "number.positive": "Refund amount must be a positive number.",
      "any.required": "Refund amount is required."
    }),
  reason: Joi.string()
    .trim()
    .min(5)
    .max(255)
    .required()
    .messages({
      "string.empty": "Refund reason is required.",
      "string.min": "Refund reason must be at least 5 characters."
    }),
  adminNote: Joi.string()
    .trim()
    .max(500)
    .optional()
});

const manualRefundSchema = Joi.object({
  paymentMode: Joi.string()
    .valid("bank_transfer", "upi", "cash", "cheque", "other")
    .required()
    .messages({
      "any.required": "Payment mode is required for manual refund.",
      "any.only": "Payment mode must be one of: bank_transfer, upi, cash, cheque, other"
    }),
  paymentDetails: Joi.string()
    .trim()
    .max(500)
    .optional()
    .allow(""),
  adminNote: Joi.string()
    .trim()
    .max(500)
    .optional()
    .allow("")
});

const refundProgressSchema = Joi.object({
  step: Joi.string()
    .valid("initiated", "processing", "completed")
    .required()
    .messages({
      "any.only": "Step must be one of: initiated, processing, completed",
      "any.required": "Refund step is required"
    }),
  adminNote: Joi.string()
    .trim()
    .max(500)
    .optional()
    .allow("")
});

module.exports = {
  cancelRequestSchema,
  adminApproveRejectSchema,
  adminCancelSchema,
  partialRefundSchema,
  manualRefundSchema,
  refundProgressSchema
};
