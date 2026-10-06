import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, initTestDatabase, setDatabase } from '../server/db';
import { GoogleSheetsService } from '../server/services/googleSheetsService';

test('Google Sheets 1: Connect, Fetch Status, and Disconnect Workflow', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_test_sheets_1';
  db.prepare(`
    INSERT INTO organizations (id, name, name_ar, slug)
    VALUES (?, 'Test Merchant', 'تاجر تجريبي', 'test-merchant')
  `).run(orgId);

  // Initial status should be disconnected
  const initial = GoogleSheetsService.getStatus(orgId);
  assert.equal(initial.sheetUrl, null);
  assert.equal(initial.sheetName, null);
  assert.equal(initial.syncedCount, 0);

  // Connect a Google Sheet
  const testUrl = 'https://script.google.com/macros/s/AKfycbx_TEST_MOCK_SCRIPT_ID/exec';
  const connected = GoogleSheetsService.connectSheet(orgId, testUrl, 'شيت المبيعات اليومية');
  assert.equal(connected.sheetUrl, testUrl);
  assert.equal(connected.sheetName, 'شيت المبيعات اليومية');
  assert.ok(connected.connectedAt);

  // Re-fetch status
  const fetched = GoogleSheetsService.getStatus(orgId);
  assert.equal(fetched.sheetUrl, testUrl);
  assert.equal(fetched.sheetName, 'شيت المبيعات اليومية');

  // Disconnect the sheet
  const disconnected = GoogleSheetsService.disconnectSheet(orgId);
  assert.equal(disconnected, true);

  // Status after disconnect
  const afterDisconnect = GoogleSheetsService.getStatus(orgId);
  assert.equal(afterDisconnect.sheetUrl, null);
  assert.equal(afterDisconnect.sheetName, null);
  assert.equal(afterDisconnect.connectedAt, null);
});

test('Google Sheets 2: Reject Invalid Webhook URLs', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_test_sheets_2';
  db.prepare(`
    INSERT INTO organizations (id, name, name_ar, slug)
    VALUES (?, 'Test Merchant 2', 'تاجر تجريبي 2', 'test-merchant-2')
  `).run(orgId);

  assert.throws(() => {
    GoogleSheetsService.connectSheet(orgId, 'javascript:alert(1)');
  }, /INVALID_URL/);

  assert.throws(() => {
    GoogleSheetsService.connectSheet(orgId, 'ftp://invalid-url.com');
  }, /INVALID_URL/);
});

test('Google Sheets 3: Connect Directly via Standard Google Sheets Document URL', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_test_sheets_3';
  db.prepare(`
    INSERT INTO organizations (id, name, name_ar, slug)
    VALUES (?, 'Test Merchant 3', 'تاجر تجريبي 3', 'test-merchant-3')
  `).run(orgId);

  const docUrl = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0';
  const connected = GoogleSheetsService.connectSheet(orgId, docUrl, 'مبيعات فودافون كاش');

  assert.equal(connected.authType, 'oauth');
  assert.equal(connected.spreadsheetId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  assert.equal(connected.sheetUrl, 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit');
  assert.equal(connected.sheetName, 'مبيعات فودافون كاش');

  // Verify stored in DB
  const row = db.prepare('SELECT google_spreadsheet_id, google_auth_type FROM organizations WHERE id = ?').get(orgId) as any;
  assert.equal(row.google_spreadsheet_id, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  assert.equal(row.google_auth_type, 'oauth');
});

test('Google Sheets 4: Platform OAuth Credentials Configuration and Auth URL Generation', () => {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = 'org_test_sheets_4';
  db.prepare(`
    INSERT INTO organizations (id, name, name_ar, slug)
    VALUES (?, 'Test Merchant 4', 'تاجر تجريبي 4', 'test-merchant-4')
  `).run(orgId);

  // Before configuring credentials
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  db.prepare('UPDATE platform_settings SET google_client_id = NULL, google_client_secret = NULL WHERE id = ?').run('current');

  const unconfigured = GoogleSheetsService.getOAuthAuthUrl(orgId, 'http://localhost:3000/api/v1/integrations/google/callback');
  assert.equal(unconfigured.isConfigured, false);
  assert.equal(unconfigured.authUrl, null);

  // Update credentials
  GoogleSheetsService.updatePlatformGoogleCredentials(
    'test-client-id-12345.apps.googleusercontent.com',
    'test-client-secret-67890'
  );

  const configured = GoogleSheetsService.getOAuthAuthUrl(orgId, 'http://localhost:3000/api/v1/integrations/google/callback');
  assert.equal(configured.isConfigured, true);
  assert.ok(configured.authUrl);
  assert.ok(configured.authUrl.includes('test-client-id-12345.apps.googleusercontent.com'));
  assert.ok(configured.authUrl.includes('accounts.google.com/o/oauth2/v2/auth'));
  assert.ok(configured.authUrl.includes(encodeURIComponent(orgId)));
});

