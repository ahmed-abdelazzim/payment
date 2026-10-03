# Payment Sources, Safe Switching, and Financial Limits (Section 4A)

## 1. Domain Entities & Structural Separation

### 1.1 Payment Source vs. Payment Address vs. Balance Account
To prevent the architectural failure of treating every phone number or InstaPay address as an independent bank account, the system enforces a strict 3-tier entity hierarchy:

1. **Balance Account (`balance_accounts`)**:
   - The canonical financial ledger container (e.g. CIB Business Checking Account, or Vodafone Cash Stored-Value Account).
   - Holds the authoritative ledger balance, currency, and checkpoint history.
   - All balance arithmetic and concurrency locks operate on this entity.

2. **Payment Source (`payment_sources`)**:
   - An authorized receiving channel bound to a tenant organization and a provider (e.g., "Vodafone Cash Main Merchant Line", "CIB InstaPay Collector").
   - Governed by provider-specific regulatory turnover policies and capacity margins.

3. **Payment Address (`payment_addresses`)**:
   - The public-facing receiving identifier provided to payers:
     - Mobile wallet phone number (MSISDN): `01019283921`
     - InstaPay Virtual Payment Address (IPA/VPA): `cairo-logistics@instapay`
     - Bank IBAN / Account Number: `EG380002000...`
   - **Crucial Invariant**: Multiple Payment Addresses can route into a single Balance Account. They share the same underlying balance ledger and the same aggregate regulatory limit scope. Adding a second InstaPay alias pointing to the same bank account does NOT create fresh banking capacity.

---

## 2. Egyptian Regulatory Limits & Source Verification

### 2.1 Central Bank of Egypt (CBE) Mobile Wallet Regulations
- **Verified Source**: Central Bank of Egypt (CBE) Regulations for Mobile Payment Services (Circulars issued March 2020 and subsequent amendments):
  - **Individual / Micro-Enterprise Wallet Tier**:
    - Maximum Balance Cap: 100,000 EGP (Individual) to 200,000 EGP (Micro-merchant / Sole Proprietor).
    - Daily Incoming Turnover Limit: 60,000 EGP.
    - Monthly Incoming Turnover Limit: 200,000 EGP.
  - **Reset Definition**: Daily limits reset at 00:00:00 Africa/Cairo time. Monthly limits reset on the first calendar day of each month at 00:00:00 Africa/Cairo time.
  - **Status**: Verified against CBE circulars.

### 2.2 InstaPay (IPN - Instant Payment Network) Limits
- **Verified Source**: Central Bank of Egypt & Egyptian Banks Company (EBC) IPN Regulations (Circular dated March 2023):
  - **Payer / Outgoing Limits (Sender's Transfer Constraints)**:
    - Maximum per-transaction transfer: 70,000 EGP.
    - Maximum daily transfer total: 120,000 EGP.
    - Maximum monthly transfer total: 400,000 EGP.
  - **Merchant / Receiver Limits (Incoming Intake Constraints)**:
    - When receiving into a commercial/business bank account via IPN: CBE regulations do **NOT** impose a flat 120,000 EGP daily ceiling on incoming bank deposits. Incoming limits are determined by the receiving bank account's commercial agreement, KYC tier, and internal bank AML risk parameters.
    - When receiving into a mobile wallet linked to InstaPay: The incoming funds remain strictly bound by the mobile wallet incoming limit (60,000 EGP daily / 200,000 EGP monthly).
  - **Status**: Partially Verified. The sender transfer limits (70k / 120k / 400k) are statutory. Receiver bank account intake limits are **Account-Specific / Merchant-Configured** and must NOT be fabricated as fixed platform numbers.

### 2.3 Explicit Rule Categorization
- **Provider-Verified Rules**:
  - Telecom wallet daily limit: 60,000 EGP.
  - Telecom wallet monthly limit: 200,000 EGP.
  - InstaPay single transfer cap: 70,000 EGP.
  - InstaPay sender daily/monthly caps: 120,000 EGP / 400,000 EGP.
- **Merchant-Configured (Unverified Platform Defaults)**:
  - Receiving bank account daily/monthly capacity: Must be entered by merchant based on their actual bank contract.
  - Early warning alert thresholds: Configured by merchant (Defaults: 70%, 85%, 95%).
- **Open Assumptions**:
  - Reversals and failed transfers do NOT automatically restore daily capacity on mobile wallets unless explicitly confirmed by telecom carrier reconciliation.

---

## 3. Safe Switching Workflow & Immutability Rules

### 3.1 Immutability of Source Identity
1. A Payment Source entity is immutable.
2. When a merchant updates their active payment instructions from Wallet A (`010...111`) to Wallet B (`010...222`):
   - The platform NEVER overwrites, modifies, or re-labels Wallet A.
   - Wallet A is flagged with `is_paused_for_new_instructions = TRUE` and `retired_at = NOW()`.
   - Wallet B is flagged with `is_default_for_new_instructions = TRUE` and `activated_at = NOW()`.
   - All historical ledger records retain their original, immutable `payment_source_id`.

### 3.2 In-Flight Ingestion & The Transition Window
- Payers with previously issued invoices or cached payment details may continue sending funds to Wallet A for hours or days.
- Ingestion devices bound to Wallet A remain active in "Ingestion-Only" mode.
- Incoming transfers to Wallet A continue to be captured, parsed, and reconciled against Wallet A's balance account without being erroneously mapped to Wallet B.

### 3.3 Capacity Alerts & Automated Margins
- Real-time limit counters track usage based on **financial event timestamp** (Cairo time), not HTTP ingestion time.
- Automated notifications fire at merchant-defined thresholds (70%, 85%, 95%) via Telegram, Webhook, and Dashboard.
- When an active wallet hits 85% capacity, the SaaS recommends safe promotion of an alternate warm wallet.
- If all authorized wallets reach threshold capacity, the system displays an explicit warning and does NOT present unmonitored capacity as guaranteed.
