import test from 'node:test';
import assert from 'node:assert';
import { initTestDatabase, setDatabase } from '../server/db';
import { ReconciliationService } from '../server/services/reconciliationService';
import { LimitEngine } from '../server/services/limitEngine';
import { parseEgyptianPaymentMessage } from '../server/parser/engine';

// Helper to setup isolated tenant for testing. Balances are given in EGP and
// stored as integer piastres.
function setupTestTenant(db: any, initialBalanceEgp = 1000.0) {
  setDatabase(db);
  const orgId = `org_${Math.random().toString(36).substring(2, 8)}`;
  const accId = `acc_${Math.random().toString(36).substring(2, 8)}`;
  const srcId = `src_${Math.random().toString(36).substring(2, 8)}`;
  const devId = `dev_${Math.random().toString(36).substring(2, 8)}`;
  const phone = '01019283921';
  const initialMinor = Math.round(initialBalanceEgp * 100);

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Test Org', 'مؤسسة تجريبية', ?)`).run(orgId, orgId);
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name, current_balance_minor) VALUES (?, ?, 'EGP Account', ?)`).run(accId, orgId, initialMinor);
  db.prepare(`
    INSERT INTO balance_checkpoints (id, balance_account_id, checkpoint_type, balance_amount_minor, as_of_timestamp, audit_notes)
    VALUES (?, ?, 'OPERATOR_PROVISIONAL', ?, datetime('now'), 'Test opening checkpoint')
  `).run(`checkpoint_${accId}`, accId, initialMinor);
  db.prepare(`INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit_minor, monthly_turnover_limit_minor) VALUES (?, ?, ?, 'vodafone_cash', 'Main Line', ?, 6000000, 20000000)`).run(srcId, orgId, accId, phone);
  db.prepare(`INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value) VALUES (?, ?, 'msisdn', ?)`).run(`addr_${srcId}`, srcId, phone);
  db.prepare(`INSERT INTO devices (id, organization_id, payment_source_id, device_number, friendly_name, adapter_type) VALUES (?, ?, ?, 'Dev #1', 'Gateway Phone', 'macrodroid')`).run(devId, orgId, srcId);

  return { orgId, accId, srcId, devId, phone };
}

function balanceMinor(db: any, where: { accId?: string; orgId?: string }): number {
  const row = where.accId
    ? db.prepare('SELECT current_balance_minor FROM balance_accounts WHERE id = ?').get(where.accId)
    : db.prepare('SELECT current_balance_minor FROM balance_accounts WHERE organization_id = ?').get(where.orgId);
  return Number((row as any).current_balance_minor);
}

test('Reconciliation: The 6-Permutation Convergence Test (Section 12A)', () => {
  // Scenario: Starting anchor = 1,000 EGP
  // Event A: +200 -> Balance 1,200
  // Event B: +300 -> Balance 1,500
  // Event C: +100 -> Balance 1,600

  const permutations = [
    ['A', 'B', 'C'],
    ['A', 'C', 'B'],
    ['B', 'A', 'C'],
    ['B', 'C', 'A'],
    ['C', 'A', 'B'],
    ['C', 'B', 'A'],
  ];

  for (const perm of permutations) {
    const db = initTestDatabase();
    const { orgId, accId, devId, phone } = setupTestTenant(db, 1000.0);

    const eventDefs: Record<string, any> = {
      A: { raw: 'تم استلام مبلغ 200 جنيه. رصيد فودافون كاش الحالي 1,200 جنيه. رقم العملية: VF-1001' },
      B: { raw: 'تم استلام مبلغ 300 جنيه. رصيد فودافون كاش الحالي 1,500 جنيه. رقم العملية: VF-1002' },
      C: { raw: 'تم استلام مبلغ 100 جنيه. رصيد فودافون كاش الحالي 1,600 جنيه. رقم العملية: VF-1003' },
    };

    // Feed events in permutation order
    for (const key of perm) {
      const parsed = parseEgyptianPaymentMessage(eventDefs[key].raw);

      ReconciliationService.processInboundTransaction({
        organizationId: orgId,
        deviceId: devId,
        rawEventId: `raw_${key}_${Math.random()}`,
        adapterType: 'macrodroid',
        boundPaymentAddress: phone,
        parsed,
        financialEventAt: new Date().toISOString(),
        signature: 'valid_hmac_sig',
        independentSettlementEvidence: true,
      });
    }

    // After all 3 events are processed, ledger MUST converge deterministically to exactly 1,600.00 EGP!
    assert.strictEqual(balanceMinor(db, { accId }), 160000, `Failed convergence on permutation [${perm.join(', ')}]`);

    // All 3 transactions must now be confirmed with zero pending items
    const transactions = db.prepare(`SELECT status FROM transactions WHERE organization_id = ?`).all(orgId) as any[];
    assert.strictEqual(transactions.length, 3);
    for (const t of transactions) {
      assert.strictEqual(t.status, 'confirmed', `Transaction not confirmed on permutation [${perm.join(', ')}]`);
    }

    // Each confirmation queued exactly one webhook and counted once against limits
    const jobs = db.prepare("SELECT COUNT(*) as c FROM outbox_jobs WHERE organization_id = ? AND job_type = 'dispatch_webhook'").get(orgId) as any;
    assert.strictEqual(jobs.c, 3);
    const usage = db.prepare("SELECT accumulated_intake_minor FROM financial_limit_usage WHERE period_type = 'daily'").get() as any;
    assert.strictEqual(usage.accumulated_intake_minor, 60000);
  }
});

test('Reconciliation: Spoofed Message Defense (Arithmetic Match != Confirmation)', () => {
  const db = initTestDatabase();
  const { orgId, devId, phone } = setupTestTenant(db, 30000.0);

  // Attacker crafts SMS with matching numbers (+5000 -> 35000) but unverified USSD string warning
  const forgedRaw = 'تم تحويل مبلغ 5,000 جنيه من محفظة 01200000000. رصيدك الحالي 35,000 جنيه. برجاء التأكد من رصيدك عبر #115#.';
  const parsed = parseEgyptianPaymentMessage(forgedRaw);

  const result = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId: 'raw_attack_01',
    adapterType: 'macrodroid',
    boundPaymentAddress: phone,
    parsed,
    financialEventAt: new Date().toISOString(),
    signature: 'valid_hmac_sig',
  });

  // Must NOT auto-confirm despite perfect mathematical balance arithmetic!
  assert.strictEqual(result.status, 'review_required');
  assert.strictEqual(result.reviewReason, 'SMS notification unverified against USSD string');

  // Canonical account balance must NOT be advanced by unverified message
  assert.strictEqual(balanceMinor(db, { orgId }), 3000000, 'Balance must remain unchanged until human operator review');
});

test('Reconciliation: Preserves Two Distinct Equal Payments from Same Sender', () => {
  const db = initTestDatabase();
  const { orgId, devId, phone } = setupTestTenant(db, 5000.0);

  // Transfer 1: 500 EGP from Karim (Ref: VF-9001)
  const raw1 = 'تم استلام مبلغ 500 جنيه من 01029182921. رصيد فودافون كاش الحالي 5,500 جنيه. رقم العملية: VF-9001';
  // Transfer 2: Another distinct 500 EGP from Karim (Ref: VF-9002)
  const raw2 = 'تم استلام مبلغ 500 جنيه من 01029182921. رصيد فودافون كاش الحالي 6,000 جنيه. رقم العملية: VF-9002';

  const r1 = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId: 'raw_distinct_1',
    adapterType: 'macrodroid',
    boundPaymentAddress: phone,
    parsed: parseEgyptianPaymentMessage(raw1),
    financialEventAt: new Date().toISOString(),
    signature: 'valid_hmac_sig',
    independentSettlementEvidence: true,
  });

  const r2 = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId: 'raw_distinct_2',
    adapterType: 'macrodroid',
    boundPaymentAddress: phone,
    parsed: parseEgyptianPaymentMessage(raw2),
    financialEventAt: new Date().toISOString(),
    signature: 'valid_hmac_sig',
    independentSettlementEvidence: true,
  });

  assert.strictEqual(r1.status, 'confirmed');
  assert.strictEqual(r2.status, 'confirmed');

  const count = db.prepare(`SELECT COUNT(*) as c FROM transactions WHERE organization_id = ?`).get(orgId) as any;
  assert.strictEqual(count.c, 2, 'Two distinct transfers of equal value must not be collapsed');

  assert.strictEqual(balanceMinor(db, { orgId }), 600000);
});

test('Reconciliation: Safe Source Switching with In-Flight Delayed Payments', () => {
  const db = initTestDatabase();
  const { orgId, accId, devId, srcId, phone } = setupTestTenant(db, 10000.0);

  // Merchant pauses Wallet A for new invoices and adds Wallet B
  db.prepare(`UPDATE payment_sources SET is_paused_for_new_instructions = 1, retired_at = datetime('now') WHERE id = ?`).run(srcId);
  const srcBId = 'src_wallet_B';
  const phoneB = '01099882211';
  db.prepare(`INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit_minor, monthly_turnover_limit_minor) VALUES (?, ?, ?, 'vodafone_cash', 'Wallet B', ?, 6000000, 20000000)`).run(srcBId, orgId, accId, phoneB);
  db.prepare(`INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value, is_default_for_invoices) VALUES ('addr_B', ?, 'msisdn', ?, 1)`).run(srcBId, phoneB);

  // A delayed customer payment sent to the OLD phone arrives 2 hours later
  const latePaymentRaw = 'تم استلام مبلغ 1,000 جنيه من 01011223344. رصيد فودافون كاش الحالي 11,000 جنيه. رقم العملية: VF-LATE-99';
  const parsed = parseEgyptianPaymentMessage(latePaymentRaw);

  const res = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId: 'raw_late_01',
    adapterType: 'macrodroid',
    boundPaymentAddress: phone, // sent to old phone
    parsed,
    financialEventAt: new Date().toISOString(),
    signature: 'valid_hmac_sig',
    independentSettlementEvidence: true,
  });

  assert.strictEqual(res.status, 'confirmed');
  assert.strictEqual(res.balanceAfter, 11000.0);

  // Check that the transaction was bound to original Wallet A (retaining immutable history)
  const tx = db.prepare(`SELECT payment_source_id, amount_minor FROM transactions WHERE external_trx_id = 'VF-LATE-99'`).get() as any;
  assert.strictEqual(tx.payment_source_id, srcId, 'Must be bound to original Wallet A');
  assert.strictEqual(tx.amount_minor, 100000);
});

test('Reconciliation: A signed capture alone is held for review and never advances the ledger', () => {
  const db = initTestDatabase();
  const { orgId, accId, devId, phone } = setupTestTenant(db, 1000.0);

  const result = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId: 'raw_signed_only',
    adapterType: 'macrodroid',
    boundPaymentAddress: phone,
    parsed: parseEgyptianPaymentMessage('تم استلام مبلغ 200 جنيه. رصيد فودافون كاش الحالي 1,200 جنيه. رقم العملية: VF-SIGNED-ONLY'),
    financialEventAt: new Date().toISOString(),
    signature: 'valid_hmac_sig',
  });

  assert.strictEqual(result.status, 'review_required');
  assert.strictEqual(balanceMinor(db, { accId }), 100000, 'HMAC proves capture, not settlement');
  const jobs = db.prepare("SELECT COUNT(*) as c FROM outbox_jobs WHERE organization_id = ? AND job_type = 'dispatch_webhook'").get(orgId) as any;
  assert.strictEqual(jobs.c, 0, 'No confirmed webhook may be queued before verification');
});

test('Reconciliation: Unbound capture device cannot select a source from SMS metadata', () => {
  const db = initTestDatabase();
  const { orgId, devId, phone } = setupTestTenant(db, 1000.0);
  db.prepare('UPDATE devices SET payment_source_id = NULL WHERE id = ?').run(devId);

  const result = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId: 'raw_unbound_device',
    adapterType: 'macrodroid',
    boundPaymentAddress: phone,
    parsed: parseEgyptianPaymentMessage('تم استلام مبلغ 100 جنيه. رصيد فودافون كاش الحالي 1,100 جنيه. رقم العملية: VF-UNBOUND'),
    financialEventAt: new Date().toISOString(),
    signature: 'valid_hmac_sig',
  });

  assert.strictEqual(result.status, 'review_required');
  const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE organization_id = ?').get(orgId) as any;
  assert.strictEqual(txCount.count, 0, 'An unbound device must not create a financial transaction');
  const event = db.prepare('SELECT processing_status FROM raw_events WHERE id = ?').get('raw_unbound_device') as any;
  assert.strictEqual(event.processing_status, 'review_required_source_binding');
});

test('Reconciliation: A balance checkpoint is required before automatic confirmation', () => {
  const db = initTestDatabase();
  const { orgId, accId, devId, phone } = setupTestTenant(db, 1000.0);
  db.prepare('DELETE FROM balance_checkpoints WHERE balance_account_id = ?').run(accId);

  const result = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId: 'raw_missing_checkpoint',
    adapterType: 'macrodroid',
    boundPaymentAddress: phone,
    parsed: parseEgyptianPaymentMessage('تم استلام مبلغ 100 جنيه. رصيد فودافون كاش الحالي 1,100 جنيه. رقم العملية: VF-NO-ANCHOR'),
    financialEventAt: new Date().toISOString(),
    signature: 'valid_hmac_sig',
    independentSettlementEvidence: true,
  });

  assert.strictEqual(result.status, 'review_required');
  assert.strictEqual(balanceMinor(db, { accId }), 100000);
});

test('Reconciliation: piastre amounts accumulate exactly (no float drift)', () => {
  const db = initTestDatabase();
  const { orgId, accId, devId, phone } = setupTestTenant(db, 0.1);

  // 0.10 + 0.20 = 0.30 exactly; in IEEE floats 0.1 + 0.2 = 0.30000000000000004
  const res = ReconciliationService.processInboundTransaction({
    organizationId: orgId,
    deviceId: devId,
    rawEventId: 'raw_piastres',
    adapterType: 'macrodroid',
    boundPaymentAddress: phone,
    parsed: parseEgyptianPaymentMessage('تم استلام مبلغ 0.20 جنيه. رصيد فودافون كاش الحالي 0.30 جنيه. رقم العملية: VF-PIASTRE'),
    financialEventAt: new Date().toISOString(),
    signature: 'valid_hmac_sig',
    independentSettlementEvidence: true,
  });

  assert.strictEqual(res.status, 'confirmed', res.reviewReason);
  assert.strictEqual(balanceMinor(db, { accId }), 30);
});

test('Financial Limits: CBE Daily Turnover Tracking & 80%/90% Alert Triggers', () => {
  const db = initTestDatabase();
  const { orgId, srcId } = setupTestTenant(db, 0.0);

  // Daily limit is 60,000 EGP.
  // 1. Ingest 40,000 EGP (66% - no alert)
  const r1 = LimitEngine.recordTurnover(orgId, srcId, 40000.0);
  assert.strictEqual(r1.dailyPercentage, 67);
  assert.strictEqual(r1.alertTriggered, undefined);

  // 2. Ingest 10,000 EGP (Total 50,000 EGP = 83% -> 80% Alert Triggered!)
  const r2 = LimitEngine.recordTurnover(orgId, srcId, 10000.0);
  assert.strictEqual(r2.dailyPercentage, 83);
  assert.strictEqual(r2.alertTriggered, '80%');

  // 3. Ingest another 1,000 EGP (Total 51,000 EGP = 85% -> 80% Alert NOT repeated!)
  const r3 = LimitEngine.recordTurnover(orgId, srcId, 1000.0);
  assert.strictEqual(r3.alertTriggered, undefined, '80% alert must not be repeatedly dispatched for the same period');

  // 4. Ingest 4,000 EGP (Total 55,000 EGP = 92% -> 90% Alert Triggered!)
  const r4 = LimitEngine.recordTurnover(orgId, srcId, 4000.0);
  assert.strictEqual(r4.dailyPercentage, 92);
  assert.strictEqual(r4.alertTriggered, '90%');
});
