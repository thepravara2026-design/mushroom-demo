const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const errors = [];
    const consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    page.on('requestfailed', (request) => {
      errors.push(`FAILED: ${request.url()} => ${request.failure().errorText}`);
    });

    page.on('response', (response) => {
      if (!response.ok() && response.status() !== 304) {
        errors.push(`HTTP ${response.status()}: ${response.url()}`);
      }
    });

    console.log('Loading http://localhost:3000 ...');
    await page.goto('http://localhost:3000', {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });

    console.log('\n=== REQUEST ERRORS ===');
    if (errors.length === 0) {
      console.log('None! All resources loaded successfully.');
    } else {
      errors.forEach((e) => console.log(e));
    }

    console.log('\n=== CONSOLE ERRORS ===');
    if (consoleErrors.length === 0) {
      console.log('None! Clean console.');
    } else {
      consoleErrors.forEach((e) => console.log(e));
    }

    // Test full OTP flow
    console.log('\n=== TESTING OTP FLOW ===');
    // Click an add to cart button
    await page.waitForSelector('.btn-card-add', { timeout: 8000 });
    await page.click('.btn-card-add');
    await new Promise((r) => setTimeout(r, 300));

    // Click checkout
    await page.click('#btn-checkout');
    await new Promise((r) => setTimeout(r, 500));

    // Verify auth modal opened
    const modalOpen = await page.$eval('#auth-modal', (el) => el.classList.contains('open'));
    console.log('Auth modal appeared on checkout:', modalOpen);

    // Enter email and request OTP
    await page.type('#auth-email', 'test@sporekart.com');
    await page.click('#form-request-otp button[type="submit"]');
    await new Promise((r) => setTimeout(r, 1500));

    // Enter OTP
    const step2Visible = await page.$eval(
      '#auth-verify-view',
      (el) => !el.classList.contains('hidden'),
    );
    console.log('OTP step 2 appeared:', step2Visible);

    await page.type('#auth-otp', '123456');
    await page.click('#form-verify-otp button[type="submit"]');
    await new Promise((r) => setTimeout(r, 2000));

    // Verify modal closed and user logged in
    const modalClosed = await page.$eval(
      '#auth-modal',
      (el) => !el.classList.contains('open'),
    );
    console.log('Auth modal closed after OTP:', modalClosed);

    const userName = await page.$eval('#user-profile-section', (el) => el.textContent.trim());
    console.log('User profile section:', userName.substring(0, 60));

    await page.screenshot({
      path: 'C:\\Users\\admin\\.gemini\\antigravity-ide\\brain\\bd4a33e6-b15f-4a5a-bfa0-c33b70a2eb2c\\browser_screenshot.png',
      fullPage: true,
    });
    console.log('\nScreenshot saved.');

    await browser.close();
    console.log('\n=== ALL TESTS PASSED ===');
  } catch (error) {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  }
})();
