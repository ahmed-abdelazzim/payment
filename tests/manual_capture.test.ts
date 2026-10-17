import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { AddressInfo } from 'node:net';
import { apiRouter } from '../server/routes';
import { initTestDatabase, setDatabase } from '../server/db';
import { hashOpaqueToken } from '../server/middleware/auth';
import { SubscriptionService } from '../server/services/subscriptionService';

test('A phone browser can submit a payment message only into its own review queue', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const db = initTestDatabase();
  setDatabase(db);
  db.prepare("INSERT INTO organizations (id, name, name_ar, slug) VALUES ('org_manual_a', 'A', 'أ', 'manual-a'), ('org_manual_b', 'B', 'ب', 'manual-b')").run();
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES ('user_manual', 'owner@manual.test', 'hash', 'Owner', 1)").run();
  db.prepare("INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ('member_manual', 'org_manual_a', 'user_manual', 'owner')").run();
  db.prepare("INSERT INTO balance_accounts (id, organization_id, account_name, current_balance_minor) VALUES ('acc_manual_a', 'org_manual_a', 'A balance', 100000), ('acc_manual_b', 'org_manual_b', 'B balance', 100000)").run();
  db.prepare("INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit_minor, monthly_turnover_limit_minor) VALUES ('source_manual_a', 'org_manual_a', 'acc_manual_a', 'vodafone_cash', 'A wallet', '01000000000', 6000000, 20000000), ('source_manual_b', 'org_manual_b', 'acc_manual_b', 'vodafone_cash', 'B wallet', '01011111111', 6000000, 20000000)").run();
  SubscriptionService.startFreeTrial('org_manual_a');
  const token = 'sess_manual_capture_test';
  db.prepare("INSERT INTO sessions (token, user_id, organization_id, expires_at) VALUES (?, 'user_manual', 'org_manual_a', ?)").run(hashOpaqueToken(token), new Date(Date.now() + 3600000).toISOString());

  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const message = 'تم استلام مبلغ 200 جنيه من 01029182921. رصيد فودافون كاش الحالي 1200 جنيه. رقم العملية: VF-882910';
  const submit = (sourceId: string, cookie = token) => fetch(`${baseUrl}/api/v1/manual-captures`, {
    method: 'POST',
    headers: { Origin: baseUrl, Cookie: `sarraf_session_token=${cookie}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentSourceId: sourceId, rawContent: message }),
  });

  try {
    const anonymous = await submit('source_manual_a', 'invalid');
    assert.equal(anonymous.status, 401);
    const crossTenant = await submit('source_manual_b');
    assert.equal(crossTenant.status, 404);

    const accepted = await submit('source_manual_a');
    assert.equal(accepted.status, 201);
    const payload = await accepted.json() as { status: string; transactionId: string };
    assert.equal(payload.status, 'review_required');
    const transaction = db.prepare('SELECT status, amount_minor, signature, payment_source_id FROM transactions WHERE id = ?').get(payload.transactionId) as any;
    assert.equal(transaction.status, 'review_required');
    assert.equal(transaction.amount_minor, 20000);
    assert.equal(transaction.signature, null);
    assert.equal(transaction.payment_source_id, 'source_manual_a');
    assert.equal((db.prepare("SELECT current_balance_minor FROM balance_accounts WHERE id = 'acc_manual_a'").get() as any).current_balance_minor, 100000);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM devices WHERE organization_id = 'org_manual_a'").get() as any).count, 0);

    const duplicate = await submit('source_manual_a');
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as { status: string }).status, 'duplicate');
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE organization_id = 'org_manual_a'").get() as any).count, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    setDatabase(null);
    process.env.NODE_ENV = previousNodeEnv;
  }
});
