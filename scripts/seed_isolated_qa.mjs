import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production') {
  console.error('[FATAL] Seeding is strictly forbidden in production.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.resolve(dbDir, 'isolated_qa_test.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

console.log(`Seeding isolated test database at ${dbPath}...`);

// Import schema creation
const { initSchema, bootstrapPlatformAndPlans } = await import('../server/db.ts');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
initSchema(db);
bootstrapPlatformAndPlans(db);

const { hashPassword } = await import('../server/security/passwords.ts');
const passwordHash = hashPassword('qa_pass_123456');

// 1. Seed Organizations
const orgA = 'org_qa_test_a';
const orgB = 'org_qa_test_b';

db.prepare(`
  INSERT INTO organizations (id, name, name_ar, slug, default_timezone, webhook_url, webhook_secret)
  VALUES 
    (?, 'Hoda Test Store', 'متجر الهدى التجريبي', 'hoda-store', 'Africa/Cairo', 'https://webhook.site/hoda-test', 'sec_hoda_123'),
    (?, 'Nour Test Store', 'متجر النور التجريبي', 'nour-store', 'Africa/Cairo', 'https://webhook.site/nour-test', 'sec_nour_123')
`).run(orgA, orgB);

// 2. Seed Balance Accounts
const accA = 'acc_hoda_main';
const accB = 'acc_nour_main';
db.prepare(`
  INSERT INTO balance_accounts (id, organization_id, account_name, current_balance_minor)
  VALUES 
    (?, ?, 'Hoda Main EGP Account', 500000),
    (?, ?, 'Nour Main EGP Account', 200000)
`).run(accA, orgA, accB, orgB);

// 3. Seed Users with 4 Roles in Org A
const userOwnerA = 'usr_qa_owner_a';
const userAdminA = 'usr_qa_admin_a';
const userManagerA = 'usr_qa_manager_a';
const userViewerA = 'usr_qa_viewer_a';
const userOwnerB = 'usr_qa_owner_b';

db.prepare(`
  INSERT INTO users (id, email, password_hash, full_name, email_verified, is_active)
  VALUES 
    (?, 'qa_owner@sarraf.local', ?, 'أحمد مالك الهدى', 1, 1),
    (?, 'qa_admin@sarraf.local', ?, 'سارة مشرفة الهدى', 1, 1),
    (?, 'qa_manager@sarraf.local', ?, 'كريم مدير العمليات', 1, 1),
    (?, 'qa_viewer@sarraf.local', ?, 'منى مراقب الحسابات', 1, 1),
    (?, 'qa_other_owner@sarraf.local', ?, 'عمر مالك النور', 1, 1)
`).run(
  userOwnerA, passwordHash,
  userAdminA, passwordHash,
  userManagerA, passwordHash,
  userViewerA, passwordHash,
  userOwnerB, passwordHash
);

// 4. Organization Memberships (RBAC matrix)
db.prepare(`
  INSERT INTO organization_members (id, organization_id, user_id, role)
  VALUES 
    ('mem_owner_a', ?, ?, 'owner'),
    ('mem_admin_a', ?, ?, 'admin'),
    ('mem_manager_a', ?, ?, 'manager'),
    ('mem_viewer_a', ?, ?, 'viewer'),
    ('mem_owner_b', ?, ?, 'owner')
`).run(orgA, userOwnerA, orgA, userAdminA, orgA, userManagerA, orgA, userViewerA, orgB, userOwnerB);

// 5. Seed Payment Sources (VF1, VF2, OR1, ET1, IP1)
const srcVF1 = 'src_qa_vf1';
const srcVF2 = 'src_qa_vf2';
const srcOR1 = 'src_qa_or1';
const srcET1 = 'src_qa_et1';
const srcIP1 = 'src_qa_ip1';

db.prepare(`
  INSERT INTO payment_sources (
    id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
    daily_turnover_limit_minor, monthly_turnover_limit_minor, is_paused_for_new_instructions
  ) VALUES 
    (?, ?, ?, 'vodafone_cash', 'QA-VF1', '01000000001', 100000, 1000000, 0),
    (?, ?, ?, 'vodafone_cash', 'QA-VF2', '01000000002', 100000, 1000000, 0),
    (?, ?, ?, 'orange_cash', 'QA-OR1', '01200000001', 100000, 1000000, 0),
    (?, ?, ?, 'etisalat_cash', 'QA-ET1', '01100000001', 100000, 1000000, 0),
    (?, ?, ?, 'instapay', 'QA-IP1', 'qa.hoda@bank', 100000, 1000000, 0)
`).run(
  srcVF1, orgA, accA,
  srcVF2, orgA, accA,
  srcOR1, orgA, accA,
  srcET1, orgA, accA,
  srcIP1, orgA, accA
);

// 6. Seed Baseline Financial Transactions T01–T08 (matching 03-DATA.md)
// T01: 100.10 EGP (10010 minor), VF1, confirmed
// T02: 75.25 EGP (7525 minor), OR1, review_required
// T03: 10.00 EGP (1000 minor), ET1, review_required
// T04: 100.10 EGP (10010 minor), VF2, confirmed (yesterday)
// T05: 20.00 EGP (2000 minor), VF1, review_required
// T06: 30.00 EGP (3000 minor), VF1, review_required
// T07: 40.00 EGP (4000 minor), VF1, review_required
// T08: 50.00 EGP (5000 minor), IP1, review_required
const nowIso = new Date().toISOString();
const yesterdayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

const txs = [
  { id: 'tx_t01', source: srcVF1, extId: 'QA-T01', prov: 'vodafone_cash', amt: 10010, bal: 510010, name: 'أحمد عبد الله', phone: '01011112222', status: 'confirmed', ts: nowIso },
  { id: 'tx_t02', source: srcOR1, extId: 'QA-T02', prov: 'orange_cash', amt: 7525, bal: null, name: 'John Doe', phone: '01211112222', status: 'review_required', ts: nowIso },
  { id: 'tx_t03', source: srcET1, extId: 'QA-T03', prov: 'etisalat_cash', amt: 1000, bal: null, name: 'محمد كمال', phone: '01111112222', status: 'review_required', ts: nowIso },
  { id: 'tx_t04', source: srcVF2, extId: 'QA-T04', prov: 'vodafone_cash', amt: 10010, bal: 520020, name: 'محمود حسن', phone: '01033334444', status: 'confirmed', ts: yesterdayIso },
  { id: 'tx_t05', source: srcVF1, extId: 'QA-T05', prov: 'vodafone_cash', amt: 2000, bal: null, name: 'علي مصطفى', phone: '01055556666', status: 'review_required', ts: nowIso },
  { id: 'tx_t06', source: srcVF1, extId: 'QA-T06', prov: 'vodafone_cash', amt: 3000, bal: null, name: 'طارق يوسف', phone: '01077778888', status: 'review_required', ts: nowIso },
  { id: 'tx_t07', source: srcVF1, extId: 'QA-T07', prov: 'vodafone_cash', amt: 4000, bal: null, name: 'سامح إبراهيم', phone: '01099990000', status: 'review_required', ts: nowIso },
  { id: 'tx_t08', source: srcIP1, extId: 'QA-T08', prov: 'instapay', amt: 5000, bal: null, name: 'عصام كرم', phone: '01500001111', status: 'review_required', ts: yesterdayIso }
];

const insertTx = db.prepare(`
  INSERT INTO transactions (
    id, organization_id, balance_account_id, payment_source_id, external_trx_id,
    provider, amount_minor, stated_balance_after_minor, sender_name, sender_phone,
    status, reconciliation_state, provenance_confidence, financial_event_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'consistent', 1.0, ?)
`);

for (const t of txs) {
  insertTx.run(t.id, orgA, accA, t.source, t.extId, t.prov, t.amt, t.bal, t.name, t.phone, t.status, t.ts);
}

// 7. Seed Active Subscription for Org A
db.prepare(`
  INSERT INTO organization_subscriptions (
    id, organization_id, plan_id, status, starts_at, ends_at, device_limit, features_json
  ) VALUES (
    'sub_qa_active_a', ?, 'plan_monthly_3', 'active',
    datetime('now', '-5 days'), datetime('now', '+25 days'), 3,
    '["realtime_reconciliation","macrodroid_agent","hmac_security","cbe_limits","audit_trail"]'
  )
`).run(orgA);

// 8. Seed API Keys for Org A
const pkLive = 'pk_live_qa_test_1234567890abcdef';
const skLive = 'sk_live_qa_test_secret_998877665544';
const pkHash = crypto.createHash('sha256').update(pkLive).digest('hex');
const skHash = crypto.createHash('sha256').update(skLive).digest('hex');

db.prepare(`
  INSERT INTO merchant_api_keys (
    id, organization_id, name, key_type, key_prefix, key_hash, key_preview, mode, is_active
  ) VALUES 
    ('key_live_pub', ?, 'Default Live Public Key', 'public', 'pk_live_', ?, 'pk_live_...cdef', 'live', 1),
    ('key_live_sec', ?, 'Default Live Secret Key', 'secret', 'sk_live_', ?, 'sk_live_...5544', 'live', 1)
`).run(orgA, pkHash, orgA, skHash);

console.log('Seeding complete!');
console.log(`Database ready with Org A (${orgA}) and Org B (${orgB}), 4 roles, 5 payment sources, and T01–T08 transactions.`);
db.close();
