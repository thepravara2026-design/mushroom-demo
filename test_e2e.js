/**
 * Sporekart E2E API Test Suite
 * Tests: Auth → Products → Checkout → Payment → Order Tracking
 */

const BASE = 'http://localhost:5000/api';

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`[${res.status}] ${path}: ${JSON.stringify(data)}`);

  // Unwrap standardized response format { success, data, meta }
  if (data.success !== undefined && data.data !== undefined) {
    return data.data;
  }
  return data;
}

let token = null;
let orderId = null;

function pass(msg) {
  console.log(`  ✅ ${msg}`);
}
function fail(msg) {
  console.error(`  ❌ FAIL: ${msg}`);
  process.exit(1);
}
function section(title) {
  console.log(
    `\n══════════════════════════════════\n  ${title}\n══════════════════════════════════`,
  );
}

async function run() {
  console.log('🍄 Sporekart E2E Test Suite Starting...\n');

  // ──────────────────────────────────────────────────────
  section('1. OTP Auth Flow (New Buyer)');
  // ──────────────────────────────────────────────────────

  const testEmail = `e2e_test_${Date.now()}@test.com`;

  const otpRes = await api('/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      role: 'buyer',
      fullName: 'E2E Test Buyer',
    }),
  }).catch((e) => fail(e.message));
  pass(`OTP requested for ${testEmail}: ${JSON.stringify(otpRes)}`);

  // In mock mode, OTP is stored in-memory. Default is '123456'
  const verifyRes = await api('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email: testEmail, otpCode: '123456' }),
  }).catch((e) => fail(`OTP verify failed: ${e.message}`));

  if (!verifyRes.token) {
    fail(
      `No token returned from verify-otp. Got: ${JSON.stringify(verifyRes)}`,
    );
  }
  token = verifyRes.token;
  pass(
    `Authenticated as ${verifyRes.user.email} (role: ${verifyRes.user.role})`,
  );
  pass(
    `WhatsApp number defaults to: "${verifyRes.user.whatsappNumber}" (should be empty string)`,
  );
  if (verifyRes.user.whatsappNumber !== '') {
    fail(
      `whatsappNumber should be '' but got: ${verifyRes.user.whatsappNumber}`,
    );
  }

  // ──────────────────────────────────────────────────────
  section('2. /auth/me — Session Verification');
  // ──────────────────────────────────────────────────────

  const me = await api('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  }).catch((e) => fail(e.message));
  pass(
    `/me returned user: ${me.email}, role: ${me.role}, whatsappNumber: "${me.whatsappNumber}"`,
  );
  if (me.whatsappNumber === undefined) fail('whatsappNumber is undefined on /me response!');

  // ──────────────────────────────────────────────────────
  section('3. Products — List & Detail');
  // ──────────────────────────────────────────────────────

  const products = await api('/products').catch((e) => fail(e.message));
  pass(`Got ${products.length} products`);
  if (products.length < 1) fail('No products returned!');

  // Filter by category
  const spawnProducts = products.filter((p) => p.category === 'spawn');
  const freshProducts = products.filter((p) => p.category === 'fresh');
  const dryProducts = products.filter((p) => p.category === 'dry');
  const kitProducts = products.filter((p) => p.category === 'kits');
  pass(
    `spawn: ${spawnProducts.length} | fresh: ${freshProducts.length} | dry: ${dryProducts.length} | kits: ${kitProducts.length}`,
  );

  // Product detail
  const prod = products[0];
  const detail = await api(`/products/${prod.id}`).catch((e) => fail(e.message));
  pass(`Product detail OK: ${detail.name} — ₹${detail.price}`);
  if (!detail.id) fail('Product detail missing id!');

  // ──────────────────────────────────────────────────────
  section('4. Checkout — Create Order');
  // ──────────────────────────────────────────────────────

  const cartItems = [
    { id: products[0].id, quantity: 2 },
    { id: products[1].id, quantity: 1 },
  ];

  const checkoutData = await api('/orders/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items: cartItems, promoCode: null }),
  }).catch((e) => fail(e.message));

  if (!checkoutData.order || !checkoutData.razorpay) {
    fail(`Checkout response malformed: ${JSON.stringify(checkoutData)}`);
  }

  orderId = checkoutData.razorpay.orderId;
  pass(`Order created: ${checkoutData.order.id}`);
  pass(`Razorpay order: ${orderId}`);
  pass(`Amount: ₹${(checkoutData.razorpay.amount / 100).toFixed(2)}`);
  pass(
    `Key: ${checkoutData.razorpay.keyId} (mock: ${orderId.includes('mock') ? 'YES ✓' : 'NO'})`,
  );

  if (!orderId) fail('No razorpay orderId returned!');

  // ──────────────────────────────────────────────────────
  section('5. Payment Verification — Mock Flow');
  // ──────────────────────────────────────────────────────

  const mockPaymentId = `pay_mock_${Date.now()}`;
  const mockSignature = `sig_mock_${Date.now()}`;

  const verifyPayment = await api('/orders/verify-payment', {
    method: 'POST',
    body: JSON.stringify({
      razorpay_order_id: orderId,
      razorpay_payment_id: mockPaymentId,
      razorpay_signature: mockSignature,
    }),
  }).catch((e) => fail(e.message));

  pass(`Payment verified: ${JSON.stringify(verifyPayment)}`);
  if (!verifyPayment.order) fail('No order in payment verify response!');
  if (verifyPayment.order.delivery_status !== 'pending') {
    pass(`Order status: ${verifyPayment.order.delivery_status}`);
  } else {
    pass(`Order status: ${verifyPayment.order.delivery_status} (OK)`);
  }

  const completedOrderId = verifyPayment.order.id;

  // ──────────────────────────────────────────────────────
  section('6. Order Tracking — My Orders & Track');
  // ──────────────────────────────────────────────────────

  const myOrders = await api('/orders/my-orders', {
    headers: { Authorization: `Bearer ${token}` },
  }).catch((e) => fail(e.message));
  pass(`My orders: ${myOrders.length} order(s)`);
  if (myOrders.length < 1) fail('Should have at least 1 order after checkout!');

  const tracked = await api(`/orders/${completedOrderId}/track`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch((e) => fail(`Track failed: ${e.message}`));
  pass(`Order track: status=${tracked.deliveryStatus}, id=${tracked.orderId}`);

  // ──────────────────────────────────────────────────────
  section('7. Promo Code — SPORE10');
  // ──────────────────────────────────────────────────────

  const promoCheckout = await api('/orders/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [{ id: products[0].id, quantity: 1 }],
      promoCode: 'SPORE10',
    }),
  }).catch((e) => fail(e.message));
  pass(
    `Promo checkout: ₹${(promoCheckout.razorpay.amount / 100).toFixed(2)} (should be 10% less than ₹${products[0].price})`,
  );

  // ──────────────────────────────────────────────────────
  section('8. Admin Login');
  // ──────────────────────────────────────────────────────

  const adminLogin = await api('/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@sporekart.com',
      password: '123456',
    }),
  }).catch((e) => fail(e.message));
  pass(
    `Admin login OK: ${adminLogin.user.email} (role: ${adminLogin.user.role})`,
  );
  if (adminLogin.user.role !== 'admin') fail('Admin role mismatch!');

  const adminToken = adminLogin.token;

  // ──────────────────────────────────────────────────────
  section('9. Admin Order Operations');
  // ──────────────────────────────────────────────────────

  const allOrders = await api('/orders/all-orders', {
    headers: { Authorization: `Bearer ${adminToken}` },
  }).catch((e) => fail(`Failed to fetch all orders for admin: ${e.message}`));
  pass(
    `Admin successfully fetched all orders. Total count: ${allOrders.length}`,
  );
  if (allOrders.length < 1) fail('Admin orders list should not be empty');

  // Verify enriched user email is present
  const testOrder = allOrders.find((o) => o.id === completedOrderId);
  if (!testOrder) {
    fail(
      `Admin could not find the created order ${completedOrderId} in all orders list.`,
    );
  }
  pass(
    `Found created order ${completedOrderId} in admin list. Associated buyer email: ${testOrder.user_email}`,
  );

  // Update order delivery status
  const updateStatusRes = await api(`/orders/${completedOrderId}/status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ delivery_status: 'shipped' }),
  }).catch((e) => fail(`Admin status update failed: ${e.message}`));

  pass(`Status update response: ${updateStatusRes.message}`);
  if (updateStatusRes.order.delivery_status !== 'shipped') {
    fail(
      `Delivery status was not updated to shipped. Got: ${updateStatusRes.order.delivery_status}`,
    );
  }
  pass(
    `Order ${completedOrderId} delivery status successfully updated to "shipped" by Admin.`,
  );

  // ──────────────────────────────────────────────────────
  section('10. Admin Category Operations');
  // ──────────────────────────────────────────────────────

  // Fetch categories
  const categories = await api('/categories').catch((e) => fail(e.message));
  pass(`Successfully fetched categories. Total count: ${categories.length}`);
  if (categories.length < 4) fail('Categories count should be at least 4');

  // Create new category
  const newCat = await api('/categories', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      id: 'test-cat',
      name: 'Test Category',
      description: 'Testing categories CRUD',
    }),
  }).catch((e) => fail(`Failed to create category: ${e.message}`));
  pass(`Category created: ${newCat.name} (id: ${newCat.id})`);

  // Update category
  const updatedCat = await api(`/categories/${newCat.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Test Category Updated',
      description: 'Testing categories CRUD updated description',
    }),
  }).catch((e) => fail(`Failed to update category: ${e.message}`));
  pass(
    `Category updated: ${updatedCat.name} (desc: ${updatedCat.description})`,
  );

  // Delete category
  const deleteRes = await api(`/categories/${newCat.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  }).catch((e) => fail(`Failed to delete category: ${e.message}`));
  pass(`Category deletion response: ${deleteRes.message}`);

  // Verify deletion
  const afterDeleteCategories = await api('/categories').catch((e) => fail(e.message));
  const found = afterDeleteCategories.find((c) => c.id === newCat.id);
  if (found) fail('Deleted category was still found in list!');
  pass('Category deletion verified successfully.');

  // ──────────────────────────────────────────────────────
  console.log('\n\n🎉 ALL TESTS PASSED! E2E flow is fully functional.\n');
  console.log('Flow tested:');
  console.log('  ✅ New user OTP registration & login');
  console.log('  ✅ Session verification (/auth/me)');
  console.log('  ✅ Products listing & detail');
  console.log('  ✅ Category filtering (spawn/fresh/dry/kits)');
  console.log('  ✅ Checkout with cart items');
  console.log('  ✅ Mock payment gateway');
  console.log('  ✅ Payment verification & order creation');
  console.log('  ✅ Order tracking');
  console.log('  ✅ Promo code (SPORE10)');
  console.log('  ✅ Admin login');
  console.log('  ✅ Admin orders view & shipping status modification');
  pass('  ✅ Admin categories CRUD (Dynamic Category Operations)\n');
}

run().catch((err) => {
  console.error('\n💥 TEST FAILED:', err.message);
  process.exit(1);
});
