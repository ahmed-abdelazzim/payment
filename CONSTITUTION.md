# Engineering Constitution for Sarraf Ops

## Invariant 1: Multi-Tenant Data Isolation
Every query, mutation, and cache key MUST include the tenant context (`organization_id`). No endpoint may accept an `organization_id` directly from an untrusted client payload; it must be derived from authenticated session tokens or device API credentials. At the database layer, PostgreSQL Row-Level Security (RLS) policies must enforce isolation unconditionally.

## Invariant 2: Decimal & Minor-Unit Financial Arithmetic
Never use floating-point types (IEEE 754 float/double) for monetary amounts. All amounts must be stored as `NUMERIC(14, 2)` or integer minor units (piastres / cents). All balance calculations must use exact decimal arithmetic.

## Invariant 3: Device Cryptographic Identity
Every device request must be authenticated via HMAC-SHA256 signature using the device secret. Requests without a valid timestamp (within ±300 seconds), unique nonce, and signature must be rejected with HTTP 401/403. The backend must reject repeated nonces to prevent replay attacks.

## Invariant 4: Deduplication & Idempotency
- **Transport Idempotency**: Repeated HTTP uploads with the same `X-Nonce` within the freshness window must return the cached response without creating duplicate raw events.
- **Financial Idempotency**: Deduplicate on `(organization_id, provider, external_trx_id)`. If an external transaction ID is missing, apply deterministic fingerprinting with manual operator quarantine on ambiguity.

## Invariant 5: The Trust Boundary (Section 12A)
Never treat matching balance arithmetic, sender labels, parser scores, or device signatures as proof of bank settlement. A successful regex parse or device signature proves only that a message was captured and parsed—not that funds have legally settled. Confirmed status requires satisfying the documented evidence policy.

## Invariant 6: Immutability of Financial Sources & Historical Bindings (Section 4A)
A Payment Source entity (receiving wallet or bank account) is immutable. Switching the default receiving source creates a new binding with activation timestamps; it never overwrites or re-labels historical ledger entries. In-flight payments received on retired or paused sources must still reconcile against their original accounts.

## Invariant 7: Proactive Limit Awareness & Separation of Scopes (Section 4A)
Financial regulatory limits (CBE daily/monthly wallet turnover) must be tracked independently from SaaS subscription quotas. Multiple receiving aliases (e.g. several InstaPay addresses pointing to one bank account) share one balance ledger scope and one regulatory limit counter.

## Invariant 8: Transparent Capture Provenance & Degradation (Section 4B)
Never claim a capture adapter has capabilities it does not possess. If an adapter (such as Apple Shortcuts or manual submission) lacks background durability or cryptographic proof, its trust level must be explicitly recorded, and transactions must remain in the review queue if unverified.
