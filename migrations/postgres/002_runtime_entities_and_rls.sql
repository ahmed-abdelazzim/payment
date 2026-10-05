-- Sarraf Ops PostgreSQL target migration: runtime entities, tenant integrity, and RLS
--
-- Apply after 001_initial_schema.sql with a PostgreSQL migration runner. This file is
-- deliberately a PostgreSQL target only: the checked-in Express runtime still uses
-- SQLite until its repository/data-access layer is ported and tested against pg.
--
-- The application role must set `SET LOCAL app.current_user_id = '<uuid>'` for every
-- request transaction after it has authenticated the session. Background ingestion,
-- audit, and outbox workers need narrowly scoped service roles or security-definer
-- procedures; they must never use an end-user connection without a tenant context.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A successful prior run forces RLS on most tables. Temporarily remove FORCE
-- inside this migration transaction so the table-owning migration role can
-- perform idempotent backfills and seed checks on a re-run. RLS is forced again
-- before COMMIT; other sessions never observe this transaction-local DDL state.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'sessions', 'email_verifications', 'password_resets',
    'login_attempts', 'team_invitations', 'balance_accounts', 'payment_sources',
    'payment_addresses', 'devices', 'device_credentials', 'pairing_tokens',
    'raw_events', 'transactions', 'balance_checkpoints', 'financial_limit_usage',
    'outbox_jobs', 'audit_logs', 'webhook_endpoints', 'webhook_deliveries',
    'subscription_plans', 'platform_settings', 'subscription_orders',
    'organization_subscriptions', 'subscription_receipts'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Bring tables created in 001 to the shape required by the current product.
-- -----------------------------------------------------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS telegram_bot_token_ciphertext BYTEA,
  ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS webhook_secret_ciphertext BYTEA;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS payment_source_id UUID,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_listener_granted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS battery_optimization_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_telemetry_payload JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.devices
  ALTER COLUMN status SET DEFAULT 'offline';

ALTER TABLE public.device_credentials
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS secret_key_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_rotated_at TIMESTAMPTZ;

ALTER TABLE public.payment_addresses
  ADD COLUMN IF NOT EXISTS organization_id UUID;

ALTER TABLE public.balance_checkpoints
  ADD COLUMN IF NOT EXISTS organization_id UUID;

ALTER TABLE public.financial_limit_usage
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS period_timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo',
  ADD COLUMN IF NOT EXISTS period_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS period_ends_at TIMESTAMPTZ;

ALTER TABLE public.outbox_jobs
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(200),
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by VARCHAR(128),
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS outbox_job_id UUID,
  ADD COLUMN IF NOT EXISTS result_code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill organization ownership before adding non-null and composite keys. A
-- migration should stop here for inconsistent data instead of guessing a tenant.
UPDATE public.payment_addresses AS address
SET organization_id = source.organization_id
FROM public.payment_sources AS source
WHERE address.organization_id IS NULL
  AND address.payment_source_id = source.id;

UPDATE public.device_credentials AS credential
SET organization_id = device.organization_id
FROM public.devices AS device
WHERE credential.organization_id IS NULL
  AND credential.device_id = device.id;

UPDATE public.balance_checkpoints AS checkpoint
SET organization_id = account.organization_id
FROM public.balance_accounts AS account
WHERE checkpoint.organization_id IS NULL
  AND checkpoint.balance_account_id = account.id;

UPDATE public.financial_limit_usage AS usage
SET organization_id = source.organization_id
FROM public.payment_sources AS source
WHERE usage.organization_id IS NULL
  AND usage.payment_source_id = source.id;

UPDATE public.webhook_deliveries AS delivery
SET organization_id = endpoint.organization_id
FROM public.webhook_endpoints AS endpoint
WHERE delivery.organization_id IS NULL
  AND delivery.endpoint_id = endpoint.id;

UPDATE public.webhook_deliveries AS delivery
SET outbox_job_id = job.id
FROM public.outbox_jobs AS job
WHERE delivery.outbox_job_id IS NULL
  AND delivery.event_id = job.id::TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_addresses WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill payment_addresses.organization_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.device_credentials WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill device_credentials.organization_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.balance_checkpoints WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill balance_checkpoints.organization_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financial_limit_usage WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill financial_limit_usage.organization_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.webhook_deliveries WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill webhook_deliveries.organization_id';
  END IF;
END;
$$;

ALTER TABLE public.payment_addresses ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.device_credentials ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.balance_checkpoints ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.financial_limit_usage ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.webhook_deliveries ALTER COLUMN organization_id SET NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Authentication, invitation, and pairing records. Only token hashes are kept.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  identifier_hash CHAR(64) PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 1 CHECK (failed_count >= 0),
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'manager', 'viewer')),
  inviter_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_hash CHAR(64),
  user_agent_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.pairing_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_identifier VARCHAR(100) NOT NULL,
  allowed_source_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

-- -----------------------------------------------------------------------------
-- 3. Subscription and platform-billing data. Transaction/payment records keep
--    snapshots so a later plan edit cannot alter a historical order or receipt.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code VARCHAR(64) NOT NULL UNIQUE,
  name_en VARCHAR(150) NOT NULL,
  name_ar VARCHAR(150) NOT NULL,
  billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'annual', 'trial')),
  price_egp NUMERIC(14, 2) NOT NULL CHECK (price_egp >= 0),
  device_limit INTEGER NOT NULL CHECK (device_limit >= 0),
  trial_duration_hours INTEGER NOT NULL DEFAULT 0 CHECK (trial_duration_hours >= 0),
  features_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(features_json) = 'array'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((billing_cycle = 'trial' AND price_egp = 0 AND trial_duration_hours > 0) OR
         (billing_cycle <> 'trial' AND trial_duration_hours = 0))
);

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id TEXT PRIMARY KEY DEFAULT 'current' CHECK (id = 'current'),
  instapay_number VARCHAR(32) NOT NULL DEFAULT '01551234263',
  beneficiary_name VARCHAR(150) NOT NULL DEFAULT 'Sarraf Ops',
  platform_org_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  platform_source_id UUID REFERENCES public.payment_sources(id) ON DELETE RESTRICT,
  platform_device_id UUID REFERENCES public.devices(id) ON DELETE RESTRICT,
  updated_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subscription_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(64) NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  plan_name_en VARCHAR(150) NOT NULL,
  plan_name_ar VARCHAR(150) NOT NULL,
  billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  price_egp NUMERIC(14, 2) NOT NULL CHECK (price_egp > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
  device_limit INTEGER NOT NULL CHECK (device_limit > 0),
  features_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(features_json) = 'array'),
  instapay_target_number VARCHAR(32) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'payment_reported', 'in_review', 'confirmed', 'rejected', 'expired')),
  reported_transfer_ref VARCHAR(150),
  reported_sender_info VARCHAR(255),
  reported_transfer_time TIMESTAMPTZ,
  reported_notes TEXT,
  reported_at TIMESTAMPTZ,
  matched_transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  approved_by_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  approval_type VARCHAR(20) CHECK (approval_type IN ('automatic', 'manual')),
  rejection_reason TEXT,
  review_notes TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL CHECK (status IN ('inactive', 'active', 'expired', 'grace_period', 'trial', 'trial_expired')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  device_limit INTEGER NOT NULL CHECK (device_limit >= 0),
  features_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(features_json) = 'array'),
  last_order_id UUID REFERENCES public.subscription_orders(id) ON DELETE SET NULL,
  trial_warn_48h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  trial_warn_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.subscription_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number VARCHAR(64) NOT NULL UNIQUE,
  order_id UUID NOT NULL UNIQUE REFERENCES public.subscription_orders(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  amount_paid NUMERIC(14, 2) NOT NULL CHECK (amount_paid > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
  payment_method VARCHAR(50) NOT NULL DEFAULT 'instapay_manual',
  matched_external_trx_id VARCHAR(150),
  billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start)
);

INSERT INTO public.platform_settings (id, instapay_number)
VALUES ('current', '01551234263')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscription_plans (
  plan_code, name_en, name_ar, billing_cycle, price_egp, device_limit,
  trial_duration_hours, features_json, is_active, sort_order
)
VALUES
  ('trial_7d', '7-Day Trial', 'تجربة مجانية لمدة 7 أيام', 'trial', 0, 1, 168,
    '["realtime_reconciliation", "macrodroid_agent", "hmac_security", "cbe_limits", "audit_trail"]'::JSONB, FALSE, 0),
  ('monthly_3', 'Monthly Plan — 3 Phones', 'الباقة الشهرية — حتى 3 هواتف', 'monthly', 499, 3, 0,
    '["realtime_reconciliation", "macrodroid_agent", "hmac_security", "cbe_limits", "audit_trail", "telegram_alerts"]'::JSONB, TRUE, 10),
  ('monthly_5', 'Monthly Plan — 5 Phones', 'الباقة الشهرية — حتى 5 هواتف', 'monthly', 799, 5, 0,
    '["realtime_reconciliation", "macrodroid_agent", "hmac_security", "cbe_limits", "audit_trail", "telegram_alerts", "webhooks", "team_access"]'::JSONB, TRUE, 20),
  ('annual_10', 'Annual Plan — 10 Phones', 'الباقة السنوية — حتى 10 هواتف', 'annual', 7990, 10, 0,
    '["realtime_reconciliation", "macrodroid_agent", "hmac_security", "cbe_limits", "audit_trail", "telegram_alerts", "webhooks", "team_access", "priority_support"]'::JSONB, TRUE, 30)
ON CONFLICT (plan_code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Cross-tenant relationships. Adding an organization_id to child rows lets
--    every tenant table have a direct, auditable RLS predicate.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_balance_accounts_id_org') THEN
    ALTER TABLE public.balance_accounts
      ADD CONSTRAINT uq_balance_accounts_id_org UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_payment_sources_id_org') THEN
    ALTER TABLE public.payment_sources
      ADD CONSTRAINT uq_payment_sources_id_org UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_devices_id_org') THEN
    ALTER TABLE public.devices
      ADD CONSTRAINT uq_devices_id_org UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_webhook_endpoints_id_org') THEN
    ALTER TABLE public.webhook_endpoints
      ADD CONSTRAINT uq_webhook_endpoints_id_org UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_subscription_orders_id_org') THEN
    ALTER TABLE public.subscription_orders
      ADD CONSTRAINT uq_subscription_orders_id_org UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_sources_account_same_org') THEN
    ALTER TABLE public.payment_sources
      ADD CONSTRAINT fk_payment_sources_account_same_org
      FOREIGN KEY (balance_account_id, organization_id)
      REFERENCES public.balance_accounts (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_devices_source_same_org') THEN
    ALTER TABLE public.devices
      ADD CONSTRAINT fk_devices_source_same_org
      FOREIGN KEY (payment_source_id, organization_id)
      REFERENCES public.payment_sources (id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_device_credentials_device_same_org') THEN
    ALTER TABLE public.device_credentials
      ADD CONSTRAINT fk_device_credentials_device_same_org
      FOREIGN KEY (device_id, organization_id)
      REFERENCES public.devices (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_addresses_source_same_org') THEN
    ALTER TABLE public.payment_addresses
      ADD CONSTRAINT fk_payment_addresses_source_same_org
      FOREIGN KEY (payment_source_id, organization_id)
      REFERENCES public.payment_sources (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pairing_tokens_source_same_org') THEN
    ALTER TABLE public.pairing_tokens
      ADD CONSTRAINT fk_pairing_tokens_source_same_org
      FOREIGN KEY (allowed_source_id, organization_id)
      REFERENCES public.payment_sources (id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_raw_events_device_same_org') THEN
    ALTER TABLE public.raw_events
      ADD CONSTRAINT fk_raw_events_device_same_org
      FOREIGN KEY (device_id, organization_id)
      REFERENCES public.devices (id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_account_same_org') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT fk_transactions_account_same_org
      FOREIGN KEY (balance_account_id, organization_id)
      REFERENCES public.balance_accounts (id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_source_same_org') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT fk_transactions_source_same_org
      FOREIGN KEY (payment_source_id, organization_id)
      REFERENCES public.payment_sources (id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_balance_checkpoints_account_same_org') THEN
    ALTER TABLE public.balance_checkpoints
      ADD CONSTRAINT fk_balance_checkpoints_account_same_org
      FOREIGN KEY (balance_account_id, organization_id)
      REFERENCES public.balance_accounts (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_limit_usage_source_same_org') THEN
    ALTER TABLE public.financial_limit_usage
      ADD CONSTRAINT fk_limit_usage_source_same_org
      FOREIGN KEY (payment_source_id, organization_id)
      REFERENCES public.payment_sources (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_webhook_deliveries_endpoint_same_org') THEN
    ALTER TABLE public.webhook_deliveries
      ADD CONSTRAINT fk_webhook_deliveries_endpoint_same_org
      FOREIGN KEY (endpoint_id, organization_id)
      REFERENCES public.webhook_endpoints (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscription_receipts_order_same_org') THEN
    ALTER TABLE public.subscription_receipts
      ADD CONSTRAINT fk_subscription_receipts_order_same_org
      FOREIGN KEY (order_id, organization_id)
      REFERENCES public.subscription_orders (id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_member_same_org') THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT fk_sessions_member_same_org
      FOREIGN KEY (organization_id, user_id)
      REFERENCES public.organization_members (organization_id, user_id) ON DELETE CASCADE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_devices_battery_level') THEN
    ALTER TABLE public.devices
      ADD CONSTRAINT chk_devices_battery_level CHECK (battery_level BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_source_limits') THEN
    ALTER TABLE public.payment_sources
      ADD CONSTRAINT chk_payment_source_limits CHECK (daily_turnover_limit >= 0 AND monthly_turnover_limit >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transaction_amount_positive') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT chk_transaction_amount_positive CHECK (amount > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transaction_provider') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT chk_transaction_provider
      CHECK (provider IN ('vodafone_cash', 'instapay', 'orange_cash', 'etisalat_cash'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_limit_usage_non_negative') THEN
    ALTER TABLE public.financial_limit_usage
      ADD CONSTRAINT chk_limit_usage_non_negative CHECK (accumulated_intake >= 0 AND regulatory_cap >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_limit_usage_cairo_timezone') THEN
    ALTER TABLE public.financial_limit_usage
      ADD CONSTRAINT chk_limit_usage_cairo_timezone CHECK (period_timezone = 'Africa/Cairo');
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Indexes and worker-safe uniqueness rules.
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_normalized_email ON public.users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_org_number ON public.devices (organization_id, device_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payment_address_per_org
  ON public.payment_addresses (organization_id, LOWER(address_value))
  WHERE retired_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_default_payment_address_per_source
  ON public.payment_addresses (payment_source_id)
  WHERE is_default_for_invoices = TRUE AND retired_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_raw_event
  ON public.transactions (raw_event_id)
  WHERE raw_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_order_matched_transaction
  ON public.subscription_orders (matched_transaction_id)
  WHERE matched_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_dedupe_key
  ON public.outbox_jobs (organization_id, job_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_delivery_attempt
  ON public.webhook_deliveries (endpoint_id, outbox_job_id, attempt)
  WHERE outbox_job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_invitation_per_org_email
  ON public.team_invitations (organization_id, LOWER(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_active_by_user
  ON public.sessions (user_id, organization_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry ON public.email_verifications (expires_at);
CREATE INDEX IF NOT EXISTS idx_password_resets_expiry ON public.password_resets (expires_at);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_expiry ON public.pairing_tokens (organization_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_devices_source ON public.devices (organization_id, payment_source_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_org_received ON public.raw_events (organization_id, server_received_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_org_created ON public.transactions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_account_time ON public.balance_checkpoints (organization_id, balance_account_id, as_of_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_limit_usage_org_period ON public.financial_limit_usage (organization_id, period_type, period_key);
CREATE INDEX IF NOT EXISTS idx_outbox_ready
  ON public.outbox_jobs (next_retry_at, created_at, id)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_outbox_lease
  ON public.outbox_jobs (lease_expires_at)
  WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_event
  ON public.webhook_deliveries (organization_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_org_created
  ON public.subscription_orders (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_status_expiry
  ON public.subscription_orders (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_subscription_receipts_org_issued
  ON public.subscription_receipts (organization_id, issued_at DESC);

-- Updated timestamps are database-owned, so retries and concurrent API paths have
-- a reliable ordering field regardless of which application process performs them.
CREATE OR REPLACE FUNCTION public.sarraf_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_balance_accounts_updated_at ON public.balance_accounts;
CREATE TRIGGER trg_balance_accounts_updated_at
  BEFORE UPDATE ON public.balance_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_payment_sources_updated_at ON public.payment_sources;
CREATE TRIGGER trg_payment_sources_updated_at
  BEFORE UPDATE ON public.payment_sources
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_devices_updated_at ON public.devices;
CREATE TRIGGER trg_devices_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_outbox_jobs_updated_at ON public.outbox_jobs;
CREATE TRIGGER trg_outbox_jobs_updated_at
  BEFORE UPDATE ON public.outbox_jobs
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_webhook_endpoints_updated_at ON public.webhook_endpoints;
CREATE TRIGGER trg_webhook_endpoints_updated_at
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_platform_settings_updated_at ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_subscription_orders_updated_at ON public.subscription_orders;
CREATE TRIGGER trg_subscription_orders_updated_at
  BEFORE UPDATE ON public.subscription_orders
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

DROP TRIGGER IF EXISTS trg_organization_subscriptions_updated_at ON public.organization_subscriptions;
CREATE TRIGGER trg_organization_subscriptions_updated_at
  BEFORE UPDATE ON public.organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_set_updated_at();

-- Audit rows are append-only. Event payloads are immutable while their processing
-- status may advance through the reconciliation state machine.
CREATE OR REPLACE FUNCTION public.sarraf_prevent_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_prevent_audit_mutation();

CREATE OR REPLACE FUNCTION public.sarraf_prevent_raw_event_payload_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.adapter_type IS DISTINCT FROM OLD.adapter_type
     OR NEW.nonce IS DISTINCT FROM OLD.nonce
     OR NEW.client_timestamp IS DISTINCT FROM OLD.client_timestamp
     OR NEW.server_received_at IS DISTINCT FROM OLD.server_received_at
     OR NEW.raw_payload IS DISTINCT FROM OLD.raw_payload THEN
    RAISE EXCEPTION 'raw event identity and payload are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raw_events_payload_immutable ON public.raw_events;
CREATE TRIGGER trg_raw_events_payload_immutable
  BEFORE UPDATE ON public.raw_events
  FOR EACH ROW EXECUTE FUNCTION public.sarraf_prevent_raw_event_payload_mutation();

-- -----------------------------------------------------------------------------
-- 6. Tenant RLS. These helpers deliberately read membership as the migration
--    owner. The runtime database role must not own these tables.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sarraf_current_user_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  setting_value TEXT;
BEGIN
  setting_value := current_setting('app.current_user_id', TRUE);
  IF setting_value IS NULL OR BTRIM(setting_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN setting_value::UUID;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sarraf_is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS candidate
    WHERE candidate.id = public.sarraf_current_user_id()
      AND candidate.is_active = TRUE
      AND candidate.is_platform_admin = TRUE
  );
$$;

-- End-user connections may update only their display name through the ordinary
-- user policy. Password, email-verification, activation, and platform-admin
-- state are changed by the authentication/provisioning service, never by a
-- browser-originated profile update.
CREATE OR REPLACE FUNCTION public.sarraf_can_update_user_profile(
  target_user_id UUID,
  proposed_email VARCHAR,
  proposed_password_hash VARCHAR,
  proposed_email_verified BOOLEAN,
  proposed_is_active BOOLEAN,
  proposed_is_platform_admin BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.sarraf_is_platform_admin()
    OR (
      target_user_id = public.sarraf_current_user_id()
      AND EXISTS (
        SELECT 1
        FROM public.users AS existing_user
        WHERE existing_user.id = target_user_id
          AND existing_user.email = proposed_email
          AND existing_user.password_hash = proposed_password_hash
          AND existing_user.email_verified = proposed_email_verified
          AND existing_user.is_active = proposed_is_active
          AND existing_user.is_platform_admin = proposed_is_platform_admin
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.sarraf_has_organization_access(target_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT target_organization_id IS NOT NULL
    AND (
      public.sarraf_is_platform_admin()
      OR EXISTS (
        SELECT 1
        FROM public.organization_members AS membership
        JOIN public.users AS member ON member.id = membership.user_id
        WHERE membership.organization_id = target_organization_id
          AND membership.user_id = public.sarraf_current_user_id()
          AND member.is_active = TRUE
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.sarraf_can_operate_organization(target_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT target_organization_id IS NOT NULL
    AND (
      public.sarraf_is_platform_admin()
      OR EXISTS (
        SELECT 1
        FROM public.organization_members AS membership
        JOIN public.users AS member ON member.id = membership.user_id
        WHERE membership.organization_id = target_organization_id
          AND membership.user_id = public.sarraf_current_user_id()
          AND membership.role IN ('owner', 'admin', 'manager')
          AND member.is_active = TRUE
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.sarraf_can_administer_organization(target_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT target_organization_id IS NOT NULL
    AND (
      public.sarraf_is_platform_admin()
      OR EXISTS (
        SELECT 1
        FROM public.organization_members AS membership
        JOIN public.users AS member ON member.id = membership.user_id
        WHERE membership.organization_id = target_organization_id
          AND membership.user_id = public.sarraf_current_user_id()
          AND membership.role IN ('owner', 'admin')
          AND member.is_active = TRUE
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.sarraf_can_assign_member_role(
  target_organization_id UUID,
  proposed_role VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT target_organization_id IS NOT NULL
    AND (
      public.sarraf_is_platform_admin()
      OR EXISTS (
        SELECT 1
        FROM public.organization_members AS membership
        JOIN public.users AS member ON member.id = membership.user_id
        WHERE membership.organization_id = target_organization_id
          AND membership.user_id = public.sarraf_current_user_id()
          AND membership.role = 'owner'
          AND member.is_active = TRUE
      )
      OR (
        proposed_role IN ('admin', 'manager', 'viewer')
        AND EXISTS (
          SELECT 1
          FROM public.organization_members AS membership
          JOIN public.users AS member ON member.id = membership.user_id
          WHERE membership.organization_id = target_organization_id
            AND membership.user_id = public.sarraf_current_user_id()
            AND membership.role = 'admin'
            AND member.is_active = TRUE
        )
      )
    );
$$;

-- RLS is enabled for every table with tenant or identity-bearing data. Do not
-- grant the application role table ownership; the FORCE clauses make an omitted
-- tenant context fail closed for table owners as well.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_limit_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_verifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.balance_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_addresses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.device_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.raw_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.balance_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_limit_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_receipts FORCE ROW LEVEL SECURITY;

-- Replace the incomplete policies from 001 before creating the full policy set.
DROP POLICY IF EXISTS rls_org_balance_accounts ON public.balance_accounts;
DROP POLICY IF EXISTS rls_org_payment_sources ON public.payment_sources;
DROP POLICY IF EXISTS rls_org_transactions ON public.transactions;

DROP POLICY IF EXISTS rls_users_self ON public.users;
DROP POLICY IF EXISTS rls_users_self_update ON public.users;
CREATE POLICY rls_users_self ON public.users
  FOR SELECT USING (id = public.sarraf_current_user_id() OR public.sarraf_is_platform_admin());
CREATE POLICY rls_users_self_update ON public.users
  FOR UPDATE USING (id = public.sarraf_current_user_id() OR public.sarraf_is_platform_admin())
  WITH CHECK (public.sarraf_can_update_user_profile(
    id, email, password_hash, email_verified, is_active, is_platform_admin
  ));

DROP POLICY IF EXISTS rls_organizations_read ON public.organizations;
DROP POLICY IF EXISTS rls_organizations_write ON public.organizations;
CREATE POLICY rls_organizations_read ON public.organizations
  FOR SELECT USING (public.sarraf_has_organization_access(id));
CREATE POLICY rls_organizations_write ON public.organizations
  FOR UPDATE USING (public.sarraf_can_administer_organization(id))
  WITH CHECK (public.sarraf_can_administer_organization(id));

DROP POLICY IF EXISTS rls_organization_members_read ON public.organization_members;
DROP POLICY IF EXISTS rls_organization_members_write ON public.organization_members;
DROP POLICY IF EXISTS rls_organization_members_insert ON public.organization_members;
DROP POLICY IF EXISTS rls_organization_members_update ON public.organization_members;
DROP POLICY IF EXISTS rls_organization_members_delete ON public.organization_members;
CREATE POLICY rls_organization_members_read ON public.organization_members
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_organization_members_insert ON public.organization_members
  FOR INSERT WITH CHECK (public.sarraf_can_assign_member_role(organization_id, role));
CREATE POLICY rls_organization_members_update ON public.organization_members
  FOR UPDATE USING (
    public.sarraf_can_administer_organization(organization_id)
    AND (role <> 'owner' OR public.sarraf_can_assign_member_role(organization_id, 'owner'))
  )
  WITH CHECK (public.sarraf_can_assign_member_role(organization_id, role));
CREATE POLICY rls_organization_members_delete ON public.organization_members
  FOR DELETE USING (
    public.sarraf_can_administer_organization(organization_id)
    AND (role <> 'owner' OR public.sarraf_can_assign_member_role(organization_id, 'owner'))
  );

DROP POLICY IF EXISTS rls_sessions_self ON public.sessions;
DROP POLICY IF EXISTS rls_sessions_self_delete ON public.sessions;
CREATE POLICY rls_sessions_self ON public.sessions
  FOR SELECT USING (user_id = public.sarraf_current_user_id()
                    AND public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_sessions_self_delete ON public.sessions
  FOR DELETE USING (user_id = public.sarraf_current_user_id()
                    AND public.sarraf_has_organization_access(organization_id));

-- Verification, reset, and login-attempt records have no end-user table policy.
-- Only the deliberately provisioned authentication service role may access them.

DROP POLICY IF EXISTS rls_invitations_read ON public.team_invitations;
DROP POLICY IF EXISTS rls_invitations_write ON public.team_invitations;
CREATE POLICY rls_invitations_read ON public.team_invitations
  FOR SELECT USING (public.sarraf_can_administer_organization(organization_id));
CREATE POLICY rls_invitations_write ON public.team_invitations
  FOR ALL USING (public.sarraf_can_administer_organization(organization_id))
  WITH CHECK (public.sarraf_can_administer_organization(organization_id));

DROP POLICY IF EXISTS rls_balance_accounts_read ON public.balance_accounts;
DROP POLICY IF EXISTS rls_balance_accounts_write ON public.balance_accounts;
CREATE POLICY rls_balance_accounts_read ON public.balance_accounts
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_balance_accounts_write ON public.balance_accounts
  FOR ALL USING (public.sarraf_can_operate_organization(organization_id))
  WITH CHECK (public.sarraf_can_operate_organization(organization_id));

DROP POLICY IF EXISTS rls_payment_sources_read ON public.payment_sources;
DROP POLICY IF EXISTS rls_payment_sources_write ON public.payment_sources;
CREATE POLICY rls_payment_sources_read ON public.payment_sources
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_payment_sources_write ON public.payment_sources
  FOR ALL USING (public.sarraf_can_operate_organization(organization_id))
  WITH CHECK (public.sarraf_can_operate_organization(organization_id));

DROP POLICY IF EXISTS rls_payment_addresses_read ON public.payment_addresses;
DROP POLICY IF EXISTS rls_payment_addresses_write ON public.payment_addresses;
CREATE POLICY rls_payment_addresses_read ON public.payment_addresses
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_payment_addresses_write ON public.payment_addresses
  FOR ALL USING (public.sarraf_can_operate_organization(organization_id))
  WITH CHECK (public.sarraf_can_operate_organization(organization_id));

DROP POLICY IF EXISTS rls_devices_read ON public.devices;
DROP POLICY IF EXISTS rls_devices_write ON public.devices;
CREATE POLICY rls_devices_read ON public.devices
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_devices_write ON public.devices
  FOR ALL USING (public.sarraf_can_operate_organization(organization_id))
  WITH CHECK (public.sarraf_can_operate_organization(organization_id));

DROP POLICY IF EXISTS rls_device_credentials_admin ON public.device_credentials;
CREATE POLICY rls_device_credentials_admin ON public.device_credentials
  FOR ALL USING (public.sarraf_can_administer_organization(organization_id))
  WITH CHECK (public.sarraf_can_administer_organization(organization_id));

DROP POLICY IF EXISTS rls_pairing_tokens_admin ON public.pairing_tokens;
CREATE POLICY rls_pairing_tokens_admin ON public.pairing_tokens
  FOR ALL USING (public.sarraf_can_administer_organization(organization_id))
  WITH CHECK (public.sarraf_can_administer_organization(organization_id));

DROP POLICY IF EXISTS rls_raw_events_read ON public.raw_events;
CREATE POLICY rls_raw_events_read ON public.raw_events
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));

DROP POLICY IF EXISTS rls_transactions_read ON public.transactions;
DROP POLICY IF EXISTS rls_transactions_write ON public.transactions;
CREATE POLICY rls_transactions_read ON public.transactions
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_transactions_write ON public.transactions
  FOR UPDATE USING (public.sarraf_can_operate_organization(organization_id))
  WITH CHECK (public.sarraf_can_operate_organization(organization_id));

DROP POLICY IF EXISTS rls_balance_checkpoints_read ON public.balance_checkpoints;
DROP POLICY IF EXISTS rls_balance_checkpoints_write ON public.balance_checkpoints;
CREATE POLICY rls_balance_checkpoints_read ON public.balance_checkpoints
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_balance_checkpoints_write ON public.balance_checkpoints
  FOR ALL USING (public.sarraf_can_operate_organization(organization_id))
  WITH CHECK (public.sarraf_can_operate_organization(organization_id));

DROP POLICY IF EXISTS rls_financial_limit_usage_read ON public.financial_limit_usage;
CREATE POLICY rls_financial_limit_usage_read ON public.financial_limit_usage
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));

DROP POLICY IF EXISTS rls_outbox_jobs_read ON public.outbox_jobs;
CREATE POLICY rls_outbox_jobs_read ON public.outbox_jobs
  FOR SELECT USING (public.sarraf_can_operate_organization(organization_id));

DROP POLICY IF EXISTS rls_audit_logs_read ON public.audit_logs;
CREATE POLICY rls_audit_logs_read ON public.audit_logs
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));

DROP POLICY IF EXISTS rls_webhook_endpoints_read ON public.webhook_endpoints;
DROP POLICY IF EXISTS rls_webhook_endpoints_write ON public.webhook_endpoints;
CREATE POLICY rls_webhook_endpoints_read ON public.webhook_endpoints
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_webhook_endpoints_write ON public.webhook_endpoints
  FOR ALL USING (public.sarraf_can_administer_organization(organization_id))
  WITH CHECK (public.sarraf_can_administer_organization(organization_id));

DROP POLICY IF EXISTS rls_webhook_deliveries_read ON public.webhook_deliveries;
CREATE POLICY rls_webhook_deliveries_read ON public.webhook_deliveries
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));

DROP POLICY IF EXISTS rls_subscription_plans_read ON public.subscription_plans;
DROP POLICY IF EXISTS rls_subscription_plans_write ON public.subscription_plans;
CREATE POLICY rls_subscription_plans_read ON public.subscription_plans
  FOR SELECT USING (public.sarraf_current_user_id() IS NOT NULL);
CREATE POLICY rls_subscription_plans_write ON public.subscription_plans
  FOR ALL USING (public.sarraf_is_platform_admin())
  WITH CHECK (public.sarraf_is_platform_admin());

DROP POLICY IF EXISTS rls_platform_settings_admin ON public.platform_settings;
CREATE POLICY rls_platform_settings_admin ON public.platform_settings
  FOR ALL USING (public.sarraf_is_platform_admin())
  WITH CHECK (public.sarraf_is_platform_admin());

DROP POLICY IF EXISTS rls_subscription_orders_read ON public.subscription_orders;
DROP POLICY IF EXISTS rls_subscription_orders_write ON public.subscription_orders;
DROP POLICY IF EXISTS rls_subscription_orders_update ON public.subscription_orders;
CREATE POLICY rls_subscription_orders_read ON public.subscription_orders
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));
CREATE POLICY rls_subscription_orders_write ON public.subscription_orders
  FOR INSERT WITH CHECK (public.sarraf_can_operate_organization(organization_id));
CREATE POLICY rls_subscription_orders_update ON public.subscription_orders
  FOR UPDATE USING (public.sarraf_can_operate_organization(organization_id))
  WITH CHECK (public.sarraf_can_operate_organization(organization_id));

DROP POLICY IF EXISTS rls_organization_subscriptions_read ON public.organization_subscriptions;
CREATE POLICY rls_organization_subscriptions_read ON public.organization_subscriptions
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));

DROP POLICY IF EXISTS rls_subscription_receipts_read ON public.subscription_receipts;
CREATE POLICY rls_subscription_receipts_read ON public.subscription_receipts
  FOR SELECT USING (public.sarraf_has_organization_access(organization_id));

COMMIT;
