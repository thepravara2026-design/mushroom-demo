const fetch = global.fetch || require('node-fetch');

(async function () {
  try {
    const BASE = 'http://localhost:5000/api';
    const catsRes = await fetch(`${BASE}/categories`);
    const cats = await catsRes.json().catch(() => []);
    console.log('Categories count:', Array.isArray(cats) ? cats.length : 0);
    const recentCats = (Array.isArray(cats) ? cats.slice(-5) : [])
      .map((c) => `${c.id} (${c.category_id})`)
      .join(', ');
    console.log('Recent categories:', recentCats);

    const prodsRes = await fetch(`${BASE}/products`);
    const prods = await prodsRes.json().catch(() => []);
    console.log('Products count:', Array.isArray(prods) ? prods.length : 0);
    const recentProds = (Array.isArray(prods) ? prods.slice(-10) : [])
      .map((p) => `${p.id}:${p.category}`)
      .join('\n');
    console.log('Recent products (last 10):\n', recentProds);
  } catch (err) {
    console.error('Verify error:', err);
    process.exit(1);
  }
}());
