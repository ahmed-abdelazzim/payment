# SaaS Architecture Specification: Sarraf Ops

## 1. System Overview & Boundaries
Sarraf Ops is an enterprise-grade payment telemetry and reconciliation platform. It captures notifications from mobile payment adapters, parses and scores financial data, maintains an account-partitioned double-entry balance ledger, and dispatches real-time alerts.

```
+-----------------------------------------------------------------------------------+
|                              Capture Adapters (Edge)                             |
|  [Android MacroDroid]  [Android Native Agent]  [iOS Shortcuts]  [Huawei EMUI Profile] |
+-----------------------------------------+-----------------------------------------+
                                          | HTTPS + HMAC-SHA256 (X-Signature, Nonce)
                                          v
+-----------------------------------------------------------------------------------+
|                                 SaaS API Gateway                                  |
|   Rate Limiter --> Device Authentication Middleware --> Nonce Cache Check         |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                             Ingestion & Outbox Core                               |
|   1. Save Raw Event Immutably (raw_events table)                                  |
|   2. Commit Outbox Job (outbox_jobs table) in Single Atomic DB Transaction        |
|   3. Return HTTP 202 Accepted (Durable Receipt Acknowledged)                      |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        Async Processing & Reconciliation Engine                   |
|   Worker picks job --> Regex Parser & Score Engine --> Provenance Classifier      |
|   Acquire Row Lock (SELECT ... FOR UPDATE on balance_accounts)                    |
|   Out-of-Order Balance Chain Validation (Section 12A Algorithm)                   |
|   Evaluate Regulatory Financial Limits (Section 4A Tracker)                       |
|   Update Transaction & Checkpoint State --> Release Lock                          |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                           Integration & Notification Layer                        |
|   Telegram Bot Dispatcher  |  Signed Outbound Webhooks  |  Operator Review Queue  |
+-----------------------------------------------------------------------------------+
```

## 2. Component Directory Structure
```
/
├── server/
│   ├── middleware/        # Device HMAC auth, Tenant context, Rate limiter
│   ├── routes/            # Ingest, Review, Devices, Rails, Webhooks
│   ├── services/          # Reconciliation, Limits, Pairing, Audit
│   ├── parser/            # Isolated regex engines for Egyptian telecom wallets
│   └── jobs/              # Outbox processor, Telegram dispatcher, Webhook worker
├── src/
│   ├── components/        # Dashboard, Ledger, Devices, Rails, ReviewModal
│   ├── data/              # Mock data & architecture specifications
│   └── types.ts           # Shared TypeScript domain contracts
```
