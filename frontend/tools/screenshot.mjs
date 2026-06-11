import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'e2e-screenshots');
const TARGET_URL = process.env.URL || 'http://localhost:3000/admin.html';
const WIDTHS = [1366, 1024, 900, 680, 520];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function waitForServer(url, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return true;
    } catch (e) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function run() {
  console.log('Waiting for server:', TARGET_URL);
  const ok = await waitForServer(TARGET_URL, 30000);
  if (!ok) {
    console.error('Server did not respond at', TARGET_URL);
    process.exit(2);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const report = { url: TARGET_URL, captures: [] };

  for (const w of WIDTHS) {
    const h = 900;
    await page.setViewportSize({ width: w, height: h });
    console.log('Navigating for width', w);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(600);

    const shotPath = path.join(OUT_DIR, `admin-${w}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    const checks = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      const overflowEls = [];
      const all = Array.from(document.querySelectorAll('body *'));
      for (const el of all) {
        try {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 1 || r.left < -1) {
            overflowEls.push({ tag: el.tagName.toLowerCase(), id: el.id || null, cls: el.className || null, right: Math.round(r.right), left: Math.round(r.left) });
            if (overflowEls.length > 12) break;
          }
        } catch (e) {}
      }
      const forms = Array.from(document.querySelectorAll('form'))
        .map((f) => ({ tag: 'form', id: f.id || null, cls: f.className || null, height: f.getBoundingClientRect().height, viewport: window.innerHeight }))
        .filter((f) => f.height > f.viewport - 40);

      return { overflow, overflowEls, formsCount: forms.length, forms };
    });

    report.captures.push({ width: w, shot: shotPath, checks });
  }

  await fs.promises.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report written to e2e-screenshots/report.json');

  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
