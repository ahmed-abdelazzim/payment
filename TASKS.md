# Master Executable Tasks: Sarraf Ops SaaS Evolution

> **سجل تاريخي:** مربعات هذه القائمة كتبت قبل التنفيذ الحالي ولا تمثل حالة تشغيل مباشرة. لا تستخدمها لتأكيد أن خدمة أو واجهة حية. اعتمد `docs/PRODUCT_CONTRACT.md` للمتطلبات الثابتة وحالة التخزين والتحقق الخارجي، ونتائج CI للاختبارات الفعلية.

## Execution Invariants for Future Coding Agents
1. Read `CONSTITUTION.md` and the relevant architecture specifications before touching code.
2. Work on ONE task at a time.
3. Explicitly distinguish UI completeness from backend connectivity: do not mark a task complete merely because a visual component exists.
4. Run tests and verify acceptance criteria before updating task status.

---

### Phase 1: SaaS Core Fundamentals & Tenant Isolation

- [ ] **SAAS-001 — PostgreSQL Schema Migration & RLS Enforcement**
  - **Status**: [مواصفة مكتملة في DATABASE.md — خدمة وقاعدة بيانات مطلوبة]
  - **Scope**: Run DDL migrations creating `organizations`, `users`, `organization_members`, `balance_accounts`, `payment_sources`, and `transactions`. Enable Row-Level Security policies.
  - **Files**: `src/db/migrations/001_initial_schema.sql`, `src/db/connection.ts`.
  - **Acceptance Criteria**: Direct queries without setting `app.current_organization_id` return 0 rows. Cross-tenant leakage impossible.

- [ ] **SAAS-002 — User Authentication & Session Management**
  - **Status**: [خدمة واتصال خلفي مطلوب]
  - **Scope**: Implement Email/Password authentication, Argon2id hashing, secure HTTP-only cookies, and session tokens.
  - **Files**: `server/routes/auth.ts`, `server/services/authService.ts`.
  - **Acceptance Criteria**: Secure signup, login, session expiry, and password reset flows with rate limiting.

- [ ] **SAAS-003 — Multi-Tenant Organization & RBAC Engine**
  - **Status**: [واجهة مكتملة بصرياً في NavigationDrawer — خدمة خلفية مطلوبة]
  - **Scope**: Implement role-based access control (Owner, Admin, Manager, Viewer) and workspace context switching.
  - **Files**: `server/middleware/rbac.ts`, `server/routes/organizations.ts`.
  - **Acceptance Criteria**: Viewers cannot modify devices or approve review items; Managers can review; Owners manage billing.

- [ ] **SAAS-004 — Centralized Entitlements & Subscription Tiers**
  - **Status**: [خدمة ونمذجة مطلوبة]
  - **Scope**: Implement plan entitlement checking (`canUseWebhooks()`, `maxConnectedDevices()`). Keep SaaS billing tiers completely separate from financial regulatory wallet limits.
  - **Files**: `server/services/entitlementService.ts`.
  - **Acceptance Criteria**: Plan quotas enforced at API boundaries without hardcoded `if (plan === 'pro')` scattered in routes.

---

### Phase 2: Ingestion Security & Device Layer

- [ ] **SAAS-005 — Cryptographic HMAC-SHA256 Ingestion Middleware**
  - **Status**: [مواصفة مكتملة في DEVICE_PROTOCOL.md — خدمة خلفية مطلوبة]
  - **Scope**: Implement request signing verification: `X-Device-ID`, `X-Timestamp`, `X-Nonce`, `X-Signature`. Check ±300s window.
  - **Files**: `server/middleware/deviceAuth.ts`, `server/routes/ingest.ts`.
  - **Acceptance Criteria**: Replayed requests, invalid signatures, or expired timestamps return HTTP 401/403.

- [ ] **SAAS-006 — Nonce Cache & Idempotent Transport Acknowledgment**
  - **Status**: [خدمة خلفية مطلوبة]
  - **Scope**: Store nonces in Redis or PostgreSQL unique index (`idx_raw_events_nonce`). Return HTTP 200 Duplicate Acknowledged for retransmissions.
  - **Files**: `server/services/nonceService.ts`.
  - **Acceptance Criteria**: Retried requests return previous receipt without creating duplicate raw events or running jobs again.

- [ ] **SAAS-007 — Immutable Raw Event Storage & Transactional Outbox**
  - **Status**: [خدمة خلفية مطلوبة]
  - **Scope**: Atomically commit raw payload into `raw_events` and downstream task into `outbox_jobs` in a single database transaction. Return HTTP 202.
  - **Files**: `server/services/ingestionService.ts`, `server/jobs/outboxProcessor.ts`.
  - **Acceptance Criteria**: Zero event loss even if worker process terminates immediately after HTTP 202 response.

- [ ] **SAAS-008 — Device Pairing Protocol & Token Provisioning**
  - **Status**: [واجهة ومحاكاة مكتملة في DevicesView — خدمة خلفية مطلوبة]
  - **Scope**: Backend implementation of 15-minute pairing token exchange, issuing permanent `device_id` and device secret.
  - **Files**: `server/services/pairingService.ts`, `server/routes/devices.ts`.
  - **Acceptance Criteria**: Pairing tokens expire in 15 minutes; credentials permanently provisioned in `device_credentials`.

---

### Phase 3: Payment Sources & Regulatory Limits (Section 4A)

- [ ] **SAAS-009 — Payment Source & Address Entity Modeling**
  - **Status**: [واجهة مكتملة بصرياً في RailsView — خدمة خلفية مطلوبة]
  - **Scope**: Implement the separate entities for `balance_accounts`, `payment_sources`, and `payment_addresses`.
  - **Files**: `server/models/paymentSource.ts`, `server/routes/sources.ts`.
  - **Acceptance Criteria**: Multiple InstaPay addresses or wallet SIMs bind to single balance accounts; adding an address does NOT duplicate balance.

- [ ] **SAAS-010 — CBE Regulatory Limit Tracking & Alert Engine**
  - **Status**: [محاكاة في الواجهة — خدمة خلفية ومطابقة زمنية مطلوبة]
  - **Scope**: Track daily incoming (60,000 EGP) and monthly incoming (200,000 EGP) wallet turnover using Cairo midnight reset. Fire alerts at 70%, 85%, 95%.
  - **Files**: `server/services/limitEngine.ts`, `server/alerts/limitAlerts.ts`.
  - **Acceptance Criteria**: Differentiates between InstaPay sender transfer caps (120k daily) and merchant bank receiving capacity.

- [ ] **SAAS-011 — Safe Source Switching & In-Flight Transition Window**
  - **Status**: [محاكاة في RailsView — خدمة خلفية مطلوبة]
  - **Scope**: Implement source promotion: mark old wallet as paused for new invoices while keeping it active for in-flight ingestion.
  - **Files**: `server/services/sourceSwitchService.ts`.
  - **Acceptance Criteria**: Payments sent to retired wallets continue reconciling against original accounts without being dropped.

---

### Phase 4: Cross-Platform Capture Adapters (Section 4B)

- [ ] **SAAS-012 — Apple Shortcuts iOS Prototype Validation Test**
  - **Status**: [مواصفة مكتملة في CAPTURE_ADAPTERS.md — مطلوب اختبار فيزيائي]
  - **Scope**: Execute manual capability tests on iOS 17/18 iPhone: personal message automation trigger, locked screen execution, HTTPS POST reliability, and network drop recovery.
  - **Files**: `tests/manual/ios_shortcuts_test_matrix.md`, `docs/setup-ios-shortcuts.md`.
  - **Acceptance Criteria**: Pass/Fail matrix documented with screenshots. If locked background POST fails, customer fallback is triggered.

- [ ] **SAAS-013 — Huawei EMUI Non-GMS Background Policy Verification**
  - **Status**: [مواصفة مكتملة في CAPTURE_ADAPTERS.md — مطلوب اختبار فيزيائي]
  - **Scope**: Validate background retention on physical non-GMS Huawei device: App Launch manual toggle, PowerGenie whitelist, device reboot test.
  - **Files**: `docs/setup-huawei-emui.md`, `tests/manual/huawei_emui_test_matrix.md`.
  - **Acceptance Criteria**: Adapter survives 4 hours of screen-off sleep and device restart without missing inbound payment SMS.

- [ ] **SAAS-014 — Dedicated Android Gateway Onboarding Wizard**
  - **Status**: [واجهة ومحاكاة مكتملة في DevicesView — توثيق ودليل مطلوب]
  - **Scope**: Production documentation and setup wizard for merchants running personal iPhones with a dedicated Android gateway SIM phone.
  - **Files**: `docs/guide-dedicated-android-gateway.md`.
  - **Acceptance Criteria**: End-to-end setup guide completed in under 7 minutes by non-technical merchants.

---

### Phase 5: Parsing & Golden Master Regression Suite

- [ ] **SAAS-015 — Isolated Regex Parser Module**
  - **Status**: [خدمة واختبارات مطلوبة]
  - **Scope**: Extract legacy Apps Script regex patterns into a pure TypeScript module without HTTP or database dependencies.
  - **Files**: `server/parser/engine.ts`, `server/parser/templates/`.
  - **Acceptance Criteria**: Returns structured `{ amount, senderPhone, senderName, statedBalance, trxId, confidenceScore }`.

- [ ] **SAAS-016 — Golden Master Test Fixture Library**
  - **Status**: [اختبارات مطلوبة]
  - **Scope**: Curate 50+ real/sanitized Egyptian payment messages (Vodafone, Orange, e&, InstaPay) covering Arabic/English numerals and edge cases.
  - **Files**: `tests/fixtures/messages/`, `tests/parser.test.ts`.
  - **Acceptance Criteria**: 100% test pass on legacy fixtures with zero regressions.

---

### Phase 6: Out-of-Order Reconciliation & Fraud Defense (Section 12A)

- [ ] **SAAS-017 — Per-Account Concurrency Lock & Balance Checkpoint Engine**
  - **Status**: [مواصفة في RECONCILIATION.md — خدمة خلفية مطلوبة]
  - **Scope**: Implement `SELECT ... FOR UPDATE` on `balance_accounts`. Enforce checkpoint anchors (`OFFICIAL_STATEMENT`, `OPERATOR_PROVISIONAL`).
  - **Files**: `server/services/reconciliationLockService.ts`.
  - **Acceptance Criteria**: Never compares initial event against zero; concurrent updates serialize cleanly per account.

- [ ] **SAAS-018 — Out-of-Order Permutation Worker**
  - **Status**: [مواصفة رياضية في RECONCILIATION.md — خدمة خلفية واختبارات مطلوبة]
  - **Scope**: Implement state machine: out-of-order events transition to `pending_ordering` and resolve upon arrival of preceding links.
  - **Files**: `server/services/reconciliationWorker.ts`, `tests/reconciliationPermutations.test.ts`.
  - **Acceptance Criteria**: All 6 permutations of arrival for Events A, B, C converge to 1,600 EGP with zero duplicate notifications.

- [ ] **SAAS-019 — Multi-Signal Fake Message Defense & USSD Verification**
  - **Status**: [مواصفة في RECONCILIATION.md — خدمة خلفية مطلوبة]
  - **Scope**: Implement invariant: arithmetic consistency != settlement. Unverified SMS or sender spoofing quarantined in `review_required`.
  - **Files**: `server/services/fraudDefenseService.ts`.
  - **Acceptance Criteria**: Spoofed SMS with mathematically correct balance is trapped in review queue and blocked from automated fulfillment.

- [ ] **SAAS-020 — Operator Review Queue API & Audit Integration**
  - **Status**: [واجهة ومحاكاة مكتملة في ReviewModal — خدمة خلفية مطلوبة]
  - **Scope**: Backend API for approving/rejecting quarantined transactions. Creates immutable entry in `audit_logs`.
  - **Files**: `server/routes/review.ts`, `server/services/reviewService.ts`.
  - **Acceptance Criteria**: Approvals require Manager/Admin role and reason string; updates transaction state to `confirmed` and adjusts ledger.

---

### Phase 7: User Interfaces & Production Operations

- [x] **SAAS-021 — Operational Telemetry Dashboard (Screen 1)**
  - **Status**: [منفذ فعلياً بالكامل في `DashboardView.tsx`]
  - **Scope**: 100% visual and interactive fidelity to Screen 1 mockup: offline alert banner, KPI cards, provider volume bento, live feed.

- [x] **SAAS-022 — Mobile Transaction Ledger & Drill-down Drawer (Screen 2)**
  - **Status**: [منفذ فعلياً بالكامل في `LedgerView.tsx`]
  - **Scope**: 100% visual and interactive fidelity to Screen 2 mockup: search, date/settlement bar, sticky chips, drill-down bottom sheet.

- [x] **SAAS-023 — POS Terminal Fleet & Battery Telemetry View**
  - **Status**: [منفذ فعلياً بالكامل في `DevicesView.tsx`]
  - **Scope**: Real-time battery levels, ping status, offline simulation, and pairing token generator modal.

- [x] **SAAS-024 — Bilingual Interface & RTL/LTR Direction Parity**
  - **Status**: [منفذ فعلياً بالكامل في `Header.tsx` و `App.tsx`]
  - **Scope**: Full localization in English and Egyptian Arabic with dynamic `dir="rtl"` / `dir="ltr"` attribute switching.

- [ ] **SAAS-025 — Native Android Background Agent APK**
  - **Status**: [مستقبلي — Phase 2]
  - **Scope**: Standalone branded Android foreground service app replacing third-party automation tools.
