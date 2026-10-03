import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

let dbInstance: DatabaseSync | null = null;

export function setDatabase(db: DatabaseSync | null): void {
  dbInstance = db;
}

export function getDatabase(dbPath?: string): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const finalPath = dbPath || process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'sarraf_ops.db');
  
  if (finalPath !== ':memory:') {
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(finalPath);

  // Enable foreign keys and WAL mode for high concurrency
  db.exec('PRAGMA foreign_keys = ON;');
  if (finalPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  initSchema(db);
  dbInstance = db;
  return dbInstance;
}

export function initTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    -- Organizations (Tenants)
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      default_timezone TEXT DEFAULT 'Africa/Cairo',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email_verified INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Email Verification Tokens (Single-use, 24-hour expiry)
    CREATE TABLE IF NOT EXISTS email_verifications (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Brute Force / Password Guessing Protection (Lockout after 5 failed attempts)
    CREATE TABLE IF NOT EXISTS login_attempts (
      identifier TEXT PRIMARY KEY, -- IP or normalized email
      failed_count INTEGER DEFAULT 1,
      locked_until TEXT,
      last_attempt_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Team Invitations (Tokenized, Role-Enforced, Single-Use)
    CREATE TABLE IF NOT EXISTS team_invitations (
      token TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'viewer')),
      inviter_user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Organization Members & RBAC
    CREATE TABLE IF NOT EXISTS organization_members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'viewer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, user_id),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- User Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- Password Reset Tokens
    CREATE TABLE IF NOT EXISTS password_resets (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Balance Accounts (Ledger Scope - Section 4A & 12A)
    CREATE TABLE IF NOT EXISTS balance_accounts (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      currency TEXT DEFAULT 'EGP',
      current_balance REAL NOT NULL DEFAULT 0.0,
      last_checkpoint_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_balance_accounts_org ON balance_accounts(organization_id);

    -- Payment Sources (Provider Financial Container)
    CREATE TABLE IF NOT EXISTS payment_sources (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      balance_account_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('vodafone_cash', 'instapay', 'orange_cash', 'etisalat_cash')),
      friendly_name TEXT NOT NULL,
      wallet_number TEXT NOT NULL,
      daily_turnover_limit REAL NOT NULL,
      monthly_turnover_limit REAL NOT NULL,
      is_paused_for_new_instructions INTEGER DEFAULT 0,
      retired_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (balance_account_id) REFERENCES balance_accounts(id) ON DELETE CASCADE
    );

    -- Payment Addresses (Receiving Aliases)
    CREATE TABLE IF NOT EXISTS payment_addresses (
      id TEXT PRIMARY KEY,
      payment_source_id TEXT NOT NULL,
      address_type TEXT NOT NULL CHECK (address_type IN ('msisdn', 'instapay_vpa', 'iban')),
      address_value TEXT NOT NULL,
      is_default_for_invoices INTEGER DEFAULT 0,
      activated_at TEXT NOT NULL DEFAULT (datetime('now')),
      retired_at TEXT,
      FOREIGN KEY (payment_source_id) REFERENCES payment_sources(id) ON DELETE CASCADE,
      UNIQUE (payment_source_id, address_value)
    );

    -- Devices (Capture Adapters)
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      device_number TEXT NOT NULL,
      friendly_name TEXT NOT NULL,
      location TEXT,
      adapter_type TEXT NOT NULL CHECK (adapter_type IN ('macrodroid', 'native_agent', 'apple_shortcuts', 'huawei_emui', 'manual')),
      status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'revoked')),
      battery_level INTEGER DEFAULT 100,
      last_seen_at TEXT,
      agent_version TEXT,
      config_version TEXT,
      verified_at TEXT,
      notification_listener_granted INTEGER DEFAULT 0,
      battery_optimization_exempt INTEGER DEFAULT 0,
      last_telemetry_payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    -- Device Credentials & Cryptographic Secrets
    CREATE TABLE IF NOT EXISTS device_credentials (
      device_id TEXT PRIMARY KEY,
      hmac_secret TEXT NOT NULL,
      token_version INTEGER DEFAULT 1,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- Pairing Tokens (Temporary 15-Minute Expiry)
    CREATE TABLE IF NOT EXISTS pairing_tokens (
      token TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      device_identifier TEXT NOT NULL,
      allowed_source_id TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    -- Raw Ingestion Events (Immutable Log)
    CREATE TABLE IF NOT EXISTS raw_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      device_id TEXT,
      adapter_type TEXT NOT NULL,
      nonce TEXT NOT NULL,
      client_timestamp TEXT NOT NULL,
      server_received_at TEXT NOT NULL DEFAULT (datetime('now')),
      raw_payload TEXT NOT NULL,
      processing_status TEXT DEFAULT 'unprocessed',
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (device_id) REFERENCES devices(id),
      UNIQUE (organization_id, nonce)
    );

    -- Transactions (Deduplicated Reconciled Financial Ledger)
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      balance_account_id TEXT NOT NULL,
      payment_source_id TEXT NOT NULL,
      raw_event_id TEXT,
      external_trx_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'EGP',
      stated_balance_after REAL,
      sender_name TEXT,
      sender_phone TEXT,
      status TEXT NOT NULL CHECK (status IN ('confirmed', 'review_required', 'pending_ordering', 'failed')),
      reconciliation_state TEXT NOT NULL CHECK (reconciliation_state IN ('consistent', 'gap_detected', 'pending_ordering')),
      provenance_confidence REAL NOT NULL,
      review_reason TEXT,
      signature TEXT,
      financial_event_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (balance_account_id) REFERENCES balance_accounts(id),
      FOREIGN KEY (payment_source_id) REFERENCES payment_sources(id),
      FOREIGN KEY (raw_event_id) REFERENCES raw_events(id),
      UNIQUE (organization_id, provider, external_trx_id)
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_order ON transactions(balance_account_id, financial_event_at ASC);

    -- Balance Checkpoints
    CREATE TABLE IF NOT EXISTS balance_checkpoints (
      id TEXT PRIMARY KEY,
      balance_account_id TEXT NOT NULL,
      checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('OFFICIAL_STATEMENT', 'OPERATOR_PROVISIONAL', 'INFERRED_FIRST_SNAPSHOT')),
      balance_amount REAL NOT NULL,
      as_of_timestamp TEXT NOT NULL,
      actor_id TEXT,
      audit_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (balance_account_id) REFERENCES balance_accounts(id) ON DELETE CASCADE
    );

    -- Financial Limit Usage
    CREATE TABLE IF NOT EXISTS financial_limit_usage (
      id TEXT PRIMARY KEY,
      payment_source_id TEXT NOT NULL,
      period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'monthly')),
      period_key TEXT NOT NULL, -- e.g. '2026-09-30'
      accumulated_intake REAL NOT NULL DEFAULT 0.0,
      regulatory_cap REAL NOT NULL,
      is_alert_80_dispatched INTEGER DEFAULT 0,
      is_alert_90_dispatched INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (payment_source_id) REFERENCES payment_sources(id) ON DELETE CASCADE,
      UNIQUE (payment_source_id, period_type, period_key)
    );

    -- Outbox Jobs (Transactional Outbox Pattern)
    CREATE TABLE IF NOT EXISTS outbox_jobs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      job_type TEXT NOT NULL CHECK (job_type IN ('reconcile_event', 'send_telegram', 'dispatch_webhook', 'limit_alert')),
      payload TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      next_retry_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_queue ON outbox_jobs(status, next_retry_at);

    -- Immutable Audit Logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      actor_identity TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      origin_ip TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    -- Webhook Endpoints & Deliveries
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      url TEXT NOT NULL,
      signing_secret TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      subscribed_events TEXT NOT NULL, -- comma-separated
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      http_status INTEGER,
      response_body TEXT,
      attempt INTEGER NOT NULL,
      delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE CASCADE
    );

    -- ----------------------------------------------------
    -- Subscription Plans (Tier definitions & device limits)
    -- ----------------------------------------------------
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id TEXT PRIMARY KEY,
      name_en TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
      price_egp REAL NOT NULL,
      device_limit INTEGER NOT NULL,
      features_json TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ----------------------------------------------------
    -- Platform Settings (Controlled exclusively by Platform Owner)
    -- ----------------------------------------------------
    CREATE TABLE IF NOT EXISTS platform_settings (
      id TEXT PRIMARY KEY DEFAULT 'current',
      instapay_number TEXT NOT NULL DEFAULT '01551234263',
      beneficiary_name TEXT NOT NULL DEFAULT 'عبدالرحمن عبده',
      platform_org_id TEXT NOT NULL DEFAULT 'org_platform_ops',
      platform_source_id TEXT NOT NULL DEFAULT 'src_platform_instapay',
      platform_device_id TEXT NOT NULL DEFAULT 'dev_platform_terminal',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ----------------------------------------------------
    -- Subscription Orders (Immutable snapshots of plan & payment terms)
    -- ----------------------------------------------------
    CREATE TABLE IF NOT EXISTS subscription_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name_en TEXT NOT NULL,
      plan_name_ar TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      price_egp REAL NOT NULL,
      currency TEXT DEFAULT 'EGP',
      device_limit INTEGER NOT NULL,
      features_json TEXT NOT NULL,
      instapay_target_number TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending_payment', 'payment_reported', 'in_review', 'confirmed', 'rejected', 'expired')),
      reported_transfer_ref TEXT,
      reported_sender_info TEXT,
      reported_transfer_time TEXT,
      reported_notes TEXT,
      reported_at TEXT,
      matched_transaction_id TEXT,
      approved_by_user_id TEXT,
      approval_type TEXT CHECK (approval_type IN ('automatic', 'manual')),
      rejection_reason TEXT,
      review_notes TEXT,
      expires_at TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sub_orders_org ON subscription_orders(organization_id);
    CREATE INDEX IF NOT EXISTS idx_sub_orders_status ON subscription_orders(status);

    -- ----------------------------------------------------
    -- Organization Subscriptions (Single active entitlement record per tenant)
    -- ----------------------------------------------------
    CREATE TABLE IF NOT EXISTS organization_subscriptions (
      id TEXT PRIMARY KEY,
      organization_id TEXT UNIQUE NOT NULL,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'expired', 'grace_period', 'trial', 'trial_expired')),
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      device_limit INTEGER NOT NULL,
      features_json TEXT NOT NULL,
      last_order_id TEXT,
      trial_warn_48h_sent INTEGER DEFAULT 0,
      trial_warn_24h_sent INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
      FOREIGN KEY (last_order_id) REFERENCES subscription_orders(id)
    );
    CREATE INDEX IF NOT EXISTS idx_org_subs_org ON organization_subscriptions(organization_id);

    -- ----------------------------------------------------
    -- Subscription Receipts (Official financial documentation for merchants)
    -- ----------------------------------------------------
    CREATE TABLE IF NOT EXISTS subscription_receipts (
      id TEXT PRIMARY KEY,
      receipt_number TEXT UNIQUE NOT NULL,
      order_id TEXT UNIQUE NOT NULL,
      organization_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      amount_paid REAL NOT NULL,
      currency TEXT DEFAULT 'EGP',
      payment_method TEXT DEFAULT 'instapay_manual',
      matched_external_trx_id TEXT,
      billing_cycle TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      issued_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES subscription_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
  `);

  // Apply incremental column migrations safely
  try {
    db.prepare('ALTER TABLE users ADD COLUMN is_platform_admin INTEGER DEFAULT 0').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE devices ADD COLUMN verified_at TEXT').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE devices ADD COLUMN notification_listener_granted INTEGER DEFAULT 0').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE devices ADD COLUMN battery_optimization_exempt INTEGER DEFAULT 0').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE devices ADD COLUMN last_telemetry_payload TEXT').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE organizations ADD COLUMN telegram_bot_token TEXT').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE organizations ADD COLUMN telegram_chat_id TEXT').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE organizations ADD COLUMN webhook_url TEXT').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE organizations ADD COLUMN webhook_secret TEXT').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE organization_subscriptions ADD COLUMN trial_warn_48h_sent INTEGER DEFAULT 0').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE organization_subscriptions ADD COLUMN trial_warn_24h_sent INTEGER DEFAULT 0').run();
  } catch {}

  // Ensure organization_subscriptions CHECK constraint supports trial and trial_expired
  try {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='organization_subscriptions'").get() as { sql: string } | undefined;
    if (tableSql?.sql && !tableSql.sql.includes('trial')) {
      db.exec(`
        CREATE TABLE organization_subscriptions_temp (
          id TEXT PRIMARY KEY,
          organization_id TEXT UNIQUE NOT NULL,
          plan_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'expired', 'grace_period', 'trial', 'trial_expired')),
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          device_limit INTEGER NOT NULL,
          features_json TEXT NOT NULL,
          last_order_id TEXT,
          trial_warn_48h_sent INTEGER DEFAULT 0,
          trial_warn_24h_sent INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
          FOREIGN KEY (last_order_id) REFERENCES subscription_orders(id)
        );
        INSERT INTO organization_subscriptions_temp (
          id, organization_id, plan_id, status, starts_at, ends_at, device_limit, features_json, last_order_id, created_at, updated_at
        ) SELECT id, organization_id, plan_id, status, starts_at, ends_at, device_limit, features_json, last_order_id, created_at, updated_at FROM organization_subscriptions;
        DROP TABLE organization_subscriptions;
        ALTER TABLE organization_subscriptions_temp RENAME TO organization_subscriptions;
        CREATE INDEX IF NOT EXISTS idx_org_subs_org ON organization_subscriptions(organization_id);
      `);
    }
  } catch {}

  // Production and Clean Execution: strictly disable demo accounts and demo data
  if (process.env.SEED_DEMO_DATA !== 'true') {
    try {
      db.prepare("UPDATE users SET is_active = 0 WHERE email = 'admin@cairologistics.com'").run();
      db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@cairologistics.com')").run();
    } catch {}
    bootstrapPlatformAndPlans(db);
    return;
  }

  // Seed plans and platform operational tenant
  bootstrapPlatformAndPlans(db);

  // Only seed in non-production environments if explicitly requested via SEED_DEMO_DATA=true
  seedInitialData(db);
}

export function bootstrapPlatformAndPlans(db: DatabaseSync): void {
  // 1. Seed or ensure the 3 official subscription plans
  const planRows = db.prepare('SELECT COUNT(*) as count FROM subscription_plans').get() as { count: number };
  if (!planRows || planRows.count === 0) {
    const plans = [
      {
        id: 'plan_monthly_3',
        nameEn: 'Monthly Plan — 3 Phones',
        nameAr: 'الباقة الشهرية — 3 هواتف',
        billingCycle: 'monthly',
        priceEgp: 499.0,
        deviceLimit: 3,
        features: [
          'realtime_reconciliation',
          'macrodroid_agent',
          'hmac_security',
          'cbe_limits',
          'audit_trail',
        ],
      },
      {
        id: 'plan_monthly_5',
        nameEn: 'Monthly Plan — 5 Phones',
        nameAr: 'الباقة الشهرية — 5 هواتف',
        billingCycle: 'monthly',
        priceEgp: 799.0,
        deviceLimit: 5,
        features: [
          'realtime_reconciliation',
          'macrodroid_agent',
          'hmac_security',
          'cbe_limits',
          'audit_trail',
          'telegram_webhooks',
        ],
      },
      {
        id: 'plan_annual_10',
        nameEn: 'Annual Plan — 10 Phones',
        nameAr: 'الباقة السنوية — 10 هواتف',
        billingCycle: 'annual',
        priceEgp: 7990.0,
        deviceLimit: 10,
        features: [
          'realtime_reconciliation',
          'macrodroid_agent',
          'hmac_security',
          'cbe_limits',
          'audit_trail',
          'telegram_webhooks',
          'csv_export',
        ],
      },
    ];

    for (const p of plans) {
      db.prepare(`
        INSERT INTO subscription_plans (id, name_en, name_ar, billing_cycle, price_egp, device_limit, features_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, p.nameEn, p.nameAr, p.billingCycle, p.priceEgp, p.deviceLimit, JSON.stringify(p.features));
    }
  }

  // Ensure 14-Day Free Trial Plan exists
  const trial14PlanExists = db.prepare('SELECT id FROM subscription_plans WHERE id = ?').get('plan_trial_14d');
  if (!trial14PlanExists) {
    db.prepare(`
      INSERT INTO subscription_plans (id, name_en, name_ar, billing_cycle, price_egp, device_limit, features_json, is_active)
      VALUES ('plan_trial_14d', '14-Day Free Trial — 1 Phone', 'تجربة مجانية 14 يوم — هاتف واحد', 'monthly', 0.0, 1, ?, 0)
    `).run(JSON.stringify(['realtime_reconciliation', 'macrodroid_agent', 'hmac_security', 'cbe_limits', 'audit_trail', 'csv_export']));
  }

  // Ensure 7-Day Free Trial Plan exists for legacy records
  const trialPlanExists = db.prepare('SELECT id FROM subscription_plans WHERE id = ?').get('plan_trial_7d');
  if (!trialPlanExists) {
    db.prepare(`
      INSERT INTO subscription_plans (id, name_en, name_ar, billing_cycle, price_egp, device_limit, features_json, is_active)
      VALUES ('plan_trial_7d', '7-Day Free Trial — 1 Phone', 'تجربة مجانية 7 أيام — هاتف واحد', 'monthly', 0.0, 1, ?, 0)
    `).run(JSON.stringify(['realtime_reconciliation', 'macrodroid_agent', 'hmac_security', 'cbe_limits', 'audit_trail', 'csv_export']));
  }

  // 2. Ensure Platform Settings exist
  const settingsRow = db.prepare('SELECT id FROM platform_settings WHERE id = ?').get('current');
  if (!settingsRow) {
    db.prepare(`
      INSERT INTO platform_settings (id, instapay_number, beneficiary_name, platform_org_id, platform_source_id, platform_device_id)
      VALUES ('current', '01551234263', 'عبدالرحمن عبده', 'org_platform_ops', 'src_platform_instapay', 'dev_platform_terminal')
    `).run();
  }

  // 3. Ensure Platform Owner Operational Tenant & Real Inbound Payment Rail exist
  const platformOrg = db.prepare('SELECT id FROM organizations WHERE id = ?').get('org_platform_ops');
  if (!platformOrg) {
    db.prepare(`
      INSERT INTO organizations (id, name, name_ar, slug, default_timezone)
      VALUES ('org_platform_ops', 'Sarraf Platform Operations', 'إدارة اشتراكات صرّاف مصر', 'platform-operations', 'Africa/Cairo')
    `).run();

    db.prepare(`
      INSERT INTO balance_accounts (id, organization_id, account_name, currency, current_balance)
      VALUES ('acc_platform_ops', 'org_platform_ops', 'Platform Subscription Revenue (EGP)', 'EGP', 0.0)
    `).run();

    db.prepare(`
      INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit)
      VALUES ('src_platform_instapay', 'org_platform_ops', 'acc_platform_ops', 'instapay', 'InstaPay Platform Subscriptions (01551234263)', '01551234263', 5000000.0, 20000000.0)
    `).run();

    db.prepare(`
      INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value, is_default_for_invoices)
      VALUES ('addr_platform_instapay', 'src_platform_instapay', 'msisdn', '01551234263', 1)
    `).run();

    db.prepare(`
      INSERT INTO devices (id, organization_id, device_number, friendly_name, location, adapter_type, status, battery_level, agent_version, verified_at, notification_listener_granted, battery_optimization_exempt)
      VALUES ('dev_platform_terminal', 'org_platform_ops', 'DEV-PLATFORM-01', 'Platform Owner Capture Phone', 'Platform HQ', 'native_agent', 'online', 100, 'v3.4.1-eg', datetime('now'), 1, 1)
    `).run();

    db.prepare(`
      INSERT INTO device_credentials (device_id, hmac_secret)
      VALUES ('dev_platform_terminal', 'sec_platform_owner_secret_token_sarraf')
      ON CONFLICT(device_id) DO NOTHING
    `).run();
  }
}

function seedInitialData(db: DatabaseSync): void {
  const row = db.prepare('SELECT COUNT(*) as count FROM organizations').get() as { count: number };
  if (row && row.count > 0) return;

  const orgId = 'org_cairo_logistics';
  const userId = 'usr_admin_01';
  const balanceAccId = 'acc_cairo_egp';

  db.prepare(`
    INSERT INTO organizations (id, name, name_ar, slug, default_timezone)
    VALUES (?, ?, ?, ?, ?)
  `).run(orgId, 'Cairo Logistics Ltd', 'كايرو لوجستكس', 'cairo-logistics', 'Africa/Cairo');

  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(userId, 'admin@cairologistics.com', 'ccb490b292ddb10df45a1e5500d54f79b62a78c5e2f97ea39cc9dc2922bf76ca', 'Karim El-Sayed');
  
  // Ensure existing db updates to the recognized hash
  db.prepare(`
    UPDATE users SET password_hash = 'ccb490b292ddb10df45a1e5500d54f79b62a78c5e2f97ea39cc9dc2922bf76ca'
    WHERE email = 'admin@cairologistics.com' AND password_hash = 'argon2id_mock_hash_99a8b'
  `).run();

  db.prepare(`
    INSERT INTO organization_members (id, organization_id, user_id, role)
    VALUES (?, ?, ?, ?)
  `).run('mem_01', orgId, userId, 'owner');

  db.prepare(`
    INSERT INTO balance_accounts (id, organization_id, account_name, currency, current_balance, version)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(balanceAccId, orgId, 'Cairo Operational Checking (EGP)', 'EGP', 48350.0, 1);

  // Seed 4 Payment Sources
  const sources = [
    { id: 'src_vf', provider: 'vodafone_cash', name: 'Vodafone Cash Main Merchant Line', num: '01019283921', daily: 60000.0, monthly: 200000.0 },
    { id: 'src_ipn', provider: 'instapay', name: 'Cairo Logistics IPN Collector', num: 'cairo-logistics@instapay', daily: 120000.0, monthly: 400000.0 },
    { id: 'src_oc', provider: 'orange_cash', name: 'Orange Cash Kiosk Collector', num: '01299880194', daily: 50000.0, monthly: 150000.0 },
    { id: 'src_et', provider: 'etisalat_cash', name: 'e& Cash Warehouse Depot', num: '01198273612', daily: 50000.0, monthly: 150000.0 },
  ];

  for (const s of sources) {
    db.prepare(`
      INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(s.id, orgId, balanceAccId, s.provider, s.name, s.num, s.daily, s.monthly);

    db.prepare(`
      INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value, is_default_for_invoices)
      VALUES (?, ?, ?, ?, ?)
    `).run(`addr_${s.id}`, s.id, s.provider === 'instapay' ? 'instapay_vpa' : 'msisdn', s.num, 1);
  }

  // Seed 5 Devices with credentials
  const devices = [
    { id: 'dev_1', num: 'Device #01', name: 'Maadi Terminal Gate', loc: 'Maadi Terminal', adapter: 'macrodroid', status: 'online', battery: 94, ver: 'v3.4.1-eg' },
    { id: 'dev_2', num: 'Device #02', name: 'New Cairo Rail Gateway', loc: 'New Cairo Rail', adapter: 'native_agent', status: 'online', battery: 88, ver: 'v3.4.1-eg' },
    { id: 'dev_3', num: 'Device #03', name: 'Al-Haram Hub POS', loc: 'Al-Haram Hub POS gateway', adapter: 'macrodroid', status: 'offline', battery: 12, ver: 'v3.2.0-eg' },
    { id: 'dev_4', num: 'Device #04', name: 'Downtown Kiosk Terminal', loc: 'Downtown Kiosk', adapter: 'macrodroid', status: 'online', battery: 76, ver: 'v3.4.1-eg' },
    { id: 'dev_5', num: 'Device #05', name: 'Alexandria Warehouse Depot', loc: 'Alexandria Warehouse', adapter: 'huawei_emui', status: 'online', battery: 65, ver: 'v3.4.1-eg' },
  ];

  for (const d of devices) {
    db.prepare(`
      INSERT INTO devices (id, organization_id, device_number, friendly_name, location, adapter_type, status, battery_level, agent_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(d.id, orgId, d.num, d.name, d.loc, d.adapter, d.status, d.battery, d.ver);

    db.prepare(`
      INSERT INTO device_credentials (device_id, hmac_secret)
      VALUES (?, ?)
    `).run(d.id, `sec_secret_${d.id}_981247`);
  }
}
