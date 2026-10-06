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
