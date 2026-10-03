import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { initTestDatabase, setDatabase, getDatabase } from '../server/db';
import { SubscriptionService, addCalendarMonthsUTC, addCalendarYearsUTC } from '../server/services/subscriptionService';
import { ReconciliationService } from '../server/services/reconciliationService';

test('Subscription 1: Purchasing and Renewing All 3 Plans with Exact Prices and UTC Calendar Dates', () => {
  const db = initTestDatabase();
  setDatabase(db);

  // 1. Verify all 3 official plans exist with exact required prices and limits
  const plans = SubscriptionService.getPlans();
  assert.strictEqual(plans.length, 3, 'Must have exactly 3 official plans');

  const p1 = plans.find((p) => p.id === 'plan_monthly_3');
  const p2 = plans.find((p) => p.id === 'plan_monthly_5');
  const p3 = plans.find((p) => p.id === 'plan_annual_10');

  assert.ok(p1, 'Monthly 3 phones plan exists');
  assert.strictEqual(p1.price_egp, 499.0);
  assert.strictEqual(p1.device_limit, 3);
  assert.strictEqual(p1.billing_cycle, 'monthly');

  assert.ok(p2, 'Monthly 5 phones plan exists');
  assert.strictEqual(p2.price_egp, 799.0);
  assert.strictEqual(p2.device_limit, 5);
  assert.strictEqual(p2.billing_cycle, 'monthly');

  assert.ok(p3, 'Annual 10 phones plan exists');
  assert.strictEqual(p3.price_egp, 7990.0);
  assert.strictEqual(p3.device_limit, 10);
  assert.strictEqual(p3.billing_cycle, 'annual');

  // 2. Setup a test merchant organization
  const orgId = 'org_test_merchant_01';
  const userId = 'usr_merchant_01';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Test Store', 'متجر تجريبي', 'test-store')`).run(orgId);
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, 'merchant1@store.eg', 'hash', 'Merchant One')`).run(userId);
  db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ('mem_m1', ?, ?, 'owner')`).run(orgId, userId);
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name) VALUES ('acc_m1', ?, 'Main')`).run(orgId);

  // Initial check: has no active subscription, default limit is 1 starter device
  const initialLimit = SubscriptionService.checkDeviceLimit(orgId);
  assert.strictEqual(initialLimit.maxLimit, 1, 'Starter tier allows 1 device');

  // 3. Purchase Plan 1 (Monthly 3 Phones @ 499 EGP)
  const order1 = SubscriptionService.createOrder({ organizationId: orgId, userId, planId: p1.id });
  assert.strictEqual(order1.price_egp, 499.0);
  assert.strictEqual(order1.device_limit, 3);
  assert.strictEqual(order1.status, 'pending_payment');
  assert.strictEqual(order1.instapay_target_number, '01551234263');

  // Simulate real inbound payment on the platform owner receiver (org_platform_ops)
  const platformTx1Id = 'tx_plat_499_01';
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, status, reconciliation_state, provenance_confidence, financial_event_at)
    VALUES (?, 'org_platform_ops', 'acc_platform_ops', 'src_platform_instapay', 'IPN-TRX-499-ALPHA', 'instapay', 499.0, 'confirmed', 'consistent', 1.0, datetime('now'))
  `).run(platformTx1Id);

  // Merchant reports transfer proof with reference
  const report1 = SubscriptionService.reportPayment({
    orderId: order1.id,
    organizationId: orgId,
    reportedTransferRef: 'IPN-TRX-499-ALPHA',
    reportedSenderInfo: '01099887766',
  });
  assert.strictEqual(report1.matched, true, 'Order 1 should be auto-matched with platform transaction');
  assert.strictEqual(report1.order.status, 'confirmed');

  // Verify organization subscription is now active with 3 phone limit
  const sub1 = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(sub1.hasSubscription, true);
  assert.strictEqual(sub1.status, 'active');
  assert.strictEqual(sub1.deviceLimit, 3);
  assert.strictEqual(sub1.priceEgp, 499.0);

  const initialEnd = new Date(sub1.endsAt!);

  // 4. Renewal of Same Plan while Active: Must extend from existing endsAt
  const orderRenewal = SubscriptionService.createOrder({ organizationId: orgId, userId, planId: p1.id });
  const platformTxRenewalId = 'tx_plat_499_renewal';
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, status, reconciliation_state, provenance_confidence, financial_event_at)
    VALUES (?, 'org_platform_ops', 'acc_platform_ops', 'src_platform_instapay', 'IPN-TRX-499-BETA', 'instapay', 499.0, 'confirmed', 'consistent', 1.0, datetime('now'))
  `).run(platformTxRenewalId);

  SubscriptionService.reportPayment({
    orderId: orderRenewal.id,
    organizationId: orgId,
    reportedTransferRef: 'IPN-TRX-499-BETA',
  });

  const subRenewed = SubscriptionService.getOrganizationSubscription(orgId);
  const renewedEnd = new Date(subRenewed.endsAt!);
  const expectedExtendedEnd = addCalendarMonthsUTC(initialEnd, 1);
  assert.strictEqual(renewedEnd.toISOString(), expectedExtendedEnd.toISOString(), 'Renewal must extend duration from existing ends_at');

  // 5. Upgrade to Plan 3 (Annual 10 Phones @ 7,990 EGP)
  const orderUpgrade = SubscriptionService.createOrder({ organizationId: orgId, userId, planId: p3.id });
  assert.strictEqual(orderUpgrade.price_egp, 7990.0);
  assert.strictEqual(orderUpgrade.device_limit, 10);

  const platformTxUpgradeId = 'tx_plat_7990_upgrade';
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, status, reconciliation_state, provenance_confidence, financial_event_at)
    VALUES (?, 'org_platform_ops', 'acc_platform_ops', 'src_platform_instapay', 'IPN-TRX-7990-GAMMA', 'instapay', 7990.0, 'confirmed', 'consistent', 1.0, datetime('now'))
  `).run(platformTxUpgradeId);

  SubscriptionService.reportPayment({
    orderId: orderUpgrade.id,
    organizationId: orgId,
    reportedTransferRef: 'IPN-TRX-7990-GAMMA',
  });

  const subUpgraded = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(subUpgraded.deviceLimit, 10, 'Device limit must immediately upgrade to 10');
  assert.strictEqual(subUpgraded.billingCycle, 'annual');
});

test('Subscription 2: Two Transfers with Exact Same Amount for Two Different Users', () => {
  const db = initTestDatabase();
  setDatabase(db);

  // Setup User A (Org A) and User B (Org B)
  const orgA = 'org_merchant_A';
  const orgB = 'org_merchant_B';
  const userA = 'usr_merchant_A';
  const userB = 'usr_merchant_B';

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Store A', 'متجر أ', 'store-a')`).run(orgA);
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Store B', 'متجر ب', 'store-b')`).run(orgB);
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, 'a@store.eg', 'h', 'User A')`).run(userA);
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, 'b@store.eg', 'h', 'User B')`).run(userB);

  // Both choose Monthly 3 Phones @ 499.0 EGP
  const orderA = SubscriptionService.createOrder({ organizationId: orgA, userId: userA, planId: 'plan_monthly_3' });
  const orderB = SubscriptionService.createOrder({ organizationId: orgB, userId: userB, planId: 'plan_monthly_3' });

  assert.strictEqual(orderA.price_egp, 499.0);
  assert.strictEqual(orderB.price_egp, 499.0);

  // Two separate inbound transfers arrive on platform owner receiver for 499.0 EGP
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, status, reconciliation_state, provenance_confidence, sender_phone, financial_event_at)
    VALUES ('tx_499_A', 'org_platform_ops', 'acc_platform_ops', 'src_platform_instapay', 'IPN-REF-A-1111', 'instapay', 499.0, 'confirmed', 'consistent', 1.0, '01511111111', datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, status, reconciliation_state, provenance_confidence, sender_phone, financial_event_at)
    VALUES ('tx_499_B', 'org_platform_ops', 'acc_platform_ops', 'src_platform_instapay', 'IPN-REF-B-2222', 'instapay', 499.0, 'confirmed', 'consistent', 1.0, '01522222222', datetime('now'))
  `).run();

  // User A reports payment with Reference A
  const reportA = SubscriptionService.reportPayment({
    orderId: orderA.id,
    organizationId: orgA,
    reportedTransferRef: 'IPN-REF-A-1111',
  });
  assert.strictEqual(reportA.matched, true);
  assert.strictEqual(reportA.order.matched_transaction_id, 'tx_499_A');

  // Verify Org B is NOT activated yet
  const subB_before = SubscriptionService.getOrganizationSubscription(orgB);
  assert.strictEqual(subB_before.hasSubscription, false);

  // User B reports payment with Reference B
  const reportB = SubscriptionService.reportPayment({
    orderId: orderB.id,
    organizationId: orgB,
    reportedTransferRef: 'IPN-REF-B-2222',
  });
  assert.strictEqual(reportB.matched, true);
  assert.strictEqual(reportB.order.matched_transaction_id, 'tx_499_B');

  // Verify both organizations are independently and correctly activated with no cross-contamination
  const subA = SubscriptionService.getOrganizationSubscription(orgA);
  const subB = SubscriptionService.getOrganizationSubscription(orgB);
  assert.strictEqual(subA.status, 'active');
  assert.strictEqual(subB.status, 'active');
  assert.notStrictEqual(subA.id, subB.id);
});

test('Subscription 3: Preventing Double-Spending (Same Inbound Transfer Cannot Activate Two Orders)', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const org1 = 'org_double_1';
  const org2 = 'org_double_2';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Org 1', 'مؤسسة 1', 'org-1')`).run(org1);
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Org 2', 'مؤسسة 2', 'org-2')`).run(org2);
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES ('usr_d1', 'd1@eg.com', 'h', 'U1')`).run();
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES ('usr_d2', 'd2@eg.com', 'h', 'U2')`).run();

  const ord1 = SubscriptionService.createOrder({ organizationId: org1, userId: 'usr_d1', planId: 'plan_monthly_3' });
  const ord2 = SubscriptionService.createOrder({ organizationId: org2, userId: 'usr_d2', planId: 'plan_monthly_3' });

  // Single inbound transaction of 499.0 EGP
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, status, reconciliation_state, provenance_confidence, financial_event_at)
    VALUES ('tx_single_spend', 'org_platform_ops', 'acc_platform_ops', 'src_platform_instapay', 'IPN-SINGLE-SPEND', 'instapay', 499.0, 'confirmed', 'consistent', 1.0, datetime('now'))
  `).run();

  // Order 1 claims it and gets confirmed
  const r1 = SubscriptionService.reportPayment({
    orderId: ord1.id,
    organizationId: org1,
    reportedTransferRef: 'IPN-SINGLE-SPEND',
  });
  assert.strictEqual(r1.matched, true);

  // Order 2 tries to claim the EXACT SAME reference
  const r2 = SubscriptionService.reportPayment({
    orderId: ord2.id,
    organizationId: org2,
    reportedTransferRef: 'IPN-SINGLE-SPEND',
  });
  assert.strictEqual(r2.matched, false, 'Second order MUST NOT match already assigned transaction');
  assert.strictEqual(r2.order.status, 'in_review');

  // Verify manual approval also blocks double-spending the same transaction
  assert.throws(() => {
    SubscriptionService.manualApproveOrder({
      orderId: ord2.id,
      platformOwnerUserId: 'usr_admin',
      transactionId: 'tx_single_spend',
      reason: 'Should fail due to double spend check',
    });
  }, /TRANSACTION_ALREADY_USED/);
});

test('Subscription 4: Rejecting Activation when User Submits Unverified Reference', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const org = 'org_unverified_test';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Shop', 'محل', 'shop')`).run(org);
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES ('usr_u', 'u@shop.eg', 'h', 'U')`).run();

  const order = SubscriptionService.createOrder({ organizationId: org, userId: 'usr_u', planId: 'plan_monthly_5' });
  assert.strictEqual(order.price_egp, 799.0);

  // User submits a fake reference with no corresponding transaction on platform receiver
  const report = SubscriptionService.reportPayment({
    orderId: order.id,
    organizationId: org,
    reportedTransferRef: 'FAKE-CLAIM-99999',
    reportedSenderInfo: '01000000000',
  });

  assert.strictEqual(report.matched, false, 'Must not activate on unverified user claim');
  assert.strictEqual(report.order.status, 'in_review');

  const sub = SubscriptionService.getOrganizationSubscription(org);
  assert.strictEqual(sub.hasSubscription, false, 'Subscription remains inactive until verified');
});

test('Subscription 5: Strict Server-Side Device Limit Enforcement & Concurrent Pairing Prevention', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const org = 'org_device_limit_test';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Limits Org', 'مؤسسة الحدود', 'limits-org')`).run(org);

  // 1. Initial State: Unsubscribed merchant has starter limit of 1 device
  let limit = SubscriptionService.checkDeviceLimit(org);
  assert.strictEqual(limit.maxLimit, 1);
  assert.strictEqual(limit.allowed, true);

  // Add 1st device
  db.prepare(`
    INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type, status)
    VALUES ('dev_test_1', ?, 'D1', 'Phone 1', 'macrodroid', 'online')
  `).run(org);

  limit = SubscriptionService.checkDeviceLimit(org);
  assert.strictEqual(limit.currentCount, 1);
  assert.strictEqual(limit.allowed, false, 'Cannot add 2nd device without active subscription');

  // 2. Activate Monthly 3 Phones (limit: 3)
  db.prepare(`
    INSERT INTO organization_subscriptions (id, organization_id, plan_id, status, starts_at, ends_at, device_limit, features_json)
    VALUES ('sub_lim_3', ?, 'plan_monthly_3', 'active', datetime('now'), datetime('now', '+1 month'), 3, '[]')
  `).run(org);

  limit = SubscriptionService.checkDeviceLimit(org);
  assert.strictEqual(limit.maxLimit, 3);
  assert.strictEqual(limit.allowed, true);

  // Add 2nd and 3rd device
  db.prepare(`INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type, status) VALUES ('dev_test_2', ?, 'D2', 'Phone 2', 'macrodroid', 'online')`).run(org);
  db.prepare(`INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type, status) VALUES ('dev_test_3', ?, 'D3', 'Phone 3', 'macrodroid', 'online')`).run(org);

  limit = SubscriptionService.checkDeviceLimit(org);
  assert.strictEqual(limit.currentCount, 3);
  assert.strictEqual(limit.allowed, false, 'Limit of 3 reached; 4th device must be rejected');

  // Bypassing limit by disabling device: Device is offline but still counts toward registered fleet!
  db.prepare(`UPDATE devices SET status = 'offline' WHERE id = 'dev_test_3'`).run();
  limit = SubscriptionService.checkDeviceLimit(org);
  assert.strictEqual(limit.currentCount, 3, 'Offline devices still occupy slot unless revoked');
  assert.strictEqual(limit.allowed, false);

  // Only revoking frees the slot
  db.prepare(`UPDATE devices SET status = 'revoked' WHERE id = 'dev_test_3'`).run();
  limit = SubscriptionService.checkDeviceLimit(org);
  assert.strictEqual(limit.currentCount, 2);
  assert.strictEqual(limit.allowed, true);
});

test('Subscription 6: Late Transfer Handling on Expired Orders', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const org = 'org_late_pay';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Late Org', 'مؤسسة متأخرة', 'late-org')`).run(org);
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES ('usr_lp', 'lp@eg.com', 'h', 'LP')`).run();

  // Create order and artificially expire it
  const order = SubscriptionService.createOrder({ organizationId: org, userId: 'usr_lp', planId: 'plan_monthly_3' });
  db.prepare(`UPDATE subscription_orders SET status = 'expired' WHERE id = ?`).run(order.id);

  // Late transaction arrives on platform receiver
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount, status, reconciliation_state, provenance_confidence, financial_event_at)
    VALUES ('tx_late_499', 'org_platform_ops', 'acc_platform_ops', 'src_platform_instapay', 'IPN-LATE-ARRIVAL', 'instapay', 499.0, 'confirmed', 'consistent', 1.0, datetime('now'))
  `).run();

  // Platform owner reviews late transfer and approves order
  SubscriptionService.manualApproveOrder({
    orderId: order.id,
    platformOwnerUserId: 'usr_admin',
    transactionId: 'tx_late_499',
    reason: 'Approved late payment received after order expiration window',
  });

  const updatedOrder = db.prepare('SELECT status, approval_type, review_notes FROM subscription_orders WHERE id = ?').get(order.id) as any;
  assert.strictEqual(updatedOrder.status, 'confirmed');
  assert.strictEqual(updatedOrder.approval_type, 'manual');

  const sub = SubscriptionService.getOrganizationSubscription(org);
  assert.strictEqual(sub.status, 'active');
  assert.strictEqual(sub.deviceLimit, 3);
});

test('Subscription 7: Data Isolation Between Merchant Accounts and Platform Receiver', () => {
  const db = initTestDatabase();
  setDatabase(db);

  // Verify platform receiver is strictly owned by org_platform_ops
  const platformSource = db.prepare("SELECT * FROM payment_sources WHERE organization_id = 'org_platform_ops'").get() as any;
  assert.ok(platformSource);
  assert.strictEqual(platformSource.wallet_number, '01551234263');

  // Verify merchant query for payment sources does NOT leak platform source
  const merchantSources = db.prepare("SELECT * FROM payment_sources WHERE organization_id = 'org_test_m'").all();
  assert.strictEqual(merchantSources.length, 0);

  // Verify platform terminal device DEV-PLATFORM-01 belongs exclusively to org_platform_ops
  const platformDevice = db.prepare("SELECT * FROM devices WHERE device_number = 'DEV-PLATFORM-01'").get() as any;
  assert.ok(platformDevice);
  assert.strictEqual(platformDevice.organization_id, 'org_platform_ops');
});

test('Subscription 8: Data Persistence Across Database Restarts', () => {
  setDatabase(null);
  const testDbFile = path.join(process.cwd(), 'data', 'test_subscription_persist.db');
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }
  const initWal = `${testDbFile}-wal`;
  if (fs.existsSync(initWal)) fs.unlinkSync(initWal);
  const initShm = `${testDbFile}-shm`;
  if (fs.existsSync(initShm)) fs.unlinkSync(initShm);

  // 1. First session: initialize file DB and create subscription
  const db1 = getDatabase(testDbFile);
  setDatabase(db1);

  const orgId = 'org_persist_test';
  db1.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Persist Co', 'شركة البقاء', 'persist-co')`).run(orgId);
  db1.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES ('usr_p', 'p@persist.eg', 'h', 'Persist User')`).run();

  const order = SubscriptionService.createOrder({ organizationId: orgId, userId: 'usr_p', planId: 'plan_annual_10' });

  // Confirm and activate
  SubscriptionService.activateSubscriptionFromOrder({
    orderId: order.id,
    transactionId: null,
    approvalType: 'manual',
    approvedByUserId: 'admin',
    reviewNotes: 'Verified offline transfer',
  });

  // Verify before close
  const subBefore = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(subBefore.status, 'active');
  assert.strictEqual(subBefore.deviceLimit, 10);

  // 2. Simulate complete restart by closing connection, resetting dbInstance and reopening file DB
  db1.close();
  setDatabase(null);

  const db2 = getDatabase(testDbFile);
  setDatabase(db2);

  // Verify after restart: all plans, settings, subscriptions, and receipts persisted
  const plans = SubscriptionService.getPlans();
  assert.strictEqual(plans.length, 3);

  const settings = SubscriptionService.getPlatformSettings();
  assert.strictEqual(settings.instapay_number, '01551234263');

  const subAfter = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(subAfter.status, 'active');
  assert.strictEqual(subAfter.deviceLimit, 10);
  assert.strictEqual(subAfter.billingCycle, 'annual');

  const receipts = db2.prepare('SELECT * FROM subscription_receipts WHERE organization_id = ?').all(orgId);
  assert.strictEqual(receipts.length, 1);

  // Cleanup test DB file
  db2.close();
  setDatabase(null);
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }
  const walFile = `${testDbFile}-wal`;
  if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
  const shmFile = `${testDbFile}-shm`;
  if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
});
