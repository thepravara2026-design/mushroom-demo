# 🍄 Sporekart — Visual Application Flow

> End-to-end user journey from browsing to delivery/cancellation  
> Last updated: June 29, 2026

---

## 👤 User Journey Overview

```mermaid
---
title: Complete Customer & Admin Flow
---
graph TB
    START(["👤 User arrives"]) --> SHOP["🛒 Browse Shop\n/products + /categories"]
    SHOP --> CART["➕ Add to Cart\nCart UI drawer"]
    CART --> CHECKOUT["🧾 Checkout\nAddress + Payment"]
    CHECKOUT --> PAYMENT{"Payment Method"}
    
    PAYMENT -->|Razorpay| RAZOR["💳 Razorpay\nCard / UPI / Netbanking"]
    PAYMENT -->|COD| COD_CONFIRM["💵 Cash on Delivery"]
    PAYMENT -->|UPI QR| UPI_QR["📱 UPI QR Scan"]
    
    RAZOR --> VERIFY["✅ Verify Payment\nPOST /orders/verify-payment"]
    COD_CONFIRM --> VERIFY_COD["✅ Confirm COD\nPOST /orders/confirm-cod-payment"]
    UPI_QR --> VERIFY_UPI["✅ Confirm UPI\nPOST /orders/confirm-upi-payment"]
    
    VERIFY --> PENDING["⏳ Order: paid\nAdmin Approval: pending"]
    VERIFY_COD --> PENDING
    VERIFY_UPI --> PENDING
    
    PENDING --> RESET["🔄 Reset category to 'all'\nRedirect to #shop"]
    RESET --> END_SHOP(["👤 Shopping continues"])
    
    %% Admin approval branch
    PENDING -.->|Admin Action| APPROVE["✅ Admin Approves\nPOST /admin/approve/:id"]
    APPROVE --> FULFILL_START["📦 Fulfillment: pending_fulfillment"]
    
    %% Fulfillment pipeline
    FULFILL_START --> F1["📋 Admin: Start Packing\n→ packing_required"]
    F1 --> F2["📦 Admin: Mark Packed\n→ packed"]
    F2 --> F3["🚀 Admin: Create Shipment\n→ ready_to_ship"]
    
    F3 --> SHIPMENT_AUTO{"Auto-create\nShipment"}
    SHIPMENT_AUTO -->|Success| WITH_CARRIER["🚚 with_carrier\nShipped via carrier"]
    SHIPMENT_AUTO -->|Failure| RETRY["⚠️ ready_to_ship\nRetry button"]
    RETRY --> F3
    
    WITH_CARRIER --> WEBHOOK{"Carrier Webhook"}
    
    %% Delivery path
    WEBHOOK -->|delivered| DELIVERED["✅ delivered\nDelivered at set\nFulfillment complete"]
    
    %% RTO path
    WEBHOOK -->|returned/RTO| RTO["↩️ RTO\nCancel + Auto-refund"]
    
    %% NDR path
    WEBHOOK -->|NDR| NDR_NOTE["⚠️ NDR Raised\nAdmin notified\nShipment: ndr"]
    NDR_NOTE --> ADMIN_NDR{"Admin Action"}
    ADMIN_NDR -->|Retry| WITH_CARRIER
    ADMIN_NDR -->|Initiate RTO| RTO
    
    RTO --> EXECUTE_REFUND["💰 executeRefundProcess()\nRazorpay refund\nRestock items"]
    EXECUTE_REFUND --> REFUND_DONE["✅ Refund Completed"]
    
    %% Cancel paths
    FULFILL_START -.->|Customer Cancels| CANCEL_REQ["🙋 Cancel Requested"]
    F1 -.-> CANCEL_REQ
    F2 -.-> CANCEL_REQ
    F3 -.-> CANCEL_REQ
    WITH_CARRIER -.->|Blocked| BLOCKED["🚫 Cannot cancel\nisWithCarrier() → true\nContact support for RTO"]
    
    CANCEL_REQ --> ADMIN_CANCEL{"Admin Decision"}
    ADMIN_CANCEL -->|Approve| APPROVE_CANCEL["✅ approveCancellation()"]
    ADMIN_CANCEL -->|Reject| REJECT_CANCEL["❌ Reverted to paid"]
    
    APPROVE_CANCEL --> CANCEL_SHIP["📄 cancelCarrierShipment()"]
    CANCEL_SHIP --> RESTOCK["📦 restockOrderItems()\n(restocked guard)"]
    RESTOCK --> NOTIFY["📧 sendRefundNotification()"]
    NOTIFY --> EXECUTE_REFUND
    
    %% Admin direct cancel
    FULFILL_START -.->|Admin Direct| ADMIN_DIRECT["🔧 adminDirectCancellation()"]
    F1 -.-> ADMIN_DIRECT
    F2 -.-> ADMIN_DIRECT
    F3 -.-> ADMIN_DIRECT
    
    ADMIN_DIRECT --> CANCEL_SHIP

    style START fill:#1a4a38,stroke:#4ecdc4,color:#e0e8e4
    style APPROVE fill:#2a3a1a,stroke:#ffd166,color:#e0e8e4
    style DELIVERED fill:#2a4a2a,stroke:#06d6a0,color:#e0e8e4
    style RTO fill:#3a1a1a,stroke:#dc2626,color:#e0e8e4
    style NDR_NOTE fill:#3a2a1a,stroke:#f59e0b,color:#e0e8e4
    style BLOCKED fill:#3a1a1a,stroke:#ef4444,color:#e0e8e4
    style EXECUTE_REFUND fill:#1a2a3a,stroke:#118ab2,color:#e0e8e4
```

---

## 🧩 Component Interaction Map

```mermaid
---
title: How Data Flows Between Components
---
graph LR
    subgraph CLIENT["🌐 Client Layer"]
        APP["app.js\nHash Router\nShop / Cart / Checkout"]
        ADMIN_UI["admin.js\nAdmin Panel\nOrders / Refunds"]
        MODAL["ProfileModal.js\nOrder History\nTimeline / Actions"]
    end

    subgraph API["📡 API Layer (Express)"]
        ORDERS["/api/orders\ncheckout · verify\nfulfillment · cancel · track"]
        REFUNDS_API["/api/refunds\ncancel-requests\nadmin-cancel · dashboard"]
        SHIPPING_API["/api/shipping\ncreate · track · cancel\nndr-shipments"]
        AUTH_API["/api/auth\nlogin · verify-otp\nprofile"]
        WEBHOOK["/api/webhooks\nCarrier events"]
    end

    subgraph LOGIC["🧠 Business Logic"]
        REFUND_SVC["RefundService"]
        ORDER_SVC["OrderStateService"]
        PAYMENT_SVC["PaymentService"]
        AUDIT["RefundAuditService"]
        NOTIFY_SVC["notificationService"]
        SHIP_PROV["ProviderRegistry\nShiprocketAdapter"]
    end

    subgraph DATA["💾 Data Layer"]
        DB["db.js\nMock / Supabase"]
        CACHE["adminOrdersCache\nadminShipmentsCache"]
    end

    subgraph EXTERNAL["☁️ External"]
        RAZORPAY["Razorpay\nPayments"]
        SHIPROCKET["Shiprocket\nShipping"]
        SUPABASE["Supabase\nProduction DB"]
    end

    APP -->|fetch / POST| ORDERS
    APP --> AUTH_API
    ADMIN_UI --> ORDERS
    ADMIN_UI --> REFUNDS_API
    ADMIN_UI --> SHIPPING_API
    MODAL --> ORDERS

    ORDERS --> ORDER_SVC
    ORDERS --> REFUND_SVC
    ORDERS --> PAYMENT_SVC
    REFUNDS_API --> REFUND_SVC
    SHIPPING_API --> SHIP_PROV
    WEBHOOK --> SHIP_PROV
    WEBHOOK --> ORDER_SVC
    AUTH_API --> AUTH["authService"]

    REFUND_SVC --> ORDER_SVC
    REFUND_SVC --> PAYMENT_SVC
    REFUND_SVC --> AUDIT
    REFUND_SVC --> NOTIFY_SVC

    ORDER_SVC --> DB
    REFUND_SVC --> DB
    ADMIN_UI --> CACHE
    CACHE --> DB

    PAYMENT_SVC --> RAZORPAY
    SHIP_PROV --> SHIPROCKET
    DB -.->|production| SUPABASE

    style CLIENT fill:#1a3a2a,stroke:#4ecdc4,color:#e0e8e4
    style API fill:#2a2a1a,stroke:#ffd166,color:#e0e8e4
    style LOGIC fill:#2a1a2a,stroke:#06d6a0,color:#e0e8e4
    style DATA fill:#2a1a1a,stroke:#ef476f,color:#e0e8e4
    style EXTERNAL fill:#1a1a2a,stroke:#118ab2,color:#e0e8e4
```

---

## 🔁 State Transition Map

```mermaid
---
title: Order Status State Machine
---
stateDiagram-v2
    direction LR
    
    state "Order Created" as PENDING
    state "Payment Success" as PAID
    state "Payment Failed" as FAILED
    state "Cancel Requested" as CANCEL_REQ
    state "Cancel Approved" as CANCELLED
    state "Cancel Rejected" as REJECTED
    state "Refund Pending" as REF_PENDING
    state "Refund Initiated" as REF_INIT
    state "Refund Processing" as REF_PROC
    state "Refund Completed" as REF_DONE
    state "Refund Failed" as REF_FAIL

    [*] --> PENDING
    PENDING --> PAID : payment verified
    PENDING --> FAILED : payment failed
    PENDING --> CANCEL_REQ : customer cancels
    PENDING --> CANCELLED : admin direct cancel
    
    PAID --> CANCEL_REQ : customer requests
    PAID --> CANCELLED : admin direct cancel
    
    CANCEL_REQ --> CANCELLED : admin approves
    CANCEL_REQ --> REJECTED : admin rejects
    REJECTED --> PAID : revert
    
    CANCELLED --> REF_PENDING : auto-initiate refund
    REF_PENDING --> REF_INIT : Razorpay refund started
    REF_PENDING --> REF_FAIL : refund failed immediately
    
    REF_INIT --> REF_PROC : processing
    REF_INIT --> REF_DONE : completed instantly
    REF_INIT --> REF_FAIL : failed
    
    REF_PROC --> REF_DONE : webhook confirms
    REF_PROC --> REF_FAIL : webhook failure
    
    REF_FAIL --> REF_PENDING : admin retry
    REF_FAIL --> REF_INIT : admin retry (direct)
    
    REF_DONE --> [*]
    
    note right of PAID : admin_approval_status\nmust be 'approved'
    note right of CANCELLED : restockOrderItems()\nruns once (restocked guard)
```

---

## 📦 Fulfillment Pipeline Detail

```mermaid
---
title: admin.js Fulfillment Progress + Action Buttons
---
graph TB
    subgraph FULFILLMENT_BAR["Fulfillment Progress Bar"]
        STEP1["◉ pending_fulfillment"] --- LINE1["—"] --- STEP2["◉ packing_required"]
        STEP2 --- LINE2["—"] --- STEP3["◉ packed"]
        STEP3 --- LINE3["—"] --- STEP4["◉ ready_to_ship"]
        STEP4 --- LINE4["—"] --- STEP5["◉ with_carrier"]
        STEP5 --- LINE5["—"] --- STEP6["◉ delivered"]
    end

    subgraph ACTIONS["Context-Sensitive Buttons"]
        ACT_PF["✅ Start Packing\nPUT /orders/:id/fulfillment\n{status: packing_required}"]
        ACT_PR["📦 Mark Packed\nPUT /orders/:id/fulfillment\n{status: packed}"]
        ACT_PD["🚀 Create Shipment\nPUT /orders/:id/fulfillment\n{status: ready_to_ship}"]
        ACT_RTS["🔄 Retry Shipment\n(appears if auto-creation failed)"]
        ACT_WC["(no admin action — awaiting carrier)"]
    end

    subgraph BACKEND_ACTIONS["Server-Side Auto-Actions"]
        TRIGGER_RTS["ready_to_ship received"]
        TRIGGER_RTS --> CREATE_SHIP["createShipment()"]
        CREATE_SHIP --> ASSIGN["assignCourier()"]
        ASSIGN --> SCHEDULE["schedulePickup()"]
        SCHEDULE --> LABEL["generateLabel()"]
        LABEL --> UPDATE_ORDER["fulfillment_status → with_carrier\nshipment_id linked\nshipped_at set"]
    end

    STEP1 -.->|current| ACT_PF
    STEP2 -.->|current| ACT_PR
    STEP3 -.->|current| ACT_PD
    STEP4 -.->|current| ACT_RTS
    STEP5 -.->|current| ACT_WC

    ACT_PD -.->|triggers| TRIGGER_RTS

    style FULFILLMENT_BAR fill:#1a2a1a,stroke:#4ecdc4,color:#e0e8e4
    style ACTIONS fill:#1a3a2a,stroke:#ffd166,color:#e0e8e4
    style BACKEND_ACTIONS fill:#1a2a3a,stroke:#118ab2,color:#e0e8e4
```

---

## 🚫 Cancellation Decision Tree

```mermaid
---
title: Who Can Cancel? (isWithCarrier Guard)
---
graph TD
    CANCEL_START(["Cancellation Requested"]) --> CHECK{"fulfillment_status\n= with_carrier ?"}
    
    CHECK -->|No| CAN_ALLOW["✅ Cancellable\nProceed with cancel flow"]
    CHECK -->|Yes| CAN_BLOCK["🚫 Blocked\nCustomer: contact support\nAdmin: use RTO flow"]
    
    CAN_ALLOW --> CUSTOMER_REQ{"Who initiates?"}
    
    CUSTOMER_REQ -->|Customer| CUST["POST /orders/:id/request-cancel"]
    CUSTOMER_REQ -->|Admin| ADMIN_DIR["POST /refunds/admin-cancel/:id"]
    
    CUST --> AWAIT_ADMIN["⏳ status = CANCEL_REQUESTED\nAwaiting admin approval"]
    AWAIT_ADMIN --> ADMIN_ACTION{"Admin Decision"}
    
    ADMIN_ACTION -->|Approve| APPROVE["POST /refunds/cancel-requests/:id/approve"]
    ADMIN_ACTION -->|Reject| REJECT["POST /refunds/cancel-requests/:id/reject"]
    
    APPROVE --> HELPER["cancelCarrierShipment()"]
    ADMIN_DIR --> HELPER
    REJECT --> REVERT["status → PAID\ndelivery_status → processing"]
    
    HELPER --> FIND_SHIP["1. Find shipment by order_id"]
    FIND_SHIP --> CAN_API["2. Call carrier API cancelShipment()"]
    CAN_API --> UPD_SHIP["3. UPDATE shipments\nSET status=cancelled\ncancelled_at=NOW"]
    UPD_SHIP --> LOG_EVENT["4. INSERT shipment_tracking_event"]
    LOG_EVENT --> SET_ORDER["5. UPDATE orders\nSET status=CANCELLED\nfulfillment_status=null"]
    SET_ORDER --> RESTOCK["6. restockOrderItems()\n(restocked guard)"]
    RESTOCK --> NOTIFY["7. sendRefundNotification()"]
    NOTIFY --> REFUND["8. executeRefundProcess()\n→ Razorpay refund"]
    
    REFUND --> REF_OK{"Refund succeeds?"}
    REF_OK -->|Yes| DONE["✅ Refund initiated\nstatus → REFUND_INITIATED"]
    REF_OK -->|No| FALLBACK["⚠️ Pending refund record\nAdmin can retry later"]

    style CAN_BLOCK fill:#3a1a1a,stroke:#ef4444,color:#e0e8e4
    style CAN_ALLOW fill:#1a4a38,stroke:#06d6a0,color:#e0e8e4
    style APPROVE fill:#2a3a1a,stroke:#ffd166,color:#e0e8e4
    style HELPER fill:#1a2a3a,stroke:#118ab2,color:#e0e8e4
    style DONE fill:#2a4a2a,stroke:#06d6a0,color:#e0e8e4
    style FALLBACK fill:#3a2a1a,stroke:#f59e0b,color:#e0e8e4
```

---

## 🌊 NDR (Non-Delivery Report) Flow

```mermaid
---
title: Carrier NDR → Admin Resolution
---
sequenceDiagram
    participant Carrier as Shiprocket
    participant Webhook as Webhook Handler
    participant ShipDB as shipments table
    participant OrderDB as orders table
    participant SSE as SSE Events
    participant Admin as Admin Dashboard
    
    Carrier->>Webhook: POST /api/webhooks/shiprocket<br/>{ status: "NDR", awb: "...", description: "..." }
    
    Webhook->>Webhook: Map status → "ndr"<br/>(SHIPMENT_STATUS_MAP)
    Webhook->>ShipDB: UPDATE shipments<br/>SET status='ndr', ndr_raised_at=NOW()
    Webhook->>ShipDB: INSERT shipment_tracking_event<br/>{ status: 'ndr', description }
    
    Note over Webhook: NDR does NOT change<br/>order.delivery_status
    
    Webhook->>OrderDB: INSERT order_status_history<br/>{ field: 'delivery_status', new_value: 'ndr' }
    Webhook->>SSE: emit order:ndr { orderId, awb, description }
    SSE->>Admin: 🔴 Admin notified<br/>NDR stat card increments
    
    Admin->>Admin: "NDR (Attention)" stat card → red<br/>Filter: NDR status
    Admin->>Admin: Opens shipment details
    
    alt Admin resolves NDR
        Admin->>Carrier: Contact carrier, update address<br/>Request re-delivery
        Carrier->>Webhook: Subsequent webhook<br/>{ status: "out_for_delivery" }
        Webhook->>ShipDB: UPDATE shipments<br/>status → 'out_for_delivery'
    else Admin initiates RTO
        Admin->>Webhook: Manually trigger RTO<br/>or carrier sends RTO webhook
        Webhook->>ShipDB: UPDATE shipments<br/>status → 'returned'
        Webhook->>OrderDB: UPDATE orders<br/>delivery_status → 'cancelled'
        Webhook->>Webhook: Auto-call cancelCarrierShipment()<br/>→ Refund + Restock
    end
```

---

## 🧭 Customer Tracking Page

```mermaid
---
title: What the Customer Sees in #track
---
graph TB
    subgraph TRACKING_PAGE["Tracking Page Layout"]
        HEADER["Header: Order ID + Status Badge + Live/Simulated tag"]
        
        subgraph SUMMARY["Two-Column Summary"]
            PAYMENT_CARD["Payment Details\nMethod · Txn ID · Status\nRefund Status · Amount"]
            DELIVERY_CARD["Delivery Summary\nStage · Fulfillment Status\nShipped At · Delivered At"]
        end
        
        subgraph PROGRESS["Progress Section"]
            PCT_BAR["Progress Bar: 0-100%"]
            FULFILL_STRIP["Fulfillment Pipeline Strip\n(dot/connector visualization)"]
        end
        
        subgraph STATUS["Status Messages"]
            CANCEL_BOX["Cancellation Requested / Approved / Rejected"]
            REFUND_BOX["Refund Pending / Processing / Completed / Failed"]
            RTO_BOX["Returned to Sender (RTO) Alert"]
        end
        
        subgraph TIMELINE["Timeline"]
            CHECKPOINTS["Vertical Timeline\nOrder Placed → ... → Delivered/Cancelled"]
        end
        
        subgraph ACTIONS["Action Buttons"]
            INVOICE["Generate Tax Invoice"]
            WHATSAPP["Update via WhatsApp"]
            CANCEL_BTN["Cancel Order\n(shows only if cancellable)"]
        end
    end

    HEADER --> SUMMARY
    SUMMARY --> PROGRESS
    PROGRESS --> STATUS
    STATUS --> TIMELINE
    TIMELINE --> ACTIONS

    style TRACKING_PAGE fill:#1a2a1a,stroke:#4ecdc4,color:#e0e8e4
    style SUMMARY fill:#1a3a2a,stroke:#ffd166,color:#e0e8e4
    style PROGRESS fill:#1a3a2a,stroke:#06d6a0,color:#e0e8e4
    style STATUS fill:#2a1a2a,stroke:#ef476f,color:#e0e8e4
    style TIMELINE fill:#1a2a3a,stroke:#118ab2,color:#e0e8e4
```

---

## ⚙️ RefundService Internal Flow

```mermaid
---
title: executeRefundProcess() Internal Logic
---
flowchart TB
    START(["executeRefundProcess(order)"]) --> GUARD_RESTOCK{"order.restocked\n=== true ?"}
    
    GUARD_RESTOCK -->|Already restocked| SKIP_RESTOCK["⏭️ Skip restock\n(idempotent guard)"]
    GUARD_RESTOCK -->|Not restocked| DO_RESTOCK["📦 restockOrderItems()"]
    DO_RESTOCK --> SET_RESTOCKED["SET order.restocked = true"]
    
    SKIP_RESTOCK --> CREATE_REFUND["Create refund record\nstatus: pending"]
    SET_RESTOCKED --> CREATE_REFUND
    
    CREATE_REFUND --> GATEWAY{"Gateway refund\nsupported ?"}
    
    GATEWAY -->|Yes| RAZOR_CALL["Call Razorpay API\nPOST /payments/:id/refund\nwith idempotency key"]
    GATEWAY -->|No| MANUAL_FALLBACK["Set status: pending\nAdmin completes manually"]
    
    RAZOR_CALL --> REFUND_OK{"API success ?"}
    
    REFUND_OK -->|Yes| UPDATE_SUCCESS["Update order:\nrefund_status = initiated\nstatus = REFUND_INITIATED"]
    REFUND_OK -->|No| UPDATE_FAILED["Update refund:\nstatus = failed\nfailure_reason = error"]
    REFUND_OK -->|Error (network etc.)| PENDING_FALLBACK["Leave as REFUND_PENDING\nAdmin retries later"]
    
    UPDATE_SUCCESS --> AUDIT_LOG["RefundAuditService.log()\naction: REFUND_INITIATED"]
    AUDIT_LOG --> SSE["SSE: order:updated"]
    SSE --> DONE_Success(["✅ Done"])

    UPDATE_FAILED --> AUDIT_FAIL["RefundAuditService.log()\naction: REFUND_FAILED"]
    AUDIT_FAIL --> DONE_Fail(["❌ Done (failed)"])

    PENDING_FALLBACK --> AUDIT_PEND["RefundAuditService.log()\naction: REFUND_PENDING"]
    AUDIT_PEND --> DONE_Pend(["⏳ Done (pending)"])

    MANUAL_FALLBACK --> AUDIT_MANUAL["RefundAuditService.log()"]
    AUDIT_MANUAL --> DONE_Manual(["🔄 Done (manual)"])

    style GUARD_RESTOCK fill:#2a3a1a,stroke:#ffd166,color:#e0e8e4
    style RAZOR_CALL fill:#1a2a3a,stroke:#118ab2,color:#e0e8e4
    style UPDATE_SUCCESS fill:#2a4a2a,stroke:#06d6a0,color:#e0e8e4
    style UPDATE_FAILED fill:#3a1a1a,stroke:#ef4444,color:#e0e8e4
    style PENDING_FALLBACK fill:#3a2a1a,stroke:#f59e0b,color:#e0e8e4
```

---

> Generated from codebase analysis — All diagrams rendered with Mermaid.js  
> Open in any Mermaid-compatible markdown viewer (VS Code + Mermaid extension, GitHub, etc.)
