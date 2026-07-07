const Joi = require("joi");

const phoneRegex = /^\+?[1-9]\d{9,14}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sendSmsSchema = Joi.object({
  recipient: Joi.string().pattern(phoneRegex).required().messages({
    "string.pattern.base": "Invalid phone number format",
    "any.required": "Recipient phone number is required",
  }),
  message: Joi.string().min(1).max(1600).optional(),
  template: Joi.string().optional(),
  templateVars: Joi.object().optional(),
}).min(1);

const sendOtpSchema = Joi.object({
  recipient: Joi.alternatives()
    .try(
      Joi.string().pattern(phoneRegex),
      Joi.string().pattern(emailRegex)
    )
    .required()
    .messages({
      "any.required": "Recipient (phone or email) is required",
    }),
  channel: Joi.string().valid("sms", "email", "whatsapp").default("sms"),
});

const verifyOtpSchema = Joi.object({
  recipient: Joi.alternatives()
    .try(
      Joi.string().pattern(phoneRegex),
      Joi.string().pattern(emailRegex)
    )
    .required()
    .messages({
      "any.required": "Recipient (phone or email) is required",
    }),
  otp: Joi.string().length(6).pattern(/^\d{6}$/).required().messages({
    "string.length": "OTP must be exactly 6 digits",
    "string.pattern.base": "OTP must be numeric",
    "any.required": "OTP is required",
  }),
});

const sendWhatsAppSchema = Joi.object({
  recipient: Joi.string().pattern(phoneRegex).required().messages({
    "string.pattern.base": "Invalid phone number format",
    "any.required": "Recipient phone number is required",
  }),
  message: Joi.string().min(1).max(4096).optional(),
  template: Joi.string().optional(),
  templateVars: Joi.object().optional(),
});

const sendEmailSchema = Joi.object({
  recipient: Joi.string().pattern(emailRegex).required().messages({
    "string.pattern.base": "Invalid email format",
    "any.required": "Recipient email is required",
  }),
  subject: Joi.string().min(1).max(998).optional(),
  body: Joi.string().optional(),
  html: Joi.string().optional(),
  template: Joi.string().optional(),
  templateVars: Joi.object().optional(),
});

const retrySchema = Joi.object({
  jobId: Joi.string().required().messages({
    "any.required": "Job ID is required",
  }),
});

const logsQuerySchema = Joi.object({
  channel: Joi.string().valid("sms", "whatsapp", "email", "otp").optional(),
  status: Joi.string().valid("queued", "sent", "delivered", "failed").optional(),
  type: Joi.string().optional(),
  search: Joi.string().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = {
  sendSmsSchema,
  sendOtpSchema,
  verifyOtpSchema,
  sendWhatsAppSchema,
  sendEmailSchema,
  retrySchema,
  logsQuerySchema,
};
