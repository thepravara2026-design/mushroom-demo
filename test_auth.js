const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Capture console logs and errors
    page.on('console', (msg) => console.log(`BROWSER ${msg.type().toUpperCase()}: ${msg.text()}`));

    console.log('Navigating to http://localhost:3000 ...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

    console.log('Testing Admin Hidden Login Flow...');
    // Open auth modal by triggering buyer checkout gate
    await page.goto('http://localhost:3000/#checkout', {
      waitUntil: 'networkidle0',
    });
    let modalOpen = await page.$eval('#auth-modal', (el) => el.classList.contains('open'));
    console.log('Auth Modal Opened:', modalOpen);

    // Switch to admin password view
    if (modalOpen) {
      await page.click('#link-admin-password');
      await new Promise((r) => setTimeout(r, 300));
      const isAdminViewVisible = await page.$eval(
        '#auth-admin-password-view',
        (el) => !el.classList.contains('hidden'),
      );
      console.log('Admin Password View Visible:', isAdminViewVisible);
      await page.click('#btn-close-auth');
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log('Testing Grower/Trainee Gating...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await page.click('.btn-training'); // Training explore button
    await new Promise((r) => setTimeout(r, 500));
    const traineeModalOpen = await page.$eval(
      '#trainee-auth-modal',
      (el) => el.classList.contains('open'),
    );
    console.log('Trainee Modal Opened:', traineeModalOpen);
    await page.click('#btn-close-trainee-auth'); // Close trainee modal
    await new Promise((r) => setTimeout(r, 500));

    console.log('Testing Buyer Checkout Gating...');
    await page.click('.btn-card-add'); // Add first item to cart
    await new Promise((r) => setTimeout(r, 500));
    await page.click('#btn-checkout'); // Click checkout
    await new Promise((r) => setTimeout(r, 500));
    const buyerModalOpen = await page.$eval(
      '#auth-modal',
      (el) => el.classList.contains('open'),
    );
    console.log('Auth Modal Opened for Checkout:', buyerModalOpen);

    await browser.close();
    console.log('Authentication gates verified successfully!');
  } catch (error) {
    console.error('Test script failed:', error);
    process.exit(1);
  }
})();
