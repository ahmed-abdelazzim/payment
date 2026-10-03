# Gap Analysis: Legacy Automation vs Commercial Multi-Tenant SaaS

| Capability Area | Current Legacy System | Target Commercial SaaS (Sarraf Ops) | Priority & Risk | Target Phase |
|---|---|---|---|---|
| **Multi-Tenancy** | Single-tenant (one Google Sheet). Hardcoded IDs. | Strict multi-tenancy with PostgreSQL RLS. Scoped organizations, workspaces, and users. | **Critical** (High risk of data leak if omitted) | Phase 1 (MVP) |
| **Device Authentication** | None. Generic unauthenticated HTTP POST. | Per-device credentials, HMAC-SHA256 request signing, nonces, timestamp window, revocation. | **Critical** (Vulnerable to forged transactions) | Phase 1 (MVP) |
| **Primary Database** | Google Sheets. Flaky, slow, rate-limited by Google API quotas. | PostgreSQL with relational integrity, decimal numeric types, indices, and transactional outbox. | **Critical** (Sheets cannot scale beyond 1 user) | Phase 1 (MVP) |
| **Section 4A: Multi-Source & Limits** | Single phone number assumption. No limit awareness. | Multiple wallet sources, safe switching with in-flight capture, CBE regulatory daily/monthly limits. | **Mandatory** (Merchant accounts get frozen by CBE) | Phase 1 (MVP) |
| **Section 4B: Capture Adapters** | Hardcoded to MacroDroid on one Android phone. | Multi-adapter framework: MacroDroid, Dedicated Android Gateway, iOS Shortcuts, Huawei EMUI. | **Mandatory** (iPhone merchants cannot onboard) | Phase 1 (MVP) |
| **Section 12A: Reconciliation** | Assumes linear sequential arrival. Accepts any math match. | Account row locks, out-of-order `pending_ordering` state machine, fake-message USSD verification. | **Mandatory** (Out-of-order SMS overwrites balance) | Phase 1 (MVP) |
| **Review & Draft Handling** | Stored in "Draft" sheet. Requires opening Google Sheets. | Dedicated Operator Review Queue UI with raw payload inspection, USSD comparison, and audit trail. | **Required** (Operational bottleneck) | Phase 1 (MVP) |
| **Customer Webhooks** | None. Only Telegram bot notifications. | Signed outbound B2B webhooks with HMAC signatures, automatic retry schedule, and delivery logs. | **Required** (Essential for e-commerce integration) | Phase 1.5 |
| **Auditing & Security** | None. No logs of who changed what. | Tamper-evident immutable audit log of all security, switching, and verification actions. | **Required** (Compliance and financial dispute safety) | Phase 1 (MVP) |
| **Automated Payment Routing** | None. Manual merchant selection. | Dynamic payment intent capacity reservation across warm wallet pools. | **Nice to Have** (Advanced optimization) | Phase 2 |
