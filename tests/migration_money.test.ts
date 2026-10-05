import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initSchema, setDatabase } from '../server/db';

/**
 * Legacy (pre-v1) money tables exactly as shipped before the piastre
 * migration: every amount is a REAL EGP value.
 */
const LEGACY_MONEY_DDL = `
  CREATE TABLE organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    default_timezone TEXT DEFAULT 'Africa/Cairo',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE balance_accounts (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, account_name TEXT NOT NULL, currency TEXT DEFAULT 'EGP',
    current_balance REAL NOT NULL DEFAULT 0.0, last_checkpoint_at TEXT, version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
  );
  CREATE TABLE payment_sources (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, balance_account_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('vodafone_cash', 'instapay', 'orange_cash', 'etisalat_cash')),
    friendly_name TEXT NOT NULL, wallet_number TEXT NOT NULL,
    daily_turnover_limit REAL NOT NULL, monthly_turnover_limit REAL NOT NULL,
    is_paused_for_new_instructions INTEGER DEFAULT 0, retired_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (balance_account_id) REFERENCES balance_accounts(id) ON DELETE CASCADE
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, balance_account_id TEXT NOT NULL, payment_source_id TEXT NOT NULL,
    raw_event_id TEXT, external_trx_id TEXT NOT NULL, provider TEXT NOT NULL, amount REAL NOT NULL, currency TEXT DEFAULT 'EGP',
    stated_balance_after REAL, sender_name TEXT, sender_phone TEXT,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'review_required', 'pending_ordering', 'failed')),
    reconciliation_state TEXT NOT NULL CHECK (reconciliation_state IN ('consistent', 'gap_detected', 'pending_ordering')),
    provenance_confidence REAL NOT NULL, review_reason TEXT, signature TEXT, financial_event_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (organization_id, provider, external_trx_id)
  );
  CREATE TABLE balance_checkpoints (
    id TEXT PRIMARY KEY, balance_account_id TEXT NOT NULL,
    checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('OFFICIAL_STATEMENT', 'OPERATOR_PROVISIONAL', 'INFERRED_FIRST_SNAPSHOT')),
    balance_amount REAL NOT NULL, as_of_timestamp TEXT NOT NULL, actor_id TEXT, audit_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE financial_limit_usage (
    id TEXT PRIMARY KEY, payment_source_id TEXT NOT NULL,
    period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'monthly')), period_key TEXT NOT NULL,
    accumulated_intake REAL NOT NULL DEFAULT 0.0, regulatory_cap REAL NOT NULL,
    is_alert_80_dispatched INTEGER DEFAULT 0, is_alert_90_dispatched INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (payment_source_id, period_type, period_key)
  );
  CREATE TABLE subscription_plans (
    id TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_ar TEXT NOT NULL,
    billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')), price_egp REAL NOT NULL,
    device_limit INTEGER NOT NULL, features_json TEXT NOT NULL, is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE subscription_orders (
    id TEXT PRIMARY KEY, order_number TEXT UNIQUE NOT NULL, organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL, plan_name_en TEXT NOT NULL, plan_name_ar TEXT NOT NULL, billing_cycle TEXT NOT NULL,
    price_egp REAL NOT NULL, currency TEXT DEFAULT 'EGP', device_limit INTEGER NOT NULL, features_json TEXT NOT NULL,
    instapay_target_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending_payment', 'payment_reported', 'in_review', 'confirmed', 'rejected', 'expired')),
    reported_transfer_ref TEXT, reported_sender_info TEXT, reported_transfer_time TEXT, reported_notes TEXT, reported_at TEXT,
    matched_transaction_id TEXT, approved_by_user_id TEXT, approval_type TEXT CHECK (approval_type IN ('automatic', 'manual')),
    rejection_reason TEXT, review_notes TEXT, expires_at TEXT NOT NULL, confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE subscription_receipts (
    id TEXT PRIMARY KEY, receipt_number TEXT UNIQUE NOT NULL, order_id TEXT UNIQUE NOT NULL, organization_id TEXT NOT NULL,
    plan_id TEXT NOT NULL, amount_paid REAL NOT NULL, currency TEXT DEFAULT 'EGP', payment_method TEXT DEFAULT 'instapay_manual',
    matched_external_trx_id TEXT, billing_cycle TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
    issued_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function makeLegacyDatabase(file: string, txAmount: number): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(LEGACY_MONEY_DDL);
  db.exec(`
    INSERT INTO organizations (id, name, name_ar, slug) VALUES ('org_legacy', 'Legacy', 'قديم', 'legacy');
    INSERT INTO balance_accounts (id, organization_id, account_name, current_balance) VALUES ('acc_legacy', 'org_legacy', 'Main', 1234.56);
    INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit)
      VALUES ('src_legacy', 'org_legacy', 'acc_legacy', 'vodafone_cash', 'VF', '01000000001', 60000, 200000.5);
    INSERT INTO balance_checkpoints (id, balance_account_id, checkpoint_type, balance_amount, as_of_timestamp)
      VALUES ('cp_legacy', 'acc_legacy', 'OPERATOR_PROVISIONAL', 1000.1, datetime('now'));
    INSERT INTO financial_limit_usage (id, payment_source_id, period_type, period_key, accumulated_intake, regulatory_cap)
      VALUES ('lim_legacy', 'src_legacy', 'daily', '2026-10-01', 0.3, 60000);
    INSERT INTO subscription_plans (id, name_en, name_ar, billing_cycle, price_egp, device_limit, features_json)
      VALUES ('plan_monthly_3', 'M3', 'م3', 'monthly', 499, 3, '[]'),
             ('plan_monthly_5', 'M5', 'م5', 'monthly', 799, 5, '[]'),
             ('plan_annual_10', 'A10', 'س10', 'annual', 7990, 10, '[]');
    INSERT INTO subscription_receipts (id, receipt_number, order_id, organization_id, plan_id, amount_paid, billing_cycle, period_start, period_end)
      VALUES ('rc_legacy', 'RC-1', 'ord_legacy', 'org_legacy', 'plan_monthly_3', 499, 'monthly', '2026-10-01', '2026-11-01');
  `);
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, stated_balance_after,
      status, reconciliation_state, provenance_confidence, financial_event_at)
    VALUES ('tx_legacy_1', 'org_legacy', 'acc_legacy', 'src_legacy', 'VF-L1', 'vodafone_cash', ?, NULL, 'confirmed', 'consistent', 1, datetime('now'))
  `).run(txAmount);
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, stated_balance_after,
      status, reconciliation_state, provenance_confidence, financial_event_at)
    VALUES ('tx_legacy_2', 'org_legacy', 'acc_legacy', 'src_legacy', 'VF-L2', 'vodafone_cash', 0.2, 1234.56, 'confirmed', 'consistent', 1, datetime('now'))
  `).run();
  return db;
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
}

test('Migration v1: legacy REAL EGP columns become exact INTEGER piastres with a backup', () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'data', 'sarraf-migrate-'));
  const file = path.join(dir, 'legacy.db');
  try {
    const db = makeLegacyDatabase(file, 0.1);
    initSchema(db);
    setDatabase(null);

    assert.ok(!columns(db, 'transactions').includes('amount'), 'legacy amount column must be dropped');
    assert.ok(columns(db, 'transactions').includes('amount_minor'));
    assert.ok(columns(db, 'balance_accounts').includes('current_balance_minor'));

    const acc = db.prepare('SELECT current_balance_minor FROM balance_accounts WHERE id = ?').get('acc_legacy') as any;
    assert.strictEqual(acc.current_balance_minor, 123456);
    const src = db.prepare('SELECT daily_turnover_limit_minor, monthly_turnover_limit_minor FROM payment_sources WHERE id = ?').get('src_legacy') as any;
    assert.strictEqual(src.daily_turnover_limit_minor, 6000000);
    assert.strictEqual(src.monthly_turnover_limit_minor, 20000050);
    const tx1 = db.prepare('SELECT amount_minor, stated_balance_after_minor FROM transactions WHERE id = ?').get('tx_legacy_1') as any;
    assert.strictEqual(tx1.amount_minor, 10);
    assert.strictEqual(tx1.stated_balance_after_minor, null, 'NULL stated balance stays NULL');
    const tx2 = db.prepare('SELECT amount_minor, stated_balance_after_minor FROM transactions WHERE id = ?').get('tx_legacy_2') as any;
    assert.strictEqual(tx2.amount_minor, 20);
    assert.strictEqual(tx2.stated_balance_after_minor, 123456);
    const cp = db.prepare('SELECT balance_amount_minor FROM balance_checkpoints WHERE id = ?').get('cp_legacy') as any;
    assert.strictEqual(cp.balance_amount_minor, 100010);
    const lim = db.prepare('SELECT accumulated_intake_minor, regulatory_cap_minor FROM financial_limit_usage WHERE id = ?').get('lim_legacy') as any;
    assert.strictEqual(lim.accumulated_intake_minor, 30);
    assert.strictEqual(lim.regulatory_cap_minor, 6000000);
    const plan = db.prepare("SELECT price_minor FROM subscription_plans WHERE id = 'plan_annual_10'").get() as any;
    assert.strictEqual(plan.price_minor, 799000);
    const rc = db.prepare("SELECT amount_paid_minor FROM subscription_receipts WHERE id = 'rc_legacy'").get() as any;
    assert.strictEqual(rc.amount_paid_minor, 49900);

    const mig = db.prepare('SELECT details FROM schema_migrations WHERE version = 1').get() as any;
    const details = JSON.parse(mig.details);
    assert.ok(details.backup, 'migration must record its backup file');
    assert.ok(fs.existsSync(path.join(dir, details.backup)), 'backup file must exist on disk');

    // Backup is the untouched legacy database (rollback path).
    const backup = new DatabaseSync(path.join(dir, details.backup));
    const legacyAcc = backup.prepare('SELECT current_balance FROM balance_accounts WHERE id = ?').get('acc_legacy') as any;
    assert.strictEqual(legacyAcc.current_balance, 1234.56);
    backup.close();

    // Re-running is a no-op.
    initSchema(db);
    setDatabase(null);
    const again = db.prepare('SELECT current_balance_minor FROM balance_accounts WHERE id = ?').get('acc_legacy') as any;
    assert.strictEqual(again.current_balance_minor, 123456);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Migration v1: refuses sub-piastre legacy values and changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'data', 'sarraf-migrate-'));
  const file = path.join(dir, 'legacy.db');
  try {
    const db = makeLegacyDatabase(file, 10.005);
    assert.throws(() => initSchema(db), /MIGRATION_V1_SUB_PIASTRE_VALUES: transactions\.amount/);
    setDatabase(null);
    assert.ok(columns(db, 'transactions').includes('amount'), 'legacy column must remain when migration is refused');
    const row = db.prepare('SELECT amount FROM transactions WHERE id = ?').get('tx_legacy_1') as any;
    assert.strictEqual(row.amount, 10.005);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
