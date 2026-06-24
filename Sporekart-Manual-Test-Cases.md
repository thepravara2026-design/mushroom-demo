# Sporekart — Manual Test Cases

**Application:** Sporekart E-commerce & Training Platform (Shriyap Enterprise)  
**Platform:** Web SPA (Vanilla JS) + REST API  
**Test Date:** _______________  
**Tester:** _______________  
**Environment:** _______________ (Mock / Production)

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Shop & Product Browsing](#2-shop--product-browsing)
3. [Cart Management](#3-cart-management)
4. [Checkout & Payment](#4-checkout--payment)
5. [Order Management](#5-order-management)
6. [Order Tracking & Cancellation](#6-order-tracking--cancellation)
7. [Training Module](#7-training-module)
8. [Blog Module](#8-blog-module)
9. [Admin Panel — Dashboard](#9-admin-panel--dashboard)
10. [Admin Panel — Product Management](#10-admin-panel--product-management)
11. [Admin Panel — Category Management](#11-admin-panel--category-management)
12. [Admin Panel — Order Management](#12-admin-panel--order-management)
13. [Admin Panel — Training Management](#13-admin-panel--training-management)
14. [Admin Panel — Blog Management](#14-admin-panel--blog-management)
15. [Admin Panel — Refund Management](#15-admin-panel--refund-management)
16. [Search Functionality](#16-search-functionality)
17. [FAQ Section](#17-faq-section)
18. [User Profile](#18-user-profile)
19. [Notifications & Real-time Updates](#19-notifications--real-time-updates)
20. [Responsive Design & Cross-browser](#20-responsive-design--cross-browser)
21. [SEO & Structured Data](#21-seo--structured-data)

---

## 1. Authentication & Authorization

### TC-AUTH-001: Homepage Load — Unauthenticated User
| Field | Detail |
|---|---|
| **Description** | Verify the website loads correctly for an unauthenticated user |
| **Precondition** | Clear browser cache, no active session |
| **Steps** | 1. Navigate to application URL<br>2. Observe the loaded page |
| **Expected Result** | Page loads with hero section, shop, training section, blog section, and footer visible. "Login" button visible in top bar. Cart badge shows "0". No user profile shown. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-002: Open Auth Modal
| Field | Detail |
|---|---|
| **Description** | Verify the authentication modal opens and displays correctly |
| **Precondition** | Not logged in |
| **Steps** | 1. Click "Log In" button in top bar<br>2. Observe the modal |
| **Expected Result** | Modal overlay appears with backdrop blur. Modal shows: phone input (10-digit), "Send OTP" button, tab/switch for Buyer/Trainee/Admin modes. Close button (X) visible. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-003: Send OTP — Valid Phone Number
| Field | Detail |
|---|---|
| **Description** | Verify OTP is sent for a valid Indian phone number |
| **Precondition** | Auth modal open, phone input empty |
| **Steps** | 1. Enter valid 10-digit phone (e.g., 9876543210)<br>2. Click "Send OTP" |
| **Expected Result** | Loading state on button. Success toast "OTP sent successfully". OTP input fields appear (6-digit). Resend timer starts (30s). Phone field becomes disabled. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-004: Send OTP — Invalid Phone Number
| Field | Detail |
|---|---|
| **Description** | Verify validation error for invalid phone |
| **Precondition** | Auth modal open |
| **Steps** | 1. Enter invalid phone (e.g., 12345, 999, 0123456789)<br>2. Click "Send OTP" |
| **Expected Result** | Error message "Please enter a valid 10-digit Indian phone number" shown. OTP not sent. No API call made. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-005: Verify OTP — Valid OTP
| Field | Detail |
|---|---|
| **Description** | Verify successful login with correct OTP |
| **Precondition** | OTP sent state, 6-digit OTP entry visible |
| **Steps** | 1. Enter correct 6-digit OTP (in mock mode, check server console for OTP)<br>2. Click "Verify OTP" |
| **Expected Result** | Loading state on button. Success toast "Login successful!". Modal closes. Top bar updates: user name/email shown, "Login" button replaced. Cart and orders fetched. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-006: Verify OTP — Invalid OTP
| Field | Detail |
|---|---|
| **Description** | Verify error on incorrect OTP |
| **Precondition** | OTP sent state |
| **Steps** | 1. Enter wrong 6-digit OTP (e.g., 000000)<br>2. Click "Verify OTP" |
| **Expected Result** | Error toast "Invalid OTP" or API error message. User remains on OTP entry screen. Not logged in. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-007: Resend OTP
| Field | Detail |
|---|---|
| **Description** | Verify OTP resend functionality |
| **Precondition** | OTP sent state, timer expired |
| **Steps** | 1. Wait for 30-second resend timer to expire<br>2. Click "Resend OTP" |
| **Expected Result** | Success toast "OTP resent successfully". New OTP sent. Timer restarts. OTP input fields cleared. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-008: Close Auth Modal
| Field | Detail |
|---|---|
| **Description** | Verify auth modal can be closed |
| **Precondition** | Auth modal open |
| **Steps** | 1. Click close (X) button on modal<br>2. OR click outside modal (on backdrop) |
| **Expected Result** | Modal closes. Page remains in same state. No login occurs. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-009: Admin Login Flow
| Field | Detail |
|---|---|
| **Description** | Verify admin can login via email OTP |
| **Precondition** | Auth modal open, switch to "Admin" mode |
| **Steps** | 1. Switch to Admin login tab<br>2. Enter admin email (admin@sporekart.com)<br>3. Click "Send OTP"<br>4. Enter received OTP<br>5. Click "Verify" |
| **Expected Result** | OTP sent to admin email (console in mock mode). Successful login. Redirect to admin panel. Admin UI elements visible. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-010: Logout
| Field | Detail |
|---|---|
| **Description** | Verify user can logout |
| **Precondition** | Logged in as any role |
| **Steps** | 1. Click user profile/name in top bar<br>2. Click "Logout" from dropdown<br>3. Observe the page |
| **Expected Result** | Success toast "Logged out successfully". User session cleared. Page returns to unauthenticated state. Cart may persist (localStorage). |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-AUTH-011: Protected Route — Unauthenticated Access
| Field | Detail |
|---|---|
| **Description** | Verify protected pages redirect unauthenticated users |
| **Precondition** | Not logged in |
| **Steps** | 1. Navigate to #profile<br>2. Observe behavior |
| **Expected Result** | Auth modal opens automatically. User cannot access profile without login. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 2. Shop & Product Browsing

### TC-SHOP-001: Shop Section Load
| Field | Detail |
|---|---|
| **Description** | Verify the shop/products section loads correctly |
| **Precondition** | Page loaded |
| **Steps** | 1. Navigate to homepage<br>2. Scroll to shop section or click "Shop by Category"<br>3. Observe product display |
| **Expected Result** | Product grid shows product cards with image, name, category badge, price (MRP strikethrough + selling price), weight variant chips, add-to-cart button. Loading skeleton shown while fetching. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SHOP-002: Category Filter — Desktop
| Field | Detail |
|---|---|
| **Description** | Verify category filtering works on desktop |
| **Precondition** | Shop section loaded with products |
| **Steps** | 1. Click a category chip (e.g., "Fresh Mushrooms")<br>2. Observe product grid |
| **Expected Result** | Only products matching selected category shown. Active category highlighted. "All" option resets to show all products. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SHOP-003: Category Dropdown Navigation
| Field | Detail |
|---|---|
| **Description** | Verify category dropdown menu works |
| **Precondition** | Page loaded |
| **Steps** | 1. Click "Shop by Category" button in navbar<br>2. Observe dropdown<br>3. Click a category item<br>4. Observe page |
| **Expected Result** | Dropdown appears with all categories. Clicking a category scrolls to shop section and filters products. Dropdown closes after selection. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SHOP-004: Product Weight Variant Selection
| Field | Detail |
|---|---|
| **Description** | Verify weight variant chips update price |
| **Precondition** | Product with multiple weight variants visible |
| **Steps** | 1. Observe product card with weight chips (100g, 200g, 500g, 1kg)<br>2. Click different weight chips |
| **Expected Result** | Active weight chip highlighted. Price updates to match selected variant. Add-to-cart will use selected variant. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SHOP-005: Product Pagination
| Field | Detail |
|---|---|
| **Description** | Verify pagination works |
| **Precondition** | More products than page size exist |
| **Steps** | 1. Scroll to bottom of product grid<br>2. Click "Next" pagination button<br>3. Click "Previous" |
| **Expected Result** | Next page of products loads. Pagination controls show current page. Products update smoothly. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SHOP-006: Empty Category State
| Field | Detail |
|---|---|
| **Description** | Verify behavior when category has no products |
| **Precondition** | At least one category with zero products (test scenario) |
| **Steps** | 1. Create or identify empty category<br>2. Select it from filter |
| **Expected Result** | "No products found in this category" message shown. Pagination hidden. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 3. Cart Management

### TC-CART-001: Add to Cart — Single Item
| Field | Detail |
|---|---|
| **Description** | Verify adding a product to cart |
| **Precondition** | User authenticated or unauthenticated, shop section loaded |
| **Steps** | 1. Select a weight variant on a product<br>2. Click "Add to Cart" button |
| **Expected Result** | Success toast "Added to cart" or equivalent. Cart badge increments by 1. Same variant quantity becomes 1 in cart. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CART-002: Add to Cart — Same Product Different Variant
| Field | Detail |
|---|---|
| **Description** | Verify different weight variants are separate cart items |
| **Precondition** | Product with multiple weight variants not in cart |
| **Steps** | 1. Add product (500g variant) to cart<br>2. Add same product (1kg variant) to cart |
| **Expected Result** | Cart now shows two line items for the same product — one for 500g, one for 1kg. Cart badge shows total quantity (2). |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CART-003: Update Quantity in Cart
| Field | Detail |
|---|---|
| **Description** | Verify quantity can be increased/decreased in cart |
| **Precondition** | Item exists in cart |
| **Steps** | 1. Open cart sidebar<br>2. Click "+" button on a cart item<br>3. Click "-" button on the same item |
| **Expected Result** | Quantity increases/decreases. Line total updates. Cart total updates. Cart badge updates. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CART-004: Remove Item from Cart
| Field | Detail |
|---|---|
| **Description** | Verify item can be removed from cart |
| **Precondition** | Multiple items in cart |
| **Steps** | 1. Open cart sidebar<br>2. Click delete/remove icon on a cart item<br>3. Confirm removal if prompted |
| **Expected Result** | Item removed from cart. Cart total recalculates. Cart badge decrements. If cart becomes empty, "Your cart is empty" message shown. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CART-005: Cart Persistence Across Sessions
| Field | Detail |
|---|---|
| **Description** | Verify cart persists in localStorage |
| **Precondition** | Cart has items |
| **Steps** | 1. Add items to cart<br>2. Close browser tab<br>3. Reopen application<br>4. Open cart |
| **Expected Result** | Cart items, quantities, and variants preserved from previous session. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CART-006: Cart Empty State
| Field | Detail |
|---|---|
| **Description** | Verify empty cart display |
| **Precondition** | Cart is empty |
| **Steps** | 1. Open cart sidebar |
| **Expected Result** | "Your cart is empty" message with a "Shop Now" CTA button. Cart badge shows "0". No checkout button visible. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CART-007: Cart Badge Sync
| Field | Detail |
|---|---|
| **Description** | Verify cart badge reflects total quantity across all operations |
| **Precondition** | Empty cart |
| **Steps** | 1. Add 2 items (qty 1 each) — badge shows 2<br>2. Increase qty of one item to 3 — badge shows 4<br>3. Remove one item — badge decreases correctly<br>4. Clear all items — badge shows 0 |
| **Expected Result** | Cart badge always matches total number of items (sum of quantities) in real-time. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 4. Checkout & Payment

### TC-CHECKOUT-001: Open Checkout from Cart
| Field | Detail |
|---|---|
| **Description** | Verify checkout page opens correctly |
| **Precondition** | Cart has at least one item, user logged in |
| **Steps** | 1. Open cart sidebar<br>2. Click "Proceed to Checkout" / "Place Order" |
| **Expected Result** | Checkout page/section loaded. Shows: delivery address form (left) and order summary (right). Address fields: Name, Phone, Email, Address Line 1 & 2, Landmark, State (dropdown), City (dropdown), Pincode. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-002: State-City Cascading Dropdown
| Field | Detail |
|---|---|
| **Description** | Verify city dropdown updates based on selected state |
| **Precondition** | Checkout page open |
| **Steps** | 1. Click State dropdown<br>2. Select a state (e.g., Karnataka)<br>3. Observe City dropdown |
| **Expected Result** | State dropdown populated with all Indian states. After selecting state, City dropdown populates with cities of that state. Changing state resets city selection. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-003: Address Form Validation — Blur
| Field | Detail |
|---|---|
| **Description** | Verify inline validation on field blur |
| **Precondition** | Checkout page open |
| **Steps** | 1. Click in Phone field<br>2. Enter invalid phone (e.g., 12345)<br>3. Click out of field (blur) |
| **Expected Result** | Red error border on field. Error message "Please enter a valid 10-digit Indian phone number" shown below field. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-004: Address Form Validation — All Fields Required
| Field | Detail |
|---|---|
| **Description** | Verify all required fields are validated on submit |
| **Precondition** | Checkout page open, all fields empty |
| **Steps** | 1. Click "Continue to Payment" / Place Order button |
| **Expected Result** | Error messages shown on all required empty fields. Form not submitted. First error field scrolled into view. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-005: Pincode Validation
| Field | Detail |
|---|---|
| **Description** | Verify pincode field accepts only 6 digits |
| **Precondition** | Checkout page open |
| **Steps** | 1. Enter pincode "5600"<br>2. Click out<br>3. Enter pincode "560001"<br>4. Click out |
| **Expected Result** | "5600" shows error: "Pincode must be 6 digits". "560001" passes validation, no error. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-006: Promo Code — Valid Code
| Field | Detail |
|---|---|
| **Description** | Verify valid promo code applies discount |
| **Precondition** | Checkout page open with items in order summary |
| **Steps** | 1. Enter promo code "SPORE10" or "SHROOM20"<br>2. Click "Apply" |
| **Expected Result** | Success toast "Promo code applied!". Discount shown in order summary. Total amount reduced by discount amount. Applied code visible with remove option. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-007: Promo Code — Invalid/Expired Code
| Field | Detail |
|---|---|
| **Description** | Verify invalid promo code shows error |
| **Precondition** | Checkout page open |
| **Steps** | 1. Enter promo code "INVALID123"<br>2. Click "Apply" |
| **Expected Result** | Error toast "Invalid or expired promo code". No discount applied. Order total unchanged. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-008: Razorpay Payment — Successful
| Field | Detail |
|---|---|
| **Description** | Verify Razorpay payment flow completes successfully |
| **Precondition** | Checkout form filled, promo applied, user logged in |
| **Steps** | 1. Click "Continue to Payment"<br>2. Razorpay checkout modal opens<br>3. Select payment method (card/UPI/netbanking)<br>4. Complete payment successfully |
| **Expected Result** | Razorpay modal shows correct amount. Payment success callback fires. Order placed. Redirect to order confirmation/thank you page. Success toast. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-009: Razorpay Payment — Failed/Cancelled
| Field | Detail |
|---|---|
| **Description** | Verify behaviour on payment failure or user cancellation |
| **Precondition** | Checkout form filled, Razorpay modal open |
| **Steps** | 1. In Razorpay modal, close without completing payment<br>2. OR use a test card that simulates failure |
| **Expected Result** | Razorpay modal closes. Error toast "Payment failed/cancelled". User returns to checkout page. Cart items preserved. Can retry payment. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-010: Cash on Delivery (COD) Flow
| Field | Detail |
|---|---|
| **Description** | Verify COD order placement |
| **Precondition** | Checkout form filled, COD option available |
| **Steps** | 1. Select "Cash on Delivery" payment method<br>2. Confirm order |
| **Expected Result** | Order placed successfully with "pending" payment status. Success toast. Order shown in order history. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-011: UPI Payment Confirmation
| Field | Detail |
|---|---|
| **Description** | Verify UPI payment flow with QR code |
| **Precondition** | Checkout form filled |
| **Steps** | 1. Select UPI payment<br>2. Scan QR code or enter UPI ID<br>3. Complete payment |
| **Expected Result** | UPI QR code displayed. Payment verification endpoint called. Order status updated on successful confirmation. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-CHECKOUT-012: Unauthenticated Checkout
| Field | Detail |
|---|---|
| **Description** | Verify checkout requires authentication |
| **Precondition** | Not logged in, items in cart |
| **Steps** | 1. Open cart<br>2. Click "Proceed to Checkout" |
| **Expected Result** | Auth modal opens. User must login before proceeding to checkout. Cart items preserved after login. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 5. Order Management

### TC-ORDER-001: My Orders Page
| Field | Detail |
|---|---|
| **Description** | Verify order history page loads correctly |
| **Precondition** | Logged in user with past orders |
| **Steps** | 1. Navigate to order tracking section / my orders<br>2. Observe order list |
| **Expected Result** | Orders displayed in reverse chronological order. Each order shows: Order ID, date, status badge, item count, total amount. Clicking an order expands detail view. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ORDER-002: Order Detail View
| Field | Detail |
|---|---|
| **Description** | Verify expanded order detail shows all information |
| **Precondition** | Order list visible |
| **Steps** | 1. Click on an order to expand<br>2. Observe detail panel |
| **Expected Result** | Detail shows: payment details card (method, transaction ID, amount), delivery summary card (address, phone, email), progress bar with status, timeline checkpoints with dates/times, line items with quantities and prices, subtotal, discount, tax, total. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ORDER-003: Invoice Generation
| Field | Detail |
|---|---|
| **Description** | Verify tax invoice can be generated for completed orders |
| **Precondition** | Order in "delivered" or "paid/placed" status |
| **Steps** | 1. Expand order detail<br>2. Click "Generate Tax Invoice" |
| **Expected Result** | Invoice modal opens. Shows: seller info (Shriyap Enterprise), buyer info, invoice number, date, line items with HSN codes, GST breakdown (CGST/SGST), total in words, digital signature/QR code. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ORDER-004: Copy Invoice Link
| Field | Detail |
|---|---|
| **Description** | Verify shareable invoice link can be copied |
| **Precondition** | Invoice modal open |
| **Steps** | 1. Click "Copy Link" or share icon in invoice<br>2. Check clipboard |
| **Expected Result** | Invoice share link copied to clipboard. Toast "Invoice link copied!" shown. Link can be opened in incognito browser by another user. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ORDER-005: WhatsApp Order Update
| Field | Detail |
|---|---|
| **Description** | Verify WhatsApp quick message works |
| **Precondition** | Order detail expanded |
| **Steps** | 1. Click "Update via WhatsApp" button<br>2. Observe behavior |
| **Expected Result** | WhatsApp web/app opens with pre-filled message containing order ID and status update request. Correct phone number (+917204709870) pre-filled. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ORDER-006: Order Status Progression
| Field | Detail |
|---|---|
| **Description** | Verify order status progresses correctly through lifecycle |
| **Precondition** | Test account with orders in various states |
| **Steps** | 1. Check order status for: newly placed order<br>2. Wait for admin approval<br>3. Check after processing update<br>4. Check after shipping update<br>5. Check after delivery update |
| **Expected Result** | Status progresses: pending → paid → pending_approval → placed → processing → shipped → in_transit → delivered. Each step shows timestamp and who updated it. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 6. Order Tracking & Cancellation

### TC-TRACK-001: Track Order by ID
| Field | Detail |
|---|---|
| **Description** | Verify order can be tracked using order ID |
| **Precondition** | User has at least one order |
| **Steps** | 1. Go to "Track Order" section<br>2. Enter valid Order ID<br>3. Click "Track" |
| **Expected Result** | Order detail page loads with full tracking information: status, timeline, delivery ETA, payment info. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRACK-002: Track Order — Invalid ID
| Field | Detail |
|---|---|
| **Description** | Verify error for invalid/missing order ID |
| **Precondition** | Track Order section open |
| **Steps** | 1. Enter invalid Order ID (e.g., "ABC123")<br>2. Click "Track"<br>3. Submit with empty field |
| **Expected Result** | Error toast "Order not found" for invalid ID. Validation error for empty field. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRACK-003: Cancel Order — Request Flow
| Field | Detail |
|---|---|
| **Description** | Verify cancellation request can be submitted |
| **Precondition** | Order in "placed" or "processing" status, not yet shipped |
| **Steps** | 1. Expand order detail<br>2. Click "Cancel Order"<br>3. Select a reason from dropdown (e.g., "Ordered by mistake")<br>4. Click "Submit"<br>5. Confirm in confirmation dialog |
| **Expected Result** | Cancel modal shows: reason dropdown (7 options), "Other" option shows textarea. Confirmation dialog shows selected reason. On confirm: toast "Cancellation request submitted successfully". Order status changes to "CANCEL_REQUESTED". |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRACK-004: Cancel Order — Validation
| Field | Detail |
|---|---|
| **Description** | Verify cancel form validation |
| **Precondition** | Cancel modal open |
| **Steps** | 1. Click "Submit" without selecting a reason<br>2. Select "Other" and submit with empty text |
| **Expected Result** | Validation error: "Please select a cancellation reason" / "Please describe your reason". Request not submitted. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRACK-005: Cancel Order — After Shipped
| Field | Detail |
|---|---|
| **Description** | Verify cancellation is blocked for shipped orders |
| **Precondition** | Order in "shipped" or "in_transit" status |
| **Steps** | 1. Open order detail for shipped order<br>2. Observe cancel button |
| **Expected Result** | Cancel button is disabled or hidden. Message shown: "Order already shipped — cannot cancel". |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRACK-006: Order Review Modal — Auto Prompt
| Field | Detail |
|---|---|
| **Description** | Verify review prompt appears for delivered orders |
| **Precondition** | Order recently marked as "delivered", not yet reviewed |
| **Steps** | 1. Navigate to order tracking<br>2. Observe if review prompt appears (for first delivered unrated order) |
| **Expected Result** | Review modal auto-opens. Shows: 5-star rating (clickable stars), optional review textarea, "Skip" button, "Submit Review" button (disabled until rating selected). |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRACK-007: Submit Review
| Field | Detail |
|---|---|
| **Description** | Verify product review submission |
| **Precondition** | Review modal open |
| **Steps** | 1. Click 4 stars<br>2. Enter review text<br>3. Click "Submit Review" |
| **Expected Result** | Stars highlight up to selected. Submit becomes enabled. On click: toast "Thank you for your review!". Review saved. Modal closes. Order marked as reviewed. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRACK-008: Skip Review
| Field | Detail |
|---|---|
| **Description** | Verify review can be skipped |
| **Precondition** | Review modal open |
| **Steps** | 1. Click "Skip" button |
| **Expected Result** | Modal closes. Review not submitted. Skip preference stored in localStorage (skipped_review_{orderId}). Same prompt will not appear again for this order. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 7. Training Module

### TC-TRAIN-001: Training Section Load
| Field | Detail |
|---|---|
| **Description** | Verify training section loads with courses |
| **Precondition** | Page loaded |
| **Steps** | 1. Scroll to training section or click "Training and Courses" nav link<br>2. Observe training cards |
| **Expected Result** | Training section shows: training cards with image, title, description, instructor name, date, price, enrollment status badge. Tabs for Future / Ongoing / Completed. Filter buttons by category. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRAIN-002: Training Enrollment — Authenticated
| Field | Detail |
|---|---|
| **Description** | Verify user can enroll in a training course |
| **Precondition** | User logged in, seats available |
| **Steps** | 1. Click "Enroll" on an available training<br>2. Confirm enrollment |
| **Expected Result** | Success toast "Enrolled successfully". Training card updates to show "Enrolled" badge. Course appears in "My Enrollments" section. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRAIN-003: Training Enrollment — Unauthenticated
| Field | Detail |
|---|---|
| **Description** | Verify unauthenticated user is prompted to login for enrollment |
| **Precondition** | Not logged in |
| **Steps** | 1. Click "Enroll" on a training |
| **Expected Result** | Trainee auth modal opens. User must sign up or login to continue enrollment. After login, enrollment flow proceeds. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRAIN-004: Trainee Registration Flow
| Field | Detail |
|---|---|
| **Description** | Verify trainee can register via OTP |
| **Precondition** | Trainee auth modal open |
| **Steps** | 1. Enter name and phone number<br>2. Click "Send OTP"<br>3. Enter received OTP<br>4. Complete registration |
| **Expected Result** | OTP sent. After verification, trainee profile created. Enrolled in selected course. Redirected to training section. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRAIN-005: Google Login for Trainee
| Field | Detail |
|---|---|
| **Description** | Verify Google OAuth for trainee |
| **Precondition** | Trainee auth modal open |
| **Steps** | 1. Click "Sign in with Google"<br>2. Complete Google OAuth flow |
| **Expected Result** | Google OAuth popup opens. After authorization, trainee is logged in and enrollment proceeds. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRAIN-006: Training Filter by Category
| Field | Detail |
|---|---|
| **Description** | Verify training category filter works |
| **Precondition** | Training section loaded |
| **Steps** | 1. Click a training category filter button<br>2. Observe displayed courses |
| **Expected Result** | Only trainings matching selected category shown. Active filter highlighted. "All" shows all trainings. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRAIN-007: Training Tabs (Future/Ongoing/Completed)
| Field | Detail |
|---|---|
| **Description** | Verify training tab switching |
| **Precondition** | User has enrollments in various states |
| **Steps** | 1. Click "Future" tab<br>2. Click "Ongoing" tab<br>3. Click "Completed" tab |
| **Expected Result** | Each tab shows only relevant trainings based on date comparison with current date. Tab content updates without page reload. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-TRAIN-008: Training Gallery
| Field | Detail |
|---|---|
| **Description** | Verify training gallery carousel |
| **Precondition** | Training section loaded |
| **Steps** | 1. Scroll to training gallery section<br>2. Click prev/next arrows<br>3. Click dots |
| **Expected Result** | Gallery images slide smoothly. Dots indicate current slide. Arrows navigate back/forth. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 8. Blog Module

### TC-BLOG-001: Blog Listing
| Field | Detail |
|---|---|
| **Description** | Verify blog listing page loads |
| **Precondition** | Page loaded |
| **Steps** | 1. Click "Blogs" in navigation<br>2. Observe blog grid |
| **Expected Result** | Blog cards shown with: featured image, title, publish date, excerpt. Loading skeleton while fetching. 5 blogs per page with pagination. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-BLOG-002: Blog Detail View
| Field | Detail |
|---|---|
| **Description** | Verify individual blog post loads |
| **Precondition** | Blog listing visible |
| **Steps** | 1. Click on a blog card<br>2. Observe full blog view |
| **Expected Result** | Full blog page loads: featured image, title, author, published date, full content. Lock icon/badge shown for locked blogs. Back to blog list link. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-BLOG-003: Blog Pagination
| Field | Detail |
|---|---|
| **Description** | Verify blog pagination works |
| **Precondition** | More than 5 blogs exist |
| **Steps** | 1. Click page 2 of blog pagination<br>2. Click back to page 1 |
| **Expected Result** | Next set of blogs loads. Page info updates. First page reloads correctly. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-BLOG-004: Empty Blog State
| Field | Detail |
|---|---|
| **Description** | Verify empty blog state |
| **Precondition** | No blogs published (test scenario) |
| **Steps** | 1. Navigate to blog listing |
| **Expected Result** | "No blogs found" message shown. No pagination. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 9. Admin Panel — Dashboard

### TC-ADMIN-001: Admin Login
| Field | Detail |
|---|---|
| **Description** | Verify admin can login to admin panel |
| **Precondition** | Navigate to /admin.html, not logged in |
| **Steps** | 1. Enter admin email: admin@sporekart.com<br>2. Click "Send OTP"<br>3. Enter received OTP<br>4. Click "Verify" |
| **Expected Result** | Login form replaced by admin dashboard. Dashboard shows: KPIs (total orders, products, users, revenue), quick action buttons, order notification panel. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-002: Admin Dashboard KPIs
| Field | Detail |
|---|---|
| **Description** | Verify dashboard statistics load correctly |
| **Precondition** | Admin logged in |
| **Steps** | 1. Observe dashboard stat cards |
| **Expected Result** | Stat cards display: Total Products (count), Total Orders (count), Total Users, Total Revenue. Values match database state. Cards have icons and color coding. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-003: SSE Notification Panel
| Field | Detail |
|---|---|
| **Description** | Verify real-time notifications appear on dashboard |
| **Precondition** | Admin logged in, SSE connection active |
| **Steps** | 1. Place a new order from a buyer account (separate browser/incognito)<br>2. Observe admin dashboard |
| **Expected Result** | New order notification appears in admin panel in real-time (no page refresh). Shows: order ID, amount, customer name, timestamp. Clicking navigates to order detail. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 10. Admin Panel — Product Management

### TC-ADMIN-PROD-001: Product List View
| Field | Detail |
|---|---|
| **Description** | Verify product list loads in admin panel |
| **Precondition** | Admin logged in, on product management section |
| **Steps** | 1. Navigate to Products section<br>2. Observe product table |
| **Expected Result** | Product table shows: Name, Category, Base Price, Stock status, GST, Actions (Edit, Delete). Pagination if > 10 products. Search/filter available. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-PROD-002: Create Product — All Valid Fields
| Field | Detail |
|---|---|
| **Description** | Verify new product can be created |
| **Precondition** | Admin logged in, add product form open |
| **Steps** | 1. Click "Add Product"<br>2. Enter Name: "Test Oyster Mushroom"<br>3. Slug auto-generated or enter "test-oyster"<br>4. Select Category from dropdown<br>5. Enter Description<br>6. Enter GST: 5%<br>7. Enable "In Stock"<br>8. Enter MRP and Price<br>9. Add weight variant rows (500g: ₹150, 1kg: ₹250)<br>10. Upload gallery images<br>11. Click "Save" |
| **Expected Result** | All fields accept input. Weight variant rows can be added dynamically. Images preview before upload. On save: success toast "Product created successfully". Product appears in list. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-PROD-003: Weight Variant Price Validation
| Field | Detail |
|---|---|
| **Description** | Verify weight variant pricing validation |
| **Precondition** | Add product form open |
| **Steps** | 1. Add weight variant with price lower than base price<br>2. Add weight variant with extremely high/escalated price |
| **Expected Result** | Validation errors: "Weight variant price must be between X and Y" based on base price. Appropriate error messages shown on each row. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-PROD-004: Edit Product
| Field | Detail |
|---|---|
| **Description** | Verify existing product can be edited |
| **Precondition** | Product exists in list |
| **Steps** | 1. Click "Edit" on a product<br>2. Modify name and price<br>3. Add new weight variant<br>4. Click "Save" |
| **Expected Result** | Form pre-filled with existing data. Changes saved successfully. Product list updates with new values. All previous data preserved except modified fields. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-PROD-005: Delete Product
| Field | Detail |
|---|---|
| **Description** | Verify product deletion with confirmation |
| **Precondition** | Product exists in list, not referenced by orders |
| **Steps** | 1. Click "Delete" on a product<br>2. Confirm deletion in popup |
| **Expected Result** | Confirmation dialog "Are you sure you want to delete this product?". On confirm: product removed from list. Success toast. On cancel: no change. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-PROD-006: Product Name Uniqueness
| Field | Detail |
|---|---|
| **Description** | Verify duplicate product name within category is rejected |
| **Precondition** | Product with name "Test Oyster" exists in a category |
| **Steps** | 1. Try to create another product with same name in same category |
| **Expected Result** | Error message "Product name already exists in this category". Product not created. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-PROD-007: Gallery Image Management
| Field | Detail |
|---|---|
| **Description** | Verify product gallery image upload and management |
| **Precondition** | Add/Edit product form open |
| **Steps** | 1. Click "Add Image" in main gallery section<br>2. Select image file from local system<br>3. Remove an existing image<br>4. Reorder images |
| **Expected Result** | Images can be uploaded (shows preview). Images can be removed with confirmation. Images can be reordered via drag or buttons. Main gallery and capsule gallery work independently. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 11. Admin Panel — Category Management

### TC-ADMIN-CAT-001: Create Category
| Field | Detail |
|---|---|
| **Description** | Verify category creation |
| **Precondition** | Admin logged in, category management section |
| **Steps** | 1. Click "Add Category"<br>2. Enter Name: "Test Category"<br>3. Slug auto-generated<br>4. Add description<br>5. Add image URL<br>6. Click "Save" |
| **Expected Result** | Slug auto-generated from name (e.g., "test-category"). Category appears in list. Category appears in shop filters and category dropdown. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-CAT-002: Unique Slug Validation
| Field | Detail |
|---|---|
| **Description** | Verify duplicate category slug is rejected |
| **Precondition** | Category "Fresh Mushrooms" exists |
| **Steps** | 1. Create category with name that generates slug "fresh-mushrooms" |
| **Expected Result** | Error: "Category with this slug already exists". Category not created. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-CAT-003: Edit Category
| Field | Detail |
|---|---|
| **Description** | Verify category can be edited |
| **Precondition** | Category exists |
| **Steps** | 1. Edit category name and description<br>2. Save changes |
| **Expected Result** | Category updates across all sections. Products in this category are unaffected. Shop filters update with new name. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-CAT-004: Delete Category
| Field | Detail |
|---|---|
| **Description** | Verify category deletion (with or without products) |
| **Precondition** | Category with no products OR Category with products |
| **Steps** | 1. Delete empty category<br>2. Delete category that has products |
| **Expected Result** | Empty category: deleted successfully. Category with products: warning/error "Cannot delete category with existing products. Remove products first." |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 12. Admin Panel — Order Management

### TC-ADMIN-ORD-001: Order List with Filters
| Field | Detail |
|---|---|
| **Description** | Verify order list loads with all filters working |
| **Precondition** | Admin logged in, order management section |
| **Steps** | 1. Observe order list<br>2. Filter by date range<br>3. Filter by order ID<br>4. Filter by phone number<br>5. Filter by status dropdown<br>6. Filter by payment method |
| **Expected Result** | All orders load initially. Each filter narrows results. Multiple filters can be combined. Clear filters resets to full list. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-ORD-002: Approve Order
| Field | Detail |
|---|---|
| **Description** | Verify admin can approve a pending order |
| **Precondition** | Order in "paid" status (pending_approval) |
| **Steps** | 1. Find a pending order<br>2. Click "Approve"<br>3. Enter delivery ETA<br>4. Confirm |
| **Expected Result** | Order status changes from "paid" → "placed". ETA saved. Customer receives notification. Order moves to processing phase. Audit log shows approval. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-ORD-003: Reject Order
| Field | Detail |
|---|---|
| **Description** | Verify admin can reject an order with reason |
| **Precondition** | Order in "paid" or "pending_approval" status |
| **Steps** | 1. Click "Reject"<br>2. Select rejection reason from dropdown<br>3. Confirm |
| **Expected Result** | Order status changes to "rejected". Reason saved. Customer notified. Refund initiated if payment was collected. Stock restocked. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-ORD-004: Update Delivery Status (Forward Only)
| Field | Detail |
|---|---|
| **Description** | Verify delivery status progression is enforced forward-only |
| **Precondition** | Order in "placed" status |
| **Steps** | 1. Update status to "processing" — allowed<br>2. Update status to "shipped" — allowed<br>3. Try to revert back to "processing" — not allowed |
| **Expected Result** | Status progresses forward: placed → processing → shipped → in_transit → delivered. Cannot move backward. Cannot skip states. Error shown if attempting invalid transition. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-ORD-005: Cancel Order (Admin)
| Field | Detail |
|---|---|
| **Description** | Verify admin can cancel an order |
| **Precondition** | Order in "placed" or "processing" status |
| **Steps** | 1. Click "Cancel Order"<br>2. Select cancellation reason<br>3. Confirm |
| **Expected Result** | Order status → "cancelled". Cancellation reason recorded. Stock restocked. Refund initiated for paid orders. Customer notified. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-ORD-006: Approve Customer Cancellation Request
| Field | Detail |
|---|---|
| **Description** | Verify admin can approve/reject customer cancellation request |
| **Precondition** | Order in "CANCEL_REQUESTED" status |
| **Steps** | 1. View pending cancellation section<br>2. Click "Approve Cancellation"<br>3. Enter delivery ETA (if any) or confirm<br>4. OR Click "Reject Cancellation" with reason |
| **Expected Result** | Approve: order moves to refund flow. Reject: order returns to previous status with rejection note. Customer is notified either way. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-ORD-007: Order History with Pagination
| Field | Detail |
|---|---|
| **Description** | Verify order history pagination |
| **Precondition** | More orders than page size |
| **Steps** | 1. Navigate to order history<br>2. Click "Next" page<br>3. Click "Previous" page |
| **Expected Result** | Paginated order list. Page info shows current/total. Prev/Next buttons enable/disable appropriately. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 13. Admin Panel — Training Management

### TC-ADMIN-TRN-001: Create Training
| Field | Detail |
|---|---|
| **Description** | Verify admin can create a new training course |
| **Precondition** | Admin logged in, training management section |
| **Steps** | 1. Click "Add Training"<br>2. Enter title, description, instructor name<br>3. Set price and strikeout price (≥ 110% of actual)<br>4. Set start/end dates (must be future)<br>5. Set capacity<br>6. Select category<br>7. Select allowed roles (buyer, grower, trainee)<br>8. Upload training image<br>9. Click "Save" |
| **Expected Result** | Form validates: future dates, price ≥ 0, strikeout ≥ 110% of price. Training image previews. On save: success toast. Training appears in frontend training section. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-TRN-002: Training Date Validation
| Field | Detail |
|---|---|
| **Description** | Verify training dates cannot be in the past |
| **Precondition** | Training form open |
| **Steps** | 1. Set start date to yesterday's date<br>2. Submit |
| **Expected Result** | Validation error: "Training start date cannot be in the past". Form not submitted. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-TRN-003: Edit Training
| Field | Detail |
|---|---|
| **Description** | Verify training can be edited |
| **Precondition** | Training exists |
| **Steps** | 1. Edit training price and capacity<br>2. Save |
| **Expected Result** | Training updates successfully. Existing enrollments preserved. Updated data reflects in frontend. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-TRN-004: Delete Training
| Field | Detail |
|---|---|
| **Description** | Verify training can be deleted |
| **Precondition** | Training exists, no active enrollments |
| **Steps** | 1. Delete a training without enrollments<br>2. Try deleting a training with enrollments |
| **Expected Result** | Without enrollments: deleted. With enrollments: warning "Cannot delete training with active enrollments". |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-TRN-005: View Enrollments
| Field | Detail |
|---|---|
| **Description** | Verify admin can view training enrollments |
| **Precondition** | At least one training has enrollments |
| **Steps** | 1. Navigate to training management<br>2. Click "View Enrollments" on a training |
| **Expected Result** | Enrolled trainees list shows: name, phone, email, enrollment date. Pagination if many entries. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 14. Admin Panel — Blog Management

### TC-ADMIN-BLG-001: Create Blog
| Field | Detail |
|---|---|
| **Description** | Verify admin can create a new blog post |
| **Precondition** | Admin logged in, blog management section |
| **Steps** | 1. Click "Add Blog"<br>2. Enter title, content, author<br>3. Upload featured image<br>4. Click "Save as Draft" or "Publish" |
| **Expected Result** | Blog created. Draft blogs visible in admin but not on public listing. Published blogs appear on frontend. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-BLG-002: Publish Blog
| Field | Detail |
|---|---|
| **Description** | Verify blog publish flow |
| **Precondition** | Blog in draft state |
| **Steps** | 1. Click "Publish" on a draft blog<br>2. Confirm |
| **Expected Result** | Blog status changes to published. `published_at` timestamp set. Blog appears on public blog listing. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-BLG-003: Blog Auto-Lock
| Field | Detail |
|---|---|
| **Description** | Verify blog auto-locks 12 hours after publish |
| **Precondition** | Blog published > 12 hours ago |
| **Steps** | 1. View blog in admin list<br>2. Check edit availability<br>3. View blog on frontend |
| **Expected Result** | Blog shows "locked" badge. Edit button disabled. Frontend shows lock icon. Content still readable. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-BLG-004: Delete Blog
| Field | Detail |
|---|---|
| **Description** | Verify blog can be deleted |
| **Precondition** | Blog exists |
| **Steps** | 1. Click "Delete" on a blog<br>2. Confirm |
| **Expected Result** | Blog removed from admin list. Blog no longer appears on public listing. Direct link to deleted blog shows 404/not found. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 15. Admin Panel — Refund Management

### TC-ADMIN-REF-001: View Refund Dashboard
| Field | Detail |
|---|---|
| **Description** | Verify refund dashboard loads correctly |
| **Precondition** | Orders with refund requests exist |
| **Steps** | 1. Navigate to refund management section<br>2. Observe refund list |
| **Expected Result** | Refund list shows: Order ID, customer, amount, reason, status, date requested. Filters by status available. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-REF-002: Process Refund — Razorpay
| Field | Detail |
|---|---|
| **Description** | Verify refund can be processed via Razorpay |
| **Precondition** | Order with Razorpay payment, cancellation approved |
| **Steps** | 1. Click "Process Refund"<br>2. Confirm |
| **Expected Result** | Refund initiated via Razorpay API. Refund status → "REFUND_INITIATED" → "REFUND_COMPLETED" on success. Customer notified. Audit log created. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-REF-003: Manual Refund
| Field | Detail |
|---|---|
| **Description** | Verify manual refund can be recorded |
| **Precondition** | Order requiring offline refund |
| **Steps** | 1. Click "Manual Refund"<br>2. Enter transaction reference<br>3. Confirm |
| **Expected Result** | Refund marked as "MANUAL_REFUND_COMPLETED". Reference number recorded. Customer notified. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-REF-004: Retry Failed Refund
| Field | Detail |
|---|---|
| **Description** | Verify failed refund can be retried |
| **Precondition** | Refund in "REFUND_FAILED" status |
| **Steps** | 1. Click "Retry Refund" |
| **Expected Result** | Refund re-attempted via Razorpay. Status updated to REFUND_INITIATED. On success → REFUND_COMPLETED. On failure → error toast. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-ADMIN-REF-005: Reject Refund Request
| Field | Detail |
|---|---|
| **Description** | Verify refund request can be rejected |
| **Precondition** | Refund in "REFUND_PENDING" status |
| **Steps** | 1. Click "Reject Refund"<br>2. Enter rejection reason<br>3. Confirm |
| **Expected Result** | Refund request rejected. Reason recorded. Customer notified. Order reverts to previous status. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 16. Search Functionality

### TC-SRCH-001: Global Search — Valid Query
| Field | Detail |
|---|---|
| **Description** | Verify search returns matching results |
| **Precondition** | Products, categories, trainings exist in database |
| **Steps** | 1. Type "oyster" in the search bar<br>2. Wait for suggestions dropdown<br>3. Press Enter or click search icon |
| **Expected Result** | Suggestions dropdown appears with matching products, categories, trainings. Search results page loads with filtered results grouped by type. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SRCH-002: Search — No Results
| Field | Detail |
|---|---|
| **Description** | Verify search handles zero results gracefully |
| **Precondition** | No entities match the search term |
| **Steps** | 1. Type "zzzznotexist123" in search bar<br>2. Execute search |
| **Expected Result** | "No results found for 'zzzznotexist123'" message. Suggestions show nothing relevant. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SRCH-003: Search — Empty / Whitespace
| Field | Detail |
|---|---|
| **Description** | Verify empty search is ignored |
| **Precondition** | Search bar focused |
| **Steps** | 1. Enter spaces only<br>2. Press Enter<br>3. Clear input, press Enter |
| **Expected Result** | No search executed. Suggestions dropdown closes or shows empty state. No API call made. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SRCH-004: Search Suggestions Debounce
| Field | Detail |
|---|---|
| **Description** | Verify suggestions debounce to avoid excessive API calls |
| **Precondition** | Search bar visible |
| **Steps** | 1. Type "oy" quickly<br>2. Type "oys" quickly<br>3. Type "oyst" quickly<br>4. Observe API calls |
| **Expected Result** | API calls debounced — only one call made after user stops typing (300ms delay). Suggestions update smoothly. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 17. FAQ Section

### TC-FAQ-001: FAQ Section Load
| Field | Detail |
|---|---|
| **Description** | Verify FAQ section renders correctly |
| **Precondition** | Page loaded |
| **Steps** | 1. Scroll to FAQ section or click "FAQ" nav link<br>2. Observe content |
| **Expected Result** | FAQ section visible with: header ("Got Questions?"), title ("Frequently Asked Questions"), subtitle, category navigation buttons ("General", "Spawn Seeds", "Cultivation", etc.), accordion items, CTA strip at bottom. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-FAQ-002: Accordion Open/Close
| Field | Detail |
|---|---|
| **Description** | Verify FAQ accordion toggle works |
| **Precondition** | FAQ section visible |
| **Steps** | 1. Click on a FAQ question to expand<br>2. Observe answer<br>3. Click same question again |
| **Expected Result** | Click: answer expands with smooth animation. Icon rotates. Background highlights. Click again: answer collapses. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-FAQ-003: Accordion — Only One Open (Same Category)
| Field | Detail |
|---|---|
| **Description** | Verify opening one FAQ closes others in same category |
| **Precondition** | FAQ General category active, one question open |
| **Steps** | 1. Click a different question in same category<br>2. Observe |
| **Expected Result** | Previous question closes. New question opens. Only one answer open at a time within the category. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-FAQ-004: Category Navigation
| Field | Detail |
|---|---|
| **Description** | Verify FAQ category filter works |
| **Precondition** | FAQ section visible, "General" category active by default |
| **Steps** | 1. Click "Spawn Seeds" category button<br>2. Click "Training" category button<br>3. Click back to "General" |
| **Expected Result** | Each button shows only its category's FAQs. Active button highlighted. Category switches smoothly. Previously open answers close. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-FAQ-005: FAQ CTA Buttons
| Field | Detail |
|---|---|
| **Description** | Verify FAQ CTA buttons work |
| **Precondition** | FAQ section visible |
| **Steps** | 1. Click "WhatsApp Us" button<br>2. Click "Email Us" button |
| **Expected Result** | WhatsApp: opens wa.me/917204709870 in new tab. Email: opens default email client to support@sporekart.com. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-FAQ-006: FAQPage Schema Validation
| Field | Detail |
|---|---|
| **Description** | Verify FAQPage JSON-LD schema is present and valid |
| **Precondition** | Page source viewable |
| **Steps** | 1. View page source<br>2. Search for "application/ld+json"<br>3. Validate with Google Rich Results Test |
| **Expected Result** | FAQPage schema present in `<head>` with 25+ Q&A entries. Valid JSON-LD. Google Rich Results Test shows no errors. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 18. User Profile

### TC-PROF-001: View Profile
| Field | Detail |
|---|---|
| **Description** | Verify user profile modal opens with correct data |
| **Precondition** | Logged in as buyer/grower |
| **Steps** | 1. Click user name/avatar in top bar<br>2. Select "My Profile" |
| **Expected Result** | Profile modal opens. Shows: Name, Email, Phone, Address (if saved). Edit button visible. Close button visible. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-PROF-002: Edit Profile
| Field | Detail |
|---|---|
| **Description** | Verify user can update profile fields |
| **Precondition** | Profile modal open |
| **Steps** | 1. Click "Edit"<br>2. Update name<br>3. Update email<br>4. Click "Save" |
| **Expected Result** | Fields become editable on "Edit". Validation on blur. On save: success toast "Profile updated". Changes reflected in top bar. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-PROF-003: Profile — Invalid Data
| Field | Detail |
|---|---|
| **Description** | Verify profile form validation |
| **Precondition** | Profile edit mode |
| **Steps** | 1. Enter invalid email<br>2. Enter empty name<br>3. Try to save |
| **Expected Result** | Validation errors shown. Invalid email: "Please enter a valid email". Empty name: "Name must be at least 2 characters". Save disabled until fixed. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 19. Notifications & Real-time Updates

### TC-NOTIF-001: Order Confirmation Toast
| Field | Detail |
|---|---|
| **Description** | Verify order confirmation notification on successful order |
| **Precondition** | User logged in, items in cart |
| **Steps** | 1. Complete checkout with successful payment<br>2. Observe notification |
| **Expected Result** | Success toast "Order placed successfully!" or equivalent. Order ID shown in toast. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-NOTIF-002: SSE Real-time Order Update
| Field | Detail |
|---|---|
| **Description** | Verify order tracking page updates in real-time via SSE |
| **Precondition** | User on order tracking page, order exists |
| **Steps** | 1. Admin updates order status from another browser<br>2. Observe order tracking page |
| **Expected Result** | Order status updates in real-time without page refresh. Progress bar advances. New timeline entry appears. Toast notification shows "Order status updated". |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-NOTIF-003: Error Toast Display
| Field | Detail |
|---|---|
| **Description** | Verify error toasts display correctly |
| **Precondition** | Any error scenario |
| **Steps** | 1. Trigger an error (e.g., invalid login)<br>2. Observe toast |
| **Expected Result** | Red error toast appears at top-right. Shows relevant error message. Auto-dismisses after 3 seconds. Multiple toasts stack correctly. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-NOTIF-004: Popup Modal Display
| Field | Detail |
|---|---|
| **Description** | Verify popup modal displays and auto-dismisses |
| **Precondition** | Scenario that triggers popup (e.g., order confirmation) |
| **Steps** | 1. Complete order<br>2. Observe popup modal |
| **Expected Result** | Centered modal with backdrop overlay. Shows title and message. Auto-dismisses after specified duration. Optionally refreshes page or redirects on close. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 20. Responsive Design & Cross-browser

### TC-RESP-001: Mobile View (360–480px)
| Field | Detail |
|---|---|
| **Description** | Verify layout adapts to mobile screen width |
| **Precondition** | Resize browser or use mobile device emulation |
| **Steps** | 1. Set viewport to 375px width (iPhone)<br>2. Navigate through all sections |
| **Expected Result** | Mobile navigation visible (hamburger menu + bottom category nav). Product grid shows 1 column. FAQ accordion full-width. Cart slides in as overlay. All touch targets ≥ 44px. No horizontal scroll. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-RESP-002: Tablet View (768–1024px)
| Field | Detail |
|---|---|
| **Description** | Verify layout adapts to tablet screen width |
| **Precondition** | Resize browser to 768px |
| **Steps** | 1. Set viewport to 768px<br>2. Observe layout |
| **Expected Result** | Product grid shows 2 columns. Navigation links visible (not hamburger). FAQ nav wraps to multiple rows. Adequate whitespace. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-RESP-003: Desktop View (1280px+)
| Field | Detail |
|---|---|
| **Description** | Verify layout provides optimal desktop experience |
| **Precondition** | Resize browser to 1440px |
| **Steps** | 1. Set viewport to 1440px<br>2. Observe layout |
| **Expected Result** | Product grid shows 3–4 columns. Max-width container centered. FAQ nav in single row. Full hero section with Three.js animation visible. All whitespace balanced. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-RESP-004: Cross-browser — Chrome, Firefox, Edge, Safari
| Field | Detail |
|---|---|
| **Description** | Verify consistent rendering across browsers |
| **Precondition** | Same test environment on each browser |
| **Steps** | 1. Load site in Chrome<br>2. Load site in Firefox<br>3. Load site in Edge<br>4. Load site in Safari<br>5. Compare layout, fonts, colors, animations |
| **Expected Result** | Consistent layout across all browsers. Fonts render correctly (Inter, Outfit). Three.js hero works in all browsers. Accordion animations smooth. Toast styling consistent. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-RESP-005: Touch Interactions
| Field | Detail |
|---|---|
| **Description** | Verify touch interactions work on mobile/tablet |
| **Precondition** | Touch-enabled device or Chrome DevTools mobile mode |
| **Steps** | 1. Tap FAQ accordion item — expands<br>2. Tap category filter — filters products<br>3. Swipe testimonials carousel<br>4. Tap add-to-cart button |
| **Expected Result** | All tap targets responsive. No 300ms delay. Swipe gestures work on carousels. No hover-dependent elements broken. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## 21. SEO & Structured Data

### TC-SEO-001: Meta Tags Presence
| Field | Detail |
|---|---|
| **Description** | Verify essential SEO meta tags are present |
| **Precondition** | View page source |
| **Steps** | 1. View `<head>` section<br>2. Check for meta tags |
| **Expected Result** | Present: `<title>`, `<meta name="description">`, `<meta name="viewport">`, `<meta charset="UTF-8">`, Open Graph tags (if implemented). Title contains "Sporekart". Description is 150–160 chars. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SEO-002: FAQPage Schema
| Field | Detail |
|---|---|
| **Description** | Verify FAQPage structured data is present and valid |
| **Precondition** | View page source |
| **Steps** | 1. Search for `"@type": "FAQPage"`<br>2. Validate with Google Rich Results Test |
| **Expected Result** | Valid FAQPage JSON-LD with 25+ questions. Each has `@type: Question` with `acceptedAnswer`. No schema validation errors. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SEO-003: Semantic HTML Structure
| Field | Detail |
|---|---|
| **Description** | Verify semantic HTML elements are used |
| **Precondition** | View page source |
| **Steps** | 1. Check for `<header>`, `<nav>`, `<main>`, `<section>`, `<footer>` elements |
| **Expected Result** | Semantic elements used appropriately. Proper heading hierarchy (h1 → h2 → h3). ARIA labels on interactive elements. Alt text on images. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SEO-004: Internal Links
| Field | Detail |
|---|---|
| **Description** | Verify internal linking structure |
| **Precondition** | FAQ section visible |
| **Steps** | 1. Check FAQ answers for internal links<br>2. Verify navbar links |
| **Expected Result** | FAQ answers contain links to `#shop-section` and `#training-section`. Navbar has links to all major sections. Footer has links to policy pages. All internal links resolve to existing sections. |
| **Actual Result** | |
| **Status (P/F)** | |

### TC-SEO-005: Page Load Speed
| Field | Detail |
|---|---|
| **Description** | Verify page loads within acceptable time |
| **Precondition** | Clean browser cache |
| **Steps** | 1. Open DevTools → Network tab<br>2. Reload page<br>3. Observe load time |
| **Expected Result** | First Contentful Paint < 2.5s. DOMContentLoaded < 3s. Total page weight < 2MB. No render-blocking resources unnecessarily large. |
| **Actual Result** | |
| **Status (P/F)** | |

---

## Test Execution Summary

| Module | Total TC | Passed | Failed | Blocked | Not Tested |
|--------|----------|--------|--------|---------|------------|
| Auth & Authorization | 11 | | | | |
| Shop & Product Browsing | 6 | | | | |
| Cart Management | 7 | | | | |
| Checkout & Payment | 12 | | | | |
| Order Management | 6 | | | | |
| Order Tracking & Cancellation | 8 | | | | |
| Training Module | 8 | | | | |
| Blog Module | 4 | | | | |
| Admin Dashboard | 3 | | | | |
| Admin Product Management | 7 | | | | |
| Admin Category Management | 4 | | | | |
| Admin Order Management | 7 | | | | |
| Admin Training Management | 5 | | | | |
| Admin Blog Management | 4 | | | | |
| Admin Refund Management | 5 | | | | |
| Search Functionality | 4 | | | | |
| FAQ Section | 6 | | | | |
| User Profile | 3 | | | | |
| Notifications & Real-time | 4 | | | | |
| Responsive Design | 5 | | | | |
| SEO & Structured Data | 5 | | | | |
| **TOTAL** | **124** | | | | |

---

## Test Environment Details

| Parameter | Value |
|-----------|-------|
| Application URL | |
| Browser (Version) | |
| OS | |
| Screen Resolution | |
| Network | |
| Backend Mode | Mock / Production |
| Test Data Used | |
| Test Execution Date | |
| Tester Name | |
| Remarks | |

## Defect Report (to be filled during testing)

| TC ID | Defect Description | Severity | Reported To | Status |
|-------|-------------------|----------|-------------|--------|
| | | High / Medium / Low | | Open / Fixed / Verified |
| | | | | |

---

*End of Test Cases Document*
