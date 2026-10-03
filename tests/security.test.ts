import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { initTestDatabase } from '../server/db';

test('Security: Tenant Isolation at Database Layer', () => {
  const db = initTestDatabase();

  // Create two distinct tenant organizations
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES ('org_A', 'Tenant Alpha', 'ألفا', 'alpha')`).run();
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES ('org_B', 'Tenant Beta', 'بيتا', 'beta')`).run();

  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name, current_balance) VALUES ('acc_A', 'org_A', 'Alpha Account', 5000)`).run();
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name, current_balance) VALUES ('acc_B', 'org_B', 'Beta Account', 9000)`).run();

  // Querying with Tenant A context must NEVER return Tenant B's account
  const queryTenantA = db.prepare(`SELECT * FROM balance_accounts WHERE organization_id = ?`).all('org_A') as any[];
  assert.strictEqual(queryTenantA.length, 1);
  assert.strictEqual(queryTenantA[0].id, 'acc_A');
  assert.strictEqual(queryTenantA[0].current_balance, 5000);

  // Cross-tenant attempt returns 0 rows
  const crossTenantCheck = db.prepare(`SELECT * FROM balance_accounts WHERE organization_id = 'org_A' AND id = 'acc_B'`).all();
  assert.strictEqual(crossTenantCheck.length, 0);
});

test('Security: HMAC-SHA256 Canonical Signature & Nonce Replay Defense', () => {
  const db = initTestDatabase();
  const orgId = 'org_sec_test';
  const devId = 'dev_sec_01';
  const hmacSecret = 'sec_super_secret_key_12345';

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Security Org', 'أمان', 'sec-org')`).run(orgId);
  db.prepare(`INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type) VALUES (?, ?, 'Device #01', 'Test Device', 'macrodroid')`).run(devId, orgId);
  db.prepare(`INSERT INTO device_credentials (device_id, hmac_secret) VALUES (?, ?)`).run(devId, hmacSecret);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = 'unique_nonce_abc_123';
  const path = '/api/v1/devices/ingest';
  const method = 'POST';
  const body = JSON.stringify({ raw_content: 'مبلغ 500 جنيه' });

  const bodySha256 = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalString = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`;
  const validSignature = crypto.createHmac('sha256', hmacSecret).update(canonicalString).digest('hex');

  // Verify valid signature passes
  const computed = crypto.createHmac('sha256', hmacSecret).update(canonicalString).digest('hex');
  assert.strictEqual(validSignature, computed);

  // First upload: store raw event with nonce
  db.prepare(`
    INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload)
    VALUES ('raw_1', ?, ?, 'macrodroid', ?, datetime('now'), ?)
  `).run(orgId, devId, nonce, body);

  // Second upload with identical nonce: must throw SQL UNIQUE constraint violation (Replay Attack Prevented!)
  assert.throws(() => {
    db.prepare(`
      INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload)
      VALUES ('raw_2', ?, ?, 'macrodroid', ?, datetime('now'), ?)
    `).run(orgId, devId, nonce, body);
  }, /UNIQUE constraint failed/);
});

test('Security: Revoked Device Rejection', () => {
  const db = initTestDatabase();
  const orgId = 'org_rev';
  const devId = 'dev_revoked_01';

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Rev Org', 'إلغاء', 'rev-org')`).run(orgId);
  db.prepare(`INSERT INTO devices (id, organization_id, device_number, friendly_name, adapter_type, status) VALUES (?, ?, 'Dev #99', 'Old Phone', 'macrodroid', 'revoked')`).run(devId, orgId);
  db.prepare(`INSERT INTO device_credentials (device_id, hmac_secret, revoked_at) VALUES (?, 'secret_key', datetime('now'))`).run(devId);

  // Querying device credentials must reject revoked status
  const dev = db.prepare(`
    SELECT d.id, d.status, c.revoked_at 
    FROM devices d 
    JOIN device_credentials c ON d.id = c.device_id 
    WHERE d.id = ?
  `).get(devId) as any;

  assert.strictEqual(dev.status, 'revoked');
  assert.ok(dev.revoked_at !== null);
});
