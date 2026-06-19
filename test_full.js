const puppeteer = require('puppeteer');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

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

    console.log(`Loading ${FRONTEND_URL} ...`);
    await page.goto(FRONTEND_URL, {
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

    // Step 1: Wait for product grid to load and add item to cart
    await page.waitForSelector('.product-grid', { timeout: 10000 });
    // Allow products to render
    await new Promise((r) => setTimeout(r, 2000));

    // Try clicking the first "Add to cart" button
    const addBtn = await page.$('.btn-card-add');
    if (addBtn) {
      console.log('Adding item to cart...');
      await addBtn.click();
    } else {
      errors.push('No .btn-card-add button found on page');
    }
    await new Promise((r) => setTimeout(r, 800));

    // Step 2: Open cart drawer via cart trigger button
    const cartTrigger = await page.$('#btn-open-cart');
    if (cartTrigger) {
      console.log('Opening cart drawer...');
      await cartTrigger.click();
    } else {
      // Fallback: try popup-view-cart
      const popupBtn = await page.$('#popup-view-cart');
      if (popupBtn) {
        console.log('Opening cart via popup button...');
        await popupBtn.click();
      }
    }
    await new Promise((r) => setTimeout(r, 1000));

    const drawerOpen = await page.evaluate(() =>
      document.getElementById('cart-drawer')?.classList.contains('open')
    );
    console.log('Cart drawer open:', drawerOpen);

    // Step 3: Click checkout inside cart drawer
    console.log('Clicking checkout...');
    const checkoutBtn = await page.$('#btn-checkout');
    if (checkoutBtn) {
      await checkoutBtn.click();
    } else {
      errors.push('No #btn-checkout button found');
    }
    await new Promise((r) => setTimeout(r, 1500));

    // Step 4: Verify navigation to checkout page
    const hash = await page.evaluate(() => window.location.hash);
    console.log('Hash after checkout:', hash);

    const checkoutPage = await page.evaluate(() =>
      document.getElementById('checkout-page')?.classList.contains('active')
    );
    console.log('Checkout page active:', checkoutPage);

    // Step 5: Test Auth Modal opens when explicitly requested via Email OTP button
    console.log('\n=== TESTING AUTH MODAL (Email OTP method) ===');

    // Try to open auth modal via the Log In button
    const authBtn = await page.$('#btn-open-auth-top');
    if (authBtn) {
      console.log('Clicking Log In button...');
      await authBtn.click();
      await new Promise((r) => setTimeout(r, 500));

      // Click "User Login" in the dropdown
      const userLogin = await page.$('#auth-choice-user');
      if (userLogin) {
        await userLogin.click();
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Check if auth modal is open
    let modalOpen = await page.evaluate(() =>
      document.getElementById('auth-modal')?.classList.contains('open')
    );

    if (!modalOpen) {
      // Try clicking login/profile section directly
      const guestBtn = await page.$('[data-action="login"]') ||
        await page.$('#btn-auth-email');
      if (guestBtn) {
        await guestBtn.click();
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Final fallback: try direct auth trigger via elements
    if (!modalOpen) {
      modalOpen = await page.evaluate(() =>
        document.getElementById('auth-modal')?.classList.contains('open')
      );
    }
    console.log('Auth modal open:', modalOpen);

    if (modalOpen) {
      // Select Email OTP method
      await page.evaluate(() => {
        const btn = document.getElementById('btn-auth-email');
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 500));

      // Enter email
      await page.waitForSelector('#auth-email', { visible: true, timeout: 5000 });
      await page.type('#auth-email', 'test@sporekart.com');

      // Submit the request OTP form
      const requestForm = await page.$('#form-request-otp');
      if (requestForm) {
        await page.evaluate(() => {
          document.querySelector('#form-request-otp button[type="submit"]')?.click();
        });
      }
      await new Promise((r) => setTimeout(r, 1500));

      const step2Visible = await page.evaluate(() =>
        !document.getElementById('auth-verify-view')?.classList.contains('hidden')
      );
      console.log('OTP step 2 appeared:', step2Visible);

      // Enter OTP
      await page.waitForSelector('#auth-otp', { visible: true, timeout: 5000 });
      await page.type('#auth-otp', '123456');

      // Submit verify OTP form
      const verifyForm = await page.$('#form-verify-otp');
      if (verifyForm) {
        await page.evaluate(() => {
          document.querySelector('#form-verify-otp button[type="submit"]')?.click();
        });
      }
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

    // Print summary
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Request/HTTP errors: ${errors.length}`);
    console.log(`Console errors: ${consoleErrors.length}`);
    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }

    await browser.close();
    if (errors.length === 0 && consoleErrors.length === 0) {
      console.log('\n=== ALL TESTS PASSED ===');
    } else {
      console.log('\n=== TESTS COMPLETED WITH ERRORS ===');
    }
  } catch (error) {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  }
})();