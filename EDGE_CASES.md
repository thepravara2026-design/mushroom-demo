# Sporekart E-Commerce — Master Edge Cases Catalog
### Prepared by Principal QA & E-Commerce Automation Engineer

This document catalogs critical edge cases, boundary values, and race conditions across all modules of Sporekart. Each scenario details the steps, expected system behavior, and automated/manual testing approaches.

---

## Table of Contents

1. [Authentication & Session Gating](#1-authentication--session-gating)
2. [Catalog & Fuzzy Search](#2-catalog--fuzzy-search)
3. [Cart & Inventory Reservation](#3-cart--inventory-reservation)
4. [Checkout, Pricing, & Promo Codes](#4-checkout-pricing--promo-codes)
5. [Fulfillment & Shipping Webhooks](#5-fulfillment--shipping-webhooks)
6. [Order State Machine & SSE Notifications](#6-order-state-machine--sse-notifications)
7. [Refund System & Cancellation Gating](#7-refund-system--cancellation-gating)
8. [Grower Training Flow v2 (Batches & Auto-Refunds)](#8-grower-training-flow-v2-batches--auto-refunds)
9. [Admin Operations & Audit Controls](#9-admin-operations--audit-controls)

---

## 1. Authentication & Session Gating

### EC-AUTH-001: OTP Resend Button Spammed Pre-expiration
- **Description:** User spams the "Resend OTP" button continuously or fires automated requests before the resend timer cooldown (30s) finishes.
- **Input / Scenario:** Trigger POST `/api/auth/request-otp` multiple times in under 1 second.
- **Expected System Response:** The server rate-limiter rejects requests after the first one with `429 Too Many Requests` or blocks with a "Wait before requesting a new OTP" message. Prevents SMS provider billing exploitation.
- **Automation Verification:** Write a script firing 10 concurrent requests and verify that $\ge 9$ return HTTP 429.

### EC-AUTH-002: Verification Code Expiration Boundary
- **Description:** User receives a valid OTP but submits it exactly at or 1 second after the expiration duration (e.g., 5 minutes).
- **Input / Scenario:** Verify OTP with timestamp `now > expiresAt`.
- **Expected System Response:** Verification fails, returning `400 Bad Request` or `401 Unauthorized` with "OTP expired. Please request a new one." The OTP token is invalidated.
- **Automation Verification:** Mock system clock in Jest to advance past expiration before verifying, and assert failure response.

### EC-AUTH-003: User Role Parameter Tampering during Registration
- **Description:** User tries to modify the `role` field from `grower` or `buyer` to `admin` in the registration payload.
- **Input / Scenario:** Post `{ name: "Malicious User", role: "admin", email: "malicious@test.com" }` to request OTP and verify OTP.
- **Expected System Response:** The backend role-assignment logic strictly validates accepted roles. Any attempt to register as an admin returns `400 Bad Request` or ignores the parameter, fallback-setting the user to `buyer` or `grower` role.
- **Automation Verification:** Post role `admin` to OTP verification and assert the created user role is NOT `admin`.

---

## 2. Catalog & Fuzzy Search

### EC-CAT-001: Search Query Injections & Special Characters
- **Description:** User enters SQL, HTML, or regex control characters in the search bar.
- **Input / Scenario:** Search query containing `' OR '1'='1` or `<script>` or `.*`.
- **Expected System Response:** Query parameters are sanitized. No SQL injection is executed. Special characters are treated as literal strings or escaped, returning no results safely.
- **Automation Verification:** Validate that searching syntax characters doesn't crash the server (returns 200 OK with empty dataset).

### EC-CAT-002: Pagination Index out of Bound
- **Description:** Requesting a page number that exceeds total count.
- **Input / Scenario:** `GET /api/products?page=9999&limit=20`.
- **Expected System Response:** System returns `200 OK` with an empty data array `[]` rather than throwing database query syntax errors or crashing.
- **Automation Verification:** Verify response structure is `{ data: [] }` (or empty array) with valid pagination metadata.

---

## 3. Cart & Inventory Reservation

### EC-CART-001: Concurrent Stock Grab (Overselling Race Condition)
- **Description:** Two buyers attempt to check out the last remaining unit of a product concurrently.
- **Input / Scenario:** Two simultaneous checkout initiation calls POST `/api/orders` targeting a product with `stock = 1`.
- **Expected System Response:** Database transaction isolation level or a mutex row lock grants checkout access to one transaction. The first buyer succeeds; the second receives `409 Conflict` (or `400 Bad Request`) stating "Item out of stock" and their transaction rolls back.
- **Automation Verification:** Fire concurrent requests using `Promise.all` in Jest and assert exactly one succeeds and one fails.

### EC-CART-002: Mid-Checkout Cart Lock Expiration
- **Description:** Product is reserved in cart, but the checkout process remains idle until the reservation window (e.g. 10 minutes) expires.
- **Input / Scenario:** User completes payment after the inventory reservation has expired and the stock has been reclaimed.
- **Expected System Response:** System checks stock validity on final transaction confirmation. Since reservation is expired, it checks current stock. If stock is available, it completes. If stock is depleted, it prevents order finalization, cancels payment capturing, and redirects user.
- **Automation Verification:** Reserve stock, advance system time in mock database, hit confirm-payment, verify it returns stock-expired error.

---

## 4. Checkout, Pricing, & Promo Codes

### EC-CHKT-001: Decimals & Rounding Errors in Subtotal/GST
- **Description:** Multi-item carts with fractional pricing/taxes resulting in floating point inaccuracies.
- **Input / Scenario:** Cart with multiple items, each having 5% GST and fractional prices (e.g. ₹299.50).
- **Expected System Response:** System performs all currency math using fixed-precision arithmetic (e.g., decimal parsing, rounding to 2 decimal places at each intermediate step) to ensure `subtotal + tax + shipping - discount === total` exactly.
- **Automation Verification:** Assert mathematically that the returned total matches decimal sums exactly.

### EC-CHKT-002: Promo Code Exceeded Usage Limit Concurrently
- **Description:** A popular promo code with 1 use left is applied concurrently by two different users.
- **Input / Scenario:** Two checkout verify-payment requests hit the server at the same time using promo code `FIRST50`.
- **Expected System Response:** Database transaction updates coupon usage count. One order registers the coupon successfully; the second fails signature verification/finalization with coupon usage limit reached.
- **Automation Verification:** Run concurrent coupon validation hits in tests and check usage limit increments.

---

## 5. Fulfillment & Shipping Webhooks

### EC-SHIP-001: Duplicate/Replayed Tracking Events
- **Description:** Shiprocket fires the same tracking event webhook multiple times (e.g. `order.shipped`).
- **Input / Scenario:** Webhook endpoint `/api/shipping/webhook` is triggered twice with identical payload.
- **Expected System Response:** The webhook controller checks for event duplication (e.g. checking existing tracking events in database by transaction or status history). The second request returns `200 OK` but performs no database write (idempotent behavior).
- **Automation Verification:** Post the identical payload twice and assert that only one history record is inserted in the DB.

### EC-SHIP-002: Out-of-Order Webhook Delivery
- **Description:** Webhook for "Delivered" arrives before the "Shipped" webhook due to network latency.
- **Input / Scenario:** Webhook receives `delivered` status event followed by `shipped` status event.
- **Expected System Response:** The order state machine enforces forward-only rules. The state remains `delivered`. The delayed `shipped` event is logged in tracking history but does not roll back the order status.
- **Automation Verification:** Fire webhooks in reverse chronological order and verify the final state of the order remains `delivered`.

---

## 6. Order State Machine & SSE Notifications

### EC-STATE-001: Illegal Backward State Transition
- **Description:** Attemping to transition an order status from `completed` or `cancelled` back to `processing` or `pending`.
- **Input / Scenario:** Call database state modifier or API route with state rollback.
- **Expected System Response:** The state machine (`OrderStateService.isValidTransition`) returns `false`, throwing a transition error and blocking the write.
- **Automation Verification:** Attempt state changes: `cancelled -> processing` and verify it fails with state exception.

### EC-STATE-002: SSE Connection Interruption Recovery
- **Description:** SSE connection disconnects during a status transition (e.g., customer changes tab or network drops).
- **Input / Scenario:** Client loses SSE connection, state transitions, and connection re-establishes.
- **Expected System Response:** The frontend implements automatic reconnection with toast alert. Upon reconnect, it triggers an API polling fallback (`fetchOrders`) to catch up on any missed status changes.
- **Automation Verification:** Disconnect connection, trigger backend state change, reconnect, verify UI refreshes.

---

## 7. Refund System & Cancellation Gating

### EC-REF-001: Multi-tab Double Cancellation Request
- **Description:** Customer has two tabs open on the tracking page. Clicks "Cancel Order" on both tabs concurrently.
- **Input / Scenario:** Concurrent POST `/api/orders/:id/cancel` or `/api/refunds/cancel-requests/:id/approve` requests.
- **Expected System Response:** The first request transitions order status to `cancel_requested` or `cancelled`. The second request returns `400 Bad Request` because the order is no longer in a cancellable state.
- **Automation Verification:** Send concurrent cancel requests and assert one receives success and the other receives "Order not in a cancellable state."

### EC-REF-002: Partial Refund Exceeding Order Value
- **Description:** Admin attempts to issue multiple partial refunds that collectively exceed the total order value.
- **Input / Scenario:** Order total is ₹1000. Admin issues partial refund of ₹600, then tries to issue another of ₹500.
- **Expected System Response:** System validates `total_refunded_amount + requested_amount <= order.total`. The second request is rejected with "Refund amount exceeds remaining order balance."
- **Automation Verification:** Create order, initiate two partial refunds totaling ₹1100, verify second is rejected.

---

## 8. Grower Training Flow v2 (Batches & Auto-Refunds)

### EC-TRAIN-001: Cancellation CUTOFF Boundary Gating (Temporal Edge)
- **Description:** Grower attempts to self-cancel exactly 3 days (cutoff duration) before the batch starts, down to the exact millisecond.
- **Input / Scenario:** Batch starts on `2026-07-10 10:00:00`. Cutoff is 3 days. User attempts cancel on `2026-07-07 09:59:59` (allow cancel) vs `2026-07-07 10:00:01` (block cancel).
- **Expected System Response:** At `09:59:59`, cancel succeeds, refund is auto-initiated. At `10:00:01`, cancel fails with `400 Bad Request` stating "Cancellation window closed."
- **Automation Verification:** Configure mock dates and verify boundaries in backend routes.

### EC-TRAIN-002: Concurrent Batch oversell (1 seat left, multiple registrants)
- **Description:** Registration slot is held by one grower, another completes payment first.
- **Input / Scenario:** Grower A opens checkout widget. Grower B opens checkout widget. B pays first.
- **Expected System Response:** B completes verification and secures the seat. When A tries to verify payment, the system sees `seats_taken >= capacity`. A's payment verification is aborted, their enrollment is set to `failed`, and a gateway refund is immediately auto-triggered for A.
- **Automation Verification:** Simulate concurrent payments with payment verification, assert refund is triggered for the user who lost the seat.

### EC-TRAIN-003: Razorpay Webhook Refund Failover Handling
- **Description:** Razorpay refund API fails during cancellation process (e.g. gateway timeout or API error).
- **Input / Scenario:** API `initiateRazorpayRefund` throws an exception.
- **Expected System Response:** The transaction rollback does not fail the cancellation state. The enrollment is marked `cancelled` but the refund status is set to `failed` or `pending_manual`, placing the ticket directly in the admin's Manual Refund Queue.
- **Automation Verification:** Mock Razorpay API to throw error, trigger cancel, check enrollment status is `cancelled` and refund queue contains the failed record.

---

## 9. Admin Operations & Audit Controls

### EC-ADM-001: Roster Export during Database Load
- **Description:** Admin triggers high-volume roster CSV export during database strain.
- **Input / Scenario:** GET `/api/trainings/admin/batches/:id/roster/export` during active concurrent registrations.
- **Expected System Response:** System executes query using a read-only database replica (if configured) or executes in chunks. Row locking is avoided so registration transactions are not blocked.
- **Automation Verification:** Measure API response latency under load and verify zero deadlocks.

### EC-ADM-002: Override Audit Logging Idempotency
- **Description:** Admin overrides a policy (e.g. manual refund) and the action fails mid-execution.
- **Input / Scenario:** Admin clicks "Override Refund" but DB network drops before the operation completes.
- **Expected System Response:** Database transaction wraps both the audit log insertion and the status modification. Either both succeed or both roll back, preventing silent or untracked state modifications.
- **Automation Verification:** Fail the update query and verify no audit log remains in `admin_action_logs`.
