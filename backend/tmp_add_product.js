const fetch = global.fetch || require('node-fetch');

async function run() {
  const BASE = 'http://localhost:5000/api';

  console.log('Logging in as admin...');
  const loginRes = await fetch(`${BASE}/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@sporekart.com',
      password: 'admin123',
    }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  console.log('Login response:', JSON.stringify(loginBody, null, 2));
  if (!loginRes.ok || !loginBody || !loginBody.data || !loginBody.data.token) {
    console.error('Admin login failed');
    process.exit(1);
  }

  const { token } = loginBody.data;

  const productPayload = {
    name: 'Demo Mushroom Grow Kit (Test)',
    description: 'Dummy product created by automated test script.',
    price: 299.99,
    mrp_price: 399.0,
    image_url:
      'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600',
    category: 'kits',
    difficulty: 'beginner',
    gst_rate: 5,
    stock: 150,
  };

  console.log('Creating product...');
  const createRes = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(productPayload),
  });
  const createBody = await createRes.json().catch(() => ({}));
  console.log('Create response status:', createRes.status);
  console.log('Create response body:', JSON.stringify(createBody, null, 2));

  if (!createRes.ok) {
    console.error('Product creation failed');
    process.exit(1);
  }

  console.log(
    'Product created successfully with id:',
    createBody && createBody.id
      ? createBody.id
      : createBody && createBody.data && createBody.data.id,
  );
}

run().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
