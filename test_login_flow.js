const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ART_DIR = './e2e-artifacts';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000/';

if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function screenshot(page, name) {
  const p = path.join(ART_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  Screenshot: ${p}`);
}

async function clickById(page, id, label) {
  const ok = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    if (el.tagName === 'FORM') {
      const btn = el.querySelector('button, input[type="submit"]');
      if (btn) { btn.click(); return true; }
    }
    el.click();
    return true;
  }, id);
  console.log(`  ${label}: ${ok}`);
  return ok;
}

async function typeText(page, id, text, label) {
  const el = await page.$(`#${id}`);
  if (!el) { console.log(`  WARN: #${id} not found`); return false; }
  await el.type(text);
  console.log(`  ${label || id}: "${text}"`);
  return true;
}

async function openAuthModal(page) {
  // Step 1: click the Log In button in the topbar
  await clickById(page, 'btn-open-auth-top', 'Log In button');
  await sleep(500);
  // Step 2: click "User Login" in the dropdown
  await clickById(page, 'auth-choice-user', 'User Login');
  await sleep(1500);
}

(async () => {
  try {
    console.log('=== Starting Login Flow Test ===\n');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
    });

    // =============================
    // Test 1: Email OTP Login
    // =============================
    console.log('--- Test 1: Email OTP Login (buyer) ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

      await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      await screenshot(page, '01-homepage');

      await openAuthModal(page);
      await screenshot(page, '02-auth-modal-method-view');

      await clickById(page, 'btn-auth-email', 'Email method');
      await sleep(500);
      await screenshot(page, '03-email-request-view');

      await typeText(page, 'auth-email', 'testuser@example.com', 'Email');
      await sleep(300);
      await screenshot(page, '04-email-filled');

      await clickById(page, 'form-request-otp', 'Get Access Code');
      await sleep(2000);
      await screenshot(page, '05-email-verify-view');

      // Read OTP from the pre-filled input or subtitle
      const otpVal = await page.evaluate(() => document.getElementById('auth-otp')?.value || '');
      console.log(`  OTP input value: "${otpVal}"`);
      if (!otpVal) {
        // Fallback: check subtitle text for mock OTP
        const subtitle = await page.evaluate(() => document.getElementById('verify-subtitle')?.textContent || '');
        console.log(`  Subtitle: "${subtitle}"`);
        await typeText(page, 'auth-otp', '123456', 'OTP (fallback)');
      }
      await sleep(300);
      await screenshot(page, '06-email-otp-filled');

      await clickById(page, 'form-verify-otp', 'Verify form');
      await sleep(3000);
      await screenshot(page, '07-email-logged-in');

      const authed = await page.evaluate(() => !!(sessionStorage.getItem('jwt_token')));
      console.log(`  Auth token: ${authed}`);
      if (errors.length) console.log(`  Errors: ${errors.join('; ')}`);
      console.log('  Email login test complete\n');
      await page.close();
    }

    // =============================
    // Test 2: Phone OTP Login
    // =============================
    console.log('--- Test 2: Phone OTP Login ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

      await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.evaluate(() => { sessionStorage.clear(); });
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1000);

      await openAuthModal(page);
      await screenshot(page, '08-phone-method-view');

      await clickById(page, 'btn-auth-phone', 'Phone method');
      await sleep(500);
      await screenshot(page, '09-phone-input-view');

      await typeText(page, 'auth-phone', '9876543210', 'Phone');
      await sleep(300);
      await screenshot(page, '10-phone-filled');

      await clickById(page, 'form-request-phone-otp', 'Send OTP form');
      await sleep(2000);
      await screenshot(page, '11-phone-verify-view');

      const otpVal2 = await page.evaluate(() => document.getElementById('auth-otp')?.value || '');
      console.log(`  OTP input value: "${otpVal2}"`);
      if (!otpVal2) {
        const subtitle = await page.evaluate(() => document.getElementById('verify-subtitle')?.textContent || '');
        console.log(`  Subtitle: "${subtitle}"`);
        await typeText(page, 'auth-otp', '123456', 'OTP (fallback)');
      }
      await sleep(300);
      await screenshot(page, '12-phone-otp-filled');

      await clickById(page, 'form-verify-otp', 'Verify form');
      await sleep(3000);
      await screenshot(page, '13-phone-logged-in');

      const authed2 = await page.evaluate(() => !!(sessionStorage.getItem('jwt_token')));
      console.log(`  Auth token: ${authed2}`);
      if (errors.length) console.log(`  Errors: ${errors.join('; ')}`);
      console.log('  Phone login test complete\n');
      await page.close();
    }

    // =============================
    // Test 3: Google OAuth Mock
    // =============================
    console.log('--- Test 3: Google OAuth Mock Login ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

      await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.evaluate(() => sessionStorage.clear());
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1000);

      await openAuthModal(page);
      await screenshot(page, '14-google-method-view');

      await clickById(page, 'btn-auth-google', 'Google method');
      await sleep(3000);
      await screenshot(page, '15-google-result');

      const authed3 = await page.evaluate(() => !!(sessionStorage.getItem('jwt_token')));
      console.log(`  Auth token: ${authed3}`);
      if (errors.length) console.log(`  Errors: ${errors.join('; ')}`);
      console.log('  Google login test complete\n');
      await page.close();
    }

    // =============================
    // Test 4: Admin Login
    // =============================
    console.log('--- Test 4: Admin Login ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

      await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.evaluate(() => sessionStorage.clear());
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(1000);

      await openAuthModal(page);
      await screenshot(page, '16-admin-method-view');

      await clickById(page, 'link-admin-password', 'Admin login link');
      await sleep(500);
      await screenshot(page, '17-admin-login-view');

      await typeText(page, 'admin-email', 'admin@sporekart.com', 'Admin email');
      await typeText(page, 'admin-password', 'admin123', 'Admin password');
      await sleep(300);
      await screenshot(page, '18-admin-filled');

      await clickById(page, 'form-admin-login', 'Admin Login form');
      await sleep(5000);
      await screenshot(page, '19-admin-redirect');

      const url = page.url();
      console.log(`  Final URL: ${url}`);
      console.log(`  Redirected to admin: ${url.includes('admin.html')}`);
      if (errors.length) console.log(`  Errors: ${errors.join('; ')}`);
      console.log('  Admin login test complete\n');
      await page.close();
    }

    await browser.close();
    console.log('=== All tests completed ===');
    console.log(`Screenshots saved to ${path.resolve(ART_DIR)}`);
    process.exit(0);
  } catch (error) {
    console.error('Test script failed:', error);
    process.exit(1);
  }
})();
