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
    .optional()
});

const adminCancelSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .valid(
      "inventory_shortage",
      "out_of_stock",
      "supplier_issues",
      "pricing_errors",
      "fraud_detection",
      "delivery_restrictions",
      "other"
    )
    .required()
    .messages({
      "any.only": "Valid cancellation reason is required."
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

module.exports = {
  cancelRequestSchema,
  adminApproveRejectSchema,
  adminCancelSchema,
  partialRefundSchema
};
