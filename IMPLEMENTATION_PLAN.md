# Master Implementation Plan (Phased Engineering Blueprint)

## Phase 1: Ingestion Core & Parsing Engine (Tasks SAAS-001 to SAAS-004)
- **Goal**: Secure, authenticated intake of payment events with zero data loss.
- **Deliverables**: Regex parser module, HMAC middleware, PostgreSQL schema with RLS, transactional outbox.
- **Definition of Done**: 100% test pass on parser fixtures; replay attacks rejected with HTTP 401.

## Phase 2: Domain Modeling & Regulatory Limits (Tasks SAAS-005 to SAAS-007)
- **Goal**: Implementation of Section 4A requirements for Egyptian financial networks.
- **Deliverables**: Separate `PaymentSource` vs `PaymentAddress` models, CBE daily/monthly turnover trackers, safe switching service.
- **Definition of Done**: Multi-InstaPay addresses share one ledger scope; alerts fire at 80% and 90% capacity; retired wallets continue in-flight capture.

## Phase 3: Hardware Adapters & Onboarding (Tasks SAAS-008 to SAAS-010)
- **Goal**: Implementation of Section 4B for Android, iOS, and Huawei devices.
- **Deliverables**: Pairing service with 15-minute token expiry, iOS Shortcuts profile, Huawei EMUI background guide.
- **Definition of Done**: Successful pairing handshake; documented physical test plan for non-GMS devices.

## Phase 4: Reconciliation Engine & Fraud Defense (Tasks SAAS-011 to SAAS-014)
- **Goal**: Implementation of Section 12A out-of-order balance reordering and fake-message quarantine.
- **Deliverables**: Partitioned row locks, permutation reordering worker, USSD handshake verification, Review Queue UI.
- **Definition of Done**: Out-of-order arrival converges to correct balance; spoofed SMS with matching balance trapped in review queue.

## Phase 5: Production User Interfaces & Telemetry (Tasks SAAS-015 to SAAS-017)
- **Goal**: Pixel-perfect implementation of provided mockups.
- **Deliverables**: Dashboard view (Screen 1), Ledger view (Screen 2), POS fleet view.
- **Definition of Done**: Responsive design matching mockups; interactive drill-down drawer and simulator suite.

## Phase 6: Integrations, Auditing & Hardening (Tasks SAAS-018 to SAAS-020)
- **Goal**: Outbound dispatchers and compliance readiness.
- **Deliverables**: Telegram bot, signed webhooks, tamper-evident audit logs.
- **Definition of Done**: All security actions audited; webhooks signed and retried on failure.
