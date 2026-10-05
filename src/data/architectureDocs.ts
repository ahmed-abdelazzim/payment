export interface ArchitectureDoc {
  id: string;
  title: string;
  filename: string;
  category: string;
  summary: string;
  content: string;
}

export const architectureDocs: ArchitectureDoc[] = [
  {
    id: 'planning_summary',
    title: 'Planning Summary Report',
    filename: 'PLANNING_SUMMARY.md',
    category: 'Executive Overview',
    summary: 'Discovery audit, selected PostgreSQL/Fastify architecture, mandatory sections 4A, 4B, 12A resolution, and MVP boundaries.',
    content: `# Sarraf Ops - Master SaaS Architectural Planning Report

## 1. Executive Summary & Discovery Findings
Sarraf Ops is evolving from a single-tenant Android MacroDroid + Google Apps Script + Google Sheets + Telegram Bot stack into an enterprise-grade, multi-tenant payment telemetry and ledger reconciliation SaaS for Egyptian merchants.

### Core Discoveries:
1. **Existing Intellectual Property**: The transaction classification and regex parser logic is highly valuable and must be preserved as an isolated TypeScript module before any major rewrite.
2. **Security Vulnerability in Legacy State**: The legacy Apps Script was an unauthenticated generic HTTP POST endpoint with no cryptographic request signing or replay mitigation.
3. **Multi-Tenancy Requirement**: Complete isolation across Organizations (Tenants), Workspaces, Devices, Wallets, and Ledgers with Row-Level Security (RLS) and cryptographic HMAC-SHA256 request authentication.
4. **Mandatory Sections 4A, 4B, 12A**:
   - **4A (Payment Sources & Financial Limits)**: Verified CBE rules (60k daily / 200k monthly for telecom wallets). Differentiates statutory InstaPay sender caps (120k daily) from merchant bank receiving limits which depend on bank agreement and KYC. Safe switching preserves historical ledger identity.
   - **4B (Cross-Platform Capture Adapters)**: Classifies iOS Apple Shortcuts as "Requires Prototype Validation" rather than ruling it out. Validates Huawei EMUI background retention without GMS. Establishes dedicated Android gateway phone as verified operational baseline.
   - **12A (Out-of-Order Reconciliation & Fake Message Defense)**: Independent provenance scoring; balance arithmetic consistency is treated as supporting evidence, NOT cryptographic proof of bank settlement. Definitive boundary for USSD capabilities.
`
  },
  {
    id: 'constitution',
    title: 'Development Constitution',
    filename: 'CONSTITUTION.md',
    category: 'Engineering Invariants',
    summary: 'Mandatory rules that all AI and human developers must strictly follow during implementation.',
    content: `# Engineering Constitution for Sarraf Ops

## Invariant 1: Multi-Tenant Data Isolation
Every query, mutation, and cache key MUST include the tenant context (organization_id). At the database layer, PostgreSQL Row-Level Security (RLS) policies must enforce isolation unconditionally.

## Invariant 2: Decimal & Minor-Unit Financial Arithmetic
Never use floating-point types (IEEE 754 float/double) for monetary amounts. All amounts must be stored as NUMERIC(14, 2) or integer minor units (piastres / cents).

## Invariant 3: Device Cryptographic Identity
Every device request must be authenticated via HMAC-SHA256 signature using the device secret. Requests without a valid timestamp (within ±300 seconds), unique nonce, and signature must be rejected with HTTP 401/403.

## Invariant 4: Deduplication & Idempotency
- Transport Idempotency: Repeated HTTP uploads with the same X-Nonce within the freshness window must return the cached response without creating duplicate raw events.
- Financial Idempotency: Deduplicate on (organization_id, provider, external_trx_id).

## Invariant 5: The Trust Boundary & Anti-Spoofing
Never treat matching balance arithmetic, sender labels, parser scores, or device signatures as proof of bank settlement. A spoofed SMS can contain mathematically perfect numbers.

## Invariant 6: Immutability of Financial Sources
A Payment Source entity is immutable. Switching the default receiving source creates a new binding with activation timestamps; it never overwrites or re-labels historical ledger entries.
`
  },
  {
    id: 'payment_sources',
    title: 'Payment Sources & Financial Limits',
    filename: 'PAYMENT_SOURCES_AND_LIMITS.md',
    category: 'Product Specifications & Limits',
    summary: 'Architecture for multi-wallet operations, safe instruction switching, and statutory CBE regulatory limits.',
    content: `# Payment Sources, Safe Switching, and Financial Limits

## 1. Domain Entities & Structural Separation
1. Balance Account: Canonical ledger container. Holds authoritative balance.
2. Payment Source: Authorized provider receiving container bound to organization.
3. Payment Address: Public identifier (phone number, InstaPay IPA/VPA, IBAN). Multiple addresses can route into ONE Balance Account, sharing one balance ledger and limit scope.

## 2. Egyptian Regulatory Limits & Source Verification
- CBE Mobile Wallet Regulations (Verified):
  - Daily Incoming Turnover: 60,000 EGP (Reset at 00:00:00 Cairo time).
  - Monthly Incoming Turnover: 200,000 EGP (Reset on 1st of month).
- InstaPay IPN Limits:
  - Payer / Sender Limits (Statutory): 70,000 EGP per transfer, 120,000 EGP daily, 400,000 EGP monthly.
  - Merchant / Receiver Limits: CBE does NOT impose a flat 120k incoming daily cap on commercial bank accounts. Incoming capacity is determined by receiving bank agreement and KYC tier. (Merchant-Configured).
`
  },
  {
    id: 'capture_adapters',
    title: 'Cross-Platform Capture Adapters',
    filename: 'CAPTURE_ADAPTERS.md',
    category: 'Hardware & Mobile Adapters',
    summary: 'Capability matrix for Android, iOS Shortcuts prototype validation, and Huawei EMUI retention.',
    content: `# Cross-Platform Capture Adapters & Capability Matrix

## 1. Executive Adapter Capability Matrix
- Android MacroDroid Bridge: 100% Autonomous, High Trust (Verified Baseline).
- Android Native Agent APK: 100% Autonomous, Highest Trust (Architecture Defined).
- iOS Apple Shortcuts Automation: Semi-autonomous to Autonomous, Moderate Trust (Requires Prototype Validation).
- Dedicated Business SIM Phone: SIM in dedicated Android gateway; merchant uses any phone (Verified Operational Pattern).
- Huawei EMUI Profile: Non-GMS HTTPS ingestion with manual App Launch whitelist (Requires Hardware Validation).

## 2. iOS Apple Shortcuts Evaluation
Treated as an active validation candidate rather than ruled out. Must be tested against:
1. Locked-screen network POST execution after 30 minutes of sleep.
2. Complete message body and sender capture without truncation.
3. Durability during network outages.
`
  },
  {
    id: 'reconciliation',
    title: 'Reconciliation & Out-of-Order Engine',
    filename: 'RECONCILIATION.md',
    category: 'Ledger Engine Architecture',
    summary: 'Mathematical models for balance reconciliation, USSD capabilities boundary, and fake-message defense.',
    content: `# Out-of-Order Reconciliation & Fake-Message Defense

## 1. The Ledger Equation & Checkpoint Anchor
- balance_after = balance_before + signed_net_account_effect.
- Initial Anchor: Never compares against 0.00 EGP. Starts from OFFICIAL_STATEMENT_CHECKPOINT or OPERATOR_PROVISIONAL_CHECKPOINT.

## 2. Precise USSD Definition: What It Proves and What It Does NOT Prove
- What USSD DOES Prove: Proves carrier core network balance for that SIM at that exact second; proves SIM hardware is active on cellular network.
- What USSD DOES NOT Prove: Does NOT prove which transaction caused the balance shift; does NOT prove sender identity; does NOT prevent race conditions between simultaneous transfers; does NOT provide cryptographic attestation.

## 3. Defense Against Spoofed Messages
- Core Invariant: A spoofed message can easily contain mathematically perfect numbers. Arithmetic consistency is NOT proof of bank settlement.
- Quarantined in Review Queue until dual-channel evidence or manual operator audit verification is provided.
`
  },
  {
    id: 'tasks',
    title: 'Master Executable Tasks (SAAS-001 to SAAS-025)',
    filename: 'TASKS.md',
    category: 'Engineering Roadmap',
    summary: '25 granular, self-contained 30-120 minute tasks distinguishing UI completeness from backend connectivity.',
    content: `# Master Executable Tasks: Sarraf Ops SaaS Evolution

- [ ] SAAS-001: PostgreSQL Schema Migration & RLS Enforcement [مواصفة مكتملة — خدمة وقاعدة بيانات مطلوبة]
- [ ] SAAS-002: User Authentication & Session Management [خدمة واتصال خلفي مطلوب]
- [ ] SAAS-003: Multi-Tenant Organization & RBAC Engine [واجهة مكتملة بصرياً — خدمة خلفية مطلوبة]
- [ ] SAAS-004: Centralized Entitlements & Subscription Tiers [خدمة ونمذجة مطلوبة]
- [ ] SAAS-005: Cryptographic HMAC-SHA256 Ingestion Middleware [مواصفة مكتملة — خدمة خلفية مطلوبة]
- [ ] SAAS-006: Nonce Cache & Idempotent Transport Acknowledgment [خدمة خلفية مطلوبة]
- [ ] SAAS-007: Immutable Raw Event Storage & Transactional Outbox [خدمة خلفية مطلوبة]
- [ ] SAAS-008: Device Pairing Protocol & Token Provisioning [واجهة ومحاكاة مكتملة — خدمة خلفية مطلوبة]
- [ ] SAAS-009: Payment Source & Address Entity Modeling [واجهة مكتملة بصرياً — خدمة خلفية مطلوبة]
- [ ] SAAS-010: CBE Regulatory Limit Tracking & Alert Engine [محاكاة في الواجهة — خدمة خلفية ومطابقة زمنية مطلوبة]
- [ ] SAAS-011: Safe Source Switching & In-Flight Transition Window [محاكاة في الواجهة — خدمة خلفية مطلوبة]
- [ ] SAAS-012: Apple Shortcuts iOS Prototype Validation Test [مواصفة مكتملة — مطلوب اختبار فيزيائي]
- [ ] SAAS-013: Huawei EMUI Non-GMS Background Policy Verification [مواصفة مكتملة — مطلوب اختبار فيزيائي]
- [ ] SAAS-014: Dedicated Android Gateway Onboarding Wizard [واجهة ومحاكاة مكتملة — توثيق ودليل مطلوب]
- [ ] SAAS-015: Isolated Regex Parser Module [خدمة واختبارات مطلوبة]
- [ ] SAAS-016: Golden Master Test Fixture Library [اختبارات مطلوبة]
- [ ] SAAS-017: Per-Account Concurrency Lock & Balance Checkpoint Engine [مواصفة مكتملة — خدمة خلفية مطلوبة]
- [ ] SAAS-018: Out-of-Order Permutation Worker [مواصفة رياضية مكتملة — خدمة خلفية واختبارات مطلوبة]
- [ ] SAAS-019: Multi-Signal Fake Message Defense & USSD Verification [مواصفة مكتملة — خدمة خلفية مطلوبة]
- [ ] SAAS-020: Operator Review Queue API & Audit Integration [واجهة ومحاكاة مكتملة — خدمة خلفية مطلوبة]
- [x] SAAS-021: Operational Telemetry Dashboard (Screen 1) [منفذ فعلياً بالكامل في DashboardView.tsx]
- [x] SAAS-022: Mobile Transaction Ledger & Drill-down Drawer (Screen 2) [منفذ فعلياً بالكامل في LedgerView.tsx]
- [x] SAAS-023: POS Terminal Fleet & Battery Telemetry View [منفذ فعلياً بالكامل في DevicesView.tsx]
- [x] SAAS-024: Bilingual Interface & RTL/LTR Direction Parity [منفذ فعلياً بالكامل في Header.tsx و App.tsx]
- [ ] SAAS-025: Native Android Background Agent APK [مستقبلي — Phase 2]
`
  }
];
