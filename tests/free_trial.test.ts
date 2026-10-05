import { test } from 'node:test';
import assert from 'node:assert';
import { initTestDatabase, setDatabase } from '../server/db';
import {
  FREE_TRIAL_DURATION_HOURS,
  FREE_TRIAL_PLAN_ID,
  SubscriptionService,
} from '../server/services/subscriptionService';

test('Free Trial 1: Free Trial Auto-Provisioning with 168 Hours UTC and 1 Device Limit', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_trial_test_1';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Trial Store', 'متجر التجربة', 'trial-store')`).run(orgId);

  // Start trial
  SubscriptionService.startFreeTrial(orgId);

  const sub = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(sub.hasSubscription, true);
  assert.strictEqual(sub.isTrial, true);
  assert.strictEqual(sub.trialExpired, false);
  assert.strictEqual(sub.status, 'trial');
  assert.strictEqual(sub.planId, FREE_TRIAL_PLAN_ID);
  assert.strictEqual(sub.deviceLimit, 1);
  assert.strictEqual(sub.daysRemaining, 7);
  assert.strictEqual(sub.hoursRemaining, FREE_TRIAL_DURATION_HOURS);

  const start = new Date(sub.startsAt).getTime();
  const end = new Date(sub.endsAt).getTime();
  const diffHours = Math.round((end - start) / (1000 * 60 * 60));
  assert.strictEqual(diffHours, FREE_TRIAL_DURATION_HOURS, 'Trial duration must be strictly 168 hours in UTC');
});

test('Free Trial 2: Trial Is Organization-Scoped, Does Not Reset on Multiple Calls or Member Joins', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_trial_test_2';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Scope Org', 'مؤسسة النطاق', 'scope-org')`).run(orgId);

  // Initialize trial with past start date (e.g., 2 days ago)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const fiveDaysLater = new Date(Date.now() + 120 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO organization_subscriptions (id, organization_id, plan_id, status, starts_at, ends_at, device_limit, features_json)
    VALUES ('sub_test_scope', ?, 'plan_trial_7d', 'trial', ?, ?, 1, '[]')
  `).run(orgId, twoDaysAgo, fiveDaysLater);

  // Multiple calls to startFreeTrial MUST NOT overwrite or reset the dates
  SubscriptionService.startFreeTrial(orgId);

  const sub = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(sub.startsAt, twoDaysAgo);
  assert.strictEqual(sub.endsAt, fiveDaysLater);
  assert.strictEqual(sub.daysRemaining, 5);
});

test('Free Trial 3: Strict 1-Phone Device Limit Enforcement During Trial', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_trial_limit_test';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Phone Org', 'مؤسسة الهواتف', 'phone-org')`).run(orgId);
  SubscriptionService.startFreeTrial(orgId);

  // 0 devices registered -> Allowed
  let check = SubscriptionService.checkDeviceLimit(orgId);
  assert.strictEqual(check.allowed, true);
  assert.strictEqual(check.currentCount, 0);
  assert.strictEqual(check.maxLimit, 1);

  // Add 1st device
  db.prepare(`
    INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type, status)
    VALUES ('dev_trial_1', ?, 'D1', 'Samsung A15 Work Terminal', 'macrodroid', 'online')
  `).run(orgId);

  // 1 device registered -> Limit reached, 2nd phone prohibited
  check = SubscriptionService.checkDeviceLimit(orgId);
  assert.strictEqual(check.allowed, false, 'Second device must be rejected under 1-phone trial policy');
  assert.strictEqual(check.currentCount, 1);
  assert.strictEqual(check.maxLimit, 1);
});

test('Free Trial 4: Transition to trial_expired When 168 Hours Elapsed & Blocking New Devices', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_trial_expired_test';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Expired Org', 'مؤسسة منتهية', 'expired-org')`).run(orgId);

  // Set ends_at in the past (1 hour ago)
  const eightDaysAgo = new Date(Date.now() - 169 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO organization_subscriptions (id, organization_id, plan_id, status, starts_at, ends_at, device_limit, features_json)
    VALUES ('sub_expired', ?, ?, 'trial', ?, ?, 1, '[]')
  `).run(orgId, FREE_TRIAL_PLAN_ID, eightDaysAgo, oneHourAgo);

  const sub = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(sub.status, 'trial_expired');
  assert.strictEqual(sub.trialExpired, true);
  assert.strictEqual(sub.daysRemaining, 0);
  assert.strictEqual(sub.hoursRemaining, 0);

  // Verify checkDeviceLimit rejects
  const limit = SubscriptionService.checkDeviceLimit(orgId);
  assert.strictEqual(limit.allowed, false, 'Must strictly forbid adding devices once trial expires');
  assert.strictEqual(limit.subscriptionStatus, 'trial_expired');
});

test('Free Trial 5: 48h and 24h Warning State Transitions Without Duplication', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_warning_test';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Warning Org', 'مؤسسة التنبيهات', 'warning-org')`).run(orgId);

  // Set ends_at to 36 hours from now (in 48h window)
  const startsAt = new Date(Date.now() - 132 * 60 * 60 * 1000).toISOString();
  const endsAt36h = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO organization_subscriptions (id, organization_id, plan_id, status, starts_at, ends_at, device_limit, features_json, trial_warn_48h_sent, trial_warn_24h_sent)
    VALUES ('sub_warn_test', ?, 'plan_trial_7d', 'trial', ?, ?, 1, '[]', 0, 0)
  `).run(orgId, startsAt, endsAt36h);

  // First fetch triggers 48h warning
  let sub = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(sub.status, 'trial');
  assert.strictEqual(sub.hoursRemaining, 36);

  let row = db.prepare('SELECT trial_warn_48h_sent, trial_warn_24h_sent FROM organization_subscriptions WHERE id = ?').get('sub_warn_test') as any;
  assert.strictEqual(row.trial_warn_48h_sent, 1);
  assert.strictEqual(row.trial_warn_24h_sent, 0);
  assert.strictEqual(
    (db.prepare("SELECT COUNT(*) as count FROM outbox_jobs WHERE job_type = 'send_telegram'").get() as any).count,
    1,
    '48-hour warning must be queued for durable delivery'
  );

  // Re-reading in the same warning window must not enqueue a duplicate job.
  SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(
    (db.prepare("SELECT COUNT(*) as count FROM outbox_jobs WHERE job_type = 'send_telegram'").get() as any).count,
    1
  );

  // Move time to 12 hours from now (in 24h window)
  const endsAt12h = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE organization_subscriptions SET ends_at = ? WHERE id = ?').run(endsAt12h, 'sub_warn_test');

  sub = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(sub.hoursRemaining, 12);

  row = db.prepare('SELECT trial_warn_48h_sent, trial_warn_24h_sent FROM organization_subscriptions WHERE id = ?').get('sub_warn_test') as any;
  assert.strictEqual(row.trial_warn_48h_sent, 1);
  assert.strictEqual(row.trial_warn_24h_sent, 1);
  assert.strictEqual(
    (db.prepare("SELECT COUNT(*) as count FROM outbox_jobs WHERE job_type = 'send_telegram'").get() as any).count,
    2,
    '24-hour warning must be separately queued exactly once'
  );
});

test('Free Trial 6: Upgrading from Expired Free Trial to Paid Plan Restores Capabilities and Increases Device Limit', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_upgrade_test';
  const userId = 'usr_upgrade_test';
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Upgrade Org', 'مؤسسة الترقية', 'upgrade-org')`).run(orgId);
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, 'boss@upgrade.eg', 'hash', 'Boss')`).run(userId);

  // Set expired trial
  const eightDaysAgo = new Date(Date.now() - 169 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO organization_subscriptions (id, organization_id, plan_id, status, starts_at, ends_at, device_limit, features_json)
    VALUES ('sub_expired_up', ?, 'plan_trial_7d', 'trial_expired', ?, ?, 1, '[]')
  `).run(orgId, eightDaysAgo, oneHourAgo);

  // Existing historical device remains preserved
  db.prepare(`
    INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type, status)
    VALUES ('dev_hist_1', ?, 'D1', 'Historical Phone', 'macrodroid', 'online')
  `).run(orgId);

  // Attempting to add 2nd device fails while trial_expired
  let limit = SubscriptionService.checkDeviceLimit(orgId);
  assert.strictEqual(limit.allowed, false);

  // Merchant creates order for Monthly 5 Phones
  const order = SubscriptionService.createOrder({
    organizationId: orgId,
    userId,
    planId: 'plan_monthly_5',
  });
  assert.strictEqual(order.device_limit, 5);

  // Inbound transfer arrives on platform receiver
  db.prepare(`
    INSERT INTO transactions (id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount_minor, status, reconciliation_state, provenance_confidence, signature, financial_event_at)
    VALUES ('tx_sub_up_799', 'org_platform_ops', 'acc_platform_ops', 'src_platform_instapay', 'IPN-UPGRADE-799', 'instapay', 79900, 'confirmed', 'consistent', 1.0, 'valid_hmac_signature', datetime('now'))
  `).run();

  // Report payment
  const report = SubscriptionService.reportPayment({
    orderId: order.id,
    organizationId: orgId,
    reportedTransferRef: 'IPN-UPGRADE-799',
  });
  assert.strictEqual(report.matched, true);

  // Subscription becomes active with 5 phones limit
  const activeSub = SubscriptionService.getOrganizationSubscription(orgId);
  assert.strictEqual(activeSub.status, 'active');
  assert.strictEqual(activeSub.isTrial, false);
  assert.strictEqual(activeSub.deviceLimit, 5);

  // Merchant can now add additional devices
  limit = SubscriptionService.checkDeviceLimit(orgId);
  assert.strictEqual(limit.allowed, true);
  assert.strictEqual(limit.maxLimit, 5);
  assert.strictEqual(limit.currentCount, 1);
});
