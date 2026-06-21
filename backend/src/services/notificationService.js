const https = require("https");
const logger = require("../utils/logger");

const WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER || "callmebot";
const CALLMEBOT_API_KEY = process.env.CALLMEBOT_API_KEY || "";
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || "";
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || "";

function buildInvoiceMessage(order, user, shareUrl) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsList = items
    .map((item) => `• ${item.name} × ${item.quantity}`)
    .join("\n");

  const deliveryLine = order.expected_delivery_date
    ? `Expected delivery: ${new Date(order.expected_delivery_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
    : "";

  const lines = [
    `🧾 *Invoice from Sporekart*`,
    ``,
    `Order: ${order.id}`,
    `Date: ${new Date(order.created_at).toLocaleDateString("en-IN")}`,
    `Total: ₹${Number(order.total || 0).toFixed(2)}`,
    `Status: ${order.delivery_status}`,
    ``,
    `*Items:*`,
    itemsList || `-`,
    ``,
  ];

  if (deliveryLine) {
    lines.push(deliveryLine);
    lines.push(``);
  }

  lines.push(`View your full invoice:`);
  lines.push(shareUrl);
  lines.push(``);
  lines.push(`Thank you for shopping with Sporekart! 🍄`);

  return lines.join("\n");
}

async function sendViaCallmebot(phone, message) {
  const text = Buffer.from(message).toString("base64");
  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", phone);
  url.searchParams.set("text", text);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    const body = new URLSearchParams({ apikey: CALLMEBOT_API_KEY }).toString();
    req.write(body);
    req.end();
  });
}

async function sendViaCustomApi(phone, message) {
  const url = new URL(WHATSAPP_API_URL);
  const payload = JSON.stringify({
    phone,
    message,
    token: WHATSAPP_API_TOKEN,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function sendWhatsAppMessage(phone, message) {
  if (!phone) {
    logger.warn(
      "[notificationService] No phone number provided, skipping WhatsApp message.",
    );
    return { success: false, error: "No phone number" };
  }

  const cleanPhone = phone.replace(/[^0-9]/g, "");
  if (cleanPhone.length < 10) {
    logger.warn(
      `[notificationService] Invalid phone number: ${phone}, skipping.`,
    );
    return { success: false, error: "Invalid phone number" };
  }

  try {
    if (WHATSAPP_PROVIDER === "custom" && WHATSAPP_API_URL) {
      await sendViaCustomApi(cleanPhone, message);
      return { success: true };
    }

    await sendViaCallmebot(cleanPhone, message);
    return { success: true };
  } catch (err) {
    logger.error(
      "[notificationService] Failed to send WhatsApp message:",
      err.message,
    );
    return { success: false, error: err.message };
  }
}

async function sendInvoiceWhatsApp(order, user, req) {
  if (!order || !user) {
    return { success: false, error: "Missing order or user data" };
  }

  const phone = user.whatsapp_number || order.delivery_phone;
  if (!phone) {
    logger.warn(
      `[notificationService] No WhatsApp number for user ${user.id}, skipping invoice.`,
    );
    return { success: false, error: "No WhatsApp number" };
  }

  const shareUrl = order.invoice_token
    ? `${req.protocol}://${req.get("host")}/api/orders/share/${order.invoice_token}`
    : "";

  const message = buildInvoiceMessage(order, user, shareUrl);
  return sendWhatsAppMessage(phone, message);
}

module.exports = {
  sendWhatsAppMessage,
  sendInvoiceWhatsApp,
};
