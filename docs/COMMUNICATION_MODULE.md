# Communication Module

## Architecture

```
Application Code
      │
      ▼
CommunicationService  (Facade — Single entry point)
      │
      ├──► MockProvider (Default — No external API calls)
      │
      └──► MSG91Provider (Future — Requires credentials)
      │
      ▼
   QueueService  (Async job processing)
      │
      ▼
   LogService  (Message logging & tracking)
```

## Folder Structure

```
backend/src/services/communication/
│
├── index.js                          # Module entry point
├── CommunicationService.js           # Facade — all app code uses this
├── config/
│   └── index.js                      # Environment variable config
├── interfaces/
│   └── ProviderInterface.js          # Interface all providers must implement
├── providers/
│   ├── mock/
│   │   └── MockProvider.js           # In-memory mock implementation
│   └── msg91/
│       └── Msg91Provider.js          # MSG91 skeleton (inactive)
├── services/
│   ├── OtpService.js                 # Secure OTP generation & verification
│   ├── TemplateService.js            # Template rendering with variables
│   ├── LogService.js                 # Message logging & stats
│   └── QueueService.js               # Async job queue with retry
├── controllers/
│   └── CommunicationController.js    # Express route handlers
├── routes/
│   └── communicationRoutes.js        # Express routes
├── validators/
│   └── communicationValidators.js    # Joi validation schemas
├── logs/
│   └── index.js                      # Winston logger (communication-specific)
└── queue/
    └── (runtime — no files needed)
```

## Configuration

### Environment Variables (.env)

| Variable | Default | Description |
|---|---|---|
| `COMMUNICATION_PROVIDER` | `mock` | Provider to use: `mock` or `msg91` |
| `MOCK_COMM_SIMULATE_FAILURES` | `false` | Enable random failure simulation |
| `MOCK_COMM_FAILURE_RATE` | `0` | Failure probability (0.0–1.0) |
| `MOCK_COMM_SIMULATE_DELAY` | `false` | Enable simulated network delay |
| `MOCK_COMM_DELAY_MS` | `100` | Base delay in milliseconds |
| `MSG91_AUTH_KEY` | — | MSG91 authentication key |
| `MSG91_SENDER_ID` | — | MSG91 sender ID |
| `MSG91_TEMPLATE_ID` | — | MSG91 default template ID |
| `MSG91_OTP_TEMPLATE` | — | MSG91 OTP template ID |
| `MSG91_WHATSAPP_TEMPLATE` | — | MSG91 WhatsApp template ID |
| `COMM_OTP_LENGTH` | `6` | OTP digit length |
| `COMM_OTP_EXPIRY_MINUTES` | `5` | OTP validity in minutes |
| `COMM_OTP_MAX_ATTEMPTS` | `5` | Max failed verification attempts |
| `COMM_QUEUE_RETRY_MAX` | `3` | Max retries for failed jobs |
| `COMM_QUEUE_RETRY_BASE_DELAY` | `1000` | Base retry delay (ms, doubles each attempt) |
| `COMM_QUEUE_POLL_INTERVAL` | `500` | Queue poll interval in ms |
| `COMM_LOG_LEVEL` | `info` | Log level: error, warn, info, debug |
| `COMM_LOG_DIR` | `logs/communication` | Log directory path |

## API Endpoints

### Public / Authenticated

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/communication/send-sms` | Send an SMS |
| `POST` | `/api/communication/send-otp` | Send an OTP |
| `POST` | `/api/communication/verify-otp` | Verify an OTP |
| `POST` | `/api/communication/send-whatsapp` | Send a WhatsApp message |
| `POST` | `/api/communication/send-email` | Send an email |
| `POST` | `/api/communication/send-event` | Send a template-based event notification |
| `POST` | `/api/communication/render-template` | Preview a rendered template |
| `GET` | `/api/communication/templates` | List all available templates |
| `GET` | `/api/communication/logs` | Get message logs (with filters) |
| `GET` | `/api/communication/logs/:id` | Get a specific log entry |
| `GET` | `/api/communication/stats` | Get communication statistics |
| `GET` | `/api/communication/queue` | Get queue status |
| `GET` | `/api/communication/otp-status/:identifier` | Check OTP status |
| `GET` | `/api/communication/health` | Health check |

### Admin Only (requires `admin` or `super_admin` role)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/communication/retry-all` | Retry all failed messages |
| `POST` | `/api/communication/retry/:jobId` | Retry a specific job |
| `DELETE` | `/api/communication/otp/:identifier` | Invalidate an OTP |
| `GET` | `/api/communication/dev-otp/:identifier` | View OTP (dev mode only) |

These routes are also mounted at `/api/admin/communication/...` for convenience.

## Mock Mode (Default)

When `COMMUNICATION_PROVIDER=mock`:

- No external API calls are made
- No SMS/WhatsApp/Email charges
- All messages are logged to console and file logs
- OTPs are displayed in console (development mode only) for testing
- Delivery simulation completes after 500ms
- Error simulation can be configured via `MOCK_COMM_SIMULATE_FAILURES`

### Testing OTP Flow in Mock Mode

1. POST `/api/communication/send-otp` with body: `{ "recipient": "user@example.com", "channel": "email" }`
2. In development mode, the OTP is printed to server console
3. POST `/api/communication/verify-otp` with body: `{ "recipient": "user@example.com", "otp": "123456" }`
4. Or use the Admin Dashboard → Communication → Development OTP Lookup

## Switching to MSG91

1. Set `COMMUNICATION_PROVIDER=msg91` in `.env`
2. Add MSG91 credentials:
   ```
   MSG91_AUTH_KEY=your-auth-key
   MSG91_SENDER_ID=your-sender-id
   MSG91_TEMPLATE_ID=your-template-id
   MSG91_OTP_TEMPLATE=your-otp-template
   MSG91_WHATSAPP_TEMPLATE=your-whatsapp-template
   ```
3. Restart the server
4. No code modifications required

## Adding a New Provider

1. Create `backend/src/services/communication/providers/myprovider/MyProvider.js`
2. Extend `ProviderInterface` and implement all methods:
   - `sendSms()`
   - `sendOtp()`
   - `verifyOtp()`
   - `sendWhatsApp()`
   - `sendEmail()`
   - `getDeliveryStatus()`
   - `healthCheck()`
3. Add a new `case` in `CommunicationService.initialize()`
4. Add config in `config/index.js`
5. Add env vars to `.env.example`

## OTP Security

- OTPs are hashed with bcrypt before storage
- 5-minute expiry
- Maximum 5 verification attempts
- OTPs are deleted after successful verification (prevent replay)
- OTPs are never exposed in API responses
- In production mode, OTPs are only logged as masked identifiers
- In development mode, OTPs are printed to server console for testing

## Message Templates

Available template variables:

| Variable | Description |
|---|---|
| `{{otp}}` | One-time password |
| `{{expiryMinutes}}` | OTP expiry duration |
| `{{orderId}}` | Order reference number |
| `{{amount}}` | Monetary amount |
| `{{trackingUrl}}` | Shipping tracking URL |
| `{{productName}}` | Product name |
| `{{stock}}` | Current stock level |
| `{{message}}` | Custom alert message |

## Queue System

- All communication jobs are processed asynchronously
- Failed jobs retry with exponential backoff (1s, 2s, 4s, ...)
- Max 3 retries by default (configurable)
- Jobs never block API response times
- Queue status visible in Admin Dashboard

## Supported Events

| Event | SMS | WhatsApp | Email |
|---|---|---|---|
| User Registration OTP | ✓ | ✓ | ✓ |
| Login OTP | ✓ | ✓ | ✓ |
| Password Reset OTP | ✓ | ✓ | ✓ |
| Order Confirmation | ✓ | ✓ | ✓ |
| Payment Success | ✓ | ✓ | ✓ |
| Order Cancelled | ✓ | ✓ | ✓ |
| Order Shipped | ✓ | ✓ | ✓ |
| Out For Delivery | ✓ | ✓ | ✓ |
| Delivered | ✓ | ✓ | ✓ |
| Refund Initiated | ✓ | ✓ | ✓ |
| Low Inventory Alert | ✓ | ✓ | ✓ |
| Admin Alert | ✓ | ✓ | ✓ |

## Testing

```bash
# Run communication module tests
cd backend
npx jest tests/communication.test.js

# Run all tests
npx jest
```

## Troubleshooting

| Problem | Likely Cause | Solution |
|---|---|---|
| MSG91 provider not working | Missing credentials | Set `COMMUNICATION_PROVIDER=mock` or add MSG91 credentials |
| OTP not received | Check mock mode logs | OTPs are printed to console in dev mode |
| Messages not appearing in admin | Check log level | Set `COMM_LOG_LEVEL=debug` for detailed logs |
| Queue not processing | Check interval | Queue polls every 500ms by default |
| Admin dashboard shows "!" badge | Failed messages | Click "Retry Failed" in Communication tab |
