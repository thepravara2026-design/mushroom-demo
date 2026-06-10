const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mushroom-spore-secret-key-123';
const BASE = process.env.BASE_URL || 'http://localhost:5001';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function startSse(token) {
  return new Promise((resolve) => {
    const url = new URL(`${BASE}/api/orders/events`);
    url.searchParams.set('token', token);

    const req = http.get(url.toString(), (res) => {
      console.log('SSE connected, status', res.statusCode);
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        process.stdout.write('[SSE] ' + chunk);
      });
      res.on('end', () => {
        console.log('SSE connection ended');
      });
    });
    req.on('error', (err) => {
      console.error('SSE connection error', err.message);
      resolve();
    });

    // resolve immediately with req so we can close later
    resolve(req);
  });
}

function postJson(path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = JSON.stringify(body);
    const opts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    if (token) opts.headers.Authorization = `Bearer ${token}`;

    const req = (url.protocol === 'https:' ? https : http).request(url, opts, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (out += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(out);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: out });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  // Obtain admin token via admin-login
  console.log('Logging in as admin...');
  const adminLogin = await postJson('/api/auth/admin-login', null, { email: 'admin@sporekart.com', password: 'admin123' });
  if (!adminLogin || !adminLogin.body || !adminLogin.body.data || !adminLogin.body.data.token) {
    console.error('Admin login failed:', JSON.stringify(adminLogin));
    process.exit(1);
  }
  const adminToken = adminLogin.body.data.token;

  // Start SSE as admin
  const sseReq = await startSse(adminToken);

  // Create buyer token via OTP verify (123456 backdoor)
  console.log('Requesting OTP for buyer...');
  await postJson('/api/auth/request-otp', null, { email: 'buyer@sporekart.com' });
  console.log('Verifying OTP for buyer...');
  const verifyOtp = await postJson('/api/auth/verify-otp', null, { email: 'buyer@sporekart.com', otpCode: '123456' });
  if (!verifyOtp || !verifyOtp.body || !verifyOtp.body.data || !verifyOtp.body.data.token) {
    console.error('Buyer verify failed:', JSON.stringify(verifyOtp));
    process.exit(1);
  }
  const buyerToken = verifyOtp.body.data.token;

  // Create checkout as buyer
  console.log('Creating checkout (buyer)...');
  const checkout = await postJson('/api/orders/checkout', buyerToken, {
    items: [{ id: 'prod-1', quantity: 1 }],
    delivery_address: '123 Test Lane',
    delivery_phone: '+919876543211',
    promoCode: null,
  });
  console.log('Checkout response:', checkout.status, JSON.stringify(checkout.body).slice(0,200));

  if (!checkout.body || !checkout.body.data || !checkout.body.data.order) {
    console.error('Checkout failed; aborting.');
    process.exit(1);
  }
  const rzpOrderId = checkout.body.data.order.razorpay_order_id;
  console.log('Razorpay order id:', rzpOrderId);

  // Simulate payment verification
  console.log('Verifying payment...');
  const verifyPayment = await postJson('/api/orders/verify-payment', null, {
    razorpay_order_id: rzpOrderId,
    razorpay_payment_id: 'pay_test_123',
    razorpay_signature: 'sig_test',
  });
  console.log('Verify response:', verifyPayment.status, JSON.stringify(verifyPayment.body).slice(0,200));

  console.log('Waiting 2s for SSE messages...');
  await new Promise((r) => setTimeout(r, 2000));

  // Cleanup: destroy SSE request if possible
  try {
    if (sseReq && sseReq.abort) sseReq.abort();
  } catch (e) {}

  console.log('E2E test completed.');
  process.exit(0);
}

run().catch((e) => {
  console.error('E2E script failed:', e);
  process.exit(1);
});
