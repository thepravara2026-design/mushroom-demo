const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');

const BASE = process.env.BASE_URL || 'http://localhost:5000';

function postJson(path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = JSON.stringify(body);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;
    const req = (url.protocol === 'https:' ? https : http).request(url, options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function putJson(path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = JSON.stringify(body);
    const options = {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;
    const req = (url.protocol === 'https:' ? https : http).request(url, options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = { method: 'GET', headers: {} };
    if (token) options.headers.Authorization = `Bearer ${token}`;
    const req = (url.protocol === 'https:' ? https : http).request(url, options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function connectSse(token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/orders/events?token=${encodeURIComponent(token)}`);
    const req = http.request(url, { method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connection failed with status ${res.statusCode}`));
        return;
      }
      console.log('SSE connected for customer.');
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        process.stdout.write(chunk);
      });
      res.on('end', () => {
        console.log('SSE connection ended');
      });
      resolve(req);
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('--- Starting customer SSE shipment update test ---');

  // Authenticate buyer
  console.log('Requesting OTP for buyer...');
  await postJson('/api/auth/request-otp', null, { email: 'buyer@sporekart.com' });
  console.log('Verifying OTP for buyer...');
  const authRes = await postJson('/api/auth/verify-otp', null, { email: 'buyer@sporekart.com', otpCode: '123456' });
  if (!authRes.body || !authRes.body.data || !authRes.body.data.token) {
    throw new Error('Buyer auth failed: ' + JSON.stringify(authRes.body));
  }
  const buyerToken = authRes.body.data.token;
  console.log('Buyer token acquired.');

  const sseReq = await connectSse(buyerToken);

  console.log('Creating checkout as buyer...');
  const checkout = await postJson('/api/orders/checkout', buyerToken, {
    items: [{ id: 'prod-1', quantity: 1 }],
    delivery_address: 'Test Address',
    delivery_phone: '+919876543210',
  });
  if (!checkout.body || !checkout.body.data || !checkout.body.data.order) {
    throw new Error('Checkout failed: ' + JSON.stringify(checkout.body));
  }
  const order = checkout.body.data.order;
  console.log('Checkout created order:', order.id);

  console.log('Verifying payment for buyer order...');
  const verifyRes = await postJson('/api/orders/verify-payment', null, {
    razorpay_order_id: order.razorpay_order_id,
    razorpay_payment_id: 'pay_test_123',
    razorpay_signature: 'sig_test',
  });
  if (verifyRes.status !== 200) {
    throw new Error('Payment verify failed: ' + JSON.stringify(verifyRes.body));
  }
  console.log('Payment verified. Order status should now be paid.');

  // Authenticate admin
  console.log('Logging in as admin...');
  const adminLogin = await postJson('/api/auth/admin-login', null, { email: 'admin@sporekart.com', password: 'admin123' });
  if (!adminLogin.body || !adminLogin.body.data || !adminLogin.body.data.token) {
    throw new Error('Admin login failed: ' + JSON.stringify(adminLogin.body));
  }
  const adminToken = adminLogin.body.data.token;
  console.log('Admin logged in. Updating shipment status...');

  const statusUpdate = await putJson(`/api/orders/${order.id}/status`, adminToken, {
    delivery_status: 'shipped',
  });
  if (statusUpdate.status !== 200) {
    throw new Error('Status update failed: ' + JSON.stringify(statusUpdate.body));
  }
  console.log('Admin updated order to shipped.');

  console.log('Waiting 3 seconds for SSE message...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  if (sseReq && sseReq.abort) {
    sseReq.abort();
  }
  console.log('Test complete.');
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
