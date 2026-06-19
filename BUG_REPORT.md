# Bug Report: Login Flow Test Results

## Test Environment
- Frontend: http://localhost:3002 (Vite dev server)
- Backend: http://localhost:5002 (Express on port 5000 was busy)
- Mode: Supabase Live (not mock)

## Critical Bugs Found

### Bug 1: Vite Proxy Backend Port Mismatch
**File:** `frontend/vite.config.js` 
**Issue:** Vite proxy targets `http://localhost:5000` but backend started on port 5002 (port 5000 was already in use).
**Impact:** All API calls to `/api/*` fail — the Vite proxy can't forward to the wrong port, and the frontend falls back to making direct CORS requests to `http://localhost:5000`, which also fails because the backend isn't there.

### Bug 2: CORS Allowed Origins Missing Port 3002
**File:** `backend/src/server.js` (line 31-33)
**Issue:** Backend CORS allows only `localhost:3000`, `localhost:5000`, `127.0.0.1:5500` but frontend runs on `localhost:3002`.
**Impact:** When the proxy is bypassed, direct API calls fail with CORS errors.

### Bug 3: handleVerifyOtp Uses Wrong Contact for Email
**File:** `frontend/src/components/AuthModal.js` (line 569)
**Issue:** In `handleVerifyOtp()`, the contact for email OTP verification uses `this.emailInput?.value.trim()` instead of `this._pendingContact`. After the view switches to verify view, the email input may not be accessible.

### Bug 4: Mock OTP Subtitle Not Showing Actual OTP
**File:** `frontend/src/components/AuthModal.js` (line 314)
**Issue:** The `showVerifyView()` subtitle shows generic "Enter the 6-digit code sent to your contact" instead of the actual mock OTP, because the backend returns the OTP inside the response wrapper `{ success: true, data: { otp: "123456", ... } }` but the frontend checks `result.otp` at the top level.

### Bug 5: Admin Login Fails with Supabase Live Mode
**File:** `backend/src/services/authService.js` (line 140-173)
**Issue:** In live Supabase mode, `adminLogin()` tries `supabaseAnon.auth.signInWithPassword()` with the mock credentials `admin@sporekart.com` / `admin123`. These are only seeded in the mock store, not in Supabase Auth, so the login fails silently.

### Bug 6: "Invalid form control not focusable" Warning
**File:** `frontend/index.html` (hidden form fields)
**Issue:** When a form with `required` fields is hidden but submitted, Chrome throws "An invalid form control with name='' is not focusable" warning.