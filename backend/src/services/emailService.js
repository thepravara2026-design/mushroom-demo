const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.EMAIL_HOST || '';
  const user = process.env.EMAIL_USER || '';
  const pass = process.env.EMAIL_PASS || '';

  if (!host || host.includes('xxxx') || host.includes('your-') || process.env.FORCE_MOCK === 'true') {
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.EMAIL_PORT, 10) || 465,
    secure: parseInt(process.env.EMAIL_PORT, 10) === 465,
    auth: { user, pass },
  });
  return _transporter;
}

async function sendEmail({ to, subject, body, html }) {
  if (!to) return { success: false, error: 'No recipient' };

  const transporter = getTransporter();

  if (!transporter || process.env.FORCE_MOCK === 'true') {
    logger.info(`[EMAIL:MOCK] To: ${(to || '').replace(/(?<=.{3}).(?=.*@)/g, '*')} | Subject: ${subject}`);
    return { success: true, mock: true };
  }

  try {
    const mailOpts = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
    };
    if (html) mailOpts.html = html;
    else mailOpts.text = body;

    await transporter.sendMail(mailOpts);
    logger.info(`[EmailService] Sent to ${to}: ${subject}`);
    return { success: true };
  } catch (err) {
    logger.error(`[EmailService] Failed to ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function sendOtpEmail(toEmail, otp) {
  const host = process.env.EMAIL_HOST || '';
  const isPlaceholder = host.includes('xxxx') || host.includes('your-') || !host || process.env.FORCE_MOCK === 'true';

  if (isPlaceholder) {
    const maskedOtp = otp[0] + "***" + otp[otp.length - 1];
    logger.info(`[MOCK EMAIL] To: ${(toEmail || '').replace(/(?<=.{3}).(?=.*@)/g, '*')} — Your OTP is ${maskedOtp}`);
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.EMAIL_PORT, 10) || 465,
      secure: parseInt(process.env.EMAIL_PORT, 10) === 465,
      auth: { user: process.env.EMAIL_USER || '', pass: process.env.EMAIL_PASS || '' },
    });

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  body { margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; }
  .container { max-width:520px; margin:40px auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08); }
  .header { background:#2d6a4f; padding:28px 24px; text-align:center; }
  .header h1 { margin:0; color:#ffffff; font-size:24px; letter-spacing:1px; }
  .body { padding:32px 24px; }
  .otp-label { font-size:14px; color:#666; margin:0 0 8px; }
  .otp-value { font-size:42px; font-weight:700; color:#2d6a4f; letter-spacing:8px; text-align:center; margin:16px 0; padding:16px; background:#f0fdf4; border-radius:8px; }
  .expiry { font-size:13px; color:#999; text-align:center; margin:16px 0 0; }
  .footer { padding:20px 24px; text-align:center; border-top:1px solid #eee; }
  .footer p { margin:0; font-size:12px; color:#aaa; }
</style></head>
<body>
  <div class="container">
    <div class="header"><h1>Sporekart</h1></div>
    <div class="body">
      <p>Hello,</p>
      <p class="otp-label">Your one-time password for Sporekart login is:</p>
      <div class="otp-value">${otp}</div>
      <p class="expiry">This OTP is valid for 10 minutes. Do not share it with anyone.</p>
    </div>
    <div class="footer"><p>&copy; ${new Date().getFullYear()} Sporekart</p></div>
  </div>
</body>
</html>`;

    await transporter.sendMail({ from: process.env.EMAIL_FROM, to: toEmail, subject: 'Your Sporekart OTP', html });
    logger.info(`OTP email sent to ${toEmail}`);
  } catch (err) {
    logger.error(`Failed to send OTP email: ${err.message}`);
  }
}

async function sendTransactional(to, subject, html) {
  return sendEmail({ to, subject, html });
}

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendTransactional,
  getTransporter,
};
