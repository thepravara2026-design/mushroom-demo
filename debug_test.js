const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
  const page = await browser.newPage();

  // Capture all API requests and responses
  const apiLogs = [];
  page.on('request', req => {
    if (req.url().includes('/api/')) {
      apiLogs.push(`REQ ${req.method()} ${req.url()} ${JSON.stringify(req.headers()['content-type'])}`);
    }
  });
  page.on('response', resp => {
    if (resp.url().includes('/api/')) {
      apiLogs.push(`RESP ${resp.status()} ${resp.url()}`);
    }
  });
  page.on('requestfailed', req => {
    if (req.url().includes('/api/')) {
      apiLogs.push(`FAIL ${req.url()} ${req.failure()?.errorText}`);
    }
  });

  await page.goto('http://localhost:3000/', {waitUntil: 'networkidle2', timeout: 15000});

  // Open modal
  await page.evaluate(() => document.getElementById('btn-open-auth-top')?.click());
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => document.getElementById('auth-choice-user')?.click());
  await new Promise(r => setTimeout(r, 2000));

  // Click email
  await page.evaluate(() => document.getElementById('btn-auth-email')?.click());
  await new Promise(r => setTimeout(r, 500));

  // Type email
  await page.evaluate(() => {
    const input = document.getElementById('auth-email');
    if (input) input.value = 'test@example.com';
  });
  await new Promise(r => setTimeout(r, 300));

  // Submit - capture the response
  const respPromise = new Promise(resolve => {
    page.on('response', resp => {
      if (resp.url().includes('/auth/request-otp')) resolve(resp);
    });
  });

  await page.evaluate(() => {
    const form = document.getElementById('form-request-otp');
    const btn = form?.querySelector('button');
    if (btn) btn.click();
  });

  const resp = await Promise.race([
    respPromise,
    new Promise(r => setTimeout(() => r(null), 8000))
  ]);

  if (resp) {
    console.log('Status:', resp.status());
    try {
      const body = await resp.json();
      console.log('Body:', JSON.stringify(body, null, 2));
    } catch(e) {
      console.log('Could not parse body:', e.message);
    }
  } else {
    console.log('No API response received');
  }

  console.log('\nAll API logs:');
  apiLogs.forEach(l => console.log(l));

  await browser.close();
})();
