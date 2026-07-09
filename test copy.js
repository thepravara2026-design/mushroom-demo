const puppeteer = require('puppeteer');

(async () => {
  try {
    const launchOptions = {};
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      launchOptions.args = ['--no-sandbox', '--disable-setuid-sandbox'];
    }
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // Ensure artifacts dir
    const ART_DIR = process.env.E2E_ARTIFACTS_DIR || './e2e-artifacts';
    const fs = require('fs');
    if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR, { recursive: true });

    // Capture console logs and errors to a file
    const consoleLogPath = require('path').join(
      ART_DIR,
      'puppeteer-console.log',
    );
    const consoleStream = fs.createWriteStream(consoleLogPath, { flags: 'a' });

    // Intercept requests and abort known external assets to avoid flaky network failures
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const blockedHosts = [
        'checkout-static-next.razorpay.com',
        'checkout.razorpay.com',
        'cdn.razorpay.com',
      ];
      try {
        const u = new URL(url);
        if (blockedHosts.includes(u.hostname)) {
          const text = `ABORTED EXTERNAL REQUEST: ${url}\n`;
          console.log(text.trim());
          if (fs) {
            fs.appendFileSync(consoleLogPath, text);
          }
          return req.abort();
        }
      } catch (e) {
        // ignore
      }
      req.continue();
    });

    page.on('console', (msg) => {
      const text = `BROWSER ${msg.type().toUpperCase()}: ${msg.text()}\n`;
      console.log(text.trim());
      consoleStream.write(text);
    });

    page.on('pageerror', (error) => {
      const text = `BROWSER PAGE ERROR: ${error.message}\n`;
      console.error(text.trim());
      consoleStream.write(text);
    });

    page.on('requestfailed', (request) => {
      const failure = request.failure() || {};
      const text = `BROWSER REQUEST FAILED: ${request.url()} - ${failure.errorText || 'unknown'}\n`;
      console.error(text.trim());
      consoleStream.write(text);
    });

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000/';
    const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

    console.log(`Navigating to ${FRONTEND_URL} ...`);
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2' });

    // Save page HTML
    const html = await page.content();
    fs.writeFileSync(require('path').join(ART_DIR, 'page.html'), html, 'utf8');

    // Take screenshot
    const screenshotPath = require('path').join(ART_DIR, 'screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

    await browser.close();
    consoleStream.end();
    console.log('Browser test completed.');
  } catch (error) {
    console.error('Test script failed:', error);
  }
})();
