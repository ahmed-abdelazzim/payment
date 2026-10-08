import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setDatabase, initSchema } from '../server/db';
import { ApiKeyService } from '../server/services/apiKeyService';
import { CheckoutService } from '../server/services/checkoutService';
import { PaymentLinkService } from '../server/services/paymentLinkService';
import { ReconciliationService } from '../server/services/reconciliationService';

describe('Merchant Payment Gateway & Integrations', () => {
  let db: DatabaseSync;
  const orgId = 'org_merchant_store_1';
  const orgId2 = 'org_merchant_store_2';

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    initSchema(db);
    setDatabase(db);

    // Seed test organizations
    db.prepare(`
      INSERT INTO organizations (id, name, name_ar, slug, webhook_url, webhook_secret)
      VALUES (?, 'Cairo Fashion Store', 'متجر أزياء القاهرة', 'cairo-fashion', 'https://store.example.com/webhook', 'sec_test_123')
    `).run(orgId);

    db.prepare(`
      INSERT INTO organizations (id, name, name_ar, slug)
      VALUES (?, 'Alexandria Tech', 'ألكسندريا تك', 'alex-tech')
    `).run(orgId2);

    // Seed balance account and payment sources for orgId
    db.prepare(`
      INSERT INTO balance_accounts (id, organization_id, account_name, current_balance_minor)
      VALUES ('acc_fashion', ?, 'Vodafone Cash Ledger', 100000)
    `).run(orgId);

    db.prepare(`
      INSERT INTO balance_checkpoints (id, balance_account_id, checkpoint_type, balance_amount_minor, as_of_timestamp)
      VALUES ('chk_1', 'acc_fashion', 'OFFICIAL_STATEMENT', 100000, datetime('now', '-1 hour'))
    `).run();

    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor
      ) VALUES ('src_vf_fashion', ?, 'acc_fashion', 'vodafone_cash', 'Vodafone Cash Business', '01012345678', 5000000, 20000000)
    `).run(orgId);

    db.prepare(`
      INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value)
      VALUES ('addr_vf_1', 'src_vf_fashion', 'msisdn', '01012345678')
    `).run();

    // Bind capture device
    db.prepare(`
      INSERT INTO devices (id, organization_id, payment_source_id, device_number, friendly_name, adapter_type, status)
      VALUES ('dev_vf_pos', ?, 'src_vf_fashion', 'DEV-001', 'Shop Android Phone', 'macrodroid', 'online')
    `).run(orgId);
  });

  test('1. API Keys: Generation, Authentication, and Revocation', () => {
    // A. Generate live key pair
    const liveKeys = ApiKeyService.generateKeySet(orgId, 'WooCommerce Store', 'live');
    assert.match(liveKeys.publicKey, /^pk_live_/);
    assert.match(liveKeys.secretKey, /^sk_live_/);

    // B. Authenticate with secret key
    const authSecret = ApiKeyService.authenticateSecretKey(liveKeys.secretKey);
    assert.ok(authSecret);
    assert.equal(authSecret.organizationId, orgId);
    assert.equal(authSecret.mode, 'live');

    // C. Authenticate with public key
    const authPublic = ApiKeyService.authenticatePublicKey(liveKeys.publicKey);
    assert.ok(authPublic);
    assert.equal(authPublic.organizationId, orgId);

    // D. Multi-tenant isolation: Organization 2 should not have these keys
    const org2Keys = ApiKeyService.listKeys(orgId2);
    assert.equal(org2Keys.length, 0);

    // E. Revoke key
    const revoked = ApiKeyService.revokeKey(orgId, liveKeys.keyId);
    assert.ok(revoked);
    const authAfterRevoke = ApiKeyService.authenticateSecretKey(liveKeys.secretKey);
    assert.equal(authAfterRevoke, null);
  });

  test('2. Checkout Session: Creation, Public Details, and Expiry', () => {
    const session = CheckoutService.createSession(orgId, {
      orderId: 'ORD-9901',
      amount: 350.50, // 350.50 EGP = 35050 piastres
      customerName: 'محمود أحمد',
      customerPhone: '01099887766',
      customerEmail: 'mahmoud@example.com',
      returnUrl: 'https://store.example.com/thank-you',
      expiresInMinutes: 15,
    });

    assert.equal(session.orderId, 'ORD-9901');
    assert.equal(session.amountMinor, 35050);
    assert.equal(session.amount, 350.50);
    assert.equal(session.status, 'pending');
    assert.match(session.checkoutUrl, /^\/pay\/cs_live_/);

    // Fetch public session details (for hosted checkout screen)
    const publicData = CheckoutService.getSession(session.id);
    assert.ok(publicData);
    assert.equal(publicData.merchantNameAr, 'متجر أزياء القاهرة');
    assert.equal(publicData.rails.length, 1);
    assert.equal(publicData.rails[0].walletNumber, '01012345678');
    assert.equal(publicData.rails[0].provider, 'vodafone_cash');

    // Status polling
    const status = CheckoutService.getSessionStatus(session.id);
    assert.ok(status);
    assert.equal(status.status, 'pending');
    assert.equal(status.returnUrl, 'https://store.example.com/thank-you');
  });

  test('3. Autonomous Payment Matching & Webhook Dispatch: Inbound Transaction confirms Session', () => {
    // Create an open checkout session for 250.00 EGP
    const session = CheckoutService.createSession(orgId, {
      orderId: 'WC-4412',
      amount: 250.00,
      customerName: 'كريم سامي',
      customerPhone: '01011223344',
      returnUrl: 'https://store.example.com/order-received/4412',
    });
    assert.equal(session.status, 'pending');

    // Simulate an inbound Vodafone Cash SMS captured by the phone
    const inbound = ReconciliationService.processInboundTransaction({
      organizationId: orgId,
      deviceId: 'dev_vf_pos',
      paymentSourceId: 'src_vf_fashion',
      rawEventId: 'raw_evt_test_01',
      adapterType: 'macrodroid',
      boundPaymentAddress: '01012345678',
      parsed: {
        provider: 'vodafone_cash',
        amount: 250.00,
        currency: 'EGP',
        externalTrxId: 'VF987654321',
        senderPhone: '01011223344',
        senderName: 'كريم سامي',
        statedBalance: 100000 / 100 + 250.00,
        confidenceScore: 0.98,
        isFinancialTransaction: true,
        messageCategory: 'inbound_credit',
      },
      signature: 'sig_test_valid',
      independentSettlementEvidence: true,
      financialEventAt: new Date().toISOString(),
    });

    assert.equal(inbound.status, 'confirmed');

    // Verify the checkout session was automatically matched and confirmed!
    const updatedSession = CheckoutService.getSession(session.id);
    assert.ok(updatedSession);
    assert.equal(updatedSession.status, 'confirmed');
    assert.equal(updatedSession.matchedTransactionId, inbound.transactionId);
    assert.ok(updatedSession.confirmedAt);

    // Verify webhook job was enqueued in outbox_jobs for the merchant
    const webhookJob = db.prepare(`
      SELECT * FROM outbox_jobs
      WHERE organization_id = ? AND job_type = 'dispatch_webhook' AND id = ?
    `).get(orgId, `job_checkout_${session.id}`) as any;

    assert.ok(webhookJob, 'Expected outbox webhook job for checkout confirmation');
    const payload = JSON.parse(webhookJob.payload);
    assert.equal(payload.event, 'payment.confirmed');
    assert.equal(payload.order_id, 'WC-4412');
    assert.equal(payload.amount, 250);
    assert.equal(payload.external_trx_id, 'VF987654321');
  });

  test('4. Payment Links: Creation, Listing, Tracking, and Checkout Generation', () => {
    // Create a payment link
    const link = PaymentLinkService.createPaymentLink(orgId, {
      title: 'استشارة تسويقية',
      description: 'جلسة لمدة ساعة',
      amount: 500.00,
      reusable: true,
      redirectUrl: 'https://mywebsite.com/booked',
    });

    assert.match(link.id, /^plink_/);
    assert.equal(link.amount, 500.00);
    assert.equal(link.amountMinor, 50000);
    assert.equal(link.isActive, true);

    // List links
    const list = PaymentLinkService.listPaymentLinks(orgId);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, link.id);

    // Customer opens link and creates a checkout session from it
    const session = CheckoutService.createSession(orgId, {
      amount: link.amount,
      paymentLinkId: link.id,
      customerName: 'سارة خالد',
      customerPhone: '01223344556',
    });

    assert.equal(session.amountMinor, 50000);
    assert.equal(session.paymentLinkId, link.id);

    // Simulate payment confirmation
    CheckoutService.simulateConfirmation(session.id);

    // Verify link statistics were updated
    const updatedLink = PaymentLinkService.getPaymentLink(link.id);
    assert.ok(updatedLink);
    assert.equal(updatedLink.successfulPaymentsCount, 1);
    assert.equal(updatedLink.totalCollectedMinor, 50000);
    assert.equal(updatedLink.totalCollected, 500.00);
  });

  test('5. Sandbox Simulator: Instant Confirmation for Merchant Testing', () => {
    const session = CheckoutService.createSession(orgId, {
      orderId: 'TEST-SIM-1',
      amount: 150.00,
      mode: 'test',
    });
    assert.equal(session.status, 'pending');

    const confirmed = CheckoutService.simulateConfirmation(session.id);
    assert.equal(confirmed.status, 'confirmed');
    assert.ok(confirmed.matchedTransactionId);

    const status = CheckoutService.getSessionStatus(session.id);
    assert.ok(status);
    assert.equal(status.status, 'confirmed');
  });
});
