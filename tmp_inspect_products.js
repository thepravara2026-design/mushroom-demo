const http = require('http');
function req(path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, 'http://localhost:5000');
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
(async()=>{
  const p = await req('/api/products');
  console.log('products', p.status);
  console.log(p.body);
})();
