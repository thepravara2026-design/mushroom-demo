# 🍄 Mushroom Shop — Comprehensive E2E Testing Analysis Report

**Date:** June 18, 2026  
**Project:** Sporekart (Mushroom Shop)  
**Backend:** Express.js (port 5000-5002)  
**Frontend:** Vite + Vanilla JS (port 3000-3002)  
**Database:** Supabase/PostgreSQL (mock in-memory fallback)  

---

## 1. Database Schema Analysis

### Tables Defined in `supabase_setup.sql` (9 tables)

| Table | Status | Notes |
|-------|--------|-------|
| `users` | ✅ Present | Text PK, email UNIQUE, password_hash, full_name, etc. |
| `categories` | ✅ Present | Text PK, category_id UNIQUE, name, description, image_url |
| `products` | ✅ Present | Text PK, FK to categories(id), price/mrp_price numeric |
| `orders` | ✅ Present | Text PK, FK to users(id), JSONB items, rich status/payment fields |
| `settings` | ✅ Present | Simple key-value store |
| `trainings` | ✅ Present | Text PK, JSONB allowed_roles |
| `blogs` | ✅ Present | Text PK, unique slug, CHECK status constraint |
| `refunds` | ✅ Present | Text PK, FK to orders(id), FK to users(id) |
| `enrollments` | ✅ Present | Text PK, FK to trainings(id), FK to users(id), UNIQUE constraint |

### Mock Store Collections in `db.js` (matches all 9 tables)

| Collection | Status | Notes |
|------------|--------|-------|
| `users` | ✅ 5 seeded | buyer@, buyer@short, grower@, admin@, admin@short |
| `categories` | ✅ 4 seeded | fresh, dry, spawn, kits |
| `products` | ✅ 9 seeded | 4 spawn, 2 fresh, 2 dry, 1 kit |
| `orders` | ✅ Empty | Populated during test runs |
| `settings` | ✅ 1 entry | shipping_charge = 50 |
| `trainings` | ✅ 6 seeded | Extra fields: training_id, start_date, end_date, price_*, duration_days |
| `blogs` | ✅ 3 seeded | All published |
| `refunds` | ✅ Empty | |
| `enrollments` | ✅ 2 seeded | train-1→user-buyer, train-5→user-buyer |

### Schema Mismatch: Training fields differ between SQL and mock

- `supabase_setup.sql` has: id, title, category, description, image_url, content_url, allowed_roles
- `db.js` mock adds: training_id, start_date, end_date, duration_days, price_strikeout, price_actual
- These extra fields don't exist in the SQL schema but are used by the mock. **If switching from mock to live Supabase, training queries expecting these extra fields will fail.**

---

## 2. Critical Bugs Found in E2E Testing Flow

### 🔴 CRITICAL: Bug 1 — test_e2e.js Hardcodes Wrong OTP

**File:** `test_e2e.js` (line 63)
```js
body: JSON.stringify({ email: testEmail, otpCode: '123456' }),
```
**Problem:** The backend generates a **random 6-digit OTP** in `authService.generateAndSendOTP()`. The test ignores the OTP returned from `request-otp` and hardcodes `'123456'`, which **always fails**.

**Evidence from test run:**
```
✅ OTP requested: {"success":true,"otp":"884874"}
❌ FAIL: OTP verify failed: [400] Invalid OTP code.
```

**Fix:** Extract the OTP from the `request-otp` response and use it:
```js
const otpRes = await api('/auth/request-otp', { ... });
const verifyRes = await api('/auth/verify-otp', {
  method: 'POST',
  body: JSON.stringify({ email: testEmail, otpCode: otpRes.otp }),
});
```

---

### 🔴 CRITICAL: Bug 2 — test_e2e.js Admin Login Uses Wrong Password

**File:** `test_e2e.js` (line 211-213)
```js
body: JSON.stringify({ email: 'admin@sporekart.com', password: '123456' }),
```
**Problem:** The admin user's password is `admin123` (seeded with bcrypt hash). Using `'123456'` will fail bcrypt comparison in mock mode.

**Fix:** Change password to `'admin123'`:
```js
body: JSON.stringify({ email: 'admin@sporekart.com', password: 'admin123' }),
```

---

### 🔴 CRITICAL: Bug 3 — All test_login_flow.js Authentications Fail (Auth Token Never Set)

**File:** `test_login_flow.js` (entire file)

**Evidence from ALL 4 test runs:**
```
Auth token: false  // for email, phone, Google, AND admin
```

**Root Cause Chain:**
1. Frontend is on `http://localhost:3000`
2. Vite proxy targets `http://localhost:5000`
3. Backend actually runs on **port 5002** (ports 5000 and 5001 were busy)
4. API calls to `/api/*` fail — proxy can't reach backend
5. Backend returns 500 errors (seen as `Failed to load resource: 500 (Internal Server Error)`)
6. OTP verification never completes → no token stored

**Additional issues in test_login_flow.js:**
- **Admin login (Test 4):** Final URL stays at `http://localhost:3000/`, NOT redirected to `/admin.html`
- **Page errors logged for all 4 tests:** Multiple 500 and 404 errors

**Fix:** 
1. Start backend on port 5000 (kill other processes on that port)
2. OR update Vite proxy to try port 5002 as fallback

---

### 🔴 CRITICAL: Bug 4 — Vite Proxy Backend Port Mismatch

**File:** `frontend/vite.config.js` (line 5)  
**File:** `backend/src/server.js` (line 23)

**Problem:**
- Vite proxy hardcodes target to `http://localhost:5000`
- Backend auto-fallsback to 5001, 5002, etc. when ports are busy
- The proxy `configure` handler detects `ECONNREFUSED` but **does NOT actually try next ports** — it only logs a warning

**Fix options:**
1. **Kill processes on port 5000** before starting backend
2. **Update Vite config** to probe multiple ports and try them
3. **Set `BACKEND_URL` env var** when starting frontend

---

### 🟡 HIGH: Bug 5 — AuthModal.js handleVerifyOtp Uses Wrong Contact for Email

**File:** `frontend/src/components/AuthModal.js` (lines 569-572)
```js
const contact = this.activeMethod === 'phone'
  ? this._mockPhoneEmail || this.emailInput?.value.trim()
  : this._pendingContact || this.emailInput?.value.trim();
```
**Problem:** When `activeMethod !== 'phone'` (i.e., email mode), it uses `this._pendingContact || this.emailInput?.value.trim()`. After switching to verify view, the email input may still be visible but the `_pendingContact` is set in `showVerifyView()`. The **real issue** is the fallback to `this.emailInput?.value.trim()` — after the view has switched, the email field might not be accessible, returning `undefined` or empty string.

**Impact on E2E test_login_flow.js:** The OTP verification is called with `contact` being possibly empty, causing a failed API call.

**Fix:** Remove the fallback. Always use `this._pendingContact`:
```js
const contact = this.activeMethod === 'phone'
  ? this._mockPhoneEmail || this._pendingContact
  : this._pendingContact;
```

---

### 🟡 HIGH: Bug 6 — Backend Returns 500 Errors for Products/Categories in test_login_flow

**Evidence:** Multiple `500 (Internal Server Error)` responses during all test_login_flow runs.

**Root Cause:** The frontend JS makes API calls to `/api/products`, `/api/categories`, etc. These calls hit the Vite proxy which forwards to `http://localhost:5000` (wrong port since backend is on 5002). The proxy returns 500 when connection is refused.

**Fix:** Same as Bug 4 — fix the port mismatch.

---

### 🟡 HIGH: Bug 7 — test_login_flow.js Admin Redirect Fails

**File:** `test_login_flow.js` (lines 225-227)
```js
const url = page.url();
console.log(`Redirected to admin: ${url.includes('admin.html')}`);
```
**Output:** `Redirected to admin: false` — final URL is `http://localhost:3000/`

**Root Cause:** Admin login returns token, but the page redirect happens via `window.location.href = '/admin.html'`. Since admin.html is a **separate HTML file** (not a SPA route), the redirect should work. But if the admin login API call fails (due to port mismatch), no redirect occurs.

---

### 🟡 HIGH: Bug 8 — test_full.js Multiple Element Selector Issues

**File:** `test_full.js`

| Line | Selector | Issue |
|------|----------|-------|
| 41 | `.btn-card-add` | May not match actual DOM class names |
| 49 | `#popup-view-cart` | Element may not exist or have different ID |
| 62 | `#btn-checkout` | May not be the correct checkout button ID |
| 72 | `#checkout-page` | May not be the right selector for checkout page |
| 84-87 | `[data-action="login"]`, `#btn-auth-email` | These are auth modal triggers that may not be visible |

**Fix:** Align selectors with the actual frontend DOM structure.

---

### 🟡 HIGH: Bug 9 — No Proper Error Handling in E2E Tests for Network Failures

**File:** `test_e2e.js` — Uses `.catch((e) => fail(e.message))` which **exits immediately** on failure instead of reporting all failures.

**File:** `test_full.js` — Uses `errors.push()` and continues, good pattern.

**File:** `test_login_flow.js` — Only checks `errors.length` but doesn't fail on errors.

---

### 🟡 MEDIUM: Bug 10 — test_e2e.js Checks Field `user_email` on Order Response

**File:** `test_e2e.js` (line 243)
```js
pass(`Found created order in admin list. Associated buyer email: ${testOrder.user_email}`);
```
**Problem:** The orders response may not include a `user_email` field by default. The `/orders/all-orders` route needs to join with users table to populate this, which depends on mock store implementation.

---

### 🟡 MEDIUM: Bug 11 — Rate Limiter Too Aggressive for Tests

**File:** `backend/src/server.js` (lines 51-57)
```js
const otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many requests. Please try again later." },
});
```

**Evidence from test_login_flow.js run:**
```
429 (Too Many Requests) — Google login test
```

The otpLimiter allows only 5 requests per minute on `/api/auth/request-otp` and `/api/auth/verify-otp`. Running multiple tests sequentially quickly hits the limit.

**Fix:** Increase the limit for development/test or disable rate limiting in dev mode:
```js
const otpLimiter = process.env.NODE_ENV === 'test' 
  ? (req, res, next) => next() 
  : rateLimit({ ... });
```

---

### 🟢 LOW: Bug 12 — BUG_REPORT.md Issues 3, 4, 5, 6 Still Present

- **Bug 3 (handleVerifyOtp wrong contact):** ✅ Confirmed — see Bug 5 above
- **Bug 4 (Mock OTP subtitle):** `showVerifyView()` checks `result.otp`, but frontend `authApi.verifyOtp` correctly unwraps via `fetchWithAuth` which returns `body.data` — so the OTP IS accessible. The OTP pre-fill in `showVerifyView()` works correctly.
- **Bug 5 (Admin login fails):** Confirmed — see Bug 2 above
- **Bug 6 (Invalid form control):** Confirmed — hidden required form fields in `frontend/index.html`

---

## 3. API Response Format Analysis

### Standardized Wrapper: `{ success: boolean, data: any, error?: string }`

Backend wraps all responses:
- Success: `res.json({ success: true, data: { ... } })`
- Error: `res.json({ success: false, error: "message", code: "SERVER_ERROR" })`

### Frontend Unwrapping (fetchWithAuth):
- ✅ Correctly unwraps `body.data` when `body.success === true`
- ✅ Correctly throws on `body.success === false`
- ✅ Retries on 5xx errors

### test_e2e.js Unwrapping (lines 19-21):
- ✅ Correctly unwraps `data.data` when `data.success !== undefined`

### AuthModal.js OTP Handling:
- `handleRequestEmailOtp()` checks `result.otp` — this works because `fetchWithAuth` unwraps `{ success: true, data: { otp: "123456" } }` → returns `{ otp: "123456" }`

---

## 4. Summary of Required Fixes

| # | Severity | Issue | File(s) | Fix |
|---|----------|-------|---------|-----|
| 1 | 🔴 CRITICAL | OTP hardcoded to '123456' in test_e2e.js | `test_e2e.js:63` | Use OTP from request response |
| 2 | 🔴 CRITICAL | Admin password wrong in test_e2e.js | `test_e2e.js:213` | Change to `admin123` |
| 3 | 🔴 CRITICAL | Vite proxy targets wrong port | `frontend/vite.config.js:5` | Correct backend port |
| 4 | 🔴 CRITICAL | Backend port mismatch (5000 vs 5002) | `backend/src/server.js:23` | Free port 5000 or update proxy |
| 5 | 🟡 HIGH | handleVerifyOtp wrong contact for email | `AuthModal.js:569-572` | Use `_pendingContact` only |
| 6 | 🟡 HIGH | Multiple 500 errors from API | All tests | Fix proxy port |
| 7 | 🟡 HIGH | Admin redirect not working | `test_login_flow.js` | Fix API calls first |
| 8 | 🟡 HIGH | Element selectors wrong in test_full.js | `test_full.js` | Match actual DOM |
| 9 | 🟡 HIGH | No proper error reporting | `test_e2e.js` | Use error collection pattern |
| 10 | 🟡 MEDIUM | `user_email` field may not exist | `test_e2e.js:243` | Check orders route |
| 11 | 🟡 MEDIUM | Rate limiter blocks tests | `backend/src/server.js:51` | Disable in test mode |
| 12 | 🟢 LOW | BUG_REPORT.md issues persist | Multiple files | Various fixes |

---

## 5. Test Execution Summary

| Test | Result | Issues |
|------|--------|--------|
| `test_e2e.js` (API-only) | ❌ FAILED | OTP hardcoded to wrong value, admin password wrong |
| `test_login_flow.js` (Puppeteer UI) | ❌ FAILED (all 4 subtests) | Proxy port mismatch → all API calls fail |
| `test_full.js` (Puppeteer) | ❌ FAILED (likely) | Selector mismatches, port issues |
| `test_auth.js` (Puppeteer) | ⚠️ UNKNOWN (not run) | Likely port issues as well |

**Primary blocker for all tests:** Backend is not reachable on port 5000 (it's on 5002), causing all API proxied calls to fail.