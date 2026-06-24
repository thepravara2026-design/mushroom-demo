const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

async function sendOtpEmail(toEmail, otp) {
  const host = process.env.EMAIL_HOST || '';
  const user = process.env.EMAIL_USER || '';
  const pass = process.env.EMAIL_PASS || '';

  const isPlaceholder =
    host.includes('xxxx') || host.includes('your-') || !host ||
    user.includes('xxxx') || !user ||
    process.env.FORCE_MOCK === 'true';

  if (isPlaceholder) {
    logger.info(`[MOCK EMAIL] To: ${toEmail} — Your OTP is ${otp}`);
    console.log(`\n📧 [MOCK EMAIL] To: ${toEmail}`);
    console.log(`   OTP: ${otp}`);
    console.log(`   Valid for 10 minutes.\n`);
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.EMAIL_PORT, 10) || 465,
      secure: parseInt(process.env.EMAIL_PORT, 10) === 465,
      auth: { user, pass },
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; }
    .container { max-width:520px; margin:40px auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08); }
    .header { background:#2d6a4f; padding:28px 24px; text-align:center; }
    .header h1 { margin:0; color:#ffffff; font-size:24px; letter-spacing:1px; }
    .body { padding:32px 24px; }
    .greeting { font-size:16px; color:#333; margin:0 0 16px; }
    .otp-label { font-size:14px; color:#666; margin:0 0 8px; }
    .otp-value { font-size:42px; font-weight:700; color:#2d6a4f; letter-spacing:8px; text-align:center; margin:16px 0; padding:16px; background:#f0fdf4; border-radius:8px; }
    .expiry { font-size:13px; color:#999; text-align:center; margin:16px 0 0; }
    .footer { padding:20px 24px; text-align:center; border-top:1px solid #eee; }
    .footer p { margin:0; font-size:12px; color:#aaa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Sporekart</h1>
    </div>
    <div class="body">
      <p class="greeting">Hello,</p>
      <p class="otp-label">Your one-time password for Sporekart login is:</p>
      <div class="otp-value">${otp}</div>
      <p class="expiry">This OTP is valid for 10 minutes. Do not share it with anyone.</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} Sporekart. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: toEmail,
      subject: 'Your Sporekart Login OTP',
      html,
    });

    logger.info(`OTP email sent to ${toEmail}`);
  } catch (err) {
    logger.error(`Failed to send OTP email to ${toEmail}: ${err.message}`, { stack: err.stack });
  }
}

module.exports = { sendOtpEmail };
