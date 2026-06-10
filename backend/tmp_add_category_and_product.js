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
  if (!loginRes.ok || !loginBody || !loginBody.data || !loginBody.data.token) {
    console.error('Admin login failed', loginBody);
    process.exit(1);
  }
  const { token } = loginBody.data;
  console.log('Logged in. Token received.');

  // Create new category
  const uniqueSlug = `demo-cat-${Date.now()}`;
  const categoryPayload = {
    id: uniqueSlug,
    name: `Demo Category ${Date.now()}`,
    description: 'Automatically created demo category.',
  };

  console.log('Creating category:', uniqueSlug);
  const catRes = await fetch(`${BASE}/categories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(categoryPayload),
  });
  const catBody = await catRes.json().catch(() => ({}));
  console.log('Category create status:', catRes.status);
  console.log('Category response:', JSON.stringify(catBody, null, 2));
  if (!catRes.ok) {
    console.error('Failed to create category');
    process.exit(1);
  }

  // Create product in that category
  const productPayload = {
    name: 'Demo Product in New Category',
    description: 'This product was created under the new demo category.',
    price: 199.99,
    mrp_price: 249.99,
    image_url:
      'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=600',
    category: uniqueSlug,
    difficulty: 'beginner',
    gst_rate: 5,
    stock: 75,
  };

  console.log('Creating product in category:', uniqueSlug);
  const prodRes = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(productPayload),
  });

  const prodBody = await prodRes.json().catch(() => ({}));
  console.log('Product create status:', prodRes.status);
  console.log('Product response:', JSON.stringify(prodBody, null, 2));
  if (!prodRes.ok) {
    console.error('Failed to create product');
    process.exit(1);
  }

  console.log('Done. Category and product created.');
}

run().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
