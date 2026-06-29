# 🍄 Sporekart — Application Flow Diagrams

> Complete system architecture, routing, state machines & data flows  
> Generated from codebase analysis — Last updated: June 29, 2026

---

## 1. System Architecture Overview

High-level view of frontend, backend, database, and external service integration.

```mermaid
graph TB
    subgraph BROWSER["🌐 Browser SPA"]
        APP["app.js\nHash Router"] 
        ADMIN["admin.html\nadmin.js Panel"]
        CSS["style.css\nadmin-premium.css"]
    end
    
    subgraph BACKEND["⚙️ Express.js Server (server.js)"]
        MIDDLEWARE["Middleware\nauthMiddleware\nvalidateBody\nrateLimit"]
        
        subgraph ROUTES["API Routes"]
            ORDERS["/api/orders\ncheckout, fulfillment\ncancel, track"]
            REFUNDS["/api/refunds\ncancel requests\nrefund management"]
            SHIPPING["/api/shipping\ncreate, track\ncancel shipment, NDR"]
            WEBHOOKS["/api/webhooks\ncarrier events"]
            AUTH["/api/auth\nlogin, OTP, profile"]
            PRODUCTS["/api/products"]
            CATEGORIES["/api/categories"]
            BLOGS["/api/blogs"]
            TRAININGS["/api/trainings"]
        end
        
        subgraph MODULES["Business Logic"]
            REFUND_SVC["RefundService\ncancelCarrierShipment\nexecuteRefundProcess\napproveCancellation"]
            ORDER_SVC["OrderStateService\nstate machine\nrestockOrderItems\nisWithCarrier"]
            PAYMENT_SVC["PaymentService\nRazorpay integration\nidempotency keys"]
            AUDIT_SVC["RefundAuditService\nimmutable audit logs"]
        end
        
        subgraph SERVICES["Service Layer"]
            NOTIFY["notificationService\nEmail + SMS + WhatsApp"]
            SHIP_PROV["shipping/ProviderRegistry\nShiprocketAdapter"]
            AUTH_SVC["authService\nJWT + OTP"]
        end
        
        subgraph CONFIG["Config"]
            DB_CFG["db.js\nmock / Supabase"]
            JWT_CFG["jwt.js"]
            RAZORPAY_CFG["razorpay.js"]
        end
    end
    
    subgraph DATABASE["🗄️ Database"]
        ORDERS_DB["orders"]
        SHIPMENTS_DB["shipments"]
        REFUNDS_DB["refunds"]
        PRODUCTS_DB["products"]
        USERS_DB["users"]
        HISTORY_DB["order_status_history"]
        FULFILL_DB["fulfillment_tasks"]
        SHIP_PROV_DB["shipping_providers"]
        AUDIT_DB["refund_audits"]
    end
    
    subgraph EXTERNAL["🌍 External"]
        RAZOR["Razorpay\nPayment Gateway"]
        SHIPROCKET["Shiprocket\nShipping Carrier"]
        SUPABASE["Supabase\n(production only)"]
    end
    
    APP --> ORDERS
    APP --> AUTH
    APP --> PRODUCTS
    APP --> CATEGORIES
    ADMIN --> ORDERS
    ADMIN --> REFUNDS
    ADMIN --> SHIPPING
    
    ORDERS --> ORDER_SVC
    ORDERS --> REFUND_SVC
    ORDERS --> PAYMENT_SVC
    REFUNDS --> REFUND_SVC
    SHIPPING --> SHIP_PROV
    WEBHOOKS --> SHIP_PROV
    WEBHOOKS --> ORDER_SVC
    AUTH --> AUTH_SVC
    
    REFUND_SVC --> ORDER_SVC
    REFUND_SVC --> PAYMENT_SVC
    REFUND_SVC --> AUDIT_SVC
    REFUND_SVC --> NOTIFY
    
    ORDER_SVC --> DB_CFG
    REFUND_SVC --> DB_CFG
    
    DB_CFG --> ORDERS_DB
    DB_CFG --> SHIPMENTS_DB
    DB_CFG --> REFUNDS_DB
    DB_CFG --> PRODUCTS_DB
    DB_CFG --> USERS_DB
    DB_CFG --> HISTORY_DB
    DB_CFG --> FULFILL_DB
    
    PAYMENT_SVC --> RAZOR
    SHIP_PROV --> SHIPROCKET
    DB_CFG --> SUPABASE

    style BROWSER fill:#1a3a2a,stroke:#4ecdc4,color:#e0e8e4
    style BACKEND fill:#2a2a1a,stroke:#ffd166,color:#e0e8e4
    style DATABASE fill:#2a1a1a,stroke:#ef476f,color:#e0e8e4
    style EXTERNAL fill:#1a1a2a,stroke:#118ab2,color:#e0e8e4
```

---

## 2. Frontend Hash Routing

Single-page app routing via `window.location.hash`. `handleRouting()` dispatches to page sections.

```mermaid
graph TD
    START["User navigates\nwindow.location.hash"] --> ROUTER["handleRouting()"]
    
    ROUTER --> SHOP["#shop / ''\nActivate: shop-page\nhero-section\n(products + categories)"]
    ROUTER --> ABOUT["#about\nActivate: about-page\nHide hero"]
    ROUTER --> CHECKOUT["#checkout\nActivate: checkout-page\nrenderCheckoutPage()"]
    ROUTER --> TRACK["#track / #track-{id}\nActivate: tracker-page\nfetchOrders() + poll"]
    ROUTER --> STORIES["#stories\nActivate: stories-page\nrenderStoriesGrid()"]
    ROUTER --> STORY["#story-{id}\nActivate: story-detail-page\nrenderStoryDetail(id)"]
    ROUTER --> BLOGS["#blogs / #blog-{slug}\nBlogs grid / detail"]
    ROUTER --> TRAINING["#training-section\n#training-courses\nScroll + auth modal"]
    ROUTER --> FALLBACK["anything else\nFallback to shop-page"]
    
    SHOP --> CAT_NAV["Category Filter\nnavigateToCategory(cat)\nstate.activeCategory=cat\nfetchProducts(?category=cat)"]
    CAT_NAV --> FETCH["fetchProducts()\n→ GET /api/products\nrenderProducts()"]

    style ROUTER fill:#2a4a38,stroke:#4ecdc4,color:#e0e8e4
    style CAT_NAV fill:#1a3a2a,stroke:#06d6a0,color:#e0e8e4
```

---

## 3. Checkout & Payment Flow

```mermaid
sequenceDiagram
    actor Buyer
    participant CartUI as Cart UI
    participant Checkout as Checkout Page
    participant Payment as Payment Screen
    participant Backend as Express API
    participant Razorpay as Razorpay
    
    Buyer->>CartUI: Click "Place Order"
    CartUI->>CartUI: handleCheckoutInitiation()
    CartUI->>Checkout: window.location.hash = '#checkout'
    
    Checkout->>Backend: GET /orders/shipping-settings
    Backend-->>Checkout: shipping charge
    
    Buyer->>Checkout: Fill address form
    Buyer->>Checkout: Click "Continue to Payment"
    Checkout->>Backend: POST /orders/checkout
    Backend->>Backend: create order (status='pending')
    Backend-->>Checkout: { razorpay_order_id, order }
    
    Checkout->>Payment: renderInlinePaymentScreen()
    
    alt Razorpay (Card / UPI / Netbanking)
        Payment->>Razorpay: rzp.open()
        Razorpay-->>Payment: onSuccess(response)
        Payment->>Backend: POST /orders/verify-payment
        Backend->>Backend: status='paid'
        Backend-->>Payment: { order }
        Payment->>Payment: clearCart()
        Payment->>Payment: state.activeCategory='all'
        Payment->>Payment: fetchProducts()
        Payment->>Payment: showPopupModal('#shop')
        Payment-->>Buyer: "Thank you! Order confirmed"
    
    else COD
        Payment->>Backend: POST /orders/confirm-cod-payment
        Backend-->>Payment: ok
        Payment->>Payment: clearCart() + reset category
        Payment->>Payment: showPopupModal('#shop')
    
    else UPI QR
        Payment->>Backend: POST /orders/confirm-upi-payment
        Backend-->>Payment: ok
        Payment->>Payment: clearCart() + reset category
        Payment->>Payment: showPopupModal('#shop')
    end
```

---

## 4. Order Fulfillment Pipeline

Replaces the old manual `delivery_status` progression. Admin moves orders through stages; carrier creation auto-triggers at `ready_to_ship`.

```mermaid
graph LR
    APPROVED["Admin Approves\nPOST /admin/approve/:id"] --> PF["pending_fulfillment\n\nDefault state after\nadmin approval"]
    
    PF --> PR["packing_required\n\nAdmin clicks\n'Start Packing'"]
    PR --> PD["packed\n\nAdmin clicks\n'Mark Packed'"]
    PD --> RTS["ready_to_ship\n\nAdmin clicks\n'Create Shipment'"]
    
    RTS --> AUTO{"Auto-create\nShipment"}
    AUTO -->|Success| WC["with_carrier\n\nShipped via carrier"]
    AUTO -->|Fail| RTS_STUCK["⚠️ Stays at\nready_to_ship\nRetry button shown"]
    
    WC --> WEBHOOK{"Carrier Webhook"}
    WEBHOOK -->|delivered| DEL["delivered\n\nsets delivered_at"]
    WEBHOOK -->|RTO / return| RTO_PATH["fulfillment_status=null\nauto-cancel + refund"]
    WEBHOOK -->|NDR| NDR["ndr_raised_at set\norder NOT changed\nSSE admin alert"]

    subgraph NDR_HANDLING["NDR (Non-Delivery Report)"]
        NDR --> ADMIN_ACTION["Admin reviews NDR\nGET /shipping/ndr-shipments"]
        ADMIN_ACTION --> RESOLVE["Retry delivery\nor\nInitiate RTO"]
    end

    style PF fill:#1a4a38,stroke:#4ecdc4,color:#e0e8e4
    style PR fill:#1a4a38,stroke:#ffd166,color:#e0e8e4
    style PD fill:#1a4a38,stroke:#ffd166,color:#e0e8e4
    style RTS fill:#1a4a38,stroke:#06d6a0,color:#e0e8e4
    style WC fill:#1a4a38,stroke:#118ab2,color:#e0e8e4
    style DEL fill:#2a4a2a,stroke:#06d6a0,color:#e0e8e4
    style RTS_STUCK fill:#3a2a1a,stroke:#ffd166,color:#e0e8e4
    style NDR_HANDLING fill:#3a1a1a,stroke:#dc2626,color:#e0e8e4
```

---

## 5. Order State Machine

Defined in `OrderStateService.js`. All transitions validated via `isValidTransition()`.

```mermaid
stateDiagram-v2
    [*] --> PENDING : Order created
    
    PENDING --> PAID : Payment success
    PENDING --> FAILED : Payment failure
    PENDING --> CANCEL_REQUESTED : Customer requests
    PENDING --> CANCELLED : Admin direct
    
    PAID --> CANCEL_REQUESTED : Customer requests
    PAID --> CANCELLED : Admin direct
    
    CANCEL_REQUESTED --> CANCELLED : Admin approves
    CANCEL_REQUESTED --> CANCEL_REJECTED : Admin rejects
    
    CANCEL_REJECTED --> PAID : Revert to paid
    
    CANCELLED --> REFUND_PENDING : Initiate refund
    
    REFUND_PENDING --> REFUND_INITIATED : Gateway refund started
    REFUND_PENDING --> REFUND_FAILED : Refund failed
    
    REFUND_INITIATED --> REFUND_PROCESSING : Processing
    REFUND_INITIATED --> REFUND_COMPLETED : Instant complete
    REFUND_INITIATED --> REFUND_FAILED : Refund failed
    
    REFUND_PROCESSING --> REFUND_COMPLETED : Webhook confirms
    REFUND_PROCESSING --> REFUND_FAILED : Webhook failure
    
    REFUND_FAILED --> REFUND_PENDING : Retry
    REFUND_FAILED --> REFUND_INITIATED : Retry (direct)
    
    REFUND_COMPLETED --> [*]
    
    note right of CANCEL_REQUESTED : assertCancellable()\nblocks if isWithCarrier()
```

---

## 6. Cancellation & Refund: Detailed Flow

Three entry points: customer request, admin approval of request, admin direct cancel. All converge on `cancelCarrierShipment()` + `executeRefundProcess()`.

```mermaid
graph TB
    subgraph CUSTOMER["🙋 Customer"]
        REQ["POST /orders/:id/request-cancel\nreason: string"]
    end
    
    subgraph ADMIN["🔧 Admin Panel"]
        APPROVE["POST /refunds/cancel-requests/:id/approve\nadminNote: string"]
        DIRECT["POST /refunds/admin-cancel/:id\nreason + adminNote"]
        REJECT["POST /refunds/cancel-requests/:id/reject\nreason: string"]
    end
    
    subgraph REFUND_SVC["RefundService"]
        REQ --> REQ_FN["requestCustomerCancellation()"]
        APPROVE --> APP_FN["approveCancellation()"]
        DIRECT --> DIR_FN["adminDirectCancellation()"]
        REJECT --> REJ_FN["rejectCancellation()"]
        
        REQ_FN --> GUARD1{"isWithCarrier(order)?"}
        GUARD1 -->|Yes| BLOCK1["❌ Error: Contact support for RTO"]
        GUARD1 -->|No| SET_CANCEL_REQ["status = CANCEL_REQUESTED\ncancelled_by = user"]
        
        APP_FN --> GUARD2{"status ===\nCANCEL_REQUESTED?"}
        GUARD2 -->|No| BLOCK2["❌ Error"]
        GUARD2 -->|Yes| CANCEL_SHIP["cancelCarrierShipment()"]
        
        DIR_FN --> GUARD3{"isWithCarrier(order)?"}
        GUARD3 -->|Yes| BLOCK3["❌ Error: Use RTO flow"]
        GUARD3 -->|No| CANCEL_SHIP2["cancelCarrierShipment()"]
        
        REJ_FN --> REVERT["status = PAID\ndelivery_status = processing"]
    end
    
    subgraph SHARED["Shared Helpers"]
        CANCEL_SHIP --> CANCEL_HELPER["cancelCarrierShipment()\n\n1. Find shipment by order_id\n2. Call carrier API cancel\n3. Update shipments table\n4. Insert tracking event"]
        CANCEL_SHIP2 --> CANCEL_HELPER
        
        CANCEL_HELPER --> SET_CANCELLED["Set order: status = CANCELLED\nfulfillment_status = null\ncancelled_by = admin/customer"]
        SET_CANCELLED --> RESTOCK["restockOrderItems()\n(idempotent via restocked guard)"]
        RESTOCK --> NOTIFY["sendRefundNotification()"]
        NOTIFY --> REFUND_START
    end
    
    subgraph REFUND_PIPE["Refund Pipeline"]
        REFUND_START["executeRefundProcess()"] --> INIT_REFUND["Initiate Razorpay refund\nwith idempotency key"]
        INIT_REFUND --> UPDATE_ORDER["Update order status\nREFUND_PENDING → REFUND_INITIATED"]
        UPDATE_ORDER --> CREATE_REFUND_REC["INSERT refunds record"]
    end
    
    subgraph FALLBACK["Fallback (if auto-refund fails)"]
        INIT_REFUND -->|Error| FALLBACK_REFUND["Create pending refund record\nstatus = pending\nAdmin can retry later"]
    end
    
    subgraph WEBHOOK_REFUND["Carrier / Webhook Path"]
        CARRIER_WEBHOOK["POST /api/webhooks/:providerKey"] --> DETECT_RTO{"Status =\nreturned/cancelled?"}
        DETECT_RTO -->|Yes| AUTO_CANCEL["Set fulfillment_status = null\nexecuteRefundProcess()"]
        DETECT_RTO -->|NDR| NDR_FLOW["Set ndr_raised_at\nSSE admin alert\nNo order changes"]
    end

    style CUSTOMER fill:#1a2a3a,stroke:#4ecdc4,color:#e0e8e4
    style ADMIN fill:#2a3a1a,stroke:#ffd166,color:#e0e8e4
    style REFUND_SVC fill:#2a1a2a,stroke:#ef476f,color:#e0e8e4
    style SHARED fill:#1a3a2a,stroke:#06d6a0,color:#e0e8e4
    style REFUND_PIPE fill:#1a2a2a,stroke:#118ab2,color:#e0e8e4
    style FALLBACK fill:#3a2a1a,stroke:#ffd166,color:#e0e8e4
    style WEBHOOK_REFUND fill:#2a2a1a,stroke:#ffd166,color:#e0e8e4
```

---

## 7. Admin Panel Structure

```mermaid
graph TB
    subgraph ADMIN_PANEL["Admin Panel (admin.html + admin.js)"]
        
        subgraph TABS["Tab Navigation"]
            TAB_ORDERS["📋 Orders"]
            TAB_CATALOG["📦 Catalog"]
            TAB_REFUNDS["💰 Refunds"]
            TAB_SHIPMENTS["🚚 Shipments"]
        end
        
        subgraph ORDERS_TAB["Orders Tab"]
            O_FETCH["fetchAdminOrders()\nGET /api/orders/all-orders"]
            O_CARD["For each order: render card"]
            
            subgraph CARD["Order Card"]
                HEADER["Header: ID, Customer, Total, Status"]
                FULFILL["Fulfillment Pipeline\nProgress Bar + Action Buttons"]
                BUTTONS["[Start Packing] [Mark Packed]\n[Create Shipment] [Cancel & Refund]"]
                APPROVE_BTNS["[Approve] [Reject]\n(for pending approval orders)"]
                STATUS["Current fulfillment_status\nRefund status display"]
            end
        end
        
        subgraph REFUNDS_TAB["Refunds Tab"]
            R_FETCH["loadRefundsDashboard()\nGET /api/refunds/dashboard"]
            R_LIST["Refund records list"]
            R_ACTIONS["[Progress Step] [Initiate] [Complete]\n[Retry Failed Refund]"]
        end
        
        subgraph SHIPMENTS_TAB["Shipments Tab"]
            S_FETCH["loadShipmentsTab()\nGET /api/shipping/all"]
            S_NDR["NDR stat card\n(filter: NDR Attention)"]
            S_LIST["All shipments table"]
            S_ACTIONS["[Cancel Shipment]\n[Refresh Cache]"]
        end
        
        subgraph KEY_FUNCTIONS["Key Functions"]
            FU_UPDATE["updateFulfillment(id, status)\nPUT /orders/:id/fulfillment"]
            FU_CANCEL["adminDirectCancelModal(id)\nPOST /refunds/admin-cancel/:id"]
            FU_SHIP_CANCEL["cancelShipmentFromTab(orderId)\nPOST /shipping/cancel/:orderId"]
            FU_REFRESH["refreshShipmentsCache()"]
        end
    end
    
    TAB_ORDERS --> ORDERS_TAB
    TAB_REFUNDS --> REFUNDS_TAB
    TAB_SHIPMENTS --> SHIPMENTS_TAB
    
    BUTTONS --> FU_UPDATE
    BUTTONS --> FU_CANCEL
    S_ACTIONS --> FU_SHIP_CANCEL
    S_ACTIONS --> FU_REFRESH
    
    style ADMIN_PANEL fill:#1a2a1a,stroke:#4ecdc4,color:#e0e8e4
    style ORDERS_TAB fill:#1a3a2a,stroke:#ffd166,color:#e0e8e4
    style REFUNDS_TAB fill:#1a3a2a,stroke:#ef476f,color:#e0e8e4
    style SHIPMENTS_TAB fill:#1a3a2a,stroke:#118ab2,color:#e0e8e4
```

---

## 8. Database Schema Relationships

Key tables and their foreign key relationships.

```mermaid
erDiagram
    orders {
        id text PK
        user_id text FK
        status text
        delivery_status text
        fulfillment_status text
        admin_approval_status text
        shipment_id text FK
        restocked boolean
        refund_status text
        total_refunded_amount numeric
        razorpay_payment_id text
        razorpay_order_id text
        shipped_at timestamp
        delivered_at timestamp
        cancelled_at timestamp
        cancel_reason text
        cancelled_by text
    }
    
    users {
        id text PK
        email text
        full_name text
        role text
        whatsapp_number text
    }
    
    shipments {
        id text PK
        order_id text FK
        shipping_provider_id text FK
        awb_code text
        status text
        provider_shipment_id text
        service_type text
        rate numeric
        label_generated boolean
        pickup_requested boolean
        cancelled_at timestamp
        cancellation_reason text
        ndr_raised_at timestamp
    }
    
    shipping_providers {
        id text PK
        provider_key text UK
        name text
        is_active boolean
        is_default boolean
        config jsonb
    }
    
    refunds {
        id text PK
        order_id text FK
        user_id text FK
        razorpay_payment_id text
        razorpay_refund_id text
        amount numeric
        status text
        refund_reason text
        cancelled_by text
        failure_reason text
    }
    
    products {
        id text PK
        name text
        price numeric
        mrp_price numeric
        stock integer
        category text
        image_url text
    }
    
    order_status_history {
        id text PK
        order_id text FK
        field_name text
        old_value text
        new_value text
        changed_by text
        changed_at timestamp
    }
    
    fulfillment_tasks {
        id text PK
        order_id text FK
        task_type text
        status text
        assigned_to text
        completed_at timestamp
    }
    
    refund_audits {
        id text PK
        refund_id text
        order_id text FK
        action text
        performed_by text
        timestamp timestamp
        metadata jsonb
    }
    
    shipment_tracking_events {
        id text PK
        shipment_id text FK
        status text
        location text
        description text
        occurred_at timestamp
    }
    
    orders ||--o{ shipments : "has"
    orders ||--o{ refunds : "has"
    orders ||--o{ order_status_history : "audited by"
    orders ||--o{ fulfillment_tasks : "tasks for"
    orders }o--|| users : "belongs to"
    shipments }o--|| shipping_providers : "uses"
    shipments ||--o{ shipment_tracking_events : "has events"
    refunds ||--o{ refund_audits : "audited by"
```

---

## 9. Complete End-to-End: Order Lifecycle

```mermaid
sequenceDiagram
    actor Buyer
    actor Admin
    actor Carrier as Shiprocket
    participant FE as Frontend SPA
    participant BE as Express API
    participant DB as Database
    participant RZ as Razorpay
    
    Note over Buyer,RZ: ── 1. SHOP & CHECKOUT ──
    Buyer->>FE: Browse, add to cart
    Buyer->>FE: Place Order
    FE->>BE: POST /orders/checkout
    BE->>DB: INSERT orders (status=pending)
    BE-->>FE: razorpay_order_id
    Buyer->>FE: Pay via Razorpay
    FE->>RZ: rzp.open()
    RZ-->>FE: onSuccess()
    FE->>BE: POST /orders/verify-payment
    BE->>DB: UPDATE orders (status=paid, admin_approval_status=pending)
    BE-->>FE: Order confirmed
    FE->>FE: Clear cart, reset category to 'all'
    FE->>FE: Redirect to #shop
    
    Note over Buyer,RZ: ── 2. ADMIN APPROVAL ──
    Admin->>FE: Open admin panel
    Admin->>FE: Click Approve
    FE->>BE: POST /admin/approve/:id
    BE->>DB: UPDATE (admin_approval_status=approved, fulfillment_status=pending_fulfillment)
    BE-->>FE: Approved
    
    Note over Buyer,RZ: ── 3. FULFILLMENT PIPELINE ──
    Admin->>FE: Click "Start Packing"
    FE->>BE: PUT /orders/:id/fulfillment {status: packing_required}
    BE->>DB: UPDATE fulfillment_status
    
    Admin->>FE: Click "Mark Packed"
    FE->>BE: PUT /orders/:id/fulfillment {status: packed}
    BE->>DB: UPDATE fulfillment_status
    
    Admin->>FE: Click "Create Shipment"
    FE->>BE: PUT /orders/:id/fulfillment {status: ready_to_ship}
    BE->>BE: Auto: createShipment()
    BE->>BE: assignCourier() + schedulePickup() + generateLabel()
    BE->>DB: INSERT shipment
    BE->>DB: UPDATE order (fulfillment_status=with_carrier, shipment_id=...)
    BE-->>FE: {order, message}
    
    Note over Buyer,RZ: ── 4. CARRIER DELIVERY ──
    Carrier->>BE: POST /api/webhooks/shiprocket (delivered)
    BE->>DB: UPDATE shipment (status=delivered)
    BE->>DB: UPDATE order (fulfillment_status=delivered, delivered_at=NOW())
    BE->>DB: INSERT order_status_history
    
    Note over Buyer,RZ: ── 4b. CARRIER NDR ──
    Carrier->>BE: POST /api/webhooks/shiprocket (NDR)
    BE->>DB: UPDATE shipment (status=ndr, ndr_raised_at=NOW())
    BE->>DB: INSERT tracking_event + order_status_history
    BE->>FE: SSE event order:ndr → admin notified
    
    Note over Buyer,RZ: ── 5. ALTERNATIVE: CANCELLATION ──
    Buyer->>FE: Request cancellation
    FE->>BE: POST /orders/:id/request-cancel
    BE->>BE: assertCancellable() → isWithCarrier? → No
    BE->>DB: UPDATE order (status=CANCEL_REQUESTED)
    BE-->>FE: Request submitted
    
    Admin->>FE: Approve cancellation
    FE->>BE: POST /refunds/cancel-requests/:id/approve
    BE->>BE: cancelCarrierShipment()
    BE->>DB: UPDATE shipment (cancelled)
    BE->>BE: restockOrderItems()
    BE->>RZ: Refund API
    BE->>DB: UPDATE order (status=CANCELLED → REFUND_PENDING → REFUND_INITIATED)
    BE->>DB: INSERT refunds
    BE-->>FE: Cancelled + Refund initiated
```

---

## 10. Key File Inventory

| File | Description |
|------|-------------|
| `frontend/src/app.js` | SPA router, shop, checkout, payment, categories, products |
| `frontend/src/admin.js` | Admin panel: orders, catalog, refunds, shipments tabs |
| `frontend/src/components/ProfileModal.js` | Profile modal with orders, timeline, actions |
| `frontend/admin.html` | Admin panel HTML structure |
| `frontend/style.css` | Shop + profile modal styles |
| `frontend/admin-premium.css` | Admin panel premium styles incl. fulfillment pipeline |
| `backend/src/server.js` | Express entry point, route mounting, auto-migration DDL |
| `backend/src/routes/orders.js` | Checkout, fulfillment pipeline, cancel, track, invoice |
| `backend/src/routes/shipping.js` | Create shipment, track, cancel, NDR listing, provider selection |
| `backend/src/routes/shipping-webhooks.js` | Carrier webhook receiver (NDR, RTO, delivery updates) |
| `backend/src/modules/refunds/RefundService.js` | Core refund & cancellation business logic |
| `backend/src/modules/refunds/RefundController.js` | REST handlers for cancel/refund routes |
| `backend/src/modules/refunds/RefundWebhookHandler.js` | Razorpay webhook: refund.processed → status transitions |
| `backend/src/modules/orders/OrderStateService.js` | State machine, restock guard, cancellability checks |
| `backend/src/modules/payments/PaymentService.js` | Razorpay refund initiation with idempotency keys |
| `backend/src/middleware/auth.js` | JWT auth middleware (mock + Supabase dual-mode) |
| `backend/src/config/db.js` | Mock in-memory DB + Supabase client, query builder wrappers |
| `backend/src/config/jwt.js` | JWT secret config with random dev fallback |
| `backend/src/services/notificationService.js` | Email + SMS + WhatsApp multi-channel notifications |
| `backend/src/services/shipping/ProviderRegistry.js` | Default provider resolver, adapter factory |
| `backend/src/services/shipping/adapters/ShiprocketAdapter.js` | Shiprocket carrier integration + mock fallback |
| `backend/migrations/004_add_fulfillment_pipeline.sql` | order_status_history, fulfillment_tasks, new columns |
| `backend/migrations/005_add_restock_guard.sql` | restocked boolean on orders table |

---

> All diagrams rendered with Mermaid.js — view with any Mermaid-compatible markdown renderer.  
> Generated from codebase analysis — Last updated: June 29, 2026
