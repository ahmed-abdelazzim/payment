import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { AddressInfo } from 'node:net';
import { apiRouter } from '../server/routes';
import { initTestDatabase, setDatabase } from '../server/db';
import { hashOpaqueToken } from '../server/middleware/auth';
import { SubscriptionService } from '../server/services/subscriptionService';

test('No-code phone link is source-bound, trial-limited, review-only and revocable', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const db = initTestDatabase();
  setDatabase(db);
  db.prepare("INSERT INTO organizations (id, name, name_ar, slug) VALUES ('org_link', 'Link Test', 'تجربة', 'link-test')").run();
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES ('user_link', 'owner@link.test', 'hash', 'Owner', 1)").run();
  db.prepare("INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ('member_link', 'org_link', 'user_link', 'owner')").run();
  db.prepare("INSERT INTO balance_accounts (id, organization_id, account_name, current_balance_minor) VALUES ('acc_link', 'org_link', 'Wallet', 100000)").run();
  db.prepare("INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit_minor, monthly_turnover_limit_minor) VALUES ('source_link', 'org_link', 'acc_link', 'vodafone_cash', 'Wallet', '01000000000', 6000000, 20000000)").run();
  SubscriptionService.startFreeTrial('org_link');
  const sessionToken = 'sess_link_capture_test';
  db.prepare("INSERT INTO sessions (token, user_id, organization_id, expires_at) VALUES (?, 'user_link', 'org_link', ?)").run(hashOpaqueToken(sessionToken), new Date(Date.now() + 3600000).toISOString());

  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const create = () => fetch(`${baseUrl}/api/v1/capture-links`, {
    method: 'POST', headers: { Origin: baseUrl, Cookie: `sarraf_session_token=${sessionToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentSourceId: 'source_link', adapterType: 'apple_shortcuts', friendlyName: 'iPhone receiver' }),
  });
  const send = (token: string, rawContent: string) => fetch(`${baseUrl}/api/v1/capture-links/ingest`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_content: rawContent }),
  });

  try {
    const anonymous = await fetch(`${baseUrl}/api/v1/capture-links`, { method: 'POST', headers: { Origin: baseUrl, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(anonymous.status, 401);

    const created = await create();
    assert.equal(created.status, 201);
    const link = await created.json() as { deviceId: string; token: string };
    assert.match(link.token, /^cap_/);
    assert.equal((db.prepare('SELECT token_hash FROM capture_link_tokens WHERE device_id = ?').get(link.deviceId) as any).token_hash, hashOpaqueToken(link.token));
    assert.equal((await create()).status, 403, 'trial supports one phone');

    const message = 'تم استلام مبلغ 200 جنيه من 01029182921. رصيد فودافون كاش الحالي 1200 جنيه. رقم العملية: VF-LINK-882910';
    assert.equal((await send('cap_invalid', message)).status, 401);
    const received = await send(link.token, message);
    assert.equal(received.status, 201);
    const accepted = await received.json() as { status: string; transactionId: string };
    assert.equal(accepted.status, 'review_required');
    assert.equal((db.prepare('SELECT status FROM transactions WHERE id = ?').get(accepted.transactionId) as any).status, 'review_required');
    assert.equal((db.prepare("SELECT current_balance_minor FROM balance_accounts WHERE id = 'acc_link'").get() as any).current_balance_minor, 100000);
    assert.equal((await send(link.token, message)).status, 200, 'duplicate event cannot create a second payment');

    const revoke = await fetch(`${baseUrl}/api/v1/devices/${link.deviceId}/revoke`, {
      method: 'POST', headers: { Origin: baseUrl, Cookie: `sarraf_session_token=${sessionToken}` },
    });
    assert.equal(revoke.status, 200);
    assert.equal((await send(link.token, message)).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    setDatabase(null);
    process.env.NODE_ENV = previousNodeEnv;
  }
});
