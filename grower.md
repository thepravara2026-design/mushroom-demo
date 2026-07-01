# Grower Admin Flow — Complete Reference

## Overview

The **Grower** role (`role: "grower"`) is a read-only customer identity designed for mushroom cultivators who access training courses, track orders, and browse products — but **cannot place orders** (blocked at checkout). Growers authenticate via OTP (email/phone) through the training registration flow.

---

## High-Level State Diagram

```mermaid
flowchart TD
    A["🗂️ Landing Page<br/>(sporekart.com)"] --> B{"User clicks<br/>'Register for Training'?"}
    B -->|Yes| C["📝 Training Registration Form<br/>(app.js:2856-3034)"]
    B -->|No| D["📖 Browse Products / Blog / Info<br/>(No auth needed)"]

    C --> E["🌐 Google Auth Flow"]
    C --> F["📧 Email OTP Flow"]
    C --> G["📱 Phone OTP Flow"]

    E --> H["AuthModal.open('grower', callback)<br/>(AuthModal.js:238)"]
    F --> H
    G --> H

    H --> I["Backend: authService.generateAndSendOTP()<br/>Stores role='grower' in OTP record"]
    I --> J["OTP sent via SMS / Email"]
    J --> K["Backend: authService.verifyOTP()<br/>Creates user with role='grower'"]
    K --> L["JWT issued: { role: 'grower', ... }"]

    L --> M["✅ Authenticated as Grower"]
    M --> N["Redirect to #training-courses<br/>(app.js:3013)"]
    N --> O["🧑‍🌾 Training Courses Page<br/>Browse & enroll in courses"]

    M --> P["Profile Dropdown<br/>(app.js:1169-1175)"]
    P --> Q["Shows: GROWER badge<br/>+ 'Track Orders' button"]

    Q --> R["Track Orders Page<br/>View order history & status"]

    M --> S["Attempt Checkout?"]
    S -->|"Blocked 🚫"| T["⚠️ Warning:<br/>'Cultivator profiles are read-only.<br/>Please create a Buyer account'<br/>(app.js:3649-3654)"]
    S -->|"Not checking out"| U["Continue browsing / training"]
```

---

## End-to-End Flow: Registration & Authentication

```mermaid
sequenceDiagram
    participant User as 🧑‍🌾 Grower
    participant UI as Frontend (app.js)
    participant Modal as AuthModal.js
    participant Backend as authService.js
    participant DB as Database

    User->>UI: Clicks "Register for Training"
    UI->>UI: Show training registration form (#training-register-form)
    User->>UI: Fills name, role, email/phone

    alt Google Auth
        User->>UI: Clicks Google button
        UI->>Modal: authModal.open('grower', callback)
        Modal->>Modal: Show "Grower Portal Access"<br/>Hide back button<br/>Show phone view first
        Modal->>Backend: OAuth mock flow
    else Email OTP
        User->>UI: Clicks "Send Email OTP"
        UI->>Backend: requestOtp(email, 'grower', name)
        Backend->>Backend: Generate OTP, store { otp, expiresAt, role:'grower' }
        Backend-->>UI: OTP sent (dev mode: auto-inject)
        UI->>UI: Show OTP input area
        User->>UI: Enters OTP
        UI->>Backend: verifyOtp(email, code)
    else Phone OTP
        User->>UI: Clicks "Send Phone OTP"
        UI->>Backend: requestOtp(mockEmail, 'grower', name)
        Backend->>Backend: Generate OTP, store { otp, expiresAt, role:'grower' }
        Backend-->>UI: OTP sent (dev mode: auto-inject)
        UI->>UI: Show OTP input area
        User->>UI: Enters OTP
        UI->>Backend: verifyOtp(mockEmail, code)
    end

    Backend->>DB: Find or create user with role='grower'
    DB-->>Backend: User record
    Backend->>Backend: Generate JWT { userId, email, role:'grower', fullName }
    Backend-->>UI: { token, user }

    UI->>UI: saveAuth(token, user)
    UI->>UI: Persist training role to localStorage
    UI->>UI: Redirect to #training-courses
    UI-->>User: 🎉 Training courses page loaded
```

---

## Role-Based UI Behavior

```mermaid
flowchart LR
    A["state.user.role"] --> B{"Which role?"}

    B -->|"admin"| C["🔧 Admin Console button<br/>in profile dropdown"]
    B -->|"grower"| D["🧑‍🌾 GROWER badge<br/>Track Orders button<br/>in profile dropdown"]
    B -->|"buyer"| E["🛒 No special action button"]

    D --> F["Checkout attempt?"]
    F -->|Yes| G["🚫 Blocked:<br/>'Cultivator profiles are read-only'"]
    F -->|No| H["✅ Browse products,<br/>view trainings,<br/>track orders"]

    C --> I["Full admin panel<br/>(admin.js)"]
```

---

## Checkout Block Flow

```mermaid
flowchart TD
    A["User navigates to #checkout<br/>(app.js:423)"] --> B{"state.user.role?"}

    B -->|"grower"| C["Redirect to #shop<br/>(app.js:424-427)"]
    B -->|"admin"| C
    B -->|"buyer"| D["Render checkout page"]

    C --> E["⬅️ User stays on shop page"]

    F["User clicks initiate checkout<br/>from cart (handleCheckoutInitiation)<br/>(app.js:3645)"] --> G{"state.user.role?"}

    G -->|"grower"| H["Show warning:<br/>'⚠️ Cultivator profiles are read-only.<br/>Please create a Buyer account'<br/>(app.js:3649-3654)"]
    G -->|"buyer / unauthenticated"| I["Proceed with checkout flow<br/>(inventory reserve, payment)"]
    H --> J["🚫 Return early, no checkout"]

    K["Order placed successfully<br/>(app.js:5962-5968)"] --> L{"state.user.role?"}
    L -->|"admin / grower"| M["Redirect to #track-{orderId}"]
    L -->|"buyer"| N["Redirect to #shop"]
```

---

## Training Enrollment Flow

```mermaid
sequenceDiagram
    participant User as 🧑‍🌾 Grower
    participant UI as Frontend
    participant API as POST /api/trainings/:id/enroll
    participant DB as Database

    User->>UI: Browses training courses
    User->>UI: Clicks "Enroll" on a course
    UI->>API: POST /api/trainings/:id/enroll<br/>{ role: 'grower' } (via JWT)
    API->>DB: Insert enrollment record<br/>{ training_id, user_id, role:'grower' }
    DB-->>API: Enrollment created
    API-->>UI: 200 OK
    UI-->>User: ✅ Enrolled in course
```

---

## Auth Modal Behavior for Growers

| Feature | Buyer | Grower | Admin |
|---------|-------|--------|-------|
| Modal title | "Welcome to Sporekart" | "Grower Portal Access" | "Admin Portal Access" |
| Back button | Visible | **Hidden** | Depends |
| Name field | Visible | Visible | Visible |
| Default view | Phone | Phone | Password |
| Admin login link | Hidden | **Visible** | N/A |
| On success callback | Varies | Redirects to `#training-courses` | Admin panel |

---

## Seed Data

```
Grower login: grower@sporekart.com (OTP-based)
Name:         Sam Grower
Phone:        9876543212
Role:         grower
```

---

## File Reference

| File | What it does for grower |
|------|------------------------|
| `frontend/src/app.js:2856-3034` | Training registration form interactions, OTP request/verify |
| `frontend/src/app.js:2896` | Opens AuthModal with `role='grower'` on Google click |
| `frontend/src/app.js:2911` | Calls `requestOtp(email, 'grower', name)` |
| `frontend/src/app.js:424-427` | Blocks grower from checkout hash route |
| `frontend/src/app.js:1169-1175` | Shows GROWER badge + "Track Orders" in profile dropdown |
| `frontend/src/app.js:3649-3654` | Checkout initiation block with warning message |
| `frontend/src/app.js:5963-5968` | Post-order redirect to track page for grower |
| `frontend/src/components/AuthModal.js:238-301` | `open()` — grower-specific title, back button hidden, admin link shown |
| `backend/src/routes/trainings.js:38-66` | Enrollment route accepting `'grower'` role |
| `backend/src/controllers/authController.js:26,172` | Validates `"grower"` as a valid role |
| `backend/src/services/authService.js:43,148-155` | Stores & persists `role: "grower"` |
| `backend/src/config/db.js:803-811` | Seed data for grower user |
| `backend/src/config/seed.js:232-238` | Seed data for grower user |

---

## Summary

The grower role is an **authenticated read-only customer identity** primarily used for training course access. Key behaviors:

- **Authentication**: OTP-based (email/phone) via training registration form
- **Post-auth redirect**: `#training-courses`
- **Profile UI**: GROWER badge + Track Orders button (no Admin Console)
- **Checkout**: **Blocked** — growers see a warning and are redirected
- **Order tracking**: Available (same as buyer)
- **Training enrollment**: Available (role `'grower'` accepted)
- **No dedicated API routes** — grower shares buyer routes with role-based UI gating
