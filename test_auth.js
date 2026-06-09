const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Capture console logs and errors
    page.on('console', msg => console.log(`BROWSER ${msg.type().toUpperCase()}: ${msg.text()}`));
    
    console.log("Navigating to http://localhost:3000 ...");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    
    console.log("Testing Admin Hidden Login Flow...");
    await page.goto('http://localhost:3000/#admin-login', { waitUntil: 'networkidle0' });
    const isAdminModalVisible = await page.$eval('#admin-login-modal', el => el.classList.contains('open'));
    console.log("Admin Modal Visible:", isAdminModalVisible);

    console.log("Testing Grower Gating...");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await page.click('.btn-training'); // Training explore button
    await new Promise(r => setTimeout(r, 500));
    const authTitleGrower = await page.$eval('#auth-modal-title', el => el.textContent);
    console.log("Grower Modal Opened with Title:", authTitleGrower);
    await page.click('#btn-close-auth'); // Close modal
    await new Promise(r => setTimeout(r, 500));

    console.log("Testing Buyer Checkout Gating...");
    await page.click('.btn-card-add'); // Add first item to cart
    await new Promise(r => setTimeout(r, 500));
    await page.click('#btn-checkout'); // Click checkout
    await new Promise(r => setTimeout(r, 500));
    const authTitleBuyer = await page.$eval('#auth-modal-title', el => el.textContent);
    console.log("Buyer Checkout Modal Opened with Title:", authTitleBuyer);

    await browser.close();
    console.log("Authentication gates verified successfully!");
  } catch (error) {
    console.error("Test script failed:", error);
    process.exit(1);
  }
})();
