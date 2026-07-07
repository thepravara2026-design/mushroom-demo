const http = require('http');

function api(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, 'http://localhost:5000');
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let body;
        try { body = JSON.parse(data); } catch { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

(async () => {
  const buyerEmail = `flow_${Date.now()}@test.com`;
  const otpRes = await api('/api/auth/request-otp', { method: 'POST', body: JSON.stringify({ email: buyerEmail, role: 'buyer', fullName: 'Flow Buyer' }) });
  const otp = otpRes.body?.data?.otp || otpRes.body?.otp;
  console.log('otpRes', otpRes.status, JSON.stringify(otpRes.body));
  const verifyRes = await api('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: buyerEmail, otpCode: otp }) });
  console.log('verifyRes', verifyRes.status, JSON.stringify(verifyRes.body));
  const token = verifyRes.body?.data?.token || verifyRes.body?.token;
  const productsRes = await api('/api/products');
  const products = productsRes.body?.data || [];
  const available = products.find(p => Number(p.stock) > 1);
  console.log('selected', available?.id, available?.name, available?.stock);
  const checkoutRes = await api('/api/orders/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [{ id: available.id, quantity: 1 }],
      delivery_phone: '9876543210',
      customer_name: 'Flow Buyer',
      customer_email: buyerEmail,
      address_line1: '123 Test',
      city: 'Test City',
      state: 'Test State',
      pincode: '560001'
    })
  });
  console.log('checkout', checkoutRes.status, JSON.stringify(checkoutRes.body));
})();
