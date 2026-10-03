# Database Architecture & Relational Schema (PostgreSQL)

## 1. Relational Entity-Relationship Model

```
organizations (1) <----> (N) users via organization_members (RBAC)
organizations (1) <----> (N) balance_accounts
organizations (1) <----> (N) payment_sources
payment_sources (1) <----> (N) payment_addresses
organizations (1) <----> (N) devices (1) <----> (1) device_credentials
organizations (1) <----> (N) raw_events
balance_accounts (1) <----> (N) transactions
balance_accounts (1) <----> (N) balance_checkpoints
balance_accounts (1) <----> (N) financial_limit_usage
organizations (1) <----> (N) outbox_jobs
organizations (1) <----> (N) audit_logs
organizations (1) <----> (N) webhook_endpoints (1) <----> (N) webhook_deliveries
```

---

## 2. Complete SQL DDL Schema

```sql
-- 1. Multi-Tenant Organizations
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    default_timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users and Organization Members (RBAC)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'viewer')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, user_id)
);

-- 3. Balance Accounts (Canonical Ledger Scope - Section 4A & 12A)
CREATE TABLE balance_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_name VARCHAR(150) NOT NULL,
    currency VARCHAR(3) DEFAULT 'EGP',
    current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    last_checkpoint_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_balance_accounts_org ON balance_accounts(organization_id);

-- 4. Payment Sources (Provider Financial Container - Section 4A)
CREATE TABLE payment_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    balance_account_id UUID NOT NULL REFERENCES balance_accounts(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('vodafone_cash', 'instapay', 'orange_cash', 'etisalat_cash')),
    friendly_name VARCHAR(150) NOT NULL,
    daily_turnover_limit NUMERIC(14, 2) NOT NULL,
    monthly_turnover_limit NUMERIC(14, 2) NOT NULL,
    is_paused_for_new_instructions BOOLEAN DEFAULT FALSE,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Payment Addresses (Receiving Aliases: MSISDN, InstaPay IPA, IBAN)
CREATE TABLE payment_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_source_id UUID NOT NULL REFERENCES payment_sources(id) ON DELETE CASCADE,
    address_type VARCHAR(20) NOT NULL CHECK (address_type IN ('msisdn', 'instapay_vpa', 'iban')),
    address_value VARCHAR(150) NOT NULL,
    is_default_for_invoices BOOLEAN DEFAULT FALSE,
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    retired_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_unique_active_address ON payment_addresses(payment_source_id, address_value);

-- 6. Devices and Cryptographic Credentials (Section 3 & 4B)
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_identifier VARCHAR(100) NOT NULL, -- e.g. 'Device #01'
    friendly_name VARCHAR(150) NOT NULL,
    location VARCHAR(150),
    adapter_type VARCHAR(50) NOT NULL CHECK (adapter_type IN ('macrodroid', 'native_agent', 'apple_shortcuts', 'huawei_emui', 'manual')),
    status VARCHAR(20) DEFAULT 'online' CHECK (status IN ('online', 'offline', 'revoked')),
    last_seen_at TIMESTAMPTZ,
    battery_level INT DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE device_credentials (
    device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    hmac_secret_hash VARCHAR(255) NOT NULL,
    token_version INT DEFAULT 1,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Raw Ingestion Events (Immutable Payload Store - Section 6)
CREATE TABLE raw_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    device_id UUID REFERENCES devices(id),
    adapter_type VARCHAR(50) NOT NULL,
    nonce VARCHAR(128) NOT NULL,
    raw_payload TEXT NOT NULL,
    client_timestamp TIMESTAMPTZ NOT NULL,
    server_received_at TIMESTAMPTZ DEFAULT NOW(),
    processing_status VARCHAR(30) DEFAULT 'unprocessed'
);
CREATE UNIQUE INDEX idx_raw_events_nonce ON raw_events(organization_id, nonce);

-- 8. Deduplicated Financial Transactions (Section 5, 11, 12A)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    balance_account_id UUID NOT NULL REFERENCES balance_accounts(id),
    payment_source_id UUID NOT NULL REFERENCES payment_sources(id),
    raw_event_id UUID REFERENCES raw_events(id),
    external_trx_id VARCHAR(150) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    amount NUMERIC(14, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'EGP',
    stated_balance_after NUMERIC(14, 2),
    sender_name VARCHAR(255),
    sender_phone VARCHAR(50),
    status VARCHAR(30) NOT NULL CHECK (status IN ('confirmed', 'review_required', 'pending_ordering', 'failed')),
    reconciliation_state VARCHAR(30) NOT NULL CHECK (reconciliation_state IN ('consistent', 'gap_detected', 'pending_ordering')),
    provenance_confidence NUMERIC(5, 2) NOT NULL,
    review_reason TEXT,
    financial_event_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_unique_external_trx ON transactions(organization_id, provider, external_trx_id);
CREATE INDEX idx_transactions_account_order ON transactions(balance_account_id, financial_event_at ASC);

-- 9. Balance Checkpoints (Section 12A Anchor Lifecycle)
CREATE TABLE balance_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    balance_account_id UUID NOT NULL REFERENCES balance_accounts(id) ON DELETE CASCADE,
    checkpoint_type VARCHAR(40) NOT NULL CHECK (checkpoint_type IN ('OFFICIAL_STATEMENT', 'OPERATOR_PROVISIONAL', 'INFERRED_FIRST_SNAPSHOT')),
    balance_amount NUMERIC(14, 2) NOT NULL,
    as_of_timestamp TIMESTAMPTZ NOT NULL,
    actor_id UUID REFERENCES users(id),
    audit_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Financial Limit Policies and Usage Tracking (Section 4A)
CREATE TABLE financial_limit_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_source_id UUID NOT NULL REFERENCES payment_sources(id) ON DELETE CASCADE,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'monthly')),
    period_start_cairo TIMESTAMPTZ NOT NULL,
    period_end_cairo TIMESTAMPTZ NOT NULL,
    accumulated_intake NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    regulatory_cap NUMERIC(14, 2) NOT NULL,
    is_alert_80_dispatched BOOLEAN DEFAULT FALSE,
    is_alert_90_dispatched BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (payment_source_id, period_type, period_start_cairo)
);

-- 11. Transactional Outbox (Guaranteed Delivery Pattern - Section 12)
CREATE TABLE outbox_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('process_transaction', 'send_telegram', 'dispatch_webhook')),
    payload JSONB NOT NULL,
    attempts INT DEFAULT 0,
    next_retry_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_outbox_retry ON outbox_jobs(status, next_retry_at) WHERE status = 'queued';

-- 12. Immutable Security Audit Logs (Section 23 & 25)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    actor_identity VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(150) NOT NULL,
    origin_ip VARCHAR(45),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Customer Outbound Webhooks (Section 17)
CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    signing_secret VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    subscribed_events TEXT[] NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_id VARCHAR(100) NOT NULL,
    http_status INT,
    response_body TEXT,
    attempt INT NOT NULL,
    delivered_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Row-Level Security (RLS) Configuration
ALTER TABLE balance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_org_balance_accounts ON balance_accounts FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::UUID);

CREATE POLICY rls_org_payment_sources ON payment_sources FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::UUID);

CREATE POLICY rls_org_transactions ON transactions FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::UUID);
```
