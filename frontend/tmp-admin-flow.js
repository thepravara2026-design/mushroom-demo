const http = require('http');
const https = require('https');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data || '{}');
          resolve({ status: res.statusCode, body: json });
        } catch (err) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const host = 'localhost';
  const port = 3003;
  const base = '/api';

  console.log('Testing admin login...');
  const adminLogin = await request(
    {
      hostname: host,
      port,
      path: `${base}/auth/admin-login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { email: 'admin@sporekart.com', password: 'admin123' },
  );
  console.log('admin-login', adminLogin.status, adminLogin.body);
  if (adminLogin.status !== 200) return;
  const adminToken = adminLogin.body.token || adminLogin.body.data?.token;
  console.log('Admin token length', adminToken?.length || 0);

  console.log('Testing orders list (should be empty or array)');
  const allOrders = await request({
    hostname: host,
    port,
    path: `${base}/orders/all-orders`,
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(
    'all-orders',
    allOrders.status,
    Array.isArray(allOrders.body)
      ? `count=${allOrders.body.length}`
      : JSON.stringify(allOrders.body).slice(0, 200),
  );

  console.log('Testing buyer OTP verify and checkout flow...');
  const otpVerify = await request(
    {
      hostname: host,
      port,
      path: `${base}/auth/verify-otp`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { email: 'buyer@sporekart.com', otpCode: '123456' },
  );
  console.log('buyer verify', otpVerify.status, otpVerify.body);
  const buyerToken = otpVerify.body.token || otpVerify.body.data?.token;
  if (!buyerToken) {
    console.log('Buyer login failed; aborting.');
    return;
  }

  const checkout = await request(
    {
      hostname: host,
      port,
      path: `${base}/orders/checkout`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${buyerToken}`,
      },
    },
    {
      items: [{ id: 'prod-1', quantity: 1 }],
      delivery_address: '123 Mushroom Lane, Bangalore',
      delivery_phone: '9876543211',
    },
  );
  console.log(
    'checkout',
    checkout.status,
    JSON.stringify(checkout.body).slice(0, 400),
  );

  if (checkout.status === 201) {
    const orderId = checkout.body.order?.id || checkout.body.data?.order?.id;
    console.log('Created order', orderId);
    console.log('Admin fetch orders again');
    const ordersAfter = await request({
      hostname: host,
      port,
      path: `${base}/orders/all-orders`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    console.log(
      'orders-after',
      ordersAfter.status,
      Array.isArray(ordersAfter.body)
        ? ordersAfter.body.length
        : JSON.stringify(ordersAfter.body).slice(0, 200),
    );

    if (orderId) {
      console.log('Updating status to shipped');
      const statusRes = await request(
        {
          hostname: host,
          port,
          path: `${base}/orders/${orderId}/status`,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
        },
        { delivery_status: 'shipped' },
      );
      console.log(
        'status update',
        statusRes.status,
        JSON.stringify(statusRes.body).slice(0, 200),
      );

      console.log(
        'Canceling order as admin (should fail because already shipped)',
      );
      const cancelRes = await request(
        {
          hostname: host,
          port,
          path: `${base}/orders/${orderId}/cancel`,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
        },
        { reason: 'Test admin cancel' },
      );
      console.log(
        'cancel as admin',
        cancelRes.status,
        JSON.stringify(cancelRes.body).slice(0, 200),
      );
    }
  }
}

run().catch((err) => {
  console.error('ERROR', err);
  process.exit(1);
});
