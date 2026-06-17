/**
 * Script to create and publish 2 dummy blogs for testing.
 * Usage: node tmp_create_dummy_blogs.js
 */
const BASE = process.env.API_BASE || 'http://localhost:5000/api';

const dummyBlogs = [
    {
        title: 'Getting Started with Mushroom Cultivation at Home',
        content: `<h2>Why Grow Mushrooms at Home?</h2>
<p>Mushroom cultivation at home is a rewarding hobby that provides fresh, organic produce right from your kitchen. With minimal space and equipment, anyone can start growing mushrooms.</p>

<h2>What You Need</h2>
<ul>
  <li><strong>Mushroom Spawn:</strong> Available online or from local suppliers. Oyster mushrooms are ideal for beginners.</li>
  <li><strong>Substrate:</strong> Straw, sawdust, or coffee grounds work well as a growing medium.</li>
  <li><strong>Humidity:</strong> Mushrooms thrive in humid environments. A simple spray bottle helps maintain moisture.</li>
  <li><strong>Dark Space:</strong> A closet or cabinet provides the ideal low-light conditions.</li>
</ul>

<h2>Step-by-Step Process</h2>
<ol>
  <li>Prepare your substrate by pasteurizing it to kill unwanted organisms.</li>
  <li>Mix the spawn thoroughly into the prepared substrate.</li>
  <li>Place the mixture in a clean container and cover it.</li>
  <li>Keep it in a dark, warm place for 2-3 weeks until white mycelium covers the substrate.</li>
  <li>Expose to indirect light and mist daily. Harvest within 5-7 days!</li>
</ol>

<h2>Common Mistakes to Avoid</h2>
<p>Over-watering and poor hygiene are the most common reasons for failed mushroom grows. Always use clean hands and tools, and mist rather than pour water.</p>`,
        featured_image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=800',
        author: 'Admin',
    },
    {
        title: 'Health Benefits of Medicinal Mushrooms',
        content: `<h2>The Power of Medicinal Mushrooms</h2>
<p>For centuries, various cultures around the world have used mushrooms not just as food but as powerful medicine. Today, modern science is confirming many of these traditional uses.</p>

<h2>Top Medicinal Mushroom Varieties</h2>
<ul>
  <li><strong>Reishi (Ganoderma lucidum):</strong> Known as the "mushroom of immortality," Reishi supports immune function and helps reduce stress.</li>
  <li><strong>Lion's Mane (Hericium erinaceus):</strong> Supports brain health and cognitive function. Studies suggest it may promote nerve growth factor.</li>
  <li><strong>Cordyceps (Cordyceps militaris):</strong> Boosts energy and athletic performance by improving oxygen utilization.</li>
  <li><strong>Turkey Tail (Trametes versicolor):</strong> Rich in polysaccharides that support gut health and immune response.</li>
  <li><strong>Chaga (Inonotus obliquus):</strong> Packed with antioxidants, supports overall wellness and skin health.</li>
</ul>

<h2>How to Incorporate Mushrooms Into Your Diet</h2>
<p>The easiest way is through mushroom powders, teas, or tinctures. Add a teaspoon of mushroom powder to your morning coffee or smoothie for a daily wellness boost.</p>

<h2>Choosing Quality Supplements</h2>
<p>Look for products that use fruiting bodies rather than mycelium-on-grain. Third-party testing for purity and potency is also essential.</p>`,
        featured_image: 'https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?auto=format&fit=crop&q=80&w=800',
        author: 'Admin',
    },
];

async function login() {
    const res = await fetch(`${BASE}/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@sporekart.com', password: 'admin123' }),
    });
    const body = await res.json();
    if (!body.success) throw new Error(`Login failed: ${body.error || JSON.stringify(body)}`);
    console.log('✅ Admin login successful');
    return body.data.token;
}

async function createBlog(token, blog) {
    const res = await fetch(`${BASE}/blogs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(blog),
    });
    const body = await res.json();
    if (!body.success) throw new Error(`Create blog failed: ${body.error || JSON.stringify(body)}`);
    console.log(`✅ Blog created: "${blog.title}" (id: ${body.data.id})`);
    return body.data;
}

async function publishBlog(token, blogId) {
    const res = await fetch(`${BASE}/blogs/${blogId}/publish`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
    });
    const body = await res.json();
    if (!body.success) throw new Error(`Publish blog failed: ${body.error || JSON.stringify(body)}`);
    console.log(`✅ Blog published: ${blogId}`);
    return body.data;
}

async function listPublishedBlogs(token) {
    const res = await fetch(`${BASE}/blogs?status=published&limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!body.success) throw new Error(`List blogs failed: ${body.error || JSON.stringify(body)}`);
    console.log(`\n📋 Published blogs (${body.data.total} total):`);
    body.data.blogs.forEach((b, i) => {
        console.log(`  ${i + 1}. [${b.id}] ${b.title} — status: ${b.status}`);
    });
}

async function main() {
    try {
        const token = await login();

        for (const blog of dummyBlogs) {
            const created = await createBlog(token, blog);
            await publishBlog(token, created.id);
        }

        await listPublishedBlogs(token);
        console.log('\n🎉 Done! 2 dummy blogs created and published successfully.');
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

main();