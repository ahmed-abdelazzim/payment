import test from 'node:test';
import assert from 'node:assert';
import { initTestDatabase } from '../server/db';

test('Database integrity: device, event, source, and transaction cannot cross tenant boundaries', () => {
  const db = initTestDatabase();

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES ('org_integrity_a', 'Tenant A', 'ألف', 'integrity-a')`).run();
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES ('org_integrity_b', 'Tenant B', 'باء', 'integrity-b')`).run();
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name) VALUES ('acc_integrity_a', 'org_integrity_a', 'A account')`).run();
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name) VALUES ('acc_integrity_b', 'org_integrity_b', 'B account')`).run();

  db.prepare(`
    INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit_minor, monthly_turnover_limit_minor)
    VALUES ('src_integrity_a', 'org_integrity_a', 'acc_integrity_a', 'instapay', 'A source', '01550000001', 6000000, 20000000)
  `).run();

  assert.throws(() => {
    db.prepare(`
      INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit_minor, monthly_turnover_limit_minor)
      VALUES ('src_integrity_bad', 'org_integrity_b', 'acc_integrity_a', 'instapay', 'Bad source', '01550000002', 6000000, 20000000)
    `).run();
  }, /payment source balance account must belong to its organization/);

  db.prepare(`
    INSERT INTO devices (id, organization_id, payment_source_id, device_number, friendly_name, adapter_type)
    VALUES ('dev_integrity_a', 'org_integrity_a', 'src_integrity_a', 'A-device', 'A device', 'native_agent')
  `).run();

  assert.throws(() => {
    db.prepare(`
      INSERT INTO devices (id, organization_id, payment_source_id, device_number, friendly_name, adapter_type)
      VALUES ('dev_integrity_bad', 'org_integrity_b', 'src_integrity_a', 'Bad-device', 'Bad device', 'native_agent')
    `).run();
  }, /device payment source must belong to its organization/);

  assert.throws(() => {
    db.prepare(`
      INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload)
      VALUES ('raw_integrity_bad', 'org_integrity_b', 'dev_integrity_a', 'native_agent', 'cross-tenant-event', datetime('now'), '{}')
    `).run();
  }, /raw event device must belong to its organization/);

  assert.throws(() => {
    db.prepare(`
      INSERT INTO transactions (
        id, organization_id, balance_account_id, payment_source_id, external_trx_id, provider, amount_minor,
        status, reconciliation_state, provenance_confidence, financial_event_at
      ) VALUES (
        'tx_integrity_bad', 'org_integrity_b', 'acc_integrity_b', 'src_integrity_a', 'cross-tenant-tx', 'instapay', 10000,
        'review_required', 'gap_detected', 0, datetime('now')
      )
    `).run();
  }, /transaction source and balance account must belong to its organization/);
});
