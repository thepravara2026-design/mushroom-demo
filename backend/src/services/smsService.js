const logger = require('../utils/logger');

function formatPhoneToE164(phone) {
  let cleaned = String(phone).replace(/[\s\-\(\)\+]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length === 10) return `+91${cleaned}`;
  if (cleaned.startsWith('91') && cleaned.length === 11) return `+${cleaned}`;
  return `+91${cleaned.slice(-10)}`;
}

async function sendSms({ to, message }) {
  if (!to) return { success: false, error: 'No recipient' };

  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_PHONE_NUMBER || '';

  const isPlaceholder = sid.startsWith('ACxxxxxxxx') || sid.includes('xxxx') || from.includes('xxxx') || !sid || !token || !from;

  if (isPlaceholder || process.env.FORCE_MOCK === 'true') {
    logger.info(`[SMS:MOCK] To: ${to.slice(0, 2)}****${to.slice(-2)} | Message length: ${message.length} chars`);
    return { success: true, mock: true };
  }

  try {
    const twilio = require('twilio');
    const client = twilio(sid, token);
    const formatted = formatPhoneToE164(to);
    await client.messages.create({ body: message, from, to: formatted });
    logger.info(`[SmsService] Sent to ${formatted}`);
    return { success: true };
  } catch (err) {
    logger.error(`[SmsService] Failed to ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function sendOtpSms(toPhone, otp) {
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_PHONE_NUMBER || '';
  const isPlaceholder = sid.startsWith('ACxxxxxxxx') || sid.includes('xxxx') || from.includes('xxxx') || process.env.FORCE_MOCK === 'true';

  if (isPlaceholder || !sid || !token || !from) {
    const maskedOtp = otp[0] + "***" + otp[otp.length - 1];
    logger.info(`[MOCK SMS] To: ${toPhone.slice(0, 2)}****${toPhone.slice(-2)} — Your OTP is ${maskedOtp}`);
    return;
  }

  try {
    const twilio = require('twilio');
    const client = twilio(sid, token);
    const formatted = formatPhoneToE164(toPhone);
    await client.messages.create({ body: `Your Sporekart login OTP is ${otp}. Valid for 10 minutes.`, from, to: formatted });
    logger.info(`OTP SMS sent to ${formatted}`);
  } catch (err) {
    logger.error(`Failed to send OTP SMS: ${err.message}`);
  }
}

module.exports = {
  sendSms,
  sendOtpSms,
};
