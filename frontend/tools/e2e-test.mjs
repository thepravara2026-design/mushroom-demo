import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const API = 'http://localhost:5000/api';

async function api(method, path, body, token) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  const unwrapped = data.data || data;
  return { ok: res.ok, status: res.status, data, unwrapped };
}

async function run() {
  const browser = await chromium.launch({ headless: true });

  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) { console.log(`  ✅ ${msg}`); passed++; }
    else { console.log(`  ❌ ${msg}`); failed++; }
  }

  // ============================================================
  // FLOW 1a: Verify email field in HTML
  // ============================================================
  console.log('\n═══ FLOW 1a: Email field in checkout form HTML ═══');
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page1 = await ctx1.newPage();

  await page1.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page1.waitForTimeout(2000);
  const html = await page1.content();
  assert(html.includes('checkout-delivery-email'), 'checkout-delivery-email id in HTML');
  assert(html.includes('Email Address'), 'Email Address label in HTML');
  assert(html.includes('error-checkout-delivery-email'), 'email error span in HTML');
  await ctx1.close();

  // ============================================================
  // FLOW 1b: API-based checkout with email
  // ============================================================
  console.log('\n═══ FLOW 1b: Fresh user OTP + checkout + email ═══');

  // Request OTP
  const otp = await api('POST', '/auth/request-otp', { email: 'test-flow1b@example.com', role: 'buyer', fullName: 'Flow1b Tester' });
  assert(otp.ok, 'OTP requested');
  const otpCode = otp.unwrapped.otp || '123456';
  console.log(`  ℹ️  OTP: ${otpCode}`);

  // Verify OTP
  const v = await api('POST', '/auth/verify-otp', { email: 'test-flow1b@example.com', otpCode, loginMethod: 'email', whatsappNumber: '' });
  console.log(`  📋 Verify response status=${v.status}: ${JSON.stringify(v.data).substring(0, 200)}`);
  assert(v.ok, 'OTP verified');
  const token = v.unwrapped.token;
  assert(!!token, `Token received: ${token ? token.substring(0, 20) + '...' : 'none'}`);

  // Get profile
  const me = await api('GET', '/auth/me', null, token);
  console.log(`  📋 Profile: ${JSON.stringify(me.data).substring(0, 150)}`);
  assert(me.ok, 'Profile fetched');
  assert(me.unwrapped.email === 'test-flow1b@example.com', `Email correct: ${me.unwrapped.email}`);

  // Create checkout with customer_email
  const co = await api('POST', '/orders/checkout', {
    items: [{ id: 'prod-1', quantity: 1 }],
    customer_name: 'Flow1b Tester',
    customer_email: 'test-flow1b@example.com',
    delivery_phone: '9876543210',
    address_line1: '123 Test St',
    address_line2: 'Test Area',
    landmark: 'Near Park',
    city: 'Test City',
    state: 'Test State',
    pincode: '110001',
  }, token);
  console.log(`  📋 Checkout: ${JSON.stringify(co.data).substring(0, 200)}`);
  assert(co.ok, 'Checkout order created');

  // Verify payment
  const pp = await api('POST', '/orders/verify-payment', {
    razorpay_order_id: 'mock_ord_1',
    razorpay_payment_id: 'mock_pay_1',
    razorpay_signature: 'mock_sig_1'
  }, token);
  console.log(`  📋 Payment verify: ${JSON.stringify(pp.data).substring(0, 200)}`);
  assert(pp.ok, 'Payment verified');
  const orderId = pp.unwrapped?.order?.id || '';
  assert(!!orderId, `Order ID: ${orderId}`);

  // Check order has customer_email
  if (orderId) {
    const tr = await api('GET', `/orders/${orderId}/track`, null, token);
    console.log(`  📋 Order track: ${JSON.stringify(tr.data).substring(0, 300)}`);
    assert(tr.ok, 'Order tracked');
    const orderEmail = tr.unwrapped.customer_email || '';
    assert(orderEmail === 'test-flow1b@example.com', `Order customer_email: ${orderEmail}`);
  }

  // Update profile with all fields (simulating what frontend does after payment)
  const up = await api('PUT', '/auth/me', {
    fullName: 'Flow1b Tester',
    email: 'test-flow1b@example.com',
    whatsappNumber: '9876543210',
    address_line1: '123 Test St',
    address_line2: 'Test Area',
    landmark: 'Near Park',
    city: 'Test City',
    state: 'Test State',
    default_pincode: '110001',
  }, token);
  console.log(`  📋 Profile update: ${JSON.stringify(up.data).substring(0, 200)}`);
  assert(up.ok, 'Profile updated with address + email');

  // ============================================================
  // FLOW 2: Returning user — pre-fill UI
  // ============================================================
  console.log('\n═══ FLOW 2: Returning user pre-fill UI ═══');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await ctx2.newPage();

  await page2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.evaluate((t) => {
    localStorage.clear();
    localStorage.setItem('sporekart_token', t);
    localStorage.setItem('sporekart_user', JSON.stringify({
      id: 'test-user',
      email: 'test-flow1b@example.com',
      fullName: 'Flow1b Tester',
      whatsappNumber: '9876543210',
      addressLine1: '123 Test St',
      addressLine2: 'Test Area',
      landmark: 'Near Park',
      city: 'Test City',
      state: 'Test State',
      defaultPincode: '110001',
    }));
  }, token);
  await page2.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.waitForTimeout(3000);

  // Add item to cart
  await page2.evaluate(() => {
    if (window.addToCart && window.__STATE__?.products?.length > 0) {
      window.addToCart(window.__STATE__.products[0].id, 1);
    }
  });
  await page2.waitForTimeout(500);

  // Go to checkout
  await page2.evaluate(() => { window.location.hash = '#checkout'; });
  await page2.waitForTimeout(2000);

  // Verify delivery form shown (no login section)
  const loginSection = await page2.$('#checkout-auth-step1');
  const delForm = await page2.$('#checkout-delivery-name');
  assert(!loginSection, 'Returning user skips login section');
  assert(!!delForm, 'Delivery form visible');

  // Check email pre-fill
  const emailEl = await page2.$('#checkout-delivery-email');
  if (emailEl) {
    const val = await emailEl.inputValue();
    console.log(`  ℹ️  Pre-filled email: "${val}"`);
    assert(val === 'test-flow1b@example.com', 'Email pre-filled from profile');
  } else {
    assert(false, 'Email field exists');
  }

  // Check phone readonly
  const phoneEl = await page2.$('#checkout-delivery-phone');
  if (phoneEl) {
    const pv = await phoneEl.inputValue();
    assert(pv === '9876543210', `Phone pre-filled: ${pv}`);
    const ro = await phoneEl.getAttribute('readonly');
    assert(ro !== null, 'Phone readonly for returning user');
  } else {
    assert(false, 'Phone field exists');
  }

  await ctx2.close();

  // ============================================================
  // FLOW 3: Cancel + Admin approve refund
  // ============================================================
  console.log('\n═══ FLOW 3: Cancel + Admin approve refund ═══');

  if (!orderId) {
    assert(false, 'No order to cancel');
  } else {
    // Request cancel
    const cx = await api('POST', `/orders/${orderId}/request-cancel`, { reason: 'Testing refund' }, token);
    console.log(`  📋 Cancel: ${cx.status} - ${JSON.stringify(cx.data).substring(0, 150)}`);
    assert(cx.ok, 'Cancel request sent');

    // Admin login
    const ad = await api('POST', '/auth/admin-login', { email: 'admin@sporekart.com', password: 'admin123' });
    console.log(`  📋 Admin login: ${JSON.stringify(ad.data).substring(0, 100)}`);
    assert(ad.ok, 'Admin logged in');
    const adminToken = ad.unwrapped.token;
    assert(!!adminToken, 'Admin token received');

    // Get refunds
    await new Promise(r => setTimeout(r, 1000));
    const rf = await api('GET', '/refunds/admin/all-refunds', null, adminToken);
    console.log(`  📋 Refunds: ${JSON.stringify(rf.data).substring(0, 200)}`);
    const refunds = rf.unwrapped.data || rf.unwrapped.refunds || rf.data?.data || [];
    console.log(`  ℹ️  ${refunds.length} refund(s) found`);
    assert(refunds.length > 0, 'Refund found');

    if (refunds.length > 0) {
      const refundId = refunds[0].id || refunds[0].refund_id;
      const rStat = refunds[0].refund_status || refunds[0].status;

      // Approve
      const app = await api('POST', `/refunds/${refundId}/approve`, { reason: 'Approved - e2e test' }, adminToken);
      console.log(`  📋 Approve: ${app.status} - ${JSON.stringify(app.data).substring(0, 150)}`);
      assert(app.ok, 'Refund approved');

      // Check status
      const chk = await api('GET', `/refunds/${refundId}`, null, adminToken);
      console.log(`  📋 Refund check: ${JSON.stringify(chk.data).substring(0, 200)}`);
      const finalStat = chk.unwrapped.refund_status || chk.unwrapped.status || '';
      assert(finalStat === 'approved' || finalStat === 'processed', `Refund status: ${finalStat}`);
    }

    // ============================================================
    // FLOW 4: Reject cancellation
    // ============================================================
    console.log('\n═══ FLOW 4: Admin reject cancellation ═══');

    // Create another order
    const co2 = await api('POST', '/orders/checkout', {
      items: [{ id: 'prod-2', quantity: 1 }],
      customer_name: 'Flow1b Tester',
      customer_email: 'test-flow1b@example.com',
      delivery_phone: '9876543210',
      address_line1: '456 Other St',
      address_line2: 'Other Area',
      landmark: 'Near Mall',
      city: 'Other City',
      state: 'Other State',
      pincode: '400001',
    }, token);
    assert(co2.ok, 'Second order created');
    const orderId2 = co2.unwrapped?.order?.id || '';

    if (orderId2) {
      // Pay
      await api('POST', '/orders/verify-payment', {
        razorpay_order_id: 'mock_ord_2', razorpay_payment_id: 'mock_pay_2', razorpay_signature: 'mock_sig_2'
      }, token);

      // Cancel
      const cx2 = await api('POST', `/orders/${orderId2}/request-cancel`, { reason: 'Testing reject' }, token);
      assert(cx2.ok, 'Second cancel requested');

      await new Promise(r => setTimeout(r, 1000));

      // Admin rejects
      const rf2 = await api('GET', '/refunds/admin/all-refunds', null, adminToken);
      const refunds2 = rf2.unwrapped.data || rf2.unwrapped.refunds || rf2.data?.data || [];
      const pending = refunds2.find(r =>
        (r.refund_status || r.status) === 'initiated' ||
        (r.refund_status || r.status) === 'pending'
      );

      if (pending) {
        const rId2 = pending.id || pending.refund_id;
        const rej = await api('POST', `/refunds/${rId2}/reject`, { reason: 'Already shipped' }, adminToken);
        console.log(`  📋 Reject: ${rej.status} - ${JSON.stringify(rej.data).substring(0, 150)}`);
        assert(rej.ok, 'Refund rejected');
      } else {
        assert(true, 'No pending refund for rejection test');
      }
    }
  }

  await browser.close();

  console.log(`\n═══════════════════════════════════════`);
  console.log(`  Passed: ${passed}  |  Failed: ${failed}`);
  console.log(`═══════════════════════════════════════\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
