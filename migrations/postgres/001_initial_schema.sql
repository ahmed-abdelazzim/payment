-- PostgreSQL Initial Migration: Sarraf Ops Multi-Tenant Schema
-- File: migrations/postgres/001_initial_schema.sql

-- `gen_random_uuid()` is provided by pgcrypto on supported PostgreSQL versions.
-- Keep uuid-ossp as well for installations that use it elsewhere, but do not
-- rely on it for the defaults in this schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    default_timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users and Organization Members
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'viewer')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, user_id)
);

-- 3. Balance Accounts (Canonical Ledger Scope)
CREATE TABLE IF NOT EXISTS balance_accounts (
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
CREATE INDEX IF NOT EXISTS idx_balance_accounts_org ON balance_accounts(organization_id);

-- 4. Payment Sources
CREATE TABLE IF NOT EXISTS payment_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    balance_account_id UUID NOT NULL REFERENCES balance_accounts(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('vodafone_cash', 'instapay', 'orange_cash', 'etisalat_cash')),
    friendly_name VARCHAR(150) NOT NULL,
    wallet_number VARCHAR(100) NOT NULL,
    daily_turnover_limit NUMERIC(14, 2) NOT NULL,
    monthly_turnover_limit NUMERIC(14, 2) NOT NULL,
    is_paused_for_new_instructions BOOLEAN DEFAULT FALSE,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Payment Addresses
CREATE TABLE IF NOT EXISTS payment_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_source_id UUID NOT NULL REFERENCES payment_sources(id) ON DELETE CASCADE,
    address_type VARCHAR(20) NOT NULL CHECK (address_type IN ('msisdn', 'instapay_vpa', 'iban')),
    address_value VARCHAR(150) NOT NULL,
    is_default_for_invoices BOOLEAN DEFAULT FALSE,
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    retired_at TIMESTAMPTZ,
    UNIQUE (payment_source_id, address_value)
);

-- 6. Devices and Device Credentials
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_number VARCHAR(100) NOT NULL,
    friendly_name VARCHAR(150) NOT NULL,
    location VARCHAR(150),
    adapter_type VARCHAR(50) NOT NULL CHECK (adapter_type IN ('macrodroid', 'native_agent', 'apple_shortcuts', 'huawei_emui', 'manual')),
    status VARCHAR(20) DEFAULT 'online' CHECK (status IN ('online', 'offline', 'revoked')),
    last_seen_at TIMESTAMPTZ,
    battery_level INT DEFAULT 100,
    agent_version VARCHAR(50),
    config_version VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_credentials (
    device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    hmac_secret VARCHAR(255) NOT NULL,
    token_version INT DEFAULT 1,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Raw Events
CREATE TABLE IF NOT EXISTS raw_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    device_id UUID REFERENCES devices(id),
    adapter_type VARCHAR(50) NOT NULL,
    nonce VARCHAR(128) NOT NULL,
    client_timestamp TIMESTAMPTZ NOT NULL,
    server_received_at TIMESTAMPTZ DEFAULT NOW(),
    raw_payload TEXT NOT NULL,
    processing_status VARCHAR(30) DEFAULT 'unprocessed',
    UNIQUE (organization_id, nonce)
);

-- 8. Deduplicated Transactions
CREATE TABLE IF NOT EXISTS transactions (
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
    signature VARCHAR(255),
    financial_event_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, provider, external_trx_id)
);
CREATE INDEX IF NOT EXISTS idx_transactions_order ON transactions(balance_account_id, financial_event_at ASC);

-- 9. Checkpoints
CREATE TABLE IF NOT EXISTS balance_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    balance_account_id UUID NOT NULL REFERENCES balance_accounts(id) ON DELETE CASCADE,
    checkpoint_type VARCHAR(40) NOT NULL CHECK (checkpoint_type IN ('OFFICIAL_STATEMENT', 'OPERATOR_PROVISIONAL', 'INFERRED_FIRST_SNAPSHOT')),
    balance_amount NUMERIC(14, 2) NOT NULL,
    as_of_timestamp TIMESTAMPTZ NOT NULL,
    actor_id UUID REFERENCES users(id),
    audit_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Financial Limit Tracking
CREATE TABLE IF NOT EXISTS financial_limit_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_source_id UUID NOT NULL REFERENCES payment_sources(id) ON DELETE CASCADE,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'monthly')),
    period_key VARCHAR(50) NOT NULL,
    accumulated_intake NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    regulatory_cap NUMERIC(14, 2) NOT NULL,
    is_alert_80_dispatched BOOLEAN DEFAULT FALSE,
    is_alert_90_dispatched BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (payment_source_id, period_type, period_key)
);

-- 11. Outbox Jobs
CREATE TABLE IF NOT EXISTS outbox_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('reconcile_event', 'send_telegram', 'dispatch_webhook', 'limit_alert')),
    payload JSONB NOT NULL,
    attempts INT DEFAULT 0,
    next_retry_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_identity VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(150) NOT NULL,
    origin_ip VARCHAR(45),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Enable Row-Level Security
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
