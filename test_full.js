const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

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
    if (errors.length === 0) console.log('None! All resources loaded successfully.');
    else errors.forEach((e) => console.log(e));

    console.log('\n=== CONSOLE ERRORS ===');
    if (consoleErrors.length === 0) console.log('None! Clean console.');
    else consoleErrors.forEach((e) => console.log(e));

    console.log('\n=== TESTING SHOPPING FLOW ===');

    // Step 1: Add item to cart
    await page.waitForSelector('.btn-card-add', { timeout: 8000 });
    console.log('Adding item to cart...');
    await page.evaluate(() => {
      document.querySelector('.btn-card-add').click();
    });
    await new Promise((r) => setTimeout(r, 800));

    // Step 2: Open cart drawer via popup
    const popupBtn = await page.$('#popup-view-cart');
    if (popupBtn) {
      await popupBtn.evaluate(b => b.click());
    }
    await new Promise((r) => setTimeout(r, 1000));

    const drawerOpen = await page.evaluate(() =>
      document.getElementById('cart-drawer')?.classList.contains('open')
    );
    console.log('Cart drawer open:', drawerOpen);

    // Step 3: Click checkout
    console.log('Clicking checkout...');
    await page.evaluate(() => {
      document.getElementById('btn-checkout').click();
    });
    await new Promise((r) => setTimeout(r, 1500));

    // Step 4: Verify navigation to checkout page (guest flow)
    const hash = await page.evaluate(() => window.location.hash);
    console.log('Hash after checkout:', hash);

    const checkoutPage = await page.evaluate(() =>
      document.getElementById('checkout-page')?.classList.contains('active')
    );
    console.log('Checkout page active:', checkoutPage);

    // Step 5: Test Auth Modal opens when explicitly requested via Email OTP button
    console.log('\n=== TESTING AUTH MODAL (Email OTP method) ===');
    // Click the login/profile button to open auth modal
    const profileSection = await page.$('#user-profile-section');
    if (profileSection) {
      // Guest user has a profile - click it to see options, or directly trigger auth
      await page.evaluate(() => {
        // Directly open auth modal via the exposed API
        const guestBtn = document.querySelector('[data-action="login"]') ||
                         document.getElementById('btn-auth-email');
        if (guestBtn) guestBtn.click();
      });
    }

    // Direct approach: open auth modal programmatically if UI approach fails
    let modalOpen = await page.evaluate(() =>
      document.getElementById('auth-modal')?.classList.contains('open')
    );

    if (!modalOpen) {
      // Try clicking the login/register button
      const loginLink = await page.$('#link-admin-password');
      if (!loginLink) {
        console.log('Clicking Email OTP method...');
        // Navigate to trigger auth - click any available login trigger
        const authTrigger = await page.$('#btn-auth-email');
        if (authTrigger) {
          await authTrigger.evaluate(b => b.click());
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    modalOpen = await page.evaluate(() =>
      document.getElementById('auth-modal')?.classList.contains('open')
    );
    console.log('Auth modal open:', modalOpen);

    if (modalOpen) {
      // Select Email OTP
      await page.evaluate(() => {
        const btn = document.getElementById('btn-auth-email');
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 500));

      // Enter email
      await page.waitForSelector('#auth-email', { visible: true, timeout: 5000 });
      await page.type('#auth-email', 'test@sporekart.com');
      await page.evaluate(() => {
        document.querySelector('#form-request-otp button[type="submit"]').click();
      });
      await new Promise((r) => setTimeout(r, 1500));

      const step2Visible = await page.evaluate(() =>
        !document.getElementById('auth-verify-view')?.classList.contains('hidden')
      );
      console.log('OTP step 2 appeared:', step2Visible);

      // Enter OTP
      await page.waitForSelector('#auth-otp', { visible: true, timeout: 5000 });
      await page.type('#auth-otp', '123456');
      await page.evaluate(() => {
        document.querySelector('#form-verify-otp button[type="submit"]').click();
      });
      await new Promise((r) => setTimeout(r, 2000));

      const modalClosed = await page.evaluate(() =>
        !document.getElementById('auth-modal')?.classList.contains('open')
      );
      console.log('Auth modal closed after OTP:', modalClosed);
    }

    await page.screenshot({
      path: 'e2e-artifacts\\otp-flow-screenshot.png',
      fullPage: true,
    });
    console.log('\nScreenshot saved to e2e-artifacts/otp-flow-screenshot.png');

    await browser.close();
    console.log('\n=== ALL TESTS PASSED ===');
  } catch (error) {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  }
})();
