# 🍄 Sporekart — Order Management System Redesign
## Implementation Plan

**Version:** 1.0  
**Status:** Draft for Review  
**Target:** Enterprise-grade order lifecycle, cancellation, and refund management

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Scope & Boundaries](#2-scope--boundaries)
3. [Existing Architecture Analysis](#3-existing-architecture-analysis)
4. [Redesigned State Machine](#4-redesigned-state-machine)
5. [User-Facing Redesign](#5-user-facing-redesign)
6. [Admin Panel Redesign](#6-admin-panel-redesign)
7. [Cancellation Flow](#7-cancellation-flow)
8. [Refund System Architecture](#8-refund-system-architecture)
9. [Notification System](#9-notification-system)
10. [Invoice Access Rules](#10-invoice-access-rules)
11. [Audit Log System](#11-audit-log-system)
12. [Database Schema](#12-database-schema)
13. [API Design](#13-api-design)
14. [Razorpay Refund Integration](#14-razorpay-refund-integration)
15. [Edge Cases & Error Handling](#15-edge-cases--error-handling)
16. [Security Considerations](#16-security-considerations)
17. [QA Test Cases](#17-qa-test-cases)
18. [Migration Strategy](#18-migration-strategy)
19. [Production Deployment Checklist](#19-production-deployment-checklist)

---

## 1. Executive Summary

### Goal
Elevate the existing order management system to enterprise-grade quality without breaking any current functionality. The redesign focuses on:

- **Immutability** — status transitions only forward, never backward
- **Visibility** — every state change tracked, every refund logged
- **Automation** — Razorpay auto-refund with graceful fallback to manual
- **UX** — Amazon/Flipkart-grade order tracking for users and ops team

### Guiding Principles
1. **Zero breakage** — every existing screen, endpoint, and flow continues working
2. **Layered enhancement** — new logic sits as a business-logic layer above existing code
3. **Dual-track migration** — old and new status systems coexist during transition
4. **Audit-first** — every mutation is logged before execution

### Key Changes Summary

| Area | Change |
|------|--------|
| Status machine | Add `PENDING_APPROVAL` status; enforce forward-only transitions |
| User order cards | Premium card design with timeline, refund status, tracking |
| Admin dashboard | 12-section panel: New Orders, Placed, Processing, Shipping, Delivered, Cancellation Requests, Cancelled, Refund Center, Refund Failed, Manual Queue, Auto Queue, Completed |
| Cancellation flow | Structured reason dropdown (7 options) + mandatory reason if "Other" |
| Refund system | Dual-track: Auto (Razorpay) & Manual (offline). Separate queues. |
| Notifications | Email + SMS + WhatsApp + in-app for all state transitions |
| Audit log | Immutable log with timestamp, admin, action, previous state, new state |

---

## 2. Scope & Boundaries

### In Scope
- Order status state machine redesign
- User-facing order list & detail pages (enhancement, not replacement)
- Admin order management dashboard (enhancement)
- Cancellation flow (user → request → admin approve/reject)
- Refund system (auto via Razorpay, manual via admin)
- Audit log for all order/refund mutations
- Notification triggers for all state transitions
- Refund center with separate queues

### Out of Scope (NOT modified)
- Payment gateway integration (Razorpay) — existing flow untouched
- Checkout page design — untouched
- Authentication flow (OTP, login) — untouched
- Product catalog — untouched
- Cart system — untouched
- Existing UI layouts, colors, navigation — untouched

### Protected Files (no changes)
- `frontend/admin.html` — only adding new sections, never removing existing
- `frontend/src/admin.js` — only adding new functions, never modifying existing signatures
- `frontend/src/app.js` — only enhancing order display, never breaking checkout
- `frontend/src/components/ProfileModal.js` — only enhancing order cards
- `backend/src/routes/orders.js` — only adding new endpoints, never changing existing
- `backend/src/modules/refunds/RefundService.js` — only adding new functions
- `backend/src/modules/refunds/RefundController.js` — only adding new routes
- `backend/src/modules/orders/OrderStateService.js` — only adding new states, never removing

---

## 3. Existing Architecture Analysis

### Current Dual-Status Problem

The existing system tracks TWO status fields:

```
orders.status           → "pending" | "paid" | "CANCEL_REQUESTED" | "REFUND_FAILED" | etc.
orders.delivery_status  → "placed" | "processing" | "shipped" | "in_transit" | "delivered" | "cancelled"
```

This leads to complexity where an order can be `status: "REFUND_FAILED"` but `delivery_status: "cancelled"`. The redesign **keeps both fields** for backward compatibility but introduces a normalized view layer.

### Current State Machine

```
PENDING → PAID → CANCEL_REQUESTED → CANCEL_APPROVED → REFUND_PENDING → REFUND_INITIATED → ...
                → CANCELLED
```

Missing states: `PENDING_APPROVAL`, no forward-only enforcement on `delivery_status`.

### Current Gaps Identified
1. No `PENDING_APPROVAL` — new orders immediately enter `placed` without admin review
2. Backward transitions possible on `delivery_status` (admin select shows disabled options but no server enforcement)
3. No structured cancellation reasons — free text only
4. No dedicated refund center with queues
5. No notification system beyond SSE events
6. No immutable audit trail
7. Refund records lack `payment_mode` and `transaction_reference` for manual refunds

---

## 4. Redesigned State Machine

### 4.1 Order Status Flow

```
                    ┌──────────────────────────────┐
                    │       PENDING_APPROVAL        │
                    │  (New order, awaiting admin)  │
                    └──────────────┬───────────────┘
                                   │
                        ┌──────────┴──────────┐
                        │                     │
                        ▼                     ▼
                ┌───────────────┐    ┌──────────────────┐
                │    PLACED     │    │     REJECTED     │
                │ (Admin approved)│   │(Admin rejected)  │
                └───────┬───────┘    └──────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │   PROCESSING  │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │   SHIPPING    │ ← CANCELLATION LOCKED
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │   DELIVERED   │
                └───────────────┘

CANCELLATION PATHS (from PENDING_APPROVAL / PLACED / PROCESSING only):

    PENDING_APPROVAL ──→ CANCEL_REQUESTED ──→ CANCEL_APPROVED ──→ REFUND PENDING ──→ ...
    PLACED            ──→ CANCEL_REQUESTED ──→ CANCEL_REJECTED  ──→ PLACED (return)
    PROCESSING        ──→ CANCEL_REQUESTED
```

### 4.2 Allowed Transitions (Server-Enforced)

```javascript
VALID_TRANSITIONS = {
  [PENDING_APPROVAL]:  ['PLACED', 'REJECTED', 'CANCEL_REQUESTED'],
  [PLACED]:            ['PROCESSING', 'CANCEL_REQUESTED'],
  [PROCESSING]:        ['SHIPPING', 'CANCEL_REQUESTED'],
  [SHIPPING]:          ['DELIVERED'],
  [DELIVERED]:         [],         // Terminal
  [REJECTED]:          [],         // Terminal
  [CANCEL_REQUESTED]:  ['CANCEL_APPROVED', 'CANCEL_REJECTED'],
  [CANCEL_APPROVED]:   ['REFUND_PENDING'],
  [CANCEL_REJECTED]:   ['PLACED'], // Return to operational
  [REFUND_PENDING]:    ['REFUND_INITIATED', 'REFUND_FAILED'],
  [REFUND_INITIATED]:  ['REFUND_PROCESSING', 'REFUND_COMPLETED', 'REFUND_FAILED'],
  [REFUND_PROCESSING]: ['REFUND_COMPLETED', 'REFUND_FAILED'],
  [REFUND_FAILED]:     ['REFUND_PENDING', 'MANUAL_REFUND_INITIATED'],
  [MANUAL_REFUND_INITIATED]: ['MANUAL_REFUND_COMPLETED'],
  [MANUAL_REFUND_COMPLETED]: [],  // Terminal
}
```

### 4.3 Forward-Only Enforcement (Delivery Status)

```javascript
// Server-side guard — added to all status update endpoints
const STATUS_ORDER = ['placed', 'processing', 'shipped', 'in_transit', 'delivered'];

function assertForwardOnly(currentStatus, newStatus) {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  const newIdx = STATUS_ORDER.indexOf(newStatus);
  if (newIdx < currentIdx) {
    throw new Error(`Cannot move backward from ${currentStatus} to ${newStatus}`);
  }
  if (newIdx > currentIdx + 1) {
    throw new Error(`Cannot skip status from ${currentStatus} to ${newStatus}`);
  }
}
```

### 4.4 Shipping Lock Rule

```javascript
function assertCancellable(order) {
  const NON_CANCELLABLE = ['shipped', 'in_transit', 'delivered'];
  if (NON_CANCELLABLE.includes(order.delivery_status)) {
    throw new Error('Order has already been shipped and can no longer be cancelled.');
  }
}
```

---

## 5. User-Facing Redesign

### 5.1 My Orders Page — Premium Order Cards

Each order card displays:

```
┌─────────────────────────────────────────────────────────────┐
│  #ORD-10234  │  12 Jun 2026  │  ₹1,299.00                  │
├─────────────────────────────────────────────────────────────┤
│  Status: ● Placed          Payment: ✅ Paid                 │
│  Refund: —                  ETA: 18-20 Jun 2026             │
├─────────────────────────────────────────────────────────────┤
│  [📋 Track Order]  [👁 View Details]  [❌ Cancel]          │
└─────────────────────────────────────────────────────────────┘
```

**States & corresponding UI:**

| Status | Badge Color | Badge Icon | Cancel Button |
|--------|-------------|------------|---------------|
| Pending Approval | Amber | ⏳ | ✅ Enabled |
| Placed | Blue | 📋 | ✅ Enabled |
| Processing | Indigo | ⚙️ | ✅ Enabled |
| Shipping | Purple | 🚚 | ❌ Disabled + tooltip |
| Delivered | Green | ✅ | ❌ Hidden |
| Cancellation Requested | Orange | ⚠️ | ❌ Hidden |
| Cancelled | Red | ❌ | ❌ Hidden |
| Refund Pending | Violet | 🔄 | ❌ Hidden |
| Refund Completed | Green | ✅ | ❌ Hidden |

### 5.2 Order Detail Page — Visual Timeline

```
┌─────────────────────────────────────────────────────┐
│  Order #ORD-10234                                    │
├─────────────────────────────────────────────────────┤
│  ● Order Confirmed        — 12 Jun 2026, 10:30 AM   │
│  │                                                   │
│  ● Placed                 — 12 Jun 2026, 11:00 AM   │
│  │                                                   │
│  ● Processing             — 13 Jun 2026, 09:15 AM   │
│  │                                                   │
│  ○ Shipping               — Expected 14-15 Jun      │
│  │                                                   │
│  ○ Delivered              — Pending                  │
├─────────────────────────────────────────────────────┤
│  Delivery Address                                     │
│  John Doe, 123 Main St, City - 560001                │
├─────────────────────────────────────────────────────┤
│  Items                                                │
│  • Oyster Mushroom 500g × 2 = ₹499                   │
│  • Shiitake Mushroom 200g × 1 = ₹350                 │
├─────────────────────────────────────────────────────┤
│  Total: ₹1,299.00                                     │
│  Payment: Razorpay (Paid)                             │
│  Transaction: tx_abc123def456                         │
└─────────────────────────────────────────────────────┘
```

**For refund states, timeline shows:**

```
┌─────────────────────────────────────────────────────┐
│  ● Cancellation Requested   — 14 Jun 2026, 02:00 PM │
│  │                                                   │
│  ● Cancelled                — 14 Jun 2026, 03:00 PM │
│  │                                                   │
│  ● Refund Processing        — 14 Jun 2026, 03:05 PM │
│  │                                                   │
│  ○ Refund Completed         — Expected 3-5 days     │
└─────────────────────────────────────────────────────┘
```

### 5.3 Cancellation Modal (User)

```
┌─────────────────────────────────────────┐
│  ❌ Cancel Order #ORD-10234             │
├─────────────────────────────────────────┤
│  Reason for cancellation:               │
│  ┌─────────────────────────────────────┐│
│  │ ▼ Select a reason                  ││
│  ├─────────────────────────────────────┤│
│  │ Ordered by mistake                 ││
│  │ Wrong address                      ││
│  │ Found cheaper elsewhere            ││
│  │ Delivery taking too long           ││
│  │ Need different product             ││
│  │ Duplicate order                    ││
│  │ Other                              ││
│  └─────────────────────────────────────┘│
│                                         │
│  [Optional] Additional details:         │
│  ┌─────────────────────────────────────┐│
│  │                                     ││
│  └─────────────────────────────────────┘│
│                                         │
│  [Cancel Order]  [Go Back]              │
└─────────────────────────────────────────┘
```

On submit → confirmation popup:

```
┌─────────────────────────────────────────┐
│  ⚠️ Confirm Cancellation                │
│                                         │
│  Are you sure you want to cancel        │
│  Order #ORD-10234?                      │
│                                         │
│  Reason: Ordered by mistake             │
│                                         │
│  This cannot be undone.                 │
│                                         │
│  [Yes, Cancel Order]  [No, Keep It]    │
└─────────────────────────────────────────┘
```

### 5.4 No Changes To
- Checkout flow
- Payment flow
- Login/OTP flow
- Profile management
- Address management

---

## 6. Admin Panel Redesign

### 6.1 New Dashboard Sections — 12 Pillars

The admin order dashboard is restructured into 12 clear sections:

```
┌────────────────────────────────────────────────────────────┐
│  📊 Orders & Shipping                                       │
├────────────────────────────────────────────────────────────┤
│  [New Orders] [Placed] [Processing] [Shipping] [Delivered]  │
│  [Cancel Requests] [Cancelled]                              │
├────────────────────────────────────────────────────────────┤
│  💰 Refund Center                                           │
├────────────────────────────────────────────────────────────┤
│  [Refund Failed] [Manual Queue] [Auto Queue] [Completed]    │
└────────────────────────────────────────────────────────────┘
```

### 6.2 Section Details

| # | Section | Filter Logic | Actions |
|---|---------|-------------|---------|
| 1 | **New Orders** | `PENDING_APPROVAL` | Approve, Reject (with reason) |
| 2 | **Placed** | `PLACED` | Move to Processing |
| 3 | **Processing** | `PROCESSING` | Move to Shipping + Set ETA |
| 4 | **Shipping** | `SHIPPING, IN_TRANSIT` | Move to Delivered |
| 5 | **Delivered** | `DELIVERED` | View Details |
| 6 | **Cancel Requests** | `CANCEL_REQUESTED` | Approve (choose refund type), Reject |
| 7 | **Cancelled** | `CANCELLED` (any cancelled) | View Details |
| 8 | **Refund Failed** | `REFUND_FAILED` | Retry Auto, Move to Manual |
| 9 | **Manual Queue** | `MANUAL_REFUND_INITIATED` | Complete Refund (form) |
| 10 | **Auto Queue** | `REFUND_PENDING, REFUND_INITIATED` | View Status, Retry Failed |
| 11 | **Completed Refunds** | `REFUND_COMPLETED, MANUAL_REFUND_COMPLETED` | View Details |
| 12 | **Refund Center** | Overview with analytics | Stats, charts, search |

### 6.3 Admin Order Card (Enhanced)

```
┌───────────────────────────────────────────────────────────────┐
│  #ORD-10234  │  John Doe  │  12 Jun 2026  │  ₹1,299          │
├───────────────────────────────────────────────────────────────┤
│  Status: ● Placed          Payment: Razorpay ✅              │
│  Refund: —                 ETA: —                            │
├───────────────────────────────────────────────────────────────┤
│  [Move to Processing ▼]  [❌ Cancel & Refund]  [👁 Details]  │
├───────────────────────────────────────────────────────────────┤
│  Customer: john@email.com  |  +91-9876543210                  │
│  Address: 123 Main St, City - 560001                          │
│  Items: Oyster 500g × 2, Shiitake 200g × 1                   │
└───────────────────────────────────────────────────────────────┘
```

### 6.4 Pending Approval Section — New Orders

```
┌───────────────────────────────────────────────────────────────┐
│  ⏳ Pending Approval (3)                                      │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ #ORD-10235  John Doe  ₹899  12 Jun 10:30 AM  Razorpay  │ │
│  │ [✅ Approve]  [❌ Reject]                               │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ #ORD-10236  Jane Smith  ₹1,499  12 Jun 10:45 AM  COD   │ │
│  │ [✅ Approve]  [❌ Reject]                               │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

**Reject modal** (requires reason):

```
┌─────────────────────────────────────────┐
│  ❌ Reject Order #ORD-10235             │
├─────────────────────────────────────────┤
│  Reason for rejection:                  │
│  ┌─────────────────────────────────────┐│
│  │ ▼ Select a reason                  ││
│  ├─────────────────────────────────────┤│
│  │ Suspicious payment                 ││
│  │ Address not serviceable            ││
│  │ Duplicate order                    ││
│  │ Product out of stock               ││
│  │ Other                              ││
│  └─────────────────────────────────────┘│
│                                         │
│  [Reject Order]  [Cancel]               │
└─────────────────────────────────────────┘
```

### 6.5 No Changes To
- Existing product management
- Category management
- Training management
- Blog management
- Existing tab navigation structure

---

## 7. Cancellation Flow

### 7.1 Complete Flow Diagram

```
USER                        SYSTEM                    ADMIN
────                        ──────                    ─────
  │                           │                         │
  │  Click "Cancel Order"     │                         │
  │──────────────────────────►│                         │
  │                           │                         │
  │  Show reason dropdown     │                         │
  │◄──────────────────────────│                         │
  │                           │                         │
  │  Select reason + submit   │                         │
  │──────────────────────────►│                         │
  │                           │                         │
  │  Show confirmation popup  │                         │
  │◄──────────────────────────│                         │
  │                           │                         │
  │  Confirm cancellation     │                         │
  │──────────────────────────►│                         │
  │                           │                         │
  │  Status:                  │  Create CANCEL_REQUESTED │
  │  Cancellation Requested  │────────────────────────►│
  │  (awaiting admin)         │                         │
  │◄──────────────────────────│                         │
  │                           │                         │
  │                           │                         │  Review request
  │                           │                         │─────────────────
  │                           │                         │
  │                           │   ┌─────────────────────┼───────────────┐
  │                           │   │                     │               │
  │                           │   │ APPROVE             │ REJECT       │
  │                           │   │◄────────────────────┤               │
  │                           │   │                     │               │
  │                           │   │ Show refund type    │ REJECTED      │
  │                           │   │                     │ status set   │
  │                           │   ├─────────┐           │               │
  │                           │   │         │           │ Notify user   │
  │                           │   │         │           │               │
  │                           │ Auto     Manual         │               │
  │                           │ Refund   Refund         │               │
  │                           │   │         │           │               │
  │                           │   ▼         ▼           │               │
  │                           │ (see refund flow below) │               │
  │                           │                         │               │
  │  Notified of decision    │                         │               │
  │◄──────────────────────────│─────────────────────────┘               │
```

### 7.2 Cancellation Rules Matrix

| Current Status | Cancel Allowed? | Behavior |
|----------------|----------------|----------|
| PENDING_APPROVAL | ✅ Yes | Immediate status → CANCEL_REQUESTED |
| PLACED | ✅ Yes | Immediate status → CANCEL_REQUESTED |
| PROCESSING | ✅ Yes | Immediate status → CANCEL_REQUESTED |
| SHIPPING | ❌ No | Show: "Already shipped, cannot cancel" |
| IN_TRANSIT | ❌ No | Show: "Already shipped, cannot cancel" |
| DELIVERED | ❌ No | Show: "Order already delivered" |
| CANCEL_REQUESTED | ❌ No | Already pending |
| CANCEL_REJECTED | ❌ No | Contact support |
| Any refund state | ❌ No | Already in refund process |

---

## 8. Refund System Architecture

### 8.1 Refund Types

```
REFUND TYPES
│
├── AUTO REFUND
│   ├── Trigger: Admin approves cancellation + selects "Auto Refund"
│   ├── Gateway: Razorpay Refund API
│   ├── Duration: 3-7 business days (Razorpay processing)
│   ├── Success: → REFUND_COMPLETED
│   └── Failure: → REFUND_FAILED → Manual Queue
│
└── MANUAL REFUND
    ├── Trigger: Admin selects "Manual Refund" OR Auto Refund failed
    ├── Gateway: Offline (Bank Transfer / UPI / Cash / Cheque)
    ├── Duration: Admin-defined (typically 1-3 days)
    ├── Fields Required: Amount, Date, Payment Method, Reference
    └── Completion: → MANUAL_REFUND_COMPLETED
```

### 8.2 Auto Refund Flow

```
Admin clicks "Approve & Auto Refund"
              │
              ▼
    ┌──────────────────┐
    │ CANCEL_APPROVED   │
    │ delivery=cancelled│
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ REFUND_PENDING    │ ← Create refund record
    │ status=pending    │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ Call Razorpay API │
    │ POST /refunds     │
    └────────┬─────────┘
             │
      ┌──────┴──────┐
      ▼              ▼
  SUCCESS          FAILURE
      │              │
      ▼              ▼
  REFUND_        REFUND_
  INITIATED      FAILED
      │              │
      ▼              ▼
  REFUND_        Move to
  COMPLETED      Manual Queue
  (async webhook) │
                  ▼
            Notify Admin
            Notify User
```

### 8.3 Manual Refund Flow

```
Admin clicks "Initiate Manual Refund"
              │
              ▼
    ┌──────────────────────────────────┐
    │ MANUAL_REFUND_INITIATED          │
    │ Form requires:                   │
    │   • Refund Amount                │
    │   • Payment Method               │
    │     (Bank Transfer / UPI /       │
    │      Cash / Cheque)              │
    │   • Transaction Reference        │
    │   • Bank Reference (optional)    │
    │   • Refund Date                  │
    │   • Admin Notes                  │
    └────────┬─────────────────────────┘
             │
             ▼ (Admin processes offline)
             │
             ▼
    ┌──────────────────────────────────┐
    │ Admin clicks "Mark Completed"    │
    │ Form re-verifies:                │
    │   • Refund Reference Number      │
    │   • Refund Date                  │
    │   • Refund Amount                │
    └────────┬─────────────────────────┘
             │
             ▼
    ┌──────────────────────────────────┐
    │ MANUAL_REFUND_COMPLETED          │
    │ Notify user                      │
    │ Close ticket                     │
    └──────────────────────────────────┘
```

### 8.4 Refund Center Dashboard

```
┌────────────────────────────────────────────────────────────┐
│  💰 Refund Center                                           │
├────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Total    │ │ Pending  │ │ Failed   │ │ Completed│      │
│  │ ₹12,499  │ │ ₹3,500   │ │ ₹1,299   │ │ ₹7,700   │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
├────────────────────────────────────────────────────────────┤
│  Tabs: [Auto Pending] [Auto Failed] [Manual Pending]       │
│        [Manual Completed] [All Refunds]                    │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐ │
│  │ #ORD-10234 │ ₹1,299 │ Auto │ Failed │ 12 Jun 2026  │ │
│  │ [Retry Auto] [Move to Manual] [View Details]        │ │
│  └──────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ #ORD-10235 │ ₹899  │ Manual │ Pending │ 12 Jun 2026 │ │
│  │ [Complete Refund] [View Details]                    │ │
│  └──────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│  Search: [Order ID / Customer / Transaction...]            │
│  Filters: [Date Range] [Payment Method] [Refund Type]     │
└────────────────────────────────────────────────────────────┘
```

---

## 9. Notification System

### 9.1 Notification Triggers

| Event | Email | SMS | WhatsApp | In-App |
|-------|-------|-----|----------|--------|
| Order Pending Approval | ✅ | ✅ | — | ✅ |
| Order Approved → Placed | ✅ | ✅ | ✅ | ✅ |
| Order Rejected | ✅ | ✅ | — | ✅ |
| Order Processing | ✅ | ✅ | — | ✅ |
| Order Shipped | ✅ | ✅ | ✅ | ✅ |
| Order Delivered | ✅ | ✅ | ✅ | ✅ |
| Cancel Requested | ✅ | ✅ | — | ✅ |
| Cancel Approved | ✅ | ✅ | — | ✅ |
| Cancel Rejected | ✅ | ✅ | — | ✅ |
| Refund Initiated | ✅ | ✅ | ✅ | ✅ |
| Refund Failed | ✅ | ✅ | — | ✅ |
| Refund Completed | ✅ | ✅ | ✅ | ✅ |
| Manual Refund Initiated | ✅ | — | — | ✅ |
| Manual Refund Completed | ✅ | ✅ | ✅ | ✅ |

### 9.2 Notification Service Architecture

```javascript
// New: services/NotificationService.js
class NotificationService {
  async notify(eventType, order, metadata) {
    const channels = this.getChannelsForEvent(eventType);
    const promises = channels.map(channel => {
      switch(channel) {
        case 'email': return this.sendEmail(eventType, order, metadata);
        case 'sms': return this.sendSms(eventType, order, metadata);
        case 'whatsapp': return this.sendWhatsApp(eventType, order, metadata);
        case 'in_app': return this.sendInApp(eventType, order, metadata);
      }
    });
    await Promise.allSettled(promises); // Fire-and-forget, never block
  }
}
```

### 9.3 Email Templates (Transactional)

Each event gets a dedicated HTML email template:
- `order-confirmed.html` — Order placed successfully
- `order-approved.html` — Admin approved, order in processing
- `order-shipped.html` — Tracking info, ETA
- `order-delivered.html` — Thank you, review request
- `cancel-requested.html` — Confirmation of cancellation request
- `cancel-approved.html` — Cancellation approved, refund initiated
- `refund-initiated.html` — Refund in progress, expected timeline
- `refund-completed.html` — Refund completed, amount credited
- `refund-failed.html` — Refund failed, manual process initiated

---

## 10. Invoice Access Rules

### 10.1 Rule Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   INVOICE VISIBILITY MATRIX                      │
├──────────────┬──────────────────────┬───────────────────────────┤
│  STATUS      │  USER CAN VIEW/DL   │  ADMIN CAN VIEW/DL        │
├──────────────┼──────────────────────┼───────────────────────────┤
│  PENDING     │  ❌ No              │  ❌ No                    │
│  APPROVAL    │                     │                           │
├──────────────┼──────────────────────┼───────────────────────────┤
│  PLACED      │  ❌ No              │  ❌ No                    │
├──────────────┼──────────────────────┼───────────────────────────┤
│  PROCESSING  │  ❌ No              │  ❌ No                    │
├──────────────┼──────────────────────┼───────────────────────────┤
│  SHIPPING    │  ✅ Yes             │  ✅ Yes                   │
│  (shipped/   │  (Email + Download) │  (Full access)            │
│   in_transit)│                     │                           │
├──────────────┼──────────────────────┼───────────────────────────┤
│  DELIVERED   │  ✅ Yes             │  ✅ Yes                   │
├──────────────┼──────────────────────┼───────────────────────────┤
│  CANCELLED   │  ❌ No              │  ✅ Yes (IF payment done) │
│  (paid order)│                     │  Generated immediately     │
│              │                     │  upon cancellation.        │
├──────────────┼──────────────────────┼───────────────────────────┤
│  CANCELLED   │  ❌ No              │  ❌ No                    │
│  (unpaid)    │                     │  (No invoice needed)      │
├──────────────┼──────────────────────┼───────────────────────────┤
│  REJECTED    │  ❌ No              │  ❌ No                    │
└──────────────┴──────────────────────┴───────────────────────────┘
```

### 10.2 Business Rules

| # | Rule | Rationale |
|---|------|-----------|
| 1 | Invoice is **never visible to the user** until order reaches `SHIPPING` / `IN_TRANSIT`. | Invoice represents a legally dispatched shipment. Before shipping, the order may still be modified/cancelled. |
| 2 | Invoice buttons (View, Download, Share) are **hidden from all user-facing pages** for pre-shipping statuses (`PENDING_APPROVAL`, `PLACED`, `PROCESSING`). | Prevents confusion from premature invoice generation. |
| 3 | Invoice buttons are **hidden from admin UI** for pre-shipping statuses as well, except the cancelled-with-payment case. | Consistent behavior for both roles during active order lifecycle. |
| 4 | If an order is **cancelled and payment was collected** (status was `paid`), the invoice is **generated immediately for admin only**. | Admin needs the invoice for manual refund processing, accounting, and GST compliance. |
| 5 | If an order is **cancelled before payment** (status was `pending`), **no invoice is generated**. | No transaction occurred — no invoice required. |
| 6 | The `invoice_token` is still created at order creation (existing behavior), but the **share endpoint enforces visibility rules** at the server level. | Token existence ≠ accessibility. Server gate is the source of truth. |
| 7 | Invoice access is **never granted retroactively** for pre-shipping statuses, even with a valid token. | Token alone is insufficient — status check is mandatory. |

### 10.3 Backend Enforcement (Existing — Updated)

The existing share endpoint guard at `routes/orders.js:1173-1181` is updated:

```javascript
// Current (too permissive):
!["placed", "processing", "shipped", "in_transit", "delivered"].includes(order.delivery_status)

// New (shipping-only for non-cancelled):
function isInvoiceAccessible(order) {
  // Rule: User/admin can view invoice from SHIPPING onward
  const shippingStatuses = ['shipped', 'in_transit', 'delivered'];
  if (shippingStatuses.includes(order.delivery_status)) return true;

  // Rule: Admin can view invoice if order was paid and then cancelled
  const isAdmin = req.user && req.user.role === 'admin';
  if (isAdmin && order.delivery_status === 'cancelled' && order.status === 'paid') return true;

  return false;
}
```

### 10.4 Frontend Enforcement

#### Admin (`admin.js`)

```javascript
// Current (line 1800):
invoiceLink && ['placed', 'processing', 'shipped', 'in_transit', 'delivered'].includes(o.delivery_status)

// New:
function showInvoiceForAdmin(order) {
  const shippingStatuses = ['shipped', 'in_transit', 'delivered'];
  if (shippingStatuses.includes(order.delivery_status)) return true;
  // Cancelled + paid → admin sees invoice
  if (order.delivery_status === 'cancelled' && order.status === 'paid') return true;
  return false;
}
```

#### User (`app.js` — Order Tracking Page)

```javascript
// Hide invoice button for pre-shipping and cancelled statuses
const INVOICE_VISIBLE_STATUSES = ['shipped', 'in_transit', 'delivered'];
if (INVOICE_VISIBLE_STATUSES.includes(order.delivery_status)) {
  // Show "View Invoice" button
} else {
  // Hide invoice button
}
```

#### User (`ProfileModal.js` — Order History)

```javascript
// Remove invoice buttons for pre-shipping/cancelled orders in the profile card
const INVOICE_VISIBLE_STATUSES = ['shipped', 'in_transit', 'delivered'];
const showInvoice = order.invoice_token && INVOICE_VISIBLE_STATUSES.includes(order.delivery_status);
```

### 10.5 Invoice Generation on Cancellation

When an order with `status === 'paid'` is cancelled (by admin or approved user request):

```
Cancel Approved (paid order)
        │
        ▼
┌───────────────────────┐
│ Generate Invoice       │ ← Immediately, for admin use
│ (if not already exists)│
│ invoice_token created  │
│ Invoice stored in DB   │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│ Notify Admin           │ ← "Invoice generated for cancelled
│ (via dashboard banner) │    order #ORD-10234"
└───────────────────────┘
```

**What the admin sees for cancelled-with-payment orders:**

```
┌──────────────────────────────────────────────────────────────┐
│  Order #ORD-10234  │  CANCELLED  │  ₹1,299  (Paid)          │
├──────────────────────────────────────────────────────────────┤
│  Cancelled by: User  │  Reason: Ordered by mistake          │
│  Refund: Manual Initiated  │  Invoice: 📄 Available         │
├──────────────────────────────────────────────────────────────┤
│  [View Invoice]  [Download PDF]  [Manual Refund Details]     │
└──────────────────────────────────────────────────────────────┘
```

**What the user sees for the same order:**

```
┌──────────────────────────────────────────────────────────────┐
│  Order #ORD-10234  │  CANCELLED  │  ₹1,299                  │
├──────────────────────────────────────────────────────────────┤
│  Cancellation Reason: Ordered by mistake                     │
│  Refund: In Progress (Manual)                                │
│                                                              │
│  ❌ Invoice not available for cancelled orders.              │
│     Contact support for any billing queries.                 │
└──────────────────────────────────────────────────────────────┘
```

### 10.6 No Changes To
- Invoice token creation logic (still created at order creation)
- Invoice HTML template
- Invoice PDF generation
- Invoice data payload (order items, pricing, GST)

---

## 11. Audit Log System

### 11.1 Schema

```sql
CREATE TABLE order_audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  action        VARCHAR(50) NOT NULL,
  performed_by  VARCHAR(255) NOT NULL,  -- admin email or 'system' or user_id
  previous_state JSONB,                  -- snapshot before change
  new_state     JSONB,                   -- snapshot after change
  metadata      JSONB DEFAULT '{}',      -- reason, notes, refund_id, etc.
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_order ON order_audit_logs(order_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON order_audit_logs(action);
```

### 11.2 Logged Actions

```javascript
const AUDIT_ACTIONS = {
  ORDER_CREATED:           'ORDER_CREATED',
  ORDER_APPROVED:          'ORDER_APPROVED',
  ORDER_REJECTED:          'ORDER_REJECTED',
  STATUS_CHANGED:          'STATUS_CHANGED',
  CANCEL_REQUESTED:        'CANCEL_REQUESTED',
  CANCEL_APPROVED:         'CANCEL_APPROVED',
  CANCEL_REJECTED:         'CANCEL_REJECTED',
  REFUND_INITIATED:        'REFUND_INITIATED',
  REFUND_COMPLETED:        'REFUND_COMPLETED',
  REFUND_FAILED:           'REFUND_FAILED',
  MANUAL_REFUND_INITIATED: 'MANUAL_REFUND_INITIATED',
  MANUAL_REFUND_COMPLETED: 'MANUAL_REFUND_COMPLETED',
  NOTIFICATION_SENT:       'NOTIFICATION_SENT',
};
```

### 11.3 Immutable Log Enforcement

```javascript
// Logs are INSERT-only. No UPDATE or DELETE privileges.
// API endpoint: GET /api/admin/orders/:id/audit-logs (read-only)
// No endpoint for modifying or deleting logs.
```

---

## 12. Database Schema

### 12.1 Existing Tables — No Schema Changes (Additive Only)

The existing `orders` table is preserved as-is. New columns are added for the redesigned state machine.

### 12.2 Orders Table — New Columns

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  admin_approval_status  VARCHAR(50) DEFAULT 'pending';  -- 'pending' | 'approved' | 'rejected'

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  rejection_reason       TEXT;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  cancellation_reason    VARCHAR(100);   -- Structured reason code

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  cancellation_reason_text TEXT;         -- If "Other", the custom text

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  shipped_at             TIMESTAMPTZ;    -- When status moved to SHIPPING

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  delivered_at           TIMESTAMPTZ;    -- When status moved to DELIVERED

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  refund_type            VARCHAR(20);    -- 'auto' | 'manual'

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  refund_initiated_at    TIMESTAMPTZ;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  refund_completed_at    TIMESTAMPTZ;
```

### 12.3 Refunds Table — Enhanced

```sql
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS
  refund_type            VARCHAR(20) DEFAULT 'auto';  -- 'auto' | 'manual'

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS
  payment_mode           VARCHAR(50);   -- 'bank_transfer' | 'upi' | 'cash' | 'cheque' | 'razorpay'

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS
  transaction_reference  VARCHAR(255);  -- Bank ref / UPI ref / cheque no

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS
  bank_reference         VARCHAR(255);

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS
  processed_at           TIMESTAMPTZ;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS
  completed_at           TIMESTAMPTZ;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS
  processed_by           VARCHAR(255);  -- Admin who processed
```

### 12.4 New Tables

```sql
-- Order Audit Log
CREATE TABLE IF NOT EXISTS order_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  action          VARCHAR(50) NOT NULL,
  performed_by    VARCHAR(255) NOT NULL,
  previous_state  JSONB,
  new_state       JSONB,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications Log
CREATE TABLE IF NOT EXISTS notification_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        INTEGER REFERENCES orders(id),
  event_type      VARCHAR(50) NOT NULL,
  channel         VARCHAR(20) NOT NULL,  -- 'email' | 'sms' | 'whatsapp' | 'in_app'
  recipient       VARCHAR(255) NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'sent' | 'failed'
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Refund Queue (for managing the refund center queue items)
CREATE TABLE IF NOT EXISTS refund_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  refund_type     VARCHAR(20) NOT NULL,  -- 'auto' | 'manual'
  status          VARCHAR(30) NOT NULL,  -- 'pending' | 'processing' | 'completed' | 'failed'
  assigned_to     VARCHAR(255),
  priority        INTEGER DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 12.5 Status Enum Reference

| Field | Values |
|-------|--------|
| `orders.status` (new) | `PENDING_APPROVAL`, `PLACED`, `PROCESSING`, `SHIPPING`, `DELIVERED`, `REJECTED`, `CANCEL_REQUESTED`, `CANCEL_APPROVED`, `CANCEL_REJECTED`, `REFUND_PENDING`, `REFUND_INITIATED`, `REFUND_PROCESSING`, `REFUND_COMPLETED`, `REFUND_FAILED`, `MANUAL_REFUND_INITIATED`, `MANUAL_REFUND_COMPLETED` |
| `orders.delivery_status` (existing) | `placed`, `processing`, `shipped`, `in_transit`, `delivered`, `cancelled` |
| `orders.admin_approval_status` | `pending`, `approved`, `rejected` |
| `orders.refund_type` | `auto`, `manual` |
| `refunds.payment_mode` | `razorpay`, `bank_transfer`, `upi`, `cash`, `cheque` |
| `refunds.status` | `pending`, `initiated`, `processing`, `completed`, `failed` |

---

## 13. API Design

### 13.1 New Endpoints

#### Order Management

```
POST   /api/orders/admin/approve/:id
  Body: { adminNote?: string }
  Response: { order, message }
  Description: Admin approves a PENDING_APPROVAL order → PLACED

POST   /api/orders/admin/reject/:id
  Body: { reason: string, adminNote?: string }
  Response: { order, message }
  Description: Admin rejects a PENDING_APPROVAL order → REJECTED. User notified.

PUT    /api/orders/:id/status
  Body: { delivery_status: string, delivery_days_text?: string }
  Response: { order }
  Description: Forward-only status change. Enforces transition rules.
  Error: "Cannot move backward from X to Y"

GET    /api/orders/my-orders
  Query: { page, limit, status }
  Response: { orders[], total, page, limit }
  Description: Enhanced user order list with refund status, timeline
```

#### Cancellation

```
POST   /api/orders/:id/request-cancel
  Body: { reason: string, reasonText?: string }
  Response: { order, message }
  Description: User requests cancellation. Validates cancellable state.
  Error: "Order has already been shipped and can no longer be cancelled."

POST   /api/refunds/approve-cancellation/:id
  Body: { refundType: 'auto' | 'manual', adminNote?: string }
  Response: { order, refund }
  Description: Admin approves cancellation with refund type selection.

POST   /api/refunds/reject-cancellation/:id
  Body: { reason: string }
  Response: { order }
  Description: Admin rejects cancellation. Order returns to previous state.
```

#### Refund Center

```
GET    /api/refunds/center
  Query: { tab, search, dateFrom, dateTo, paymentMethod, page, limit }
  Response: { refunds[], stats: { total, pending, failed, completed }, pagination }
  Description: Refund center dashboard data.

POST   /api/refunds/manual/:id/initiate
  Body: { refundAmount, paymentMode, transactionReference, bankReference?, refundDate, notes }
  Response: { order, refund }
  Description: Admin initiates manual refund. All fields required.

POST   /api/refunds/manual/:id/complete
  Body: { refundReferenceNumber, refundDate, refundAmount, adminNote? }
  Response: { order, refund }
  Description: Admin marks manual refund as completed.

POST   /api/refunds/:id/retry-auto
  Response: { refund }
  Description: Retry failed auto refund via Razorpay.

POST   /api/refunds/:id/move-to-manual
  Body: { adminNote? }
  Response: { order, refund }
  Description: Move a failed auto refund to manual queue.
```

#### Notifications

```
POST   /api/admin/orders/:id/notify
  Body: { eventType: string }
  Response: { success, channels: string[] }
  Description: Manually trigger notification for an order event.

GET    /api/admin/orders/:id/notification-log
  Response: { notifications[] }
  Description: View notification history for an order.
```

#### Audit

```
GET    /api/admin/orders/:id/audit-logs
  Query: { page, limit }
  Response: { logs[], pagination }
  Description: Immutable audit trail for an order. Read-only.
```

### 13.2 Validation Rules

```javascript
// Cancel request validation
const cancelRequestSchema = Joi.object({
  reason: Joi.string()
    .valid('ordered_by_mistake', 'wrong_address', 'found_cheaper', 'delivery_too_long',
           'need_different_product', 'duplicate_order', 'other')
    .required(),
  reasonText: Joi.string()
    .when('reason', { is: 'other', then: Joi.required(), otherwise: Joi.optional() })
    .max(500),
});

// Manual refund initiation validation
const manualRefundInitiateSchema = Joi.object({
  refundAmount: Joi.number().positive().required(),
  paymentMode: Joi.string()
    .valid('bank_transfer', 'upi', 'cash', 'cheque')
    .required(),
  transactionReference: Joi.string().required().max(255),
  bankReference: Joi.string().optional().max(255),
  refundDate: Joi.date().required(),
  notes: Joi.string().optional().max(1000),
});

// Manual refund completion validation
const manualRefundCompleteSchema = Joi.object({
  refundReferenceNumber: Joi.string().required().max(255),
  refundDate: Joi.date().required(),
  refundAmount: Joi.number().positive().required(),
  adminNote: Joi.string().optional().max(1000),
});
```

### 13.3 Error Handling Pattern

```javascript
// All new endpoints follow this pattern:
async (req, res) => {
  try {
    // 1. Validate input
    const body = await schema.validateAsync(req.body);

    // 2. Check preconditions
    const order = await repo.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // 3. Check state machine transition validity
    assertValidTransition(order.status, targetStatus);

    // 4. Take snapshot for audit log
    const previousState = snapshotOrder(order);

    // 5. Execute mutation
    const result = await someServiceFunction(order, body);

    // 6. Log audit
    await auditLog.create({ orderId: order.id, action: '...', previousState, newState: snapshotOrder(result.order), performedBy: req.user.email });

    // 7. Send notifications (async, non-blocking)
    notificationService.notify('EVENT_TYPE', result.order).catch(logger.warn);

    // 8. Return success
    return res.json({ ...result, message: '...' });
  } catch (err) {
    if (err.isJoi) return res.status(400).json({ error: err.message });
    if (err.message.includes('Cannot move backward')) return res.status(400).json({ error: err.message });
    if (err.message.includes('cannot be cancelled')) return res.status(400).json({ error: err.message });
    logger.error(`[Endpoint] ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

---

## 14. Razorpay Refund Integration

### 14.1 Current Integration (Preserved)

The existing `initiateRazorpayRefund` function in `RefundService.js` is preserved and enhanced:

```javascript
// Existing (preserved):
async function initiateRazorpayRefund(paymentId, amountInPaise, idempotencyKey, metadata) {
  return razorpay.payments.refund(paymentId, {
    amount: amountInPaise,
    speed: 'normal',   // 'normal' or 'optimum'
    notes: {
      orderId: metadata.orderId,
      reason: metadata.reason,
      initiatedBy: metadata.initiatedBy
    }
  }, { idempotency: idempotencyKey });
}
```

### 14.2 Enhancements

```javascript
// New: handleRefundWebhook(req, res)
// Razorpay sends webhook on refund status changes
async function handleRefundWebhook(req, res) {
  const webhook = req.body;
  // Verify webhook signature using razorpay webhook secret
  const isValid = verifyRazorpayWebhook(req);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  if (webhook.event === 'refund.created') {
    // Update refund record status to processing
    await repo.updateRefundByRazorpayId(webhook.payload.refund.id, { status: 'processing' });
  }

  if (webhook.event === 'refund.processed') {
    // Refund completed by Razorpay
    await repo.updateRefundByRazorpayId(webhook.payload.refund.id, {
      status: 'completed',
      completed_at: new Date().toISOString()
    });
    // Update order status
    await repo.updateOrder(orderId, {
      status: OrderStates.REFUND_COMPLETED,
      refund_status: 'completed'
    });
    // Notify user
    await notificationService.notify('REFUND_COMPLETED', order);
  }

  return res.status(200).json({ status: 'ok' });
}
```

### 14.3 Idempotency

```javascript
// Each refund attempt gets a deterministic idempotency key
// to prevent duplicate refunds on retry
function generateRefundIdempotencyKey(orderId, paymentId, amount, attempt) {
  return crypto
    .createHash('sha256')
    .update(`${orderId}:${paymentId}:${amount}:${attempt}`)
    .digest('hex')
    .substring(0, 32);
}
```

### 14.4 Refund Status Mapping

| Razorpay Status | Our Status | Action |
|----------------|------------|--------|
| `created` | `processing` | Awaiting processing |
| `processed` | `completed` | Refund complete, notify user |
| `failed` | `failed` | Move to manual queue |
| `pending` | `processing` | Wait for webhook |

---

## 15. Edge Cases & Error Handling

### 15.1 Order Lifecycle Edge Cases

| # | Scenario | Handling |
|---|----------|----------|
| 1 | User cancels while admin is processing | Cancel takes priority. Admin sees "Order cancelled by user" notification. |
| 2 | Admin tries to move status backward | Server throws `Cannot move backward`. UI button is disabled, but server enforces independently. |
| 3 | User double-clicks cancel | Idempotency check: if already `CANCEL_REQUESTED`, return existing state. |
| 4 | Payment pending when cancel requested | If `status: 'pending'`, cancel without refund. If `status: 'paid'`, proceed with refund. |
| 5 | Order in `SHIPPING` — user tries to cancel | Error: "Order has already been shipped and cannot be cancelled." Disable button in UI. |
| 6 | Razorpay refund initiated but webhook never arrives | Cron job checks refunds in `initiated` state for >7 days and marks as `failed`. |
| 7 | Manual refund initiated but never completed | Admin dashboard shows stale entries in Manual Queue >7 days with warning badge. |
| 8 | Razorpay payment expired (capture failed) | Cancel without refund. `refund_status = 'none'`. |

### 15.2 Concurrency Edge Cases

| # | Scenario | Handling |
|---|----------|----------|
| 9 | Two admins approve same cancellation | First wins. Second gets "Already approved by X at [time]". |
| 10 | Admin approves while user also cancels | Both transition to `CANCEL_REQUESTED` · first mutation wins. |
| 11 | Razorpay webhook arrives during manual retry | Refund record status check prevents double-processing. |
| 12 | Database transaction fails mid-refund | Compensating transaction: refund record created BEFORE gateway call. If DB fails after gateway success, reconciliation job catches orphaned Razorpay refunds. |

### 15.3 Refund Edge Cases

| # | Scenario | Handling |
|---|----------|----------|
| 13 | Razorpay refund amount exceeds payment | Razorpay rejects. Error message returned to admin. |
| 14 | Partial refund requested > remaining balance | Validation rejects: "Refund amount exceeds remaining balance." |
| 15 | Manual refund entered with wrong amount | Admin can void and re-initiate within 24 hours (if status still `MANUAL_REFUND_INITIATED`). |
| 16 | Duplicate refund request (same order, same amount) | Idempotency key prevents duplicate Razorpay calls. |
| 17 | Refund for COD order | Auto refund not available — forced to manual refund. |
| 18 | Foreign currency / international payment | Razorpay handles conversion. Our system stores in INR only. |

---

## 16. Security Considerations

### 16.1 Authorization Matrix

| Action | Required Role | Notes |
|--------|--------------|-------|
| View my orders | Authenticated user | `req.user.id === order.user_id` |
| Cancel my order | Authenticated user | `req.user.id === order.user_id` + cancellable state |
| Approve/reject order | Admin | `req.user.role === 'admin'` |
| Approve/reject cancellation | Admin | `req.user.role === 'admin'` |
| Initiate/complete manual refund | Admin | `req.user.role === 'admin'` |
| View audit logs | Admin | `req.user.role === 'admin'` |
| Retry refund | Admin | `req.user.role === 'admin'` |
| View refund center | Admin | `req.user.role === 'admin'` |
| Trigger notification | Admin | `req.user.role === 'admin'` |

### 16.2 Data Integrity

- **Idempotency keys** prevent duplicate refunds
- **Optimistic locking** with `updated_at` timestamp check prevents race conditions
- **Audit logs are INSERT-only** — no update or delete endpoints
- **Refund records are immutable** after completion — no edits allowed

### 16.3 Sensitive Data

- Refund transaction references stored encrypted at rest
- Payment gateway keys never exposed to frontend
- Admin actions logged with identity (email, not just "admin")
- No PII in URLs (use order IDs, not customer identifiers)

### 16.4 API Security

- Rate limiting on cancel request endpoint (max 5 per hour per user)
- CSRF protection on all mutation endpoints
- Request validation on ALL inputs (Joi schemas)
- Webhook signature verification for Razorpay callbacks

---

## 17. QA Test Cases

### 17.1 Order Status Flow

| TC# | Test Case | Steps | Expected Result |
|-----|-----------|-------|-----------------|
| OF-01 | Place new order | User completes checkout | Order appears in PENDING_APPROVAL |
| OF-02 | Admin approves order | Admin clicks Approve | Status → PLACED, user notified |
| OF-03 | Admin rejects order | Admin clicks Reject with reason | Status → REJECTED, user notified with reason |
| OF-04 | Move PLACED → PROCESSING | Admin clicks Move | Status updates, audit logged |
| OF-05 | Move PROCESSING → SHIPPING | Admin clicks Move with ETA | Status updates, user notified, cancellation disabled |
| OF-06 | Move SHIPPING → DELIVERED | Admin clicks Move | Status updates, user notified |
| OF-07 | Backward transition attempt | Admin tries PROCESSING → PLACED | Error: "Cannot move backward" |
| OF-08 | Skip transition attempt | Admin tries PLACED → SHIPPED | Error: "Cannot skip status" |

### 17.2 Cancellation Flow

| TC# | Test Case | Steps | Expected Result |
|-----|-----------|-------|-----------------|
| CN-01 | Cancel from PLACED | User clicks Cancel, selects reason, confirms | Status → CANCEL_REQUESTED |
| CN-02 | Cancel from PROCESSING | User clicks Cancel, selects reason, confirms | Status → CANCEL_REQUESTED |
| CN-03 | Cancel from SHIPPING | User clicks Cancel | Error: "Already shipped, cannot cancel" |
| CN-04 | Cancel from DELIVERED | User clicks Cancel | Error: "Already delivered" |
| CN-05 | Admin approves cancellation | Admin clicks Approve, selects Auto Refund | Refund initiated via Razorpay |
| CN-06 | Admin approves cancellation (Manual) | Admin clicks Approve, selects Manual Refund | MANUAL_REFUND_INITIATED |
| CN-07 | Admin rejects cancellation | Admin clicks Reject with reason | Status returns to PLACED |
| CN-08 | Cancel with reason "Other" | User selects Other, enters custom text | Reason saved correctly |

### 17.3 Refund Flow

| TC# | Test Case | Steps | Expected Result |
|-----|-----------|-------|-----------------|
| RF-01 | Auto refund success | Razorpay returns success | REFUND_INITIATED → REFUND_COMPLETED |
| RF-02 | Auto refund failure | Razorpay returns error | REFUND_FAILED, moves to manual queue |
| RF-03 | Manual refund initiation | Admin fills required fields | MANUAL_REFUND_INITIATED |
| RF-04 | Manual refund completion | Admin fills reference, date, amount | MANUAL_REFUND_COMPLETED |
| RF-05 | Retry failed refund | Admin clicks Retry on REFUND_FAILED | New Razorpay attempt |
| RF-06 | Move failed to manual | Admin clicks Move to Manual | MANUAL_REFUND_INITIATED |
| RF-07 | Duplicate refund attempt | Same order, same amount | Idempotency key prevents duplicate |

### 17.4 Admin Dashboard

| TC# | Test Case | Steps | Expected Result |
|-----|-----------|-------|-----------------|
| AD-01 | View New Orders | Click New Orders tab | Only PENDING_APPROVAL orders shown |
| AD-02 | View Cancel Requests | Click Cancel Requests tab | Only CANCEL_REQUESTED orders shown |
| AD-03 | View Refund Center | Click Refund Center | Stats cards + tabbed queue |
| AD-04 | Search in any section | Enter Order ID | Filtered results |
| AD-05 | Date filter | Select date range | Orders within range |

### 17.5 User UI

| TC# | Test Case | Steps | Expected Result |
|-----|-----------|-------|-----------------|
| UI-01 | View order list | User opens My Orders | Premium card design with all fields |
| UI-02 | View order detail | User clicks View Details | Timeline shown with progress |
| UI-03 | Track order | User clicks Track | Shows current status + ETA |
| UI-04 | Cancel button visibility | Check all statuses | Only visible for cancellable states |
| UI-05 | Refund display | Check order with refund | Refund status, amount, method shown |

### 17.6 Audit & Notifications

| TC# | Test Case | Steps | Expected Result |
|-----|-----------|-------|-----------------|
| AN-01 | Status change logged | Admin moves order | Audit log entry created |
| AN-02 | Cancel request logged | User cancels | Audit log entry with reason |
| AN-03 | Refund action logged | Admin processes refund | Audit log with all details |
| AN-04 | Notification sent | Order status changes | Email/SMS/WhatsApp sent |
| AN-05 | Notification failure | SMTP down | Logged as failed, not blocking |

---

## 18. Migration Strategy

### 18.1 Phased Rollout

```
PHASE 1 — Foundation (Week 1)
├── Add new DB columns (additive, no existing changes)
├── Create new tables (order_audit_logs, notification_logs, refund_queue)
├── Extend OrderStateService with new statuses
├── Backfill: Update existing orders to PENDING_APPROVAL → PLACED
├── New: AuditLogService (write-only initially)
├── New: NotificationService (register channels, no-op sending initially)
└── Deploy: No visible changes, but infrastructure is in place

PHASE 2 — Status Machine (Week 2)
├── New: Status transition middleware (forward-only enforcement)
├── New: Shipping lock middleware
├── Update: Status change endpoints with validation
├── New: GET /api/orders/my-orders (enhanced response)
├── Update: Admin status controls with backward-movement protection
└── Deploy: Status changes are now enforced. Users see enhanced order data.

PHASE 3 — Cancellation + Refund (Week 3)
├── New: Structured cancellation reasons + admin flow
├── New: Refund type selection (auto/manual) during approval
├── New: Manual refund complete flow with required fields
├── New: Refund center dashboard
├── New: Razorpay webhook handler
├── Update: NotificationService with real email/SMS sending
└── Deploy: Full cancellation and refund cycle operational.

PHASE 4 — Admin Dashboard (Week 4)
├── New: 12-section admin panel (tabs with data)
├── New: Pending Approval section (approve/reject)
├── New: Refund center with stats and queues
├── Update: Existing admin order cards with enhanced data
├── Update: Audit log viewer in admin
└── Deploy: Complete admin panel redesign.

PHASE 5 — User UI + Polish (Week 5)
├── New: Premium order cards with timeline
├── New: User refund view (in-progress, completed)
├── New: Order tracking page enhancements
├── Update: Cancellation modal with dropdown
├── QA: Full regression test suite
├── Performance: Load testing, query optimization
└── Deploy: Full system live.
```

### 18.2 Backward Compatibility

- All existing API endpoints continue to work unchanged
- Old status values are mapped to new ones via a compatibility layer
- `delivery_status` field is still updated for existing frontend code
- No existing frontend code needs modification for the new system to work
- New features are additive — old features remain accessible via old paths

### 18.3 Rollback Plan

```javascript
// If Phase 2 causes issues:
// 1. Disable forward-only enforcement via feature flag
const FEATURE_FLAGS = {
  ENFORCE_FORWARD_ONLY: false,  // Set to false to disable
  ENABLE_CANCEL_REASONS: false,
  ENABLE_REFUND_CENTER: false,
};

// 2. Old endpoints remain operational
// 3. New columns can be rolled back with DROP COLUMN IF EXISTS
// 4. New tables are independent — DROP them if needed
```

---

## 19. Production Deployment Checklist

### Pre-Deployment

- [ ] All new DB migrations tested on staging
- [ ] Rollback scripts prepared and tested
- [ ] Feature flags configured (all disabled initially)
- [ ] Razorpay webhook endpoint registered in Razorpay dashboard
- [ ] Webhook secret configured in environment variables
- [ ] Email service (Resend/SMTP) configured and tested
- [ ] SMS service (Twilio) configured and tested
- [ ] WhatsApp API credentials configured (if applicable)
- [ ] Rate limiting configured for cancel endpoints
- [ ] CORS updated for any new frontend routes

### Staging Verification

- [ ] All QA test cases (Section 17) pass
- [ ] Order creation → approval → processing → shipping → delivery
- [ ] Cancellation from all valid states
- [ ] Auto refund (mock Razorpay) success and failure paths
- [ ] Manual refund initiation and completion
- [ ] Refund center displays correct data
- [ ] Audit logs created for all actions
- [ ] Notifications sent (check logs)
- [ ] No regression in existing checkout flow
- [ ] No regression in existing payment flow
- [ ] No regression in existing user profile

### Performance Checklist

- [ ] Index on `orders.status` for new status queries
- [ ] Index on `orders.admin_approval_status`
- [ ] Index on `order_audit_logs(order_id, created_at)`
- [ ] Refund center queries optimized (limit 50 per page)
- [ ] Load test: 100 concurrent order creations
- [ ] Load test: 50 concurrent cancellation requests
- [ ] API response times < 200ms for order list queries

### Deployment Steps

```
1. Run DB migrations (additive only)
2. Deploy backend code (new endpoints + enhanced services)
3. Enable FEATURE_FLAGS one by one:
   a. ENABLE_FORWARD_ONLY = false (monitor 24h)
   b. ENABLE_FORWARD_ONLY = true (monitor 24h)
   c. ENABLE_CANCEL_REASONS = true
   d. ENABLE_REFUND_CENTER = true
4. Deploy frontend code (enhanced order cards + admin sections)
5. Run post-deployment smoke tests
6. Monitor error logs for 48 hours
7. Remove feature flag checks (clean up)
```

### Post-Deployment Monitoring (48h)

- [ ] Error rate < 0.1% for new endpoints
- [ ] No failed refunds due to code issues
- [ ] Audit log entries created for all status changes
- [ ] Notification delivery rate > 95%
- [ ] No duplicate refunds
- [ ] No backward status transitions
- [ ] User-reported issues = 0

---

## Appendix A: File Change Map

| File | Change Type | What Changes |
|------|------------|-------------|
| `backend/src/modules/orders/OrderStateService.js` | **Enhance** | Add PENDING_APPROVAL, REJECTED, SHIPPING statuses. Add forward-only validator. Add shipping lock check. |
| `backend/src/modules/refunds/RefundService.js` | **Enhance** | Add manualRefundComplete() with reference validation. Add webhook handler. Add retry logic. |
| `backend/src/modules/refunds/RefundController.js` | **Enhance** | Add /center, /manual/:id/complete, /:id/retry-auto, /:id/move-to-manual, approve-cancellation with refund type. |
| `backend/src/routes/orders.js` | **Enhance** | Add /admin/approve/:id, /admin/reject/:id, enhanced /my-orders. |
| `backend/src/services/NotificationService.js` | **New** | Email + SMS + WhatsApp + in-app notification dispatcher. |
| `backend/src/services/AuditLogService.js` | **New** | Immutable audit log writer + reader. |
| `backend/src/server.js` | **Enhance** | Add DB migrations for new columns/tables. Register webhook route. |
| `frontend/src/app.js` | **Enhance** | Premium order cards. Structured cancel modal. Timeline view. Refund status display. |
| `frontend/src/admin.js` | **Enhance** | 12-section dashboard. Approve/reject modals. Refund center. Enhanced order cards. |
| `frontend/admin.html` | **Enhance** | New section containers. Refund center HTML. Enhanced status pills. |
| `frontend/src/components/ProfileModal.js` | **Enhance** | Premium order cards. Cancel modal with dropdown. Timeline. |

## Appendix B: Razorpay Webhook Setup

1. Go to Razorpay Dashboard → Settings → Webhooks
2. Add webhook URL: `https://yourdomain.com/api/webhooks/razorpay`
3. Subscribe to events: `refund.created`, `refund.processed`, `payment.captured`
4. Copy webhook secret → set as `RAZORPAY_WEBHOOK_SECRET` in `.env`
5. Verify signature in webhook handler:

```javascript
const crypto = require('crypto');
function verifyRazorpayWebhook(req) {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return req.headers['x-razorpay-signature'] === expectedSignature;
}
```

---

*End of Implementation Plan*
