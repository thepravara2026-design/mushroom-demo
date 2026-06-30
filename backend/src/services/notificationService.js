const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const { sendSseEvent } = require('../lib/sse');
const { logAuditAction, AUDIT_ACTIONS } = require('./AuditLogService');
const FEATURE_FLAGS = require('../config/featureFlags');
const engine = require('./notificationEngine');

// ── Channel Map: which channels each event uses ──
const EVENT_CHANNELS = {
  ORDER_PENDING_APPROVAL:  { email: true, sms: true,  whatsapp: false, in_app: true },
  ORDER_APPROVED:          { email: true, sms: true,  whatsapp: true,  in_app: true },
  ORDER_REJECTED:          { email: true, sms: true,  whatsapp: false, in_app: true },
  ORDER_PROCESSING:        { email: true, sms: true,  whatsapp: false, in_app: true },
  ORDER_SHIPPED:           { email: true, sms: true,  whatsapp: true,  in_app: true },
  ORDER_DELIVERED:         { email: true, sms: true,  whatsapp: true,  in_app: true },
  CANCEL_REQUESTED:        { email: true, sms: true,  whatsapp: false, in_app: true },
  CANCEL_APPROVED:         { email: true, sms: true,  whatsapp: false, in_app: true },
  CANCEL_REJECTED:         { email: true, sms: true,  whatsapp: false, in_app: true },
  SELF_CANCELLED:          { email: true, sms: true,  whatsapp: true,  in_app: true },
  ADMIN_REJECTED:          { email: true, sms: true,  whatsapp: true,  in_app: true },
  RETURN_WINDOW:           { email: true, sms: true,  whatsapp: true,  in_app: true },
  RETURN_APPROVED:         { email: true, sms: true,  whatsapp: true,  in_app: true },
  RETURN_REJECTED:         { email: true, sms: true,  whatsapp: false, in_app: true },
  RETURN_PICKUP_SCHEDULED: { email: true, sms: true,  whatsapp: true,  in_app: true },
  REFUND_INITIATED:        { email: true, sms: true,  whatsapp: true,  in_app: true },
  REFUND_FAILED:           { email: true, sms: true,  whatsapp: false, in_app: true },
  REFUND_COMPLETED:        { email: true, sms: true,  whatsapp: true,  in_app: true },
  MANUAL_REFUND_INITIATED: { email: true, sms: false, whatsapp: false, in_app: true },
  MANUAL_REFUND_COMPLETED: { email: true, sms: true,  whatsapp: true,  in_app: true },
};

// ── Subject Lines ──
const EMAIL_SUBJECTS = {
  ORDER_PENDING_APPROVAL:  'Order Pending Approval — Sporekart',
  ORDER_APPROVED:          'Order Approved! — Sporekart',
  ORDER_REJECTED:          'Order Update — Sporekart',
  ORDER_PROCESSING:        'Order is Being Processed — Sporekart',
  ORDER_SHIPPED:           'Your Order Has Been Shipped! — Sporekart',
  ORDER_DELIVERED:         'Order Delivered — Sporekart',
  CANCEL_REQUESTED:        'Cancellation Request Received — Sporekart',
  CANCEL_APPROVED:         'Cancellation Approved — Sporekart',
  CANCEL_REJECTED:         'Cancellation Update — Sporekart',
  SELF_CANCELLED:          'Self Cancellation Confirmed — Sporekart',
  ADMIN_REJECTED:          'Order Rejected — Sporekart',
  RETURN_WINDOW:           'Return Window Open — Sporekart',
  RETURN_APPROVED:         'Return Request Approved — Sporekart',
  RETURN_REJECTED:         'Return Request Update — Sporekart',
  RETURN_PICKUP_SCHEDULED: 'Return Pickup Scheduled — Sporekart',
  REFUND_INITIATED:        'Refund Initiated — Sporekart',
  REFUND_FAILED:           'Refund Update — Sporekart',
  REFUND_COMPLETED:        'Refund Completed — Sporekart',
  MANUAL_REFUND_INITIATED: 'Manual Refund Initiated — Sporekart',
  MANUAL_REFUND_COMPLETED: 'Manual Refund Completed — Sporekart',
};

// ── Transport (lazy singleton) ──
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.EMAIL_HOST || '';
  if (!host || host.includes('xxxx') || host.includes('your-') || process.env.FORCE_MOCK === 'true') {
    return null;
  }
  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.EMAIL_PORT, 10) || 465,
    secure: parseInt(process.env.EMAIL_PORT, 10) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  return _transporter;
}

// ── Email Template Builder ──
function buildEmailHtml(eventType, order, metadata) {
  const orderId = order.id || order.order_id || '';
  const date = order.created_at ? new Date(order.created_at).toLocaleDateString('en-IN') : '';
  const total = order.total || order.amount || 0;
  const subject = EMAIL_SUBJECTS[eventType] || 'Order Update — Sporekart';

  const statusMessages = {
    ORDER_PENDING_APPROVAL:  'Your order is awaiting admin approval. We will notify you once it is confirmed.',
    ORDER_APPROVED:          'Your order has been approved and is now being processed!',
    ORDER_REJECTED:          `Your order could not be approved. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Please contact support for more details.'}`,
    ORDER_PROCESSING:        'Your order is now being prepared. We will update you when it ships.',
    ORDER_SHIPPED:           `Your order has been shipped! ${metadata.eta ? `Expected delivery: ${metadata.eta}` : 'Track your order for real-time updates.'}`,
    ORDER_DELIVERED:         'Your order has been delivered. Thank you for shopping with Sporekart!',
    CANCEL_REQUESTED:        'Your cancellation request has been received and is pending admin approval.',
    CANCEL_APPROVED:         'Your cancellation has been approved. Refund will be initiated shortly.',
    CANCEL_REJECTED:         `Your cancellation request was not approved. ${metadata.reason ? `Reason: ${metadata.reason}` : ''}`,
    SELF_CANCELLED:          'Your order has been self-cancelled successfully. Refund will be processed shortly.',
    ADMIN_REJECTED:          `Your order could not be approved. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Please contact support for more details.'}`,
    RETURN_WINDOW:           'Your order has been delivered! You have 7 days to request a return if needed.',
    RETURN_APPROVED:         'Your return request has been approved. We will schedule a pickup shortly.',
    RETURN_REJECTED:         `Your return request was not approved. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Please contact support for details.'}`,
    RETURN_PICKUP_SCHEDULED: 'Your return pickup has been scheduled. Our courier partner will collect the item from your address.',
    REFUND_INITIATED:        'Your refund has been initiated. It may take 3-7 business days to reflect in your account.',
    REFUND_FAILED:           'Your refund encountered an issue. Our team is looking into it and will contact you shortly.',
    REFUND_COMPLETED:        `Your refund of ₹${Number(total).toFixed(2)} has been completed.`,
    MANUAL_REFUND_INITIATED: 'A manual refund has been initiated for your order. We will notify you once it is completed.',
    MANUAL_REFUND_COMPLETED: `Your manual refund of ₹${Number(total).toFixed(2)} has been completed.`,
  };

  const message = statusMessages[eventType] || 'Your order has been updated.';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; }
    .container { max-width:520px; margin:40px auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08); }
    .header { background:#2d6a4f; padding:28px 24px; text-align:center; }
    .header h1 { margin:0; color:#ffffff; font-size:24px; }
    .body { padding:32px 24px; }
    .order-ref { font-size:14px; color:#666; margin:0 0 16px; }
    .message { font-size:15px; color:#333; line-height:1.6; margin:0 0 24px; }
    .details { background:#f9fafb; border-radius:8px; padding:16px; margin:0 0 24px; }
    .details dt { font-size:12px; color:#888; text-transform:uppercase; margin-top:8px; }
    .details dd { font-size:14px; color:#333; margin:0 0 8px; }
    .footer { padding:20px 24px; text-align:center; border-top:1px solid #eee; }
    .footer p { margin:0; font-size:12px; color:#aaa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>Sporekart</h1></div>
    <div class="body">
      <p class="order-ref">Order #${orderId} &middot; ${date}</p>
      <p class="message">${message}</p>
      <dl class="details">
        <dt>Order Total</dt>
        <dd>₹${Number(total).toFixed(2)}</dd>
        <dt>Status</dt>
        <dd>${eventType.replace(/_/g, ' ')}</dd>
        ${metadata.eta ? `<dt>Expected Delivery</dt><dd>${metadata.eta}</dd>` : ''}
        ${metadata.reason ? `<dt>Reason</dt><dd>${metadata.reason}</dd>` : ''}
        ${metadata.refundId ? `<dt>Refund ID</dt><dd>${metadata.refundId}</dd>` : ''}
      </dl>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} Sporekart. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

// ── SMS Message Builder ──
function buildSmsMessage(eventType, order, metadata) {
  const orderId = order.id || order.order_id || '';
  const total = order.total || order.amount || 0;

  const messages = {
    ORDER_PENDING_APPROVAL:  `Order #${orderId} of ₹${Number(total).toFixed(2)} is awaiting approval. We'll notify you once confirmed. — Sporekart`,
    ORDER_APPROVED:          `Order #${orderId} has been approved! We're processing it now. — Sporekart`,
    ORDER_REJECTED:          `Order #${orderId} could not be approved. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Contact support.'} — Sporekart`,
    ORDER_PROCESSING:        `Order #${orderId} is being processed. We'll update you when it ships. — Sporekart`,
    ORDER_SHIPPED:           `Order #${orderId} has been shipped! ${metadata.eta ? `ETA: ${metadata.eta}` : 'Track online.'} — Sporekart`,
    ORDER_DELIVERED:         `Order #${orderId} has been delivered! Thank you for shopping with Sporekart. 🍄`,
    CANCEL_REQUESTED:        `Cancellation request for Order #${orderId} has been received. Awaiting admin approval. — Sporekart`,
    CANCEL_APPROVED:         `Cancellation for Order #${orderId} approved. Refund will be initiated shortly. — Sporekart`,
    CANCEL_REJECTED:         `Cancellation for Order #${orderId} was not approved. ${metadata.reason || ''} — Sporekart`,
    SELF_CANCELLED:          `Order #${orderId} has been self-cancelled. Refund will be processed shortly. — Sporekart`,
    ADMIN_REJECTED:          `Order #${orderId} could not be approved. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Contact support.'} — Sporekart`,
    RETURN_WINDOW:           `Order #${orderId} delivered! Return window is open for 7 days. — Sporekart`,
    RETURN_APPROVED:         `Return for Order #${orderId} has been approved. Pickup will be scheduled shortly. — Sporekart`,
    RETURN_REJECTED:         `Return for Order #${orderId} was not approved. ${metadata.reason || ''} — Sporekart`,
    RETURN_PICKUP_SCHEDULED: `Return pickup for Order #${orderId} has been scheduled. Courier will contact you. — Sporekart`,
    REFUND_INITIATED:        `Refund for Order #${orderId} has been initiated. 3-7 business days to reflect. — Sporekart`,
    REFUND_FAILED:           `Refund for Order #${orderId} encountered an issue. We'll contact you shortly. — Sporekart`,
    REFUND_COMPLETED:        `Refund of ₹${Number(total).toFixed(2)} for Order #${orderId} has been completed! — Sporekart`,
    MANUAL_REFUND_COMPLETED: `Manual refund of ₹${Number(total).toFixed(2)} for Order #${orderId} has been completed! — Sporekart`,
  };

  return messages[eventType] || `Order #${orderId} has been updated. Check Sporekart for details.`;
}

// ── WhatsApp Message Builder ──
function buildWhatsAppMessage(eventType, order, metadata) {
  const orderId = order.id || order.order_id || '';
  const shortId = String(orderId).slice(-6);
  const total = order.total || order.amount || 0;
  const amountStr = `₹${Number(total).toFixed(2)}`;

  const messages = {
    ORDER_APPROVED:    `✅ *Order Approved!*\n\nOrder #${shortId} of ${amountStr} has been approved and is being processed.`,
    ORDER_SHIPPED:     `🚚 *Order Shipped!*\n\nOrder #${shortId} is on its way! ${metadata.eta ? `Expected delivery: ${metadata.eta}` : ''}`,
    ORDER_DELIVERED:   `🎉 *Order Delivered!*\n\nOrder #${shortId} has been delivered. Thank you for choosing Sporekart! 🍄`,
    SELF_CANCELLED:    `✅ *Self Cancellation Confirmed*\n\nOrder #${shortId} has been self-cancelled. Refund of ${amountStr} will be processed shortly.`,
    ADMIN_REJECTED:    `❌ *Order Rejected*\n\nOrder #${shortId} could not be approved. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Contact support.'}`,
    RETURN_WINDOW:     `📦 *Return Window Open*\n\nOrder #${shortId} delivered! You have 7 days to request a return. Log in to your account to start a return.`,
    RETURN_APPROVED:   `✅ *Return Approved*\n\nYour return for Order #${shortId} has been approved. We will schedule a pickup shortly.`,
    RETURN_REJECTED:   `❌ *Return Rejected*\n\nYour return for Order #${shortId} was not approved. ${metadata.reason ? `Reason: ${metadata.reason}` : 'Contact support for details.'}`,
    RETURN_PICKUP_SCHEDULED: `📬 *Pickup Scheduled*\n\nReturn pickup for Order #${shortId} has been scheduled. Our courier will collect the item from your address.`,
    REFUND_INITIATED:  `🔄 *Refund Initiated*\n\nRefund of ${amountStr} for Order #${shortId} has been initiated. 3-7 business days to reflect.`,
    REFUND_COMPLETED:  `💰 *Refund Completed*\n\nRefund of ${amountStr} for Order #${shortId} has been completed!`,
    MANUAL_REFUND_COMPLETED: `💰 *Manual Refund Completed*\n\nManual refund of ${amountStr} for Order #${shortId} has been completed!`,
  };

  return messages[eventType] || `Order #${shortId} updated. Check Sporekart app for details.`;
}

// ── Email Sender ──
async function sendEmail(toEmail, eventType, order, metadata) {
  if (!toEmail) return { success: false, error: 'No email address' };
  try {
    const transporter = getTransporter();
    const html = buildEmailHtml(eventType, order, metadata);
    const subject = EMAIL_SUBJECTS[eventType] || 'Order Update — Sporekart';

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: toEmail,
      subject,
      html,
    });

    logger.info(`[NotificationService] Email sent to ${toEmail} for ${eventType}`);
    return { success: true };
  } catch (err) {
    logger.error(`[NotificationService] Email failed to ${toEmail}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── SMS Sender ──
async function sendSms(toPhone, eventType, order, metadata) {
  if (!toPhone) return { success: false, error: 'No phone number' };
  try {
    const message = buildSmsMessage(eventType, order, metadata);

    const sid = process.env.TWILIO_ACCOUNT_SID || '';
    const token = process.env.TWILIO_AUTH_TOKEN || '';
    const from = process.env.TWILIO_PHONE_NUMBER || '';

    const isPlaceholder =
      sid.startsWith('ACxxxxxxxx') || sid.includes('xxxx') ||
      from.includes('xxxx') || from.includes('xxx');

    if (isPlaceholder || !sid || !token || !from) {
      logger.info(`[MOCK SMS] To: ${toPhone} — ${message}`);
      console.log(`\n📱 [MOCK SMS] To: ${toPhone}`);
      console.log(`   Message: ${message}\n`);
      return { success: true, mock: true };
    }

    const twilio = require('twilio');
    const client = twilio(sid, token);
    await client.messages.create({ body: message, from, to: toPhone });

    logger.info(`[NotificationService] SMS sent to ${toPhone} for ${eventType}`);
    return { success: true };
  } catch (err) {
    logger.error(`[NotificationService] SMS failed to ${toPhone}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── WhatsApp Sender ──
const WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER || 'callmebot';
const CALLMEBOT_API_KEY = process.env.CALLMEBOT_API_KEY || '';
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || '';
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || '';

function formatPhone(phone) {
  return String(phone).replace(/[^0-9]/g, '');
}

async function sendViaCallmebot(phone, message) {
  const text = Buffer.from(message).toString('base64');
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', phone);
  url.searchParams.set('text', text);

  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(new URLSearchParams({ apikey: CALLMEBOT_API_KEY }).toString());
    req.end();
  });
}

async function sendViaCustomApi(phone, message) {
  const https = require('https');
  const url = new URL(WHATSAPP_API_URL);
  const payload = JSON.stringify({ phone, message, token: WHATSAPP_API_TOKEN });

  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendWhatsApp(phone, eventType, order, metadata) {
  if (!phone) return { success: false, error: 'No phone number' };
  const cleanPhone = formatPhone(phone);
  if (cleanPhone.length < 10) return { success: false, error: 'Invalid phone number' };

  const message = buildWhatsAppMessage(eventType, order, metadata);
  if (!message) return { success: false, error: `No WhatsApp template for ${eventType}` };

  try {
    if (WHATSAPP_PROVIDER === 'custom' && WHATSAPP_API_URL) {
      await sendViaCustomApi(cleanPhone, message);
    } else {
      await sendViaCallmebot(cleanPhone, message);
    }
    logger.info(`[NotificationService] WhatsApp sent to ${cleanPhone} for ${eventType}`);
    return { success: true };
  } catch (err) {
    logger.error(`[NotificationService] WhatsApp failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── In-App (SSE) Sender ──
async function sendInApp(eventType, order, metadata) {
  try {
    sendSseEvent('order_notification', {
      type: eventType,
      orderId: order.id || order.order_id,
      message: buildSmsMessage(eventType, order, metadata),
      timestamp: new Date().toISOString(),
      ...metadata,
    });
    return { success: true };
  } catch (err) {
    logger.error(`[NotificationService] In-app notification failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── Unified Notify ──
// Fire-and-forget, never blocks the caller
async function notify(eventType, order, user, metadata = {}) {
  if (FEATURE_FLAGS.NOTIFICATION_TRIGGERS) {
    const context = {
      orderId: order?.id || order?.order_id,
      userId: user?.id,
      email: user?.email || order?.customer_email,
      phone: user?.phone || order?.delivery_phone,
      whatsapp: user?.whatsapp_number || order?.delivery_phone,
      name: user?.name || user?.fullName || '',
      amount: order?.total || order?.amount || 0,
      order,
      user,
      metadata,
      date: order?.created_at ? new Date(order.created_at).toLocaleDateString('en-IN') : '',
    };
    return engine.dispatch(eventType, context);
  }

  const channels = EVENT_CHANNELS[eventType];
  if (!channels) {
    logger.warn(`[NotificationService] Unknown event type: ${eventType}`);
    return;
  }

  const promises = [];

  const contactEmail = user?.email || order?.customer_email;
  if (channels.email && contactEmail) {
    promises.push(sendEmail(contactEmail, eventType, order, metadata));
  }

  if (channels.sms) {
    const smsPhone = user?.phone || order?.delivery_phone;
    if (smsPhone) {
      promises.push(sendSms(smsPhone, eventType, order, metadata));
    }
  }

  if (channels.whatsapp) {
    const waPhone = user?.whatsapp_number || order?.delivery_phone;
    if (waPhone) {
      promises.push(sendWhatsApp(waPhone, eventType, order, metadata));
    }
  }

  if (channels.in_app) {
    promises.push(sendInApp(eventType, order, metadata));
  }

  const results = await Promise.allSettled(promises);

  logAuditAction({
    orderId: order.id || order.order_id,
    action: AUDIT_ACTIONS.NOTIFICATION_SENT,
    performedBy: 'system',
    metadata: { eventType, channels: Object.keys(channels).filter(k => channels[k]), results: results.map(r => r.status) },
  }).catch(() => {});

  const failures = results.filter(r => r.status === 'rejected' || (r.value && r.value.success === false));
  if (failures.length > 0) {
    logger.warn(`[NotificationService] ${failures.length}/${promises.length} channels failed for ${eventType} on order ${order.id || order.order_id}`);
  }
}

// Legacy export for backward compatibility
async function sendWhatsAppMessage(phone, message) {
  if (!phone) return { success: false, error: 'No phone number' };
  const cleanPhone = formatPhone(phone);
  if (cleanPhone.length < 10) return { success: false, error: 'Invalid phone number' };

  try {
    if (WHATSAPP_PROVIDER === 'custom' && WHATSAPP_API_URL) {
      await sendViaCustomApi(cleanPhone, message);
    } else {
      await sendViaCallmebot(cleanPhone, message);
    }
    return { success: true };
  } catch (err) {
    logger.error(`[notificationService] sendWhatsAppMessage failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function sendInvoiceWhatsApp(order, user, req) {
  if (!order || !user) return { success: false, error: 'Missing order or user data' };
  const phone = user.whatsapp_number || order.delivery_phone;
  if (!phone) return { success: false, error: 'No WhatsApp number' };

  const shareUrl = order.invoice_token
    ? `${req.protocol}://${req.get('host')}/api/orders/share/${order.invoice_token}`
    : '';

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsList = items.map(item => `• ${item.name} × ${item.quantity}`).join('\n');
  const deliveryLine = order.expected_delivery_date
    ? `Expected delivery: ${new Date(order.expected_delivery_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '';

  const lines = [
    `🧾 *Invoice from Sporekart*`,
    ``,
    `Order: ${order.id}`,
    `Date: ${new Date(order.created_at).toLocaleDateString('en-IN')}`,
    `Total: ₹${Number(order.total || 0).toFixed(2)}`,
    `Status: ${order.delivery_status}`,
    ``,
    `*Items:*`,
    itemsList || '-',
    ``,
  ];
  if (deliveryLine) { lines.push(deliveryLine); lines.push(''); }
  lines.push('View your full invoice:');
  lines.push(shareUrl);
  lines.push('');
  lines.push('Thank you for shopping with Sporekart! 🍄');

  return sendWhatsAppMessage(phone, lines.join('\n'));
}

module.exports = {
  notify,
  sendWhatsAppMessage,
  sendInvoiceWhatsApp,
  EVENT_CHANNELS,
};
