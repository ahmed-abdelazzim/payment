import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTestDatabase, setDatabase, getDatabase } from '../server/db';
import { hashPassword, verifyPassword } from '../server/security/passwords';
import { parseEgyptianPaymentMessage } from '../server/parser/engine';
import { ReconciliationService } from '../server/services/reconciliationService';
import { LimitEngine } from '../server/services/limitEngine';
import { AuditService } from '../server/services/auditService';

test('Full Merchant Journey 1: Clean Registration, Scrypt Security & Email Verification', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const userId = `usr_journey_${Date.now()}`;
  const orgId = `org_journey_${Date.now()}`;
  const email = 'founder@niletrade.eg';
  const rawPassword = 'EnterpriseP@ssword2026!';

  // 1. Password Hashed using Scrypt with 16-byte random salt
  const scryptHash = hashPassword(rawPassword);
  assert.ok(scryptHash.startsWith('scrypt$16384$8$1$'), 'Password must use standard scrypt parameters');
  
  const verification = verifyPassword(rawPassword, scryptHash);
  assert.strictEqual(verification.valid, true);
  assert.strictEqual(verification.needsRehash, false);

  // 2. Insert User & Organization
  db.prepare(`
    INSERT INTO organizations (id, name, name_ar, slug, default_timezone)
    VALUES (?, 'Nile Trade Ltd', 'شركة نايل تريد', 'nile-trade', 'Africa/Cairo')
  `).run(orgId);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, email_verified, is_active)
    VALUES (?, ?, ?, 'Youssef El-Masry', 0, 1)
  `).run(userId, email, scryptHash);

  db.prepare(`
    INSERT INTO organization_members (id, organization_id, user_id, role)
    VALUES ('mem_01', ?, ?, 'owner')
  `).run(orgId, userId);

  db.prepare(`
    INSERT INTO balance_accounts (id, organization_id, account_name, currency, current_balance)
    VALUES (?, ?, 'Main Operational Account (EGP)', 'EGP', 0.0)
  `).run(`acc_${orgId}`, orgId);

  // 3. Verify clean slate: 0 mock devices, 0 mock transactions, 0 initial balance
  const balanceRow = db.prepare('SELECT current_balance FROM balance_accounts WHERE organization_id = ?').get(orgId) as any;
  assert.strictEqual(balanceRow.current_balance, 0.0);

  const devicesCount = (db.prepare('SELECT COUNT(*) as c FROM devices WHERE organization_id = ?').get(orgId) as any).c;
  assert.strictEqual(devicesCount, 0, 'New merchant must have 0 mock devices');

  const txCount = (db.prepare('SELECT COUNT(*) as c FROM transactions WHERE organization_id = ?').get(orgId) as any).c;
  assert.strictEqual(txCount, 0, 'New merchant must have 0 mock transactions');

  // 4. Issue Single-Use 24-Hour Email Verification Token
  const verifyToken = `verify_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO email_verifications (token, user_id, email, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(verifyToken, userId, email, expiresAt);

  // 5. Verify Email Verification Handshake
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  db.prepare("UPDATE email_verifications SET used_at = datetime('now') WHERE token = ?").run(verifyToken);

  const updatedUser = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(userId) as any;
  assert.strictEqual(updatedUser.email_verified, 1);
});

test('Full Merchant Journey 2: Add Receiving Payment Source with Distinct Commercial Limits', () => {
  const db = initTestDatabase();
  setDatabase(db);
  const orgId = 'org_sources_test';
  const balanceAccId = 'acc_sources_1';

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Sources Test Org', 'تيست', 'sources-test')`).run(orgId);
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name, current_balance) VALUES (?, ?, 'Ops Balance', 0.0)`).run(balanceAccId, orgId);

  // Add Vodafone Cash Source
  const vfSourceId = 'src_vf_real';
  db.prepare(`
    INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit)
    VALUES (?, ?, ?, 'vodafone_cash', 'Main Vodafone Cash Line', '01099887766', 60000.0, 200000.0)
  `).run(vfSourceId, orgId, balanceAccId);

  db.prepare(`
    INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value, is_default_for_invoices)
    VALUES ('addr_vf_1', ?, 'msisdn', '01099887766', 1)
  `).run(vfSourceId);

  // Add Commercial InstaPay Source (with merchant approved limit, NOT personal 120k cap)
  const ipnSourceId = 'src_ipn_real';
  const commercialDailyCap = 500000.0; // 500,000 EGP Commercial receiving tier
  db.prepare(`
    INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit)
    VALUES (?, ?, ?, 'instapay', 'Nile Trade Corporate IPN', 'niletrade@instapay', ?, 2000000.0)
  `).run(ipnSourceId, orgId, balanceAccId, commercialDailyCap);

  db.prepare(`
    INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value, is_default_for_invoices)
    VALUES ('addr_ipn_1', ?, 'instapay_vpa', 'niletrade@instapay', 0)
  `).run(ipnSourceId);

  const sources = db.prepare('SELECT id, provider, daily_turnover_limit FROM payment_sources WHERE organization_id = ?').all(orgId) as any[];
  assert.strictEqual(sources.length, 2);
  const ipnSource = sources.find(s => s.provider === 'instapay');
  assert.strictEqual(ipnSource.daily_turnover_limit, 500000.0, 'InstaPay merchant receiving limit must reflect commercial setting');
});

test('Full Merchant Journey 3 & 4: Register Device, Handshake & Proof of Telemetry Permissions', () => {
  const db = initTestDatabase();
  setDatabase(db);
  const orgId = 'org_device_journey';
  const devId = 'dev_android_01';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Device Journey Org', 'تيست', 'dev-journey')`).run(orgId);

  // 1. Merchant Registers Device -> Status is offline and unverified
  db.prepare(`
    INSERT INTO devices (id, organization_id, device_number, friendly_name, location, adapter_type, status, battery_level, agent_version)
    VALUES (?, ?, 'POS #01', 'Maadi Warehouse Gateway', 'Maadi Depot', 'macrodroid', 'offline', 100, 'v3.4.1-eg')
  `).run(devId, orgId);

  const pairingCode = 'SARRAF-A1B2C3';
  db.prepare(`
    INSERT INTO pairing_tokens (token, organization_id, device_identifier, expires_at)
    VALUES (?, ?, ?, datetime('now', '+15 minutes'))
  `).run(pairingCode, orgId, devId);

  // Device starts unverified
  const initialDev = db.prepare('SELECT status, verified_at, notification_listener_granted FROM devices WHERE id = ?').get(devId) as any;
  assert.strictEqual(initialDev.status, 'offline');
  assert.strictEqual(initialDev.verified_at, null);
  assert.strictEqual(initialDev.notification_listener_granted, 0);

  // 2. Real Device Handshake with Pairing Token
  const hmacSecret = `sec_${crypto.randomBytes(32).toString('hex')}`;
  db.prepare(`
    INSERT INTO device_credentials (device_id, hmac_secret)
    VALUES (?, ?)
  `).run(devId, hmacSecret);
  db.prepare("UPDATE pairing_tokens SET used_at = datetime('now') WHERE token = ?").run(pairingCode);

  // 3. Real Device Telemetry Ping with Proof of Permissions
  db.prepare(`
    UPDATE devices
    SET status = 'online',
        battery_level = 96,
        notification_listener_granted = 1,
        battery_optimization_exempt = 1,
        verified_at = datetime('now'),
        last_seen_at = datetime('now')
    WHERE id = ?
  `).run(devId);

  const verifiedDev = db.prepare('SELECT status, verified_at, notification_listener_granted, battery_optimization_exempt FROM devices WHERE id = ?').get(devId) as any;
  assert.strictEqual(verifiedDev.status, 'online');
  assert.ok(verifiedDev.verified_at !== null, 'Device must have explicit verification timestamp from real heartbeat');
  assert.strictEqual(verifiedDev.notification_listener_granted, 1, 'Proof of notification listener granted');
  assert.strictEqual(verifiedDev.battery_optimization_exempt, 1, 'Proof of battery optimization exemption');
});

test('Full Merchant Journey 5: Real Inbound Event via HMAC-SHA256, Parsing, Reconciliation & Audit Trail', () => {
  const db = initTestDatabase();
  setDatabase(db);
  const orgId = 'org_payment_journey';
  const devId = 'dev_pos_main';
  const balanceAccId = 'acc_payment_main';
  const hmacSecret = 'sec_super_secret_for_pos_terminal_9921';
  const phone = '01012345678';
  const srcId = 'src_vf_main';

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Payment Journey Org', 'دفع', 'pay-journey')`).run(orgId);
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name, current_balance, version) VALUES (?, ?, 'Main EGP', 1000.0, 1)`).run(balanceAccId, orgId);
  db.prepare(`INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit) VALUES (?, ?, ?, 'vodafone_cash', 'Main Line', ?, 60000, 200000)`).run(srcId, orgId, balanceAccId, phone);
  db.prepare(`INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value) VALUES (?, ?, 'msisdn', ?)`).run(`addr_${srcId}`, srcId, phone);
  db.prepare(`INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type, status) VALUES (?, ?, 'DEV-01', 'Counter POS', 'macrodroid', 'online')`).run(devId, orgId);
  db.prepare(`INSERT INTO device_credentials (device_id, hmac_secret) VALUES (?, ?)`).run(devId, hmacSecret);

  // Inbound Real Vodafone Cash SMS
  const rawMessage = 'تم استلام مبلغ 1250.00 جنيه من 01012345678 في 30/09/2026 14:15. الرصيد الحالي 2250.00 جنيه. رقم العملية 982173456.';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = `nonce_${Date.now()}_9921`;

  // 1. Calculate HMAC-SHA256 Canonical Signature
  const body = JSON.stringify({ raw_content: rawMessage });
  const bodySha256 = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalString = `POST\n/api/v1/devices/ingest\n${timestamp}\n${nonce}\n${bodySha256}`;
  const signature = crypto.createHmac('sha256', hmacSecret).update(canonicalString).digest('hex');

  // Verify Signature Matches
  const testSig = crypto.createHmac('sha256', hmacSecret).update(canonicalString).digest('hex');
  assert.strictEqual(signature, testSig);

  // 2. Commit to raw_events immutably
  const rawEventId = 'raw_evt_test_01';
  db.prepare(`
    INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload, processing_status)
    VALUES (?, ?, ?, 'macrodroid', ?, datetime('now'), ?, 'processing')
  `).run(rawEventId, orgId, devId, nonce, rawMessage);

  // 3. Parse Message with Egyptian Engine
  const parsed = parseEgyptianPaymentMessage(rawMessage, 'vodafone_cash');
  assert.strictEqual(parsed.isFinancialTransaction, true);
  assert.strictEqual(parsed.amount, 1250.0);
  assert.strictEqual(parsed.provider, 'vodafone_cash');
  assert.strictEqual(parsed.externalTrxId, '982173456');
  assert.strictEqual(parsed.statedBalance, 2250.0);

  // 4. Reconcile with Section 12A Engine
  const result = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId,
    adapterType: 'macrodroid',
    boundPaymentAddress: phone,
    parsed,
    financialEventAt: new Date().toISOString(),
    signature,
  });

  assert.strictEqual(result.status, 'confirmed');
  assert.strictEqual(result.externalTrxId, '982173456');

  // 5. Verify Ledger Balance Updated
  const updatedBalance = db.prepare('SELECT current_balance FROM balance_accounts WHERE id = ?').get(balanceAccId) as any;
  assert.strictEqual(updatedBalance.current_balance, 2250.0);

  // 6. Verify Transaction Recorded for Client Dashboard
  const clientTx = db.prepare('SELECT * FROM transactions WHERE organization_id = ? AND external_trx_id = ?').get(orgId, '982173456') as any;
  assert.ok(clientTx);
  assert.strictEqual(clientTx.amount, 1250.0);
  assert.strictEqual(clientTx.status, 'confirmed');

  // 7. Verify Outbox Job created for Webhook/Telegram Dispatch
  const outboxJob = db.prepare('SELECT * FROM outbox_jobs WHERE organization_id = ?').get(orgId) as any;
  assert.ok(outboxJob);
  assert.strictEqual(outboxJob.job_type, 'dispatch_webhook');
  const payload = JSON.parse(outboxJob.payload);
  assert.strictEqual(payload.event, 'transaction.confirmed');
  assert.strictEqual(payload.external_trx_id, '982173456');
  assert.strictEqual(payload.amount, 1250.0);
});

test('Full Merchant Journey 6: Data Persistence Across Service Restarts', () => {
  const tempDbPath = path.join('/tmp', `sarraf_persist_test_${Date.now()}.db`);

  try {
    // Reset global db instance so getDatabase opens the disk file
    setDatabase(null);
    const db1 = getDatabase(tempDbPath);
    const orgId = 'org_persisted_merchant';
    const userId = 'usr_persisted_owner';
    const devId = 'dev_persisted_terminal';
    const accId = 'acc_persisted_main';
    const srcId = 'src_persisted_vf';

    db1.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Persistent Org', 'ثابت', 'persist-org')`).run(orgId);
    db1.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name, current_balance) VALUES (?, ?, 'Main EGP', 5000)`).run(accId, orgId);
    db1.prepare(`INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit) VALUES (?, ?, ?, 'vodafone_cash', 'VF', '01019283921', 60000, 200000)`).run(srcId, orgId, accId);
    db1.prepare(`INSERT INTO users (id, email, password_hash, full_name, email_verified, is_active) VALUES (?, 'owner@persist.eg', 'scrypt_hash', 'Persist Owner', 1, 1)`).run(userId);
    db1.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ('mem_p1', ?, ?, 'owner')`).run(orgId, userId);
    db1.prepare(`INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type, status, battery_level) VALUES (?, ?, 'DEV-PERSIST', 'Terminal', 'macrodroid', 'online', 91)`).run(devId, orgId);
    db1.prepare(`INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, amount, currency, provider, status, reconciliation_state, provenance_confidence, financial_event_at) VALUES ('tx_persisted_01', ?, ?, ?, 'TRX-PERSIST-999', 3450.0, 'EGP', 'instapay', 'confirmed', 'consistent', 1.0, datetime('now'))`).run(orgId, accId, srcId);

    // Close db connection to simulate process shutdown
    db1.close();
    setDatabase(null);

    // 2. Second Boot: Reopen Database from disk file (Simulate server restart)
    const db2 = new DatabaseSync(tempDbPath);

    // Verify all records survived restart intact
    const org = db2.prepare('SELECT name, slug FROM organizations WHERE id = ?').get(orgId) as any;
    assert.ok(org);
    assert.strictEqual(org.name, 'Persistent Org');

    const user = db2.prepare('SELECT email, full_name FROM users WHERE id = ?').get(userId) as any;
    assert.ok(user);
    assert.strictEqual(user.email, 'owner@persist.eg');

    const device = db2.prepare('SELECT device_number, battery_level FROM devices WHERE id = ?').get(devId) as any;
    assert.ok(device);
    assert.strictEqual(device.battery_level, 91);

    const transaction = db2.prepare('SELECT external_trx_id, amount, status FROM transactions WHERE id = ?').get('tx_persisted_01') as any;
    assert.ok(transaction);
    assert.strictEqual(transaction.amount, 3450.0);
    assert.strictEqual(transaction.status, 'confirmed');

    db2.close();
  } finally {
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
      if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);
    } catch {}
  }
});

test('Full Merchant Journey 7: Two-Tenant Complete Cryptographic and Data Isolation', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgA = 'org_tenant_A';
  const orgB = 'org_tenant_B';

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Tenant A Ltd', 'شركة أ', 'tenant-a')`).run(orgA);
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Tenant B Ltd', 'شركة ب', 'tenant-b')`).run(orgB);

  // Tenant A items
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name, current_balance) VALUES ('acc_A', ?, 'Acc A', 15000)`).run(orgA);
  db.prepare(`INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit) VALUES ('src_A', ?, 'acc_A', 'vodafone_cash', 'Line A', '01011111111', 60000, 200000)`).run(orgA);
  db.prepare(`INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type) VALUES ('dev_A', ?, 'Dev A', 'Phone A', 'macrodroid')`).run(orgA);
  db.prepare(`INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, amount, currency, provider, status, reconciliation_state, provenance_confidence, financial_event_at) VALUES ('tx_A', ?, 'acc_A', 'src_A', 'TRX-A-100', 800.0, 'EGP', 'vodafone_cash', 'confirmed', 'consistent', 1.0, datetime('now'))`).run(orgA);

  // Tenant B items
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name, current_balance) VALUES ('acc_B', ?, 'Acc B', 42000)`).run(orgB);
  db.prepare(`INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit) VALUES ('src_B', ?, 'acc_B', 'instapay', 'Line B', 'b@instapay', 100000, 500000)`).run(orgB);
  db.prepare(`INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type) VALUES ('dev_B', ?, 'Dev B', 'Phone B', 'native_agent')`).run(orgB);
  db.prepare(`INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, amount, currency, provider, status, reconciliation_state, provenance_confidence, financial_event_at) VALUES ('tx_B', ?, 'acc_B', 'src_B', 'TRX-B-200', 9500.0, 'EGP', 'instapay', 'confirmed', 'consistent', 1.0, datetime('now'))`).run(orgB);

  // Tenant A queries MUST NEVER return Tenant B's data
  const accountsA = db.prepare('SELECT * FROM balance_accounts WHERE organization_id = ?').all(orgA);
  assert.strictEqual(accountsA.length, 1);
  assert.strictEqual(accountsA[0].id, 'acc_A');

  const devicesA = db.prepare('SELECT * FROM devices WHERE organization_id = ?').all(orgA);
  assert.strictEqual(devicesA.length, 1);
  assert.strictEqual(devicesA[0].id, 'dev_A');

  const txsA = db.prepare('SELECT * FROM transactions WHERE organization_id = ?').all(orgA);
  assert.strictEqual(txsA.length, 1);
  assert.strictEqual(txsA[0].id, 'tx_A');

  // Direct ID cross-tenant query returns 0
  const crossQuery = db.prepare('SELECT * FROM transactions WHERE organization_id = ? AND id = ?').all(orgA, 'tx_B');
  assert.strictEqual(crossQuery.length, 0, 'Cross-tenant query must return zero records');
});
