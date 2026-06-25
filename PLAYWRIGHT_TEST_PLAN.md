# 🍄 Sporekart — Comprehensive Playwright Test Plan

**Project:** Sporekart (Mushroom Shop E-Commerce Platform)  
**Tech Stack:** Express.js Backend | Vanilla JS Frontend | Supabase/PostgreSQL | Razorpay Payments  
**Date:** 2026-06-25  
**Test Coverage:** All User Flows, Admin Flows, Integrations, and Edge Cases  

---

## TABLE OF CONTENTS

1. [Test Environment Setup](#test-environment-setup)
2. [Pre-Test Requirements](#pre-test-requirements)
3. [Test Execution Strategy](#test-execution-strategy)
4. [User Authentication Flows](#user-authentication-flows)
5. [Product & Category Management](#product--category-management)
6. [Shopping Cart & Checkout](#shopping-cart--checkout)
7. [Order Management & Tracking](#order-management--tracking)
8. [Admin Dashboard Flows](#admin-dashboard-flows)
9. [Trainings & Courses](#trainings--courses)
10. [Blogs & Content](#blogs--content)
11. [Payment Processing](#payment-processing)
12. [Search & Filtering](#search--filtering)
13. [Profile & Account Management](#profile--account-management)
14. [Notifications & SSE (Server-Sent Events)](#notifications--sse-server-sent-events)
15. [Critical Bugs & Issues](#critical-bugs--issues)
16. [High Priority Issues](#high-priority-issues)
17. [Medium Priority Issues](#medium-priority-issues)
18. [Low Priority Issues](#low-priority-issues)
19. [Security Issues](#security-issues)
20. [Performance & Load Testing](#performance--load-testing)

---

## Test Environment Setup

### Prerequisites
```bash
# 1. Kill any process on port 5000
node scripts/kill-port-5000.js

# 2. Install dependencies
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 3. Set environment variables
export NODE_ENV=test
export BACKEND_URL=http://localhost:5000/api
export FRONTEND_URL=http://localhost:3000

# 4. Start services in separate terminals
npm run dev

# 5. Wait for both to be ready
# Frontend: http://localhost:3000
# Backend: http://localhost:5000
```

### Database Reset Between Tests
```bash
# Mock mode (default):
# In-memory database resets automatically on backend restart

# Live Supabase mode:
cd backend
npm run seed:reset
npm run migrations:run
```

### Playwright Configuration
```javascript
// playwright.config.js
module.exports = {
  webServer: [
    {
      command: 'npm run dev',
      port: 3000,
      timeout: 120000,
      reuseExistingServer: false,
    },
  ],
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
  testTimeout: 30000,
};
```

---

## Pre-Test Requirements

### ✅ System Status Checks
- [ ] Port 5000 is free (backend)
- [ ] Port 3000 is free (frontend)
- [ ] Database connectivity verified (mock or live Supabase)
- [ ] Razorpay API keys loaded (if payment tests enabled)
- [ ] Environment variables set correctly

### ✅ Test Data Preparation
- [ ] Mock users seeded: buyer@, grower@, admin@
- [ ] Mock products created: 9 products across 4 categories
- [ ] Mock categories created: fresh, dry, spawn, kits
- [ ] Mock trainings seeded: 6 training programs
- [ ] Mock blogs seeded: 3 blog posts
- [ ] Test admin credentials: `admin@sporekart.com` / `admin123`
- [ ] Test buyer email: `buyer@test.com` (optional for OTP)

---

## Test Execution Strategy

### Test Levels
1. **Unit Tests** — Backend services, utilities (Jest)
2. **Integration Tests** — API endpoints with database (Jest + Supertest)
3. **E2E Tests** — Full user flows (Playwright)
4. **Load/Stress Tests** — High-traffic scenarios (Artillery)

### Execution Order
```
1. Unit + Integration Tests (Backend) → Must Pass
2. E2E Tests (Critical Path)
3. E2E Tests (Happy Path)
4. E2E Tests (Edge Cases & Error Handling)
5. Security Tests
6. Performance/Load Tests
```

### Expected Results Document
- All test results saved to `test-results/`
- Screenshots/videos for failures in `test-results/failures/`
- Coverage reports in `backend/coverage/`
- Performance metrics in `test-results/performance.json`

---

## User Authentication Flows

### 📋 AUTH-001: Email OTP Registration (New User)

**Preconditions:**
- Backend running on port 5000
- Frontend accessible on port 3000
- No user exists with test email

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `http://localhost:3000` | Home page loads |
| 2 | Click "Log In" button | AuthModal opens |
| 3 | Select "Email" tab | Email input field visible |
| 4 | Enter unique email `test_${timestamp}@test.com` | Input accepted |
| 5 | Enter full name "Test User" | Input accepted |
| 6 | Click "Request OTP" | API call succeeds, OTP returned in response |
| 7 | Copy OTP from response/console | OTP code visible (dev mode) |
| 8 | Enter OTP in verify field | 6-digit input accepted |
| 9 | Click "Verify & Login" | Modal closes, user authenticated |
| 10 | Verify JWT in localStorage | `authToken` key exists |
| 11 | Verify user profile loaded | "Log In" button replaced with user name |

**Assertions:**
```javascript
// ✅ User created in database
await db('users').select('*').where({ email: testEmail });

// ✅ Auth token is valid JWT
const decoded = jwt.decode(authToken);
expect(decoded.email).toBe(testEmail);

// ✅ Session persists on page reload
await page.reload();
// User name still visible → token valid
```

**Bugs Found:**
- ❌ **Bug 4:** Mock OTP not shown in subtitle (backend returns `{ data: { otp: "..." } }`)
- ❌ **SEC-002:** OTP returned in production (should be dev/test only)

---

### 📋 AUTH-002: Phone OTP Registration

**Preconditions:**
- Backend running
- No user exists with test phone

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Log In" button | AuthModal opens |
| 2 | Select "Phone" tab | Phone input field visible |
| 3 | Enter valid Indian phone `9876543210` | Input accepted |
| 4 | Enter full name "Test Grower" | Input accepted |
| 5 | Click "Request OTP" | OTP sent to phone (SMS simulated) |
| 6 | Enter OTP in verify field | OTP accepted |
| 7 | Click "Verify & Login" | User authenticated |
| 8 | Verify phone saved to profile | Profile shows phone number |

**Assertions:**
```javascript
// ✅ Phone validated as Indian number
const phone = await db('users').where({ id: userId }).select('whatsapp_number');
expect(phone[0].whatsapp_number).toMatch(/^[6-9]\d{9}$/);

// ✅ User role defaults to 'buyer'
expect(decoded.role).toBe('buyer');
```

---

### 📋 AUTH-003: Google OAuth Integration

**Preconditions:**
- Google OAuth configured in Supabase
- Test account available

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open AuthModal, select "Google" tab | Google Sign-In button visible |
| 2 | Click "Sign in with Google" | Google OAuth popup/redirect |
| 3 | Complete Google login flow | Popup closes, redirected back |
| 4 | Verify user created | Email from Google account saved |
| 5 | Verify token received | JWT stored in localStorage |

**Edge Cases:**
- User denies OAuth permissions → Modal shows error
- OAuth popup blocked → Fallback to manual email
- User cancels mid-OAuth → AuthModal remains open

---

### 📋 AUTH-004: Admin Login

**Preconditions:**
- Admin user seeded: `admin@sporekart.com` / `admin123`
- Backend running

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Log In" button | AuthModal opens |
| 2 | Select "Admin" tab | Email + password fields visible |
| 3 | Enter email `admin@sporekart.com` | Email accepted |
| 4 | Enter password `admin123` | Password accepted |
| 5 | Click "Admin Login" | API call succeeds |
| 6 | Verify token received | JWT stored, role = "admin" |
| 7 | Verify redirect to admin panel | `http://localhost:3000/admin.html` |
| 8 | Check admin console loaded | Dashboard, product list, order list visible |

**Bugs Found:**
- ❌ **Bug 2 (Fixed):** Password was hardcoded as '123456' in tests (should be 'admin123')
- ❌ **Bug 5 (Fixed):** Live Supabase mode: admin credentials not in auth (only in mock)

**Assertions:**
```javascript
// ✅ User role is 'admin'
expect(decoded.role).toBe('admin');

// ✅ Admin panel loads without errors
const pageTitle = await page.locator('title').textContent();
expect(pageTitle).toContain('Admin');
```

---

### 📋 AUTH-005: Login Flow Persistence

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login as buyer | User authenticated |
| 2 | Verify token in localStorage | `authToken` key exists |
| 3 | Navigate to `/` | Token persists |
| 4 | Reload page | User still logged in (token restored from localStorage) |
| 5 | Close browser tab, reopen site | User still logged in (localStorage persists) |
| 6 | Click "Logout" button | AuthModal shows login form |
| 7 | Verify token cleared | `authToken` not in localStorage |

---

### 📋 AUTH-006: Logout & Session Cleanup

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login as user | Authenticated |
| 2 | Click user dropdown → "Logout" | Logout API called |
| 3 | Verify token cleared from storage | localStorage empty |
| 4 | Verify cart cleared | Cart count = 0 |
| 5 | Verify UI updated | "Log In" button shown instead of user name |
| 6 | Try accessing protected route | Redirected to login |

---

### 📋 AUTH-007: Session Expiry (JWT Expiration)

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login successfully | Token received |
| 2 | Manually manipulate token to expire in backend config | (Simulate expired token) |
| 3 | Try accessing `/api/auth/me` | 401 Unauthorized |
| 4 | Refresh page | AuthModal shown (session expired) |
| 5 | Try placing order with expired token | 401 error |

---

### 📋 AUTH-008: Invalid Credentials Handling

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enter admin email but wrong password | Submit login |
| 2 | Verify error message | "Invalid credentials" shown |
| 3 | Try OTP with invalid code | "Invalid OTP code" error |
| 4 | Try non-existent email for OTP | New user created OR error shown |
| 5 | Try empty email field | Form validation error |

---

## Product & Category Management

### 📋 PRODUCT-001: Browse Products (Buyer)

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to home page | Product grid loaded |
| 2 | Verify products displayed | 9 products visible with images |
| 3 | Verify product details shown | Name, price, category, rating |
| 4 | Click on product | Product detail page opens |
| 5 | Verify detail page info | Full description, images, pricing tiers |
| 6 | Verify "Add to Cart" button visible | Button clickable |

**Assertions:**
```javascript
// ✅ Products listed
const products = await page.locator('[data-testid="product-card"]').count();
expect(products).toBeGreaterThan(0);

// ✅ Product has required fields
await page.click('[data-testid="product-card"]:first-child');
expect(page.locator('[data-testid="product-name"]')).toBeVisible();
expect(page.locator('[data-testid="product-price"]')).toBeVisible();
```

---

### 📋 PRODUCT-002: Filter Products by Category

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to home | Products displayed |
| 2 | Click "Shop by Category" | Category dropdown opens |
| 3 | Select "Fresh Mushrooms" | Products filtered to 2 items |
| 4 | Select "Spawn Seeds" | Products filtered to 4 items |
| 5 | Select "All" or clear filter | All 9 products shown |

---

### 📋 PRODUCT-003: Sort Products

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Locate sort dropdown | Dropdown visible |
| 2 | Select "Price: Low to High" | Products re-ordered |
| 3 | Verify first product cheaper than last | Sort correct |
| 4 | Select "Price: High to Low" | Reverse order |
| 5 | Select "Newest" | Products by creation date |

---

### 📋 PRODUCT-004: Search Products

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click search bar | Search input focused |
| 2 | Type "oyster" | Search suggestions dropdown appears |
| 3 | Verify matching products in dropdown | "Oyster Spawn" listed |
| 4 | Click suggestion | Product detail page opens |
| 5 | Try search with no matches | "No results" message shown |
| 6 | Search by partial name "spawn" | 4 spawn products listed |

---

### 📋 PRODUCT-005: Admin - Create Product

**Preconditions:**
- Login as admin
- Admin console accessible

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to admin panel | Dashboard loads |
| 2 | Click "Add Product" button | Product creation form opens |
| 3 | Fill form fields | Form accepts all inputs |
| 4 | Upload product image | Image previewed |
| 5 | Set weight-based pricing | Multiple tiers added |
| 6 | Click "Create" | Product saved |
| 7 | Verify product appears in list | New product visible on home |

**Form Validation:**
```javascript
// ✅ Required fields enforced
await page.fill('[name="name"]', '');
await page.click('button[type="submit"]');
expect(page.locator('text=Name is required')).toBeVisible();

// ✅ Price must be numeric
await page.fill('[name="price"]', 'abc');
expect(page.locator('text=Price must be a number')).toBeVisible();

// ✅ Image URL must be valid
await page.fill('[name="image_url"]', 'not-a-url');
expect(page.locator('text=Invalid URL')).toBeVisible();
```

---

### 📋 PRODUCT-006: Admin - Update Product

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to admin → Products | Product list shown |
| 2 | Click "Edit" on a product | Edit form opens with current data |
| 3 | Change product name | Name field updated |
| 4 | Change price | Price field updated |
| 5 | Click "Save" | Product updated |
| 6 | Verify changes persisted | Changes visible on product list |

**Bugs Found:**
- ❌ **SEC-003:** No input validation on PUT endpoint (only on POST)

---

### 📋 PRODUCT-007: Admin - Delete Product

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to admin → Products | Product list shown |
| 2 | Click "Delete" on a product | Confirmation dialog shown |
| 3 | Click "Cancel" | Product remains in list |
| 4 | Click "Delete" again → confirm | Product deleted |
| 5 | Verify product removed from home | Product no longer visible |

---

### 📋 CATEGORY-001: Create Category (Admin)

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login as admin | Admin console loaded |
| 2 | Navigate to "Categories" | Category management page |
| 3 | Click "Add Category" | Category form opens |
| 4 | Enter category name "Exotic Varieties" | Input accepted |
| 5 | Upload category image | Image previewed |
| 6 | Click "Create" | Category created |
| 7 | Verify in dropdown | New category in "Shop by Category" |

---

### 📋 CATEGORY-002: Update Category

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Categories | List shown |
| 2 | Click "Edit" | Form populated |
| 3 | Change description | Updated |
| 4 | Change image | New image shown |
| 5 | Save | Changes persisted |

---

### 📋 CATEGORY-003: Delete Category

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Categories | List shown |
| 2 | Click "Delete" on empty category | Confirmation shown |
| 3 | Confirm deletion | Category deleted |
| 4 | Try to delete category with products | Warning shown: "Products will be moved to Uncategorized" |
| 5 | Confirm → Products reassigned | Products still exist but uncategorized |

---

## Shopping Cart & Checkout

### 📋 CART-001: Add Product to Cart

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Browse products | Product grid shown |
| 2 | Click "Add to Cart" on a product | Product added |
| 3 | Verify cart badge | Count incremented to 1 |
| 4 | Click cart icon | Cart sidebar opens |
| 5 | Verify product in cart | Product displayed with quantity, price |
| 6 | Click "+" to increase quantity | Quantity incremented |
| 7 | Click "-" to decrease quantity | Quantity decremented |
| 8 | Quantity = 0 → click "-" | Product removed from cart |

**Assertions:**
```javascript
// ✅ Cart count updated
const badgeCount = await page.locator('[data-testid="cart-badge"]').textContent();
expect(badgeCount).toBe('1');

// ✅ Price calculated correctly
const itemPrice = parseFloat(await page.locator('[data-testid="item-price"]').textContent());
const itemQty = parseInt(await page.locator('[data-testid="item-qty"]').inputValue());
const totalPrice = parseFloat(await page.locator('[data-testid="item-total"]').textContent());
expect(totalPrice).toBe(itemPrice * itemQty);
```

---

### 📋 CART-002: Persistent Cart Across Sessions

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Add 3 products to cart | Cart count = 3 |
| 2 | Reload page | Cart persists (localStorage) |
| 3 | Logout and login again | Cart still exists |
| 4 | Close tab and reopen | Cart still in browser storage |

---

### 📋 CART-003: Checkout Flow

**Preconditions:**
- Buyer logged in
- Products in cart (at least 1)

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Checkout" button | Checkout modal opens |
| 2 | Verify cart items listed | All items with prices shown |
| 3 | Verify subtotal calculated | Sum of all items correct |
| 4 | Verify shipping charge shown | "Free" or flat rate (default 0) |
| 5 | Verify taxes calculated | GST shown for each item |
| 6 | Verify promo code input | Input field visible |
| 7 | Verify total | subtotal + shipping + tax = total |

**Assertions:**
```javascript
// ✅ Promo code applied correctly
await page.fill('[data-testid="promo-input"]', 'SAVE10');
await page.click('button[data-testid="apply-promo"]');
const newTotal = parseFloat(await page.locator('[data-testid="total"]').textContent());
expect(newTotal).toBeLessThan(originalTotal);

// ✅ Tax breakdown correct
const item = cartItems[0];
const itemTax = (item.price * item.quantity * item.gstRate) / 100;
const displayedTax = parseFloat(await page.locator(`[data-testid="tax-${item.id}"]`).textContent());
expect(displayedTax).toBe(itemTax);
```

---

### 📋 CART-004: Delivery Address Entry

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In checkout → Delivery section | Address form visible |
| 2 | Fill name field | "John Doe" accepted |
| 3 | Fill phone field | Valid Indian number accepted |
| 4 | Select state from dropdown | State options populated |
| 5 | After state selection → city dropdown | Cities for state populated |
| 6 | Select city | City selected |
| 7 | Fill address line 1 | "123 Main St" accepted |
| 8 | Fill address line 2 (optional) | "Apartment 4B" accepted |
| 9 | Fill pincode | "560001" accepted (validate format) |

**Form Validation:**
```javascript
// ✅ Phone number validated
await page.fill('[name="phone"]', '123'); // Too short
expect(page.locator('text=Invalid phone')).toBeVisible();

// ✅ Pincode format validated
await page.fill('[name="pincode"]', '12345'); // 5 digits = invalid
expect(page.locator('text=Pincode must be 6 digits')).toBeVisible();

// ✅ Required fields enforced
await page.click('button[type="submit"]');
expect(page.locator('text=Address is required')).toBeVisible();
```

---

### 📋 CART-005: Apply Promo Code

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In checkout → Promo code section | Input field visible |
| 2 | Enter valid promo code "SAVE10" | Code accepted |
| 3 | Click "Apply" | Discount calculated |
| 4 | Verify total reduced | Total = Total - Discount |
| 5 | Try invalid code "BADCODE" | Error: "Invalid promo code" |
| 6 | Clear and try expired code | Error: "Promo code expired" |

**Assertions:**
```javascript
// ✅ Promo applied to correct items
const items = await page.locator('[data-testid="cart-item"]');
const discountPercentage = 10;
for (let item of items) {
  const originalPrice = parseFloat(await item.locator('[data-testid="original-price"]').textContent());
  const discountedPrice = parseFloat(await item.locator('[data-testid="discounted-price"]').textContent());
  const expectedDiscount = originalPrice * (discountPercentage / 100);
  expect(discountedPrice).toBe(originalPrice - expectedDiscount);
}
```

---

### 📋 CART-006: Empty Cart Message

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Remove all items from cart | Cart empty |
| 2 | Open cart sidebar | "Your cart is empty" message |
| 3 | "Continue Shopping" button visible | Click → shop page |

---

## Order Management & Tracking

### 📋 ORDER-001: Place Order (Happy Path)

**Preconditions:**
- Buyer logged in
- Cart filled with products
- Delivery address entered
- Payment ready (mock or real)

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Complete checkout form | All fields valid |
| 2 | Select payment method "Razorpay" | Payment option selected |
| 3 | Click "Place Order" | Order created, ID returned |
| 4 | Razorpay modal opens | Payment form shown |
| 5 | Complete payment (mock) | Payment successful |
| 6 | Redirect to order confirmation | Order details page shown |
| 7 | Verify order ID, date, items | All info correct |
| 8 | Verify status = "Pending" or "Confirmed" | Status shown |

**Assertions:**
```javascript
// ✅ Order created in database
const order = await db('orders').where({ id: orderId }).first();
expect(order).toBeDefined();
expect(order.status).toMatch(/pending|confirmed/i);
expect(order.user_id).toBe(userId);

// ✅ Items linked to order
const orderItems = await db('order_items').where({ order_id: orderId });
expect(orderItems.length).toBe(cartItems.length);

// ✅ Cart cleared after order
const cartInStorage = JSON.parse(localStorage.getItem('cart'));
expect(cartInStorage || []).toHaveLength(0);
```

---

### 📋 ORDER-002: Order Confirmation Email

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Place order successfully | Order created |
| 2 | Check email inbox | Confirmation email sent |
| 3 | Open confirmation email | Order details correct |
| 4 | Verify invoice attached | PDF or download link present |

---

### 📋 ORDER-003: View Order History

**Preconditions:**
- Buyer logged in
- At least 1 order placed

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click user profile → "My Orders" | Orders list page |
| 2 | Verify all orders displayed | Order IDs, dates, totals shown |
| 3 | Click on an order | Order detail page opens |
| 4 | Verify items in order | Products, quantities, prices |
| 5 | Verify delivery address | Full address shown |
| 6 | Verify status timeline | Order creation → confirmed → shipped → delivered |

---

### 📋 ORDER-004: Order Tracking

**Preconditions:**
- Order placed and confirmed
- Order has tracking number

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to tracking page | Tracking input visible |
| 2 | Enter order ID | Lookup succeeds |
| 3 | Verify status | Current status displayed (e.g., "Shipped") |
| 4 | Verify tracking URL | Carrier link available (if applicable) |
| 5 | Verify estimated delivery | ETA shown |
| 6 | Try invalid order ID | "Order not found" message |

**Live Updates via SSE:**
```javascript
// ✅ Order status updates in real-time
const statusBefore = await page.locator('[data-testid="order-status"]').textContent();
// Simulate backend updating order status to "Shipped"
await updateOrderStatusInDB(orderId, 'Shipped');
// Frontend should receive SSE event and update UI
await page.waitForTimeout(2000);
const statusAfter = await page.locator('[data-testid="order-status"]').textContent();
expect(statusAfter).toBe('Shipped');
```

---

### 📋 ORDER-005: Cancel Order

**Preconditions:**
- Order placed but not shipped
- Status = "Pending" or "Confirmed"

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | View order details | Cancel button visible |
| 2 | Click "Cancel Order" | Confirmation dialog |
| 3 | Click "Confirm" | Order cancelled |
| 4 | Verify status changed to "Cancelled" | Status updated |
| 5 | Verify refund initiated | Refund shown as "Processing" |
| 6 | Try to cancel already-shipped order | Error: "Cannot cancel shipped order" |

---

### 📋 ORDER-006: Refund Processing

**Preconditions:**
- Order cancelled or marked for refund
- Payment was via Razorpay

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Initiate order cancellation | Refund record created |
| 2 | Admin panel → Refunds | Refund visible in list |
| 3 | Click refund → view details | Amount, reason, status shown |
| 4 | Click "Process Refund" | Refund sent to Razorpay API |
| 5 | Verify Razorpay response | Success or error logged |
| 6 | Check user's refund status | "Refunded" shown in order |
| 7 | Verify amount returned to payment method | (Manual check with test payment) |

---

### 📋 ORDER-007: Order State Transitions

**Test:** Verify state machine enforces valid transitions only

| Current State | Next State | Allowed? | Test |
|---|---|---|---|
| pending | confirmed | ✅ Yes | Admin clicks confirm |
| confirmed | shipped | ✅ Yes | Admin clicks ship |
| shipped | delivered | ✅ Yes | Admin clicks deliver |
| delivered | pending | ❌ No | Error: Invalid transition |
| confirmed | delivered | ❌ No (skip shipped) | Error: Invalid transition |
| cancelled | pending | ❌ No | Error: Cannot un-cancel |
| pending | cancelled | ✅ Yes | User cancels |
| shipped | cancelled | ❌ No | Error: Too late to cancel |

---

## Admin Dashboard Flows

### 📋 ADMIN-001: Admin Login & Dashboard

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to home, click "Log In" | AuthModal |
| 2 | Select "Admin" tab | Email + password fields |
| 3 | Enter credentials `admin@sporekart.com` / `admin123` | Login |
| 4 | Redirect to `/admin.html` | Admin dashboard loads |
| 5 | Verify navigation menu | Products, Categories, Orders, Refunds, Trainings, Blogs |

---

### 📋 ADMIN-002: View Dashboard Analytics

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin console → Dashboard | Analytics cards displayed |
| 2 | Verify metrics shown | Total orders, revenue, customers, conversion rate |
| 3 | Verify graphs rendered | Sales trend, category breakdown |
| 4 | Click on metric → drill down | Detailed breakdown shown |

---

### 📋 ADMIN-003: Manage Orders from Admin

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Orders | Order list with filters |
| 2 | Filter by status "Pending" | Only pending orders shown |
| 3 | Click on order → expand | Order details shown |
| 4 | Click "Confirm" button | Status → "Confirmed" |
| 5 | Enter tracking number | Tracking saved |
| 6 | Click "Mark Shipped" | Status → "Shipped", SSE event sent |
| 7 | Buyer sees update in real-time | Order page updates without refresh |

---

### 📋 ADMIN-004: Manage Products from Admin

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Products | Product list with pagination |
| 2 | Click "Add Product" | Product creation form |
| 3 | Fill and submit form | Product created |
| 4 | Click "Edit" on a product | Prefilled edit form |
| 5 | Change price | Price updated |
| 6 | Click "Delete" → confirm | Product deleted |
| 7 | Search for product by name | Correct product found |

---

### 📋 ADMIN-005: Manage Trainings

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Trainings | Training list shown |
| 2 | Click "Add Training" | Training creation form |
| 3 | Fill form (title, description, price, content) | Form accepted |
| 4 | Upload training video/content | Content saved |
| 5 | Set allowed roles (buyer, grower, both) | Roles saved |
| 6 | Click "Publish" | Training visible on frontend |
| 7 | Unpublish a training | No longer visible to buyers |

---

### 📋 ADMIN-006: Manage Blogs

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Blogs | Blog list shown |
| 2 | Click "Create Blog" | Blog editor opens (WYSIWYG) |
| 3 | Fill title, content, tags | Form accepted |
| 4 | Upload cover image | Image previewed |
| 5 | Set status "Draft" | Saved as draft, not visible |
| 6 | Change to "Published" | Visible on frontend |
| 7 | Try to schedule publication | (If supported) Date selected, auto-publish |

---

### 📋 ADMIN-007: Settings & Configuration

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Settings | Settings form displayed |
| 2 | Modify shipping charge | Value updated |
| 3 | Modify GST rates for categories | Rates updated |
| 4 | Modify business address | Address saved |
| 5 | Save changes | "Settings saved" confirmation |

---

## Trainings & Courses

### 📋 TRAINING-001: Browse Trainings (Buyer)

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to "Training & Courses" section | Training cards displayed |
| 2 | Verify 6 trainings shown | All published trainings visible |
| 3 | Verify training details | Title, description, price, image |
| 4 | Click on training card | Training detail page opens |
| 5 | Verify detail page | Full description, curriculum, instructor, reviews |
| 6 | Verify "Enroll" button visible | Button clickable |

---

### 📋 TRAINING-002: Enroll in Training (Paid)

**Preconditions:**
- Buyer logged in
- Training has a price > 0

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Enroll Now" button | Enrollment modal/page opens |
| 2 | Verify price and payment details | Price shown, payment method selection |
| 3 | Select Razorpay | Payment option selected |
| 4 | Click "Proceed to Payment" | Razorpay modal opens |
| 5 | Complete payment (mock) | Payment successful |
| 6 | Verify enrollment created | Database record created |
| 7 | Redirect to course page | Access to training materials granted |
| 8 | Verify "My Trainings" shows new course | Course appears in user's enrolled trainings |

**Assertions:**
```javascript
// ✅ Enrollment record created
const enrollment = await db('enrollments').where({ 
  training_id: trainingId, 
  user_id: userId 
}).first();
expect(enrollment).toBeDefined();

// ✅ User has access to course materials
const courseAccess = enrollment.access_granted_at !== null;
expect(courseAccess).toBe(true);
```

---

### 📋 TRAINING-003: Enroll in Free Training

**Preconditions:**
- Training has price = 0 or free

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Enroll Now" on free training | Instant enrollment (no payment) |
| 2 | Redirect to course | Training accessible immediately |
| 3 | Verify enrollment record created | No payment_id needed |

---

### 📋 TRAINING-004: Mark Training as Complete

**Preconditions:**
- Enrolled in training
- Course materials viewed

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Complete all modules | Progress bar fills to 100% |
| 2 | Optional: Complete quiz | Quiz submitted, results shown |
| 3 | Click "Mark Complete" button | Completion date recorded |
| 4 | Verify certificate generation | (If applicable) Certificate created |
| 5 | Option to download certificate | PDF downloadable |

---

### 📋 TRAINING-005: Training Filtering & Search

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Trainings section | Filter options visible |
| 2 | Filter by role "Grower" | Only trainings for growers shown |
| 3 | Filter by price range $0-$100 | Trainings filtered |
| 4 | Search "Oyster" | Matching training results |
| 5 | Combine filters (role + price) | Both filters applied |

---

## Blogs & Content

### 📋 BLOG-001: Browse Blogs

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to "Blogs" section | Blog cards displayed |
| 2 | Verify 3 published blogs shown | All published blogs visible |
| 3 | Verify blog metadata | Title, excerpt, cover image, publish date, author |
| 4 | Click blog card | Blog detail page opens |
| 5 | Verify full content rendered | Formatted text, images, links |

---

### 📋 BLOG-002: Create Blog (Admin)

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Blogs → Create | Blog editor opens |
| 2 | Fill title | "Advanced Oyster Cultivation" entered |
| 3 | Fill content | Rich text with formatting |
| 4 | Upload cover image | Image previewed |
| 5 | Add tags | "oyster, cultivation, tips" added |
| 6 | Set slug | Auto-generated or custom |
| 7 | Set status "Draft" | Saved, not public |
| 8 | Publish | Status → "Published", visible on frontend |

---

### 📋 BLOG-003: Edit Blog

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Blogs, click "Edit" | Blog editor opens with existing content |
| 2 | Change title | Updated |
| 3 | Add content | Appended |
| 4 | Save | Changes persisted |
| 5 | Verify on frontend | Blog shows updated content |

---

### 📋 BLOG-004: Delete Blog

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Admin → Blogs, click "Delete" on blog | Confirmation dialog |
| 2 | Confirm deletion | Blog deleted |
| 3 | Verify blog no longer on frontend | Blog removed from list |

---

### 📋 BLOG-005: Blog Comments (If Implemented)

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Buyer viewing blog | Comments section visible |
| 2 | Enter comment | Input field visible |
| 3 | Submit comment | Comment posted (pending approval if moderated) |
| 4 | Admin approves comment | Comment visible to public |
| 5 | Delete comment | Admin can delete inappropriate comments |

---

## Payment Processing

### 📋 PAYMENT-001: Razorpay Integration

**Preconditions:**
- Razorpay API keys configured
- Test/live mode set correctly

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Place order | Razorpay modal opens |
| 2 | Verify order details in modal | Amount, description correct |
| 3 | Click "Pay Now" | Razorpay form displayed |
| 4 | Enter test card details | 4111 1111 1111 1111 (test card) |
| 5 | Complete payment | Payment successful |
| 6 | Verify webhook received | Backend updated order with payment_id |
| 7 | Redirect to confirmation | Order marked as paid |

**Test Cards:**
```
Success: 4111 1111 1111 1111
Failed: 4000 0000 0000 0002
CVV: Any 3 digits
Expiry: Any future date
```

---

### 📋 PAYMENT-002: Payment Failure Handling

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Enter failed test card | 4000 0000 0000 0002 |
| 2 | Submit payment | Razorpay declines |
| 3 | User sees error | "Payment failed. Please try again." |
| 4 | User can retry | Payment modal remains open |
| 5 | Order not created until payment succeeds | No order in database yet |

---

### 📋 PAYMENT-003: Payment Timeout

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Razorpay modal opens | Waiting for payment |
| 2 | Close modal without paying | Order abandoned |
| 3 | Return to checkout | Cart still has items |
| 4 | Retry checkout | Can place order again |

---

### 📋 PAYMENT-004: Webhook Security

**Test:** Verify webhook signature validation

```javascript
// ✅ Valid webhook accepted
const signature = generateRazorpaySignature(webhookBody, razorpaySecret);
const response = await api('/payment/webhook', {
  method: 'POST',
  body: webhookBody,
  headers: { 'X-Razorpay-Signature': signature }
});
expect(response.success).toBe(true);

// ✅ Invalid signature rejected
const invalidSignature = 'fake_signature';
const response = await api('/payment/webhook', {
  method: 'POST',
  body: webhookBody,
  headers: { 'X-Razorpay-Signature': invalidSignature }
});
expect(response.status).toBe(401);
```

---

## Search & Filtering

### 📋 SEARCH-001: Full-Text Search

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click search bar | Search input focused |
| 2 | Type "oyster" | Real-time suggestions dropdown |
| 3 | Verify dropdown shows matching products | "Oyster Spawn", "Oyster Kit" listed |
| 4 | Click suggestion → product detail | Correct product shown |
| 5 | Search with partial word "spawn" | All spawn products appear |
| 6 | Search with case variations "OySteR" | Still finds "oyster" (case-insensitive) |

---

### 📋 SEARCH-002: No Results Search

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Search "xyzabc" (non-existent) | "No results found" message |
| 2 | Suggestion to browse all products | "Browse all products" link shown |

---

### 📋 SEARCH-003: Advanced Filters

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Home page → Filters sidebar | Multiple filter options |
| 2 | Select category "Fresh" | Products filtered |
| 3 | Select price range $50-$500 | Filtered by price |
| 4 | Select rating "4+ stars" | High-rated products |
| 5 | Combine all filters | All filters applied simultaneously |
| 6 | Clear all filters | All products shown again |

---

## Profile & Account Management

### 📋 PROFILE-001: View User Profile

**Preconditions:**
- Buyer logged in

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click user icon → "Profile" | Profile page opens |
| 2 | Verify user details | Name, email, phone, role |
| 3 | Verify account info | Account creation date, status |
| 4 | Verify saved addresses | List of addresses or "No addresses" |

---

### 📋 PROFILE-002: Update Profile Information

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Edit Profile" | Profile edit form |
| 2 | Change full name | "John Doe" → "Jane Doe" |
| 3 | Change phone number | Updated |
| 4 | Save | Changes persisted |
| 5 | Reload page | Changes still visible (verified from DB) |

---

### 📋 PROFILE-003: Save Multiple Delivery Addresses

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Add Address" | Address form opens |
| 2 | Fill address details | All fields populated |
| 3 | Click "Save Address" | Address added to list |
| 4 | Add another address | Second address added |
| 5 | Mark as default | Selected address marked with star |
| 6 | During checkout → address dropdown | Both addresses available |
| 7 | Edit address | Form opens, can modify |
| 8 | Delete address | Address removed from list |

---

### 📋 PROFILE-004: Change Password

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Profile → "Change Password" | Password change form |
| 2 | Enter old password | Current password verified |
| 3 | Enter new password (min 8 chars, mixed case) | Validation passed |
| 4 | Confirm new password | Match verified |
| 5 | Submit | Password changed |
| 6 | Try login with old password | Login fails |
| 7 | Login with new password | Login succeeds |

---

## Notifications & SSE (Server-Sent Events)

### 📋 SSE-001: Real-Time Order Status Updates

**Preconditions:**
- Order placed and confirmed
- Buyer on order tracking page

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Buyer viewing order tracking page | SSE connection established |
| 2 | Admin marks order as "Shipped" | Backend sends SSE event |
| 3 | Buyer's page updates in real-time | Order status changes to "Shipped" without refresh |
| 4 | Verify notification toast shown | "Order shipped!" toast appears |

**Backend Event:**
```javascript
sendSseEvent(userId, {
  type: 'order_status_update',
  orderId: orderId,
  newStatus: 'Shipped',
  message: 'Your order has been shipped!'
});
```

---

### 📋 SSE-002: SSE Connection Management

**Test Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Buyer logged in, SSE connected | Connection established |
| 2 | Close browser tab | Connection closes |
| 3 | Reopen site | New SSE connection established |
| 4 | Buyer logs out | SSE connection closed |
| 5 | Admin sends event while buyer offline | Event queued or discarded appropriately |

---

## Critical Bugs & Issues

### 🔴 CRITICAL (P0) — Immediate Action Required

---

#### **[BUG-001] Real Supabase Service Role Key Committed to Git**

| Field | Value |
|-------|-------|
| **File** | `backend/.env` |
| **Category** | Security — Credential Leakage |
| **Severity** | CRITICAL (CVSS 10.0) |
| **Status** | ⚠️ **STILL ACTIVE** |

**Description:**
The `.env` file contains real Supabase credentials committed to the git repository:
- `SUPABASE_URL` = `nqpjzxzrdeucherewatt.supabase.co` (real project)
- `SUPABASE_SERVICE_ROLE_KEY` = full admin access token
- `SUPABASE_ANON_KEY` = public key
- `SUPABASE_DB_PASSWORD` = raw database password

These credentials are visible in git history and can give attackers full database access, ability to delete data, modify users, and compromise all customer data.

**Impact:**
- Anyone with repo access can read all customer PII
- Attackers can modify orders, delete products, create fraudulent transactions
- Potential GDPR/compliance violations
- Complete database compromise

**Fix Required:**
```bash
# 1. Immediately rotate all Supabase keys
# Go to Supabase dashboard → Settings → API Keys → Rotate

# 2. Remove .env from git history
git rm --cached backend/.env
git filter-branch --tree-filter 'rm -f backend/.env' -- --all
git push --force-with-lease

# 3. Add to .gitignore
echo "backend/.env" >> .gitignore

# 4. Use environment variables for CI/CD
# Add to GitHub Secrets, GitLab CI/CD Variables, etc.

# 5. Audit git logs for any other exposed keys
git log -p backend/.env | grep -E 'SUPABASE_|postgres'
```

**Test:**
```javascript
// ✅ Verify .env not in git history
const hasEnv = await runCommand('git log --all -p backend/.env | wc -l');
expect(hasEnv).toBe(0);

// ✅ Verify CORS and rate limiting active
const response = await api('/products', { origin: 'http://attacker.com' });
expect(response.status).toBe(403); // CORS blocked
```

---

#### **[BUG-002] OTP Always Returned in API Response**

| Field | Value |
|-------|-------|
| **File** | `backend/src/services/authService.js:48` |
| **Category** | Security — Authentication Bypass |
| **Severity** | CRITICAL (CVSS 9.8) |
| **Status** | ⚠️ **STILL ACTIVE** |

**Description:**
The `generateAndSendOTP()` endpoint always returns the generated OTP in the response body, regardless of environment:

```javascript
return {
  success: true,
  message: `OTP sent successfully to ${emailLower}`,
  otp: generatedOtp,  // ← ALWAYS returned
};
```

In production, an attacker can:
1. Call `/api/auth/request-otp` with any email
2. Receive the actual OTP in the response
3. Call `/api/auth/verify-otp` with that OTP
4. Gain access to any account without email access

**Attack Scenario:**
```bash
# Attacker calls:
curl -X POST http://api/auth/request-otp \
  -d '{"email":"admin@sporekart.com"}'

# Response includes:
{ "success": true, "otp": "483921", ... }

# Attacker immediately verifies:
curl -X POST http://api/auth/verify-otp \
  -d '{"email":"admin@sporekart.com","otpCode":"483921"}'

# Attacker gains JWT token for admin account
```

**Fix Required:**
```javascript
// authService.js:44-49
return {
  success: true,
  message: `OTP sent successfully to ${emailLower}`,
  ...(process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
    ? { otp: generatedOtp }  // Only in dev/test
    : {}),
};
```

**Test:**
```javascript
// ✅ OTP not exposed in production
const response = await api('/auth/request-otp', {
  email: 'test@test.com',
  NODE_ENV: 'production'
});
expect(response.otp).toBeUndefined();

// ✅ OTP visible in dev mode
const devResponse = await api('/auth/request-otp', {
  email: 'test@test.com',
  NODE_ENV: 'development'
});
expect(devResponse.otp).toBeDefined();
```

---

#### **[BUG-003] No Input Validation on Product Update Endpoint**

| Field | Value |
|-------|-------|
| **File** | `backend/src/routes/products.js:89` |
| **Category** | Security — Missing Input Validation |
| **Severity** | CRITICAL (CVSS 8.8) |
| **Status** | ⚠️ **STILL ACTIVE** |

**Description:**
`PUT /api/products/:id` has no `validateBody()` middleware, while `POST /api/products` (line 52) has full Joi validation. This allows:
- Injecting arbitrary fields into product documents
- Setting invalid field types
- NoSQL injection through nested objects
- Corrupting product data

**Current Code (VULNERABLE):**
```javascript
router.put("/:id", authMiddleware, adminOnly, async (req, res) => {
  const updated = await productService.updateProduct(req.params.id, req.body);
  // req.body has NO validation — any field accepted
```

**Proper Code (POST endpoint - SAFE):**
```javascript
router.post(
  "/",
  authMiddleware,
  adminOnly,
  validateBody(Joi.object({
    name: Joi.string().required(),
    price: Joi.number().required(),
    category: Joi.string().required(),
    // ... all fields validated
  })),
  async (req, res) => { ... }
```

**Fix Required:**
```javascript
router.put(
  "/:id",
  authMiddleware,
  adminOnly,
  validateBody(Joi.object({
    name: Joi.string().optional(),
    description: Joi.string().optional(),
    price: Joi.number().optional(),
    category: Joi.string().optional(),
    mrp_price: Joi.number().optional(),
    image_url: Joi.string().uri().optional().allow(""),
    gst_rate: Joi.number().optional(),
    stock: Joi.number().optional(),
    // ... same as POST endpoint
  })),
  async (req, res) => {
    const updated = await productService.updateProduct(req.params.id, req.body);
    return success(res, updated);
  }
);
```

**Test:**
```javascript
// ✅ Invalid price rejected
const response = await api('/products/prod-1', {
  method: 'PUT',
  headers: { Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ price: 'not-a-number' })
});
expect(response.status).toBe(400);
expect(response.error).toContain('price must be a number');

// ✅ Arbitrary fields rejected
const response = await api('/products/prod-1', {
  method: 'PUT',
  headers: { Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ malicious_field: 'value' })
});
expect(response.status).toBe(400);
```

---

#### **[BUG-004] No Input Validation on Blog CRUD**

| Field | Value |
|-------|-------|
| **File** | `backend/src/routes/blogs.js:42,55,68,81` |
| **Category** | Security — Missing Input Validation |
| **Severity** | CRITICAL (CVSS 8.8) |
| **Status** | ⚠️ **STILL ACTIVE** |

**Description:**
ALL blog admin routes (`POST`, `PUT`, `DELETE`, `GET by slug`) use `authMiddleware` + `adminOnly` but **NONE** use `validateBody()`:

```javascript
// blogs.js:42 — NO validation
router.post("/", authMiddleware, adminOnly, async (req, res) => {
  const blog = await blogService.createBlog(req.body);
  // req.body.content could contain anything — XSS, injection, etc.
});

router.put("/:slug", authMiddleware, adminOnly, async (req, res) => {
  // Same issue — no validation
});
```

**Attack Scenario:**
```javascript
// Attacker (as admin) creates blog with malicious content:
const maliciousBlog = {
  title: "My Blog",
  content: "<img src=x onerror='alert(document.cookie)'>",
  slug: "my-blog",
  status: "published"
};

// Frontend renders content without sanitization
// → XSS attack triggers when users view blog
```

**Fix Required:**
```javascript
const blogSchema = Joi.object({
  title: Joi.string().required().max(255),
  content: Joi.string().required(),
  slug: Joi.string().required().pattern(/^[a-z0-9-]+$/),
  status: Joi.string().valid('draft', 'published', 'archived'),
  tags: Joi.array().items(Joi.string()).max(10),
});

router.post("/", authMiddleware, adminOnly, validateBody(blogSchema), async (req, res) => {
  // Now validated
});

router.put("/:slug", authMiddleware, adminOnly, validateBody(blogSchema), async (req, res) => {
  // Now validated
});
```

**Test:**
```javascript
// ✅ Invalid slug rejected
const response = await api('/blogs', {
  method: 'POST',
  headers: { Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({
    title: "Test",
    content: "Content",
    slug: "invalid_slug"  // Underscores not allowed
  })
});
expect(response.status).toBe(400);
```

---

#### **[BUG-005] Admin Login Fails with Supabase Live Mode**

| Field | Value |
|-------|-------|
| **File** | `backend/src/services/authService.js:140-173` |
| **Category** | Integration — Live DB Issue |
| **Severity** | CRITICAL (P0) |
| **Status** | ⚠️ **STILL ACTIVE** |

**Description:**
In live Supabase mode, `adminLogin()` tries to authenticate using Supabase Auth:

```javascript
adminLogin(email, password) {
  // Live mode: uses supabaseAnon.auth.signInWithPassword()
  // But admin credentials only exist in mock DB, not in Supabase Auth
  return supabaseAnon.auth.signInWithPassword({
    email: 'admin@sporekart.com',  // Not registered in Supabase Auth
    password: 'admin123'
  });
  // → Always fails in live mode
}
```

**Impact:**
- Admin cannot log in when using live Supabase
- Only works in mock mode (test)
- Blocks admin functionality in staging/production if live DB used

**Fix Required:**
```javascript
adminLogin(email, password) {
  // Always use local password comparison, not Supabase Auth
  const adminUser = this.db('admin_users').where({ email }).first();
  if (!adminUser) throw new AppError('Admin not found', 401);
  
  const passwordValid = bcrypt.compareSync(password, adminUser.password_hash);
  if (!passwordValid) throw new AppError('Invalid password', 401);
  
  return {
    token: jwt.sign({ id: adminUser.id, role: 'admin', email }, JWT_SECRET, { expiresIn: '24h' }),
    user: { id: adminUser.id, email, role: 'admin' }
  };
}
```

**Test:**
```javascript
// ✅ Admin login works in both modes
const token = await api('/auth/admin-login', {
  method: 'POST',
  body: JSON.stringify({
    email: 'admin@sporekart.com',
    password: 'admin123'
  })
});
expect(token).toBeDefined();
```

---

#### **[BUG-006] Vite Proxy Backend Port Mismatch**

| Field | Value |
|-------|-------|
| **Files** | `frontend/vite.config.js:5` + `backend/src/server.js:23` |
| **Category** | Integration — Port Configuration |
| **Severity** | CRITICAL (P0) |
| **Status** | ✅ **PARTIALLY FIXED** (kill-port-5000.js added) |

**Description:**
- Vite proxy hardcoded to `http://localhost:5000`
- Backend tries port 5000, then 5001, 5002, etc. if busy
- If port 5000 occupied, proxy can't reach backend
- All API calls fail with 500/ECONNREFUSED

**Example Failure:**
```
Frontend: http://localhost:3000
Vite proxy target: http://localhost:5000
Backend: Actually running on http://localhost:5002 (port 5000 was busy)
Result: API call fails → "Failed to load resource: 500"
```

**Partial Fix Applied:**
```bash
# kill-port-5000.js now runs before backend startup
# But Vite config still hardcoded to port 5000
```

**Complete Fix Required:**
```javascript
// vite.config.js — add dynamic port detection
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path
      }
    }
  }
});

// package.json — pass BACKEND_URL
{
  "scripts": {
    "dev": "node scripts/kill-port-5000.js && cross-env BACKEND_URL=http://localhost:5000 vite",
  }
}
```

**Test:**
```bash
# ✅ Verify port 5000 is free
lsof -i :5000  # Should output nothing

# ✅ Verify Vite proxy works
curl http://localhost:3000/api/products  # Should proxy to backend correctly
```

---

#### **[BUG-007] Missing CORS Origin for Frontend Port**

| Field | Value |
|-------|-------|
| **File** | `backend/src/server.js:31-33` |
| **Category** | Integration — CORS Configuration |
| **Severity** | CRITICAL (P1) |
| **Status** | ⚠️ **PARTIALLY FIXED** (regex pattern added) |

**Description:**
CORS allows only specific ports:
- `localhost:3000` ✅
- `localhost:5500` (Live Server)

When frontend runs on `localhost:3002` or other ports, CORS fails:
```
Access to XMLHttpRequest blocked by CORS policy
Origin 'http://localhost:3002' is not allowed
```

**Current Config:**
```javascript
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [specific URLs] // CORS locked down
  : [
      /^http:\/\/localhost:\d+$/,  // ← Now allows any localhost port (FIXED)
      /^http:\/\/127\.0\.0\.1:\d+$/,
    ];
```

**Status:** ✅ Mostly fixed — regex pattern allows any localhost port in dev

**Remaining Issue:**
- Production CORS still needs careful configuration
- Needs env var for allowed production origins

**Test:**
```javascript
// ✅ CORS allows localhost on any port
const response = await fetch('http://localhost:3000/api/products', {
  headers: { 'Origin': 'http://localhost:3002' }
});
expect(response.headers['access-control-allow-origin']).toContain('localhost');
```

---

### 🟡 HIGH (P1) — Must Fix Before Production

---

#### **[BUG-008] Email OTP Contact Wrong in handleVerifyOtp (Fixed)**

**Status:** ✅ **FIXED**

| Field | Value |
|-------|-------|
| **File** | `frontend/src/components/AuthModal.js:569-572` |
| **Previous Code** | Used `this.emailInput?.value.trim()` as fallback |
| **Fix Applied** | Use `this._pendingContact` exclusively |

**What was wrong:**
```javascript
// BEFORE (WRONG):
const contact = this.activeMethod === 'phone'
  ? this._mockPhoneEmail || this.emailInput?.value.trim()
  : this._pendingContact || this.emailInput?.value.trim();  // ← Fallback could return wrong value

// AFTER (CORRECT):
const contact = this.activeMethod === 'phone'
  ? this._mockPhoneEmail || this._pendingContact
  : this._pendingContact;  // Always use _pendingContact
```

**Test:**
```javascript
// ✅ Email OTP verification uses correct contact
const contact = await page.evaluate(() => {
  return window.authModal._pendingContact;
});
expect(contact).toBe(testEmail);
```

---

#### **[BUG-009] OTP Extract from Response (Fixed)**

**Status:** ✅ **FIXED**

| Field | Value |
|-------|-------|
| **File** | `test_e2e.js:63` |
| **Previous Code** | Hardcoded `otpCode: '123456'` |
| **Fix Applied** | Extract from response dynamically |

**What was wrong:**
```javascript
// BEFORE (ALWAYS FAILS):
const verifyRes = await api('/auth/verify-otp', {
  method: 'POST',
  body: JSON.stringify({ email: testEmail, otpCode: '123456' })  // ← Wrong!
});

// AFTER (CORRECT):
const otpRes = await api('/auth/request-otp', { ... });
const verifyRes = await api('/auth/verify-otp', {
  method: 'POST',
  body: JSON.stringify({ email: testEmail, otpCode: otpRes.otp })  // ← Dynamic
});
```

---

#### **[BUG-010] Admin Password Hardcoded Wrong (Fixed)**

**Status:** ✅ **FIXED**

| Field | Value |
|-------|-------|
| **File** | `test_e2e.js:213` |
| **Previous Code** | Password: `'123456'` |
| **Fix Applied** | Password: `'admin123'` |

---

#### **[BUG-011] Rate Limiter Too Aggressive in Dev (Fixed)**

**Status:** ✅ **FIXED**

| Field | Value |
|-------|-------|
| **File** | `backend/src/server.js:51-57` |
| **Previous Code** | Rate limiter always enabled |
| **Fix Applied** | Disabled in dev/test mode |

```javascript
// Rate limiters now disabled in dev/test mode
const isDevOrTest = process.env.NODE_ENV === 'test';
const otpLimiter = isDevOrTest
  ? (req, res, next) => next()  // Bypass in dev/test
  : rateLimit({ ... });
```

---

#### **[BUG-012] Invalid Form Control Warning (Fixed)**

**Status:** ✅ **FIXED**

| Field | Value |
|-------|-------|
| **File** | `frontend/index.html` |
| **Issue** | Hidden form with `required` fields caused browser warning |
| **Fix Applied** | Added `novalidate` to form |

```html
<!-- BEFORE:
<form id="training-register-form" ...> -->

<!-- AFTER: -->
<form id="training-register-form" novalidate>
```

---

#### **[BUG-013] Product/Category/Blog Update Missing Validation (Active)**

**Status:** ⚠️ **STILL ACTIVE**

**Files:**
- `backend/src/routes/products.js:89` — PUT /products/:id
- `backend/src/routes/categories.js:71` — PUT /categories/:slug
- `backend/src/routes/blogs.js:55,68` — PUT /blogs, DELETE /blogs

**Issue:** No `validateBody()` on PUT/DELETE routes

**Fix Needed:** Add same Joi schema validation as POST routes

---

### 🟡 MEDIUM (P2) — Should Fix

---

#### **[BUG-014] Training Schema Mismatch Between SQL and Mock**

| Field | Value |
|-------|-------|
| **Files** | `backend/supabase_setup.sql` vs `backend/src/config/db.js` |
| **Issue** | Mock data has extra fields not in SQL schema |
| **Severity** | MEDIUM (P2) |
| **Status** | ⚠️ **ACTIVE** |

**Schema Mismatch:**
```javascript
// SQL schema has:
id, title, category, description, image_url, content_url, allowed_roles

// Mock data adds:
training_id, start_date, end_date, duration_days, price_strikeout, price_actual

// When switching from mock to live Supabase, queries for extra fields will fail
```

**Fix Required:**
Option 1: Add missing fields to SQL schema
```sql
ALTER TABLE trainings ADD COLUMN training_id TEXT UNIQUE;
ALTER TABLE trainings ADD COLUMN start_date DATE;
ALTER TABLE trainings ADD COLUMN end_date DATE;
ALTER TABLE trainings ADD COLUMN duration_days INT;
ALTER TABLE trainings ADD COLUMN price_strikeout NUMERIC;
ALTER TABLE trainings ADD COLUMN price_actual NUMERIC;
```

Option 2: Remove extra fields from mock
```javascript
// Remove training_id, start_date, etc. from mock data
```

---

#### **[BUG-015] Order user_email Field Handling**

| Field | Value |
|-------|-------|
| **File** | `test_e2e.js:243` |
| **Issue** | Order response may not include `user_email` |
| **Severity** | MEDIUM (P2) |
| **Status** | ✅ **FIXED** (fallback added) |

**What was wrong:**
```javascript
// BEFORE: Always expects user_email
const userEmail = order.user_email;

// AFTER: Fallback to customer_email
const userEmail = order.user_email || order.customer_email;
```

---

#### **[BUG-016] Admin Test Selectors Mismatch (Fixed)**

| Field | Value |
|-------|-------|
| **File** | `test_full.js` (frontend tests) |
| **Issue** | DOM selectors didn't match actual HTML |
| **Severity** | MEDIUM (P2) |
| **Status** | ✅ **FIXED** (fallback selectors added) |

---

### 🟢 LOW (P3) — Minor / Cosmetic

---

#### **[BUG-017] Missing Email WhatsApp Field Default**

| Field | Value |
|-------|-------|
| **File** | `backend/src/services/authService.js` |
| **Issue** | `whatsappNumber` not set to empty string on email signup |
| **Severity** | LOW (P3) |
| **Status** | ⚠️ **ACTIVE** |

**Impact:** Frontend shows `null` instead of empty string for buyers who sign up via email

**Fix:**
```javascript
const newUser = {
  email: emailLower,
  full_name: fullName,
  role,
  phone: '', // Empty for email signups
  whatsapp_number: '',  // ← Default to empty string
  address: ''
};
```

---

#### **[BUG-018] Cart Not Updated When Product Price Changes**

| Field | Value |
|-------|-------|
| **Issue** | Cart stored in localStorage doesn't reflect price updates |
| **Severity** | LOW (P3) |
| **Impact** | User pays old price if admin reduces price after cart added |

**Fix:** On checkout, validate cart item prices against current DB prices

---

## Security Issues

### 🔐 [SEC-001] Service Role Key Exposed (See BUG-001)

### 🔐 [SEC-002] OTP Authentication Bypass (See BUG-002)

### 🔐 [SEC-003] Product Update Missing Validation (See BUG-003)

### 🔐 [SEC-004] Blog CRUD Missing Validation (See BUG-004)

### 🔐 [SEC-005] Missing Rate Limiting on Sensitive Endpoints

**Issue:** Some endpoints not rate-limited:
- `/api/search` — Could be abused for enumeration
- `/api/products` — DoS attack vector
- `/api/trainings` — Resource exhaustion

**Fix:** Apply rate limiting:
```javascript
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,  // 30 requests per minute
});
app.use('/api/search', searchLimiter);
app.use('/api/products', rateLimit({ windowMs: 60 * 1000, max: 100 }));
```

### 🔐 [SEC-006] No HTTPS Enforced in Production

**Issue:** Backend doesn't force HTTPS in production, allowing MITM attacks

**Fix:**
```javascript
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

### 🔐 [SEC-007] XSS in Blog Content (Requires Sanitization)

**Issue:** Blog content rendered without sanitization

**Fix:**
```javascript
const DOMPurify = require('isomorphic-dompurify');

// On blog creation/update:
req.body.content = DOMPurify.sanitize(req.body.content, { 
  ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a', 'img', 'h1', 'h2', 'h3'],
  ALLOWED_ATTR: ['href', 'src', 'alt'] 
});
```

### 🔐 [SEC-008] SQL Injection Prevention Not Verified

**Issue:** Using Supabase ORM but need to verify parameterized queries

**Fix:** Audit all database queries to ensure:
```javascript
// GOOD (parameterized):
db.from('users').select('*').eq('id', userId);

// BAD (concatenation):
db.raw(`SELECT * FROM users WHERE id = ${userId}`);  // ← NEVER do this
```

### 🔐 [SEC-009] Missing Content Security Policy (CSP)

**Fix:**
```javascript
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],  // Tighten as needed
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc: ["'self'", "data:", "https:"],
  }
}));
```

---

## Performance & Load Testing

### 📊 PERF-001: Frontend Load Time

**Test Steps:**

| Metric | Target | Test |
|--------|--------|------|
| First Contentful Paint (FCP) | < 2s | Use Lighthouse |
| Largest Contentful Paint (LCP) | < 2.5s | Use Web Vitals |
| Cumulative Layout Shift (CLS) | < 0.1 | Monitor during interactions |
| Time to Interactive (TTI) | < 3.5s | DevTools Performance tab |

**Command:**
```bash
npm install -g lighthouse
lighthouse http://localhost:3000 --view
```

---

### 📊 PERF-002: API Response Time

**Test:**

| Endpoint | Target | Current |
|----------|--------|---------|
| GET /products | < 200ms | ? |
| POST /orders | < 500ms | ? |
| GET /auth/me | < 100ms | ? |
| POST /payment/webhook | < 1s | ? |

**Measurement:**
```javascript
const start = performance.now();
const response = await api('/products');
const duration = performance.now() - start;
console.log(`/products took ${duration}ms`);
```

---

### 📊 PERF-003: Database Query Performance

**Test:**

| Query | Max Duration | Indexed? |
|-------|--------------|----------|
| List 100 products | < 50ms | need index on `category` |
| Get user with orders | < 100ms | need JOIN optimization |
| Search products | < 200ms | need fulltext index |

**Command (Supabase):**
```sql
EXPLAIN ANALYZE SELECT * FROM products WHERE category = 'spawn';
-- Check if uses index scan (fast) or seq scan (slow)
```

---

### 📊 PERF-004: Load Testing (100 concurrent users)

**Tool:** Artillery

```yaml
# load-test.yml
config:
  target: "http://localhost:5000"
  phases:
    - duration: 60
      arrivalRate: 10  # 10 new users per second
      name: "Ramp-up"
    - duration: 120
      arrivalRate: 10
      name: "Sustained"

scenarios:
  - name: "Homepage + Product Browse"
    flow:
      - get:
          url: "/api/products"
      - think: 5
      - get:
          url: "/api/products/prod-1"
      - think: 3
```

**Run:**
```bash
npm install -g artillery
artillery run load-test.yml
```

**Metrics:**
- Median response time < 500ms
- P99 response time < 2s
- Error rate < 0.1%

---

### 📊 PERF-005: Memory Leak Detection

**Test:**

```javascript
// Run E2E tests and monitor memory usage
const initialMem = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Initial heap: ${initialMem} MB`);

// Simulate 1000 page loads
for (let i = 0; i < 1000; i++) {
  await page.goto('http://localhost:3000');
  await page.goto('http://localhost:3000/admin.html');
}

// Check if memory has grown excessively
const finalMem = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Final heap: ${finalMem} MB`);
const memoryGrowth = finalMem - initialMem;
expect(memoryGrowth).toBeLessThan(100); // Less than 100 MB growth
```

---

## Test Reporting & Metrics

### Test Results Template

```markdown
# Test Execution Report — [Date]

## Summary
- Total Tests: 150
- Passed: 145 ✅
- Failed: 5 ❌
- Skipped: 0

## Critical Issues Found
1. [BUG-001] Service key exposed — **MUST FIX**
2. [BUG-002] OTP bypass — **MUST FIX**

## High Priority Issues
1. [BUG-003] Product validation missing
2. [BUG-005] Admin login fails on live DB

## Test Coverage
- Auth flows: 8/8 (100%)
- Product management: 7/7 (100%)
- Checkout: 6/6 (100%)
- Admin dashboard: 7/7 (100%)
- Payments: 4/4 (100%)
- Security: 9/10 (90%)
  - Missing: HTTPS enforcement test

## Performance Metrics
- Avg FCP: 1.8s (Target: <2s) ✅
- Avg LCP: 2.2s (Target: <2.5s) ✅
- Avg API response: 180ms (Target: <200ms) ✅

## Next Steps
1. Fix security issues (3 days)
2. Fix high priority bugs (2 days)
3. Retest all flows
4. Load testing (1 day)
5. Security audit (2 days)
```

---

## Summary

**Total Test Scenarios:** 150+  
**Bug Severity Breakdown:**
- 🔴 Critical (P0): 7
- 🟡 High (P1): 6
- 🟡 Medium (P2): 3
- 🟢 Low (P3): 2
- 🔐 Security Issues: 9

**Estimated Test Execution Time:**
- Unit/Integration Tests: 30 min
- E2E Tests (All flows): 2-3 hours
- Load/Performance Tests: 1 hour
- Security Tests: 1 hour
- **Total:** ~5-6 hours

---

**Generated:** 2026-06-25  
**Last Updated:** 2026-06-25
