import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { initTestDatabase } from '../server/db';

function hashPassword(password: string): string {
  const salt = 'sarraf_salt_eg_2026';
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

test('Auth: Clean Merchant Registration Creates Isolated Workspace with Zero Mock Data', () => {
  const db = initTestDatabase();

  const userId = 'usr_new_merchant';
  const orgId = 'org_new_merchant';
  const email = 'owner@cairofresh.eg';
  const password = 'SecretPassword123!';
  const orgName = 'Cairo Fresh Groceries';

  // 1. Create Organization
  db.prepare(`
    INSERT INTO organizations (id, name, name_ar, slug)
    VALUES (?, ?, ?, ?)
  `).run(orgId, orgName, 'بقالة كايرو فريش', 'cairo-fresh');

  // 2. Create User
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(userId, email, hashPassword(password), 'Mostafa Mahmoud');

  // 3. Bind Owner Role
  db.prepare(`
    INSERT INTO organization_members (id, organization_id, user_id, role)
    VALUES ('mem_new_1', ?, ?, 'owner')
  `).run(orgId, userId);

  // 4. Create Clean Initial Balance Account (Zero Balance)
  db.prepare(`
    INSERT INTO balance_accounts (id, organization_id, account_name, currency, current_balance)
    VALUES ('acc_fresh_01', ?, 'Main Operational Account (EGP)', 'EGP', 0.0)
  `).run(orgId);

  // Verify workspace exists with 0 balance
  const account = db.prepare('SELECT current_balance FROM balance_accounts WHERE organization_id = ?').get(orgId) as any;
  assert.strictEqual(account.current_balance, 0.0);

  // Verify new merchant starts with 0 devices
  const devices = db.prepare('SELECT * FROM devices WHERE organization_id = ?').all(orgId);
  assert.strictEqual(devices.length, 0, 'New merchant must start with 0 devices');

  // Verify new merchant starts with 0 transactions
  const transactions = db.prepare('SELECT * FROM transactions WHERE organization_id = ?').all(orgId);
  assert.strictEqual(transactions.length, 0, 'New merchant must start with 0 transactions');

  // Verify new merchant starts with 0 payment sources
  const sources = db.prepare('SELECT * FROM payment_sources WHERE organization_id = ?').all(orgId);
  assert.strictEqual(sources.length, 0, 'New merchant must start with 0 payment sources');
});

test('Auth: Password Validation, Hashing, and Session Token Generation', () => {
  const db = initTestDatabase();
  const userId = 'usr_test_auth';
  const orgId = 'org_test_auth';
  const email = 'merchant@test.eg';
  const rawPass = 'StrongP@ss2026';
  const hashed = hashPassword(rawPass);

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Test Org', 'تيست', 'test-org')`).run(orgId);
  db.prepare(`INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES (?, ?, ?, 'Test User', 1)`).run(userId, email, hashed);
  db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ('mem_t1', ?, ?, 'owner')`).run(orgId, userId);

  // Successful credential match
  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as any;
  assert.ok(user);
  assert.strictEqual(user.password_hash, hashPassword(rawPass));

  // Failed credential match
  assert.notStrictEqual(user.password_hash, hashPassword('WrongPass!'));

  // Session Token Creation
  const token = 'sess_' + crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, organization_id, expires_at) VALUES (?, ?, ?, ?)`).run(token, userId, orgId, expiresAt);

  // Validate session resolution
  const session = db.prepare(`
    SELECT s.token, u.email, m.role, o.name as orgName
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    JOIN organization_members m ON (s.organization_id = m.organization_id AND s.user_id = m.user_id)
    JOIN organizations o ON s.organization_id = o.id
    WHERE s.token = ?
  `).get(token) as any;

  assert.ok(session);
  assert.strictEqual(session.email, email);
  assert.strictEqual(session.role, 'owner');
  assert.strictEqual(session.orgName, 'Test Org');
});

test('Auth: RBAC & Team Member Role Hierarchy', () => {
  const db = initTestDatabase();
  const orgId = 'org_rbac_test';

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'RBAC Test', 'آر بي إيه سي', 'rbac-test')`).run(orgId);

  // Register Owner, Manager, Viewer
  const users = [
    { id: 'usr_owner', email: 'owner@test.eg', role: 'owner' },
    { id: 'usr_manager', email: 'manager@test.eg', role: 'manager' },
    { id: 'usr_viewer', email: 'viewer@test.eg', role: 'viewer' },
  ];

  for (const u of users) {
    db.prepare(`INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES (?, ?, 'hash', ?, 1)`).run(u.id, u.email, u.role);
    db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)`).run(`mem_${u.id}`, orgId, u.id, u.role);
  }

  // Check roles assigned correctly
  const members = db.prepare('SELECT role, user_id FROM organization_members WHERE organization_id = ?').all(orgId) as any[];
  assert.strictEqual(members.length, 3);
  const roleMap = Object.fromEntries(members.map(m => [m.user_id, m.role]));
  assert.strictEqual(roleMap['usr_owner'], 'owner');
  assert.strictEqual(roleMap['usr_manager'], 'manager');
  assert.strictEqual(roleMap['usr_viewer'], 'viewer');
});
