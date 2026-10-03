# Out-of-Order Reconciliation & Fake-Message Defense (Section 12A)

## 1. The Financial Core Equation & Scope

### 1.1 The Ledger Equation
For every understood account entry within a partition `(organization_id, balance_account_id, currency)`:
```
balance_after = balance_before + signed_net_account_effect
```
Where `signed_net_account_effect` accounts for:
- Incoming credit transfers (+)
- Outgoing debit transfers (-)
- Telecom operator service fees (-)
- Reversals, chargebacks, and refund entries (+/-)

### 1.2 Initial Anchor / Checkpoint Lifecycle
The platform **NEVER** compares the first incoming message to a fabricated zero balance (0.00 EGP). All balance chains originate from an explicit anchor:

1. **`OFFICIAL_STATEMENT_CHECKPOINT` (High Trust)**:
   - Established from an official bank statement export or authenticated banking portal balance snapshot.
   - Immutable audit stamp: `(actor_id, statement_reference, timestamp, verified_amount)`.

2. **`OPERATOR_PROVISIONAL_CHECKPOINT` (Provisional Trust)**:
   - Initialized by an authorized merchant operator entering the current balance during onboarding (e.g. 28,000.00 EGP as of 09:00 Cairo time).
   - Tagged as provisional until validated by subsequent continuous transaction chains.

3. **`INFERRED_FIRST_SNAPSHOT` (Provisional Trust)**:
   - Derived from the post-balance string of the first verified telecom notification or USSD response.
   - Tagged as provisional and explicitly labeled in the UI.

---

## 2. Precise Definition: What USSD Proves and What It Does NOT Prove

### 2.1 What USSD DOES Prove (Supporting Physical Evidence)
- **Carrier Core Network Confirmation**: Proves that the mobile network operator's core billing system currently associates that exact stored-value balance with the active SIM seated in the capture phone at the moment of the query.
- **SIM Hardware Liveness**: Proves the SIM card is physically inserted, unlocked, registered on the cellular network, and able to execute interactive telecom USSD sessions (e.g. `*9#` for Vodafone, `#115#` for Orange).

### 2.2 What USSD DOES NOT Prove (Critical Security Boundaries)
- **Does NOT Prove Transaction Identity**: A USSD balance check returns only an aggregate balance number (e.g. "رصيدك الحالي 32,500 جنيه"). It does **NOT** prove which specific sender, transfer, or transaction ID produced that balance.
- **Does NOT Prove Sender Authenticity**: It cannot verify the payer's phone number or name.
- **Does NOT Prevent Race Conditions**: If two payers transfer funds within seconds of each other, a single USSD query cannot differentiate between their contributions.
- **Does NOT Provide Cryptographic Attestation**: Telecom USSD responses are plaintext cellular strings subject to network timeouts, session drops (`ERR-408-USSD-DROP`), or carrier formatting changes.
- **Architectural Rule**: USSD is an auxiliary **consistency check**, NOT a standalone proof of payment settlement.

---

## 3. Defense Against Spoofed & Fabricated Messages

### 3.1 The Invariant: Arithmetic Consistency is NOT Settlement Proof
> **A spoofed message can easily contain mathematically perfect numbers.**

Consider this real attack scenario:
- Current account balance: **30,000.00 EGP**.
- An attacker sends a forged SMS displaying sender "VodafoneCash":  
  *"تم استلام مبلغ 5,000 جنيه من 01099881122. رصيدك الحالي 35,000 جنيه. رقم العملية: VF-991204"*
- If the system relies on balance arithmetic alone, it verifies that `30,000 + 5,000 = 35,000` matches perfectly and would automatically fulfill an order.
- **The Sarraf Ops Defense**: Inbound messages from unauthenticated channels or missing cryptographic proof must **NEVER** auto-confirm based on arithmetic alone.

### 3.2 Multi-Signal Provenance Verification Engine
A transaction achieves `confirmed` status ONLY when it satisfies the documented evidence policy:
1. **Transport Authenticity**: Request uploaded with a valid HMAC-SHA256 signature from a registered, unrevoked device.
2. **Channel Provenance**:
   - For Mobile Wallets: Automated USSD delta verification executed by the device agent confirms that the carrier core balance shifted by the expected amount.
   - For InstaPay: Notification package identity verification (`com.egyptianbanks.instapay`) validated through Android `NotificationListenerService`.
3. **Quarantine / Review Required**:
   - Any message with an unverified USSD string, sender header anomaly, or manual paste is automatically held in `review_required`.
   - Webhook broadcasts and automated fulfillment are suspended until an authorized human operator verifies their banking app and signs an audit approval.

---

## 4. Handling Out-of-Order & Concurrent Payments

### 4.1 Account-Partitioned Concurrency Locks
- Concurrency locks are scoped strictly to `(organization_id, balance_account_id)`.
- Concurrent payments into different accounts execute in full parallel.
- When an account projection is updated:
  ```sql
  SELECT id, current_balance, last_checkpoint_at, version 
  FROM balance_accounts 
  WHERE id = $1 FOR UPDATE;
  ```
- Locks are released immediately after DB commit, BEFORE triggering external Telegram or webhook dispatches.

### 4.2 Worked Example: The 6-Permutation Convergence Test
- Starting Trusted Anchor: **1,000.00 EGP**
- Financial Transfers:
  - Event A: +200.00 EGP -> Expected Balance: 1,200.00 EGP
  - Event B: +300.00 EGP -> Expected Balance: 1,500.00 EGP
  - Event C: +100.00 EGP -> Expected Balance: 1,600.00 EGP
- **Worst-Case Arrival: C arrives first, then A, then B**:
  1. Event C arrives (+100 EGP, stated balance 1,600 EGP):
     - Inferred prior balance: `1,600 - 100 = 1,500 EGP`.
     - Prior balance (1,500) does not match current anchor (1,000 EGP).
     - Event C is stored with status `pending_ordering` (NOT marked as fake or fraud!).
  2. Event A arrives (+200 EGP, stated balance 1,200 EGP):
     - Inferred prior balance: `1,200 - 200 = 1,000 EGP`. Matches anchor (1,000).
     - Ledger balance updated to **1,200.00 EGP**. Event A status: `consistent`.
  3. Event B arrives (+300 EGP, stated balance 1,500 EGP):
     - Inferred prior balance: `1,500 - 300 = 1,200 EGP`. Matches current ledger (1,200).
     - Ledger balance updated to **1,500.00 EGP**. Event B status: `consistent`.
     - Re-evaluation trigger finds pending Event C: Prior balance 1,500 now matches!
     - Event C applied: Final Ledger balance updated to **1,600.00 EGP**. Event C transitions to `consistent`.
- **Outcome**: Regardless of arrival order (ABC, ACB, BAC, BCA, CAB, CBA), all permutations converge deterministically to **1,600.00 EGP** with zero duplicate notifications.
