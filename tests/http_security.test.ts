import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { AddressInfo } from 'node:net';
import { apiRouter } from '../server/routes';
import { initTestDatabase, setDatabase } from '../server/db';
import { hashOpaqueToken } from '../server/middleware/auth';

async function startSecurityApi() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRouter);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('HTTP security: cookie-only auth, same-origin mutations, retired webhook, and viewer RBAC', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  const db = initTestDatabase();
  setDatabase(db);
  const sessionToken = 'sess_http_security_cookie_only';
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES ('org_http_security', 'HTTP Security', 'أمان HTTP', 'http-security')`).run();
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES ('usr_http_viewer', 'viewer@example.test', 'hash', 'Viewer', 1)`).run();
  db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ('mem_http_viewer', 'org_http_security', 'usr_http_viewer', 'viewer')`).run();
  db.prepare(`INSERT INTO sessions (token, user_id, organization_id, expires_at) VALUES (?, 'usr_http_viewer', 'org_http_security', ?)`)
    .run(hashOpaqueToken(sessionToken), expiresAt);

  const api = await startSecurityApi();
  try {
    const bearerOnly = await fetch(`${api.baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(bearerOnly.status, 401, 'Bearer headers must not authenticate browser sessions');

    const crossOriginMutation = await fetch(`${api.baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' },
    });
    assert.strictEqual(crossOriginMutation.status, 403, 'Cookie mutations must reject an untrusted origin');
    assert.strictEqual((await crossOriginMutation.json()).error, 'CSRF_ORIGIN_MISMATCH');

    const retiredWebhook = await fetch(`${api.baseUrl}/api/v1/devices/webhook-ingest`, {
      method: 'POST',
      headers: { Origin: api.baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'legacy request' }),
    });
    assert.strictEqual(retiredWebhook.status, 410, 'Legacy token/webhook ingestion must stay retired');
    assert.strictEqual((await retiredWebhook.json()).error, 'LEGACY_WEBHOOK_RETIRED');

    const viewerMutation = await fetch(`${api.baseUrl}/api/v1/devices/dev_any/toggle`, {
      method: 'POST',
      headers: {
        Origin: api.baseUrl,
        Cookie: `sarraf_session_token=${sessionToken}`,
      },
    });
    assert.strictEqual(viewerMutation.status, 403, 'Viewers must not toggle device state');
    assert.strictEqual((await viewerMutation.json()).error, 'FORBIDDEN_INSUFFICIENT_ROLE');
  } finally {
    await api.close();
    setDatabase(null);
    process.env.NODE_ENV = previousNodeEnv;
  }
});
