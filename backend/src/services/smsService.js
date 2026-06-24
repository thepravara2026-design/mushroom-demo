const twilio = require('twilio');
const logger = require('../utils/logger');

function formatPhoneToE164(phone) {
  let cleaned = String(phone).replace(/[\s\-\(\)\+]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  if (cleaned.startsWith('91') && cleaned.length === 11) {
    return `+${cleaned}`;
  }
  return `+91${cleaned.slice(-10)}`;
}

async function sendOtpSms(toPhone, otp) {
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_PHONE_NUMBER || '';

  const isPlaceholder =
    sid.startsWith('ACxxxxxxxx') || sid.includes('xxxx') ||
    from.includes('xxxx') || from.includes('xxx') ||
    process.env.FORCE_MOCK === 'true';

  if (isPlaceholder || !sid || !token || !from) {
    logger.info(`[MOCK SMS] To: ${toPhone} — Your OTP is ${otp}`);
    console.log(`\n📱 [MOCK SMS] To: ${toPhone}`);
    console.log(`   OTP: ${otp}`);
    console.log(`   Valid for 10 minutes.\n`);
    return;
  }

  try {
    const client = twilio(sid, token);
    const formattedPhone = formatPhoneToE164(toPhone);

    await client.messages.create({
      body: `Your Sporekart login OTP is ${otp}. It is valid for 10 minutes. Do not share this OTP with anyone.`,
      from,
      to: formattedPhone,
    });

    logger.info(`OTP SMS sent to ${formattedPhone}`);
  } catch (err) {
    logger.error(`Failed to send OTP SMS to ${toPhone}: ${err.message}`, { stack: err.stack });
  }
}

module.exports = { sendOtpSms };
