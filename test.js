const puppeteer = require('puppeteer');

(async () => {
  try {
    const launchOptions = {};
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      launchOptions.args = ['--no-sandbox', '--disable-setuid-sandbox'];
    }
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    
    // Capture console logs and errors
    page.on('console', msg => {
      console.log(`BROWSER ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    
    page.on('pageerror', error => {
      console.error(`BROWSER PAGE ERROR: ${error.message}`);
    });

    page.on('requestfailed', request => {
      console.error(`BROWSER REQUEST FAILED: ${request.url()} - ${request.failure().errorText}`);
    });

    console.log("Navigating to http://localhost:3000 ...");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    
    // Take screenshot
    await page.screenshot({ path: 'C:\\Users\\admin\\.gemini\\antigravity-ide\\brain\\bd4a33e6-b15f-4a5a-bfa0-c33b70a2eb2c\\browser_screenshot.png', fullPage: true });
    console.log("Screenshot saved to artifacts.");
    
    await browser.close();
    console.log("Browser test completed.");
  } catch (error) {
    console.error("Test script failed:", error);
  }
})();
