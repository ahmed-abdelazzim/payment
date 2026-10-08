import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setDatabase, initSchema } from '../server/db';
import { CheckoutService } from '../server/services/checkoutService';
import { LimitEngine } from '../server/services/limitEngine';
import { FraudProtectionService } from '../server/services/fraudProtectionService';

describe('Competitive Advantages & Killer Features', () => {
  let db: DatabaseSync;
  const orgId = 'org_killer_features_test';

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    initSchema(db);
    setDatabase(db);

    // 1. Seed merchant organization
    db.prepare(`
      INSERT INTO organizations (
        id, name, name_ar, slug, wallet_routing_strategy, whatsapp_business_phone, whatsapp_auto_message
      ) VALUES (?, 'Nile Mart', 'متجر النيل', 'nile-mart', 'least_loaded', '201011122233', 1)
    `).run(orgId);

    // 2. Seed balance account
    db.prepare(`
      INSERT INTO balance_accounts (id, organization_id, account_name, current_balance_minor)
      VALUES ('acc_nile_wallets', ?, 'Multi-Wallet Pool Ledger', 500000)
    `).run(orgId);

    db.prepare(`
      INSERT INTO balance_checkpoints (id, balance_account_id, checkpoint_type, balance_amount_minor, as_of_timestamp)
      VALUES ('chk_1', 'acc_nile_wallets', 'OFFICIAL_STATEMENT', 500000, datetime('now', '-1 hour'))
    `).run();

    // 3. Seed two Vodafone Cash wallets:
    // Wallet A (Primary): Daily cap 60,000 EGP (6,000,000 minor)
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor
      ) VALUES ('src_vf_primary', ?, 'acc_nile_wallets', 'vodafone_cash', 'Vodafone Primary', '01011111111', 6000000, 20000000)
    `).run(orgId);

    db.prepare(`
      INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value)
      VALUES ('addr_vf_1', 'src_vf_primary', 'msisdn', '01011111111')
    `).run();

    // Wallet B (Backup/Secondary): Daily cap 60,000 EGP (6,000,000 minor)
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor
      ) VALUES ('src_vf_secondary', ?, 'acc_nile_wallets', 'vodafone_cash', 'Vodafone Secondary', '01022222222', 6000000, 20000000)
    `).run(orgId);

    db.prepare(`
      INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value)
      VALUES ('addr_vf_2', 'src_vf_secondary', 'msisdn', '01022222222')
    `).run();

    // InstaPay source
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor
      ) VALUES ('src_instapay', ?, 'acc_nile_wallets', 'instapay', 'Nile InstaPay IPA', '01033333333', 10000000, 30000000)
    `).run(orgId);

    db.prepare(`
      INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value)
      VALUES ('addr_ipa_1', 'src_instapay', 'instapay_vpa', 'nilemart@instapay')
    `).run();

    // Bind capture devices
    db.prepare(`
      INSERT INTO devices (id, organization_id, payment_source_id, device_number, friendly_name, adapter_type, status)
      VALUES ('dev_vf_1', ?, 'src_vf_primary', 'DEV-VF-1', 'Phone 1', 'macrodroid', 'online'),
             ('dev_vf_2', ?, 'src_vf_secondary', 'DEV-VF-2', 'Phone 2', 'macrodroid', 'online')
    `).run(orgId, orgId);
  });

  test('1. Real-Time Capacity & Limit Engine Tracking', () => {
    // Both wallets have 0 intake today
    const capA = LimitEngine.getSourceCapacity(orgId, 'src_vf_primary');
    assert.ok(capA);
    assert.equal(capA.dailyIntakeMinor, 0);
    assert.equal(capA.remainingDailyMinor, 6000000);
    assert.equal(capA.dailyPercentage, 0);
    assert.equal(capA.isSaturated, false);

    // Record turnover on Wallet A totaling 58,800 EGP (98% of 60,000 EGP limit)
    LimitEngine.recordTurnover(orgId, 'src_vf_primary', 58800);

    const capA_after = LimitEngine.getSourceCapacity(orgId, 'src_vf_primary');
    assert.ok(capA_after);
    assert.equal(capA_after.dailyIntakeMinor, 5880000);
    assert.equal(capA_after.remainingDailyMinor, 120000);
    assert.equal(capA_after.dailyPercentage, 98);
    // At >= 98%, isSaturated should be true!
    assert.equal(capA_after.isSaturated, true);
  });

  test('2. Smart Wallet Cascading & Quota Failover on Checkout', () => {
    // Settle Wallet A near its limit (59,000 EGP out of 60,000 EGP)
    LimitEngine.recordTurnover(orgId, 'src_vf_primary', 59000);

    // Create a new checkout session
    const session = CheckoutService.createSession(orgId, {
      amount: 450,
      orderId: 'ORDER-CASCADE-001',
    });

    const publicSession = CheckoutService.getSession(session.id);
    assert.ok(publicSession);
    assert.ok(publicSession.rails.length > 0);

    // Find the Vodafone Cash rail offered to the customer
    const vfRail = publicSession.rails.find((r) => r.provider === 'vodafone_cash');
    assert.ok(vfRail);

    // Because Wallet A is saturated (>98%), the smart cascading engine
    // MUST auto-route customer to Wallet B ('01022222222')!
    assert.equal(vfRail.walletNumber, '01022222222', 'Should auto-cascade to healthiest headroom wallet');
  });

  test('3. Anti-Fraud Radar: Blacklisting & Enforcing Fraud Blocks', () => {
    const fraudsterPhone = '01099887766';

    // Verify initially clean
    const initialCheck = FraudProtectionService.assessSender(orgId, fraudsterPhone);
    assert.equal(initialCheck.isBlocked, false);
    assert.equal(initialCheck.riskScore, 0);

    // Merchant blocks suspicious number
    FraudProtectionService.blockSender(orgId, fraudsterPhone, 'محاولات احتيال متكررة وإيصالات مزورة');

    // Radar should now recognize the block
    const isBlocked = FraudProtectionService.isSenderBlocked(orgId, fraudsterPhone);
    assert.equal(isBlocked, true);

    const assessed = FraudProtectionService.assessSender(orgId, fraudsterPhone);
    assert.equal(assessed.isBlocked, true);
    assert.equal(assessed.riskScore, 100);

    // Attempting to create checkout session with blocked customer phone must throw CUSTOMER_BLOCKED
    assert.throws(() => {
      CheckoutService.createSession(orgId, {
        amount: 300,
        customerPhone: fraudsterPhone,
        orderId: 'ORDER-FRAUD-001',
      });
    }, /CUSTOMER_BLOCKED/);

    // If an existing session is claimed by the blocked phone, claim must fail
    const cleanSession = CheckoutService.createSession(orgId, {
      amount: 300,
      orderId: 'ORDER-LEGIT-002',
    });

    assert.throws(() => {
      CheckoutService.claimManualReference(cleanSession.id, {
        senderPhone: fraudsterPhone,
        transferRef: 'TRX_FAKE_999',
      });
    }, /SENDER_BLOCKED/);

    // Unblock the sender
    FraudProtectionService.unblockSender(orgId, fraudsterPhone);
    assert.equal(FraudProtectionService.isSenderBlocked(orgId, fraudsterPhone), false);

    // Now session creation works cleanly
    const restoredSession = CheckoutService.createSession(orgId, {
      amount: 300,
      customerPhone: fraudsterPhone,
      orderId: 'ORDER-RESTORED-003',
    });
    assert.ok(restoredSession.id);
  });

  test('4. Automated WhatsApp Customer Receipt Dispatch', () => {
    const session = CheckoutService.createSession(orgId, {
      amount: 850.5,
      orderId: 'ORDER-WA-777',
      customerPhone: '01012345678',
    });

    // Confirm session
    CheckoutService.simulateConfirmation(session.id);

    // Generate WhatsApp Receipt URL
    const waUrl = CheckoutService.generateWhatsAppReceiptUrl(session.id);
    assert.ok(waUrl);
    assert.match(waUrl, /^https:\/\/wa\.me\//);
    assert.ok(waUrl.includes('ORDER-WA-777'));
    assert.ok(waUrl.includes('850.50'));
    // Decoded URL should contain official Arabic confirmation text
    const decodedUrl = decodeURIComponent(waUrl);
    assert.ok(decodedUrl.includes('إيصال تأكيد سداد إلكتروني معتمد'));
    assert.ok(decodedUrl.includes('متجر النيل'));
    assert.ok(decodedUrl.includes('850.50 ج.م'));
  });

  test('5. Multi-Rail & InstaPay Support in Public Session', () => {
    const session = CheckoutService.createSession(orgId, {
      amount: 1200,
      orderId: 'ORDER-INSTAPAY-001',
    });

    const publicData = CheckoutService.getSession(session.id);
    assert.ok(publicData);
    assert.equal(publicData.rails.length, 2, 'Should offer both Vodafone Cash and InstaPay rails');

    const ipaRail = publicData.rails.find((r) => r.provider === 'instapay');
    assert.ok(ipaRail);
    assert.equal(ipaRail.instapayAddress, 'nilemart@instapay');
  });
});
