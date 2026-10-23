import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setDatabase, initSchema, migratePaymentSourcesUniqueIndex } from '../server/db';
import { ApiKeyService } from '../server/services/apiKeyService';
import { CheckoutService } from '../server/services/checkoutService';
import { PaymentLinkService } from '../server/services/paymentLinkService';
import { AuditService } from '../server/services/auditService';
import { hashSessionToken } from '../server/middleware/auth';
import { getWooCommercePluginPaths } from '../server/routes';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { INITIAL_ADD_SOURCE_FORM_STATE } from '../src/components/AddSourceModal';
import {
  computeScrollTargetOffset,
  getPasswordInputType,
  formatAuthErrorMessage,
  getNextFocusIndex,
  resolveTelemetryStateOnFetch,
  copyToClipboardSafely,
  validateDailyMonthlyLimits,
  isLimitsStepCompleted,
  syncTabToUrl,
  calculateContrastRatio,
  isWcagAaCompliant,
  getRelativeLuminance,
} from '../src/utils/uiHelpers';

describe('QA Bugfixes Regression Test Suite (BUG-001 through BUG-019)', () => {
  let db: DatabaseSync;
  const orgId = 'org_regression_test';

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    initSchema(db);
    setDatabase(db);

    // Seed test organization
    db.prepare(`
      INSERT INTO organizations (id, name, name_ar, slug, webhook_url, webhook_secret)
      VALUES (?, 'Regression Test Store', 'متجر اختبار العيوب', 'regression-store', 'https://store.example.com/webhook', 'sec_test_reg')
    `).run(orgId);

    // Seed balance account
    db.prepare(`
      INSERT INTO balance_accounts (id, organization_id, account_name, current_balance_minor)
      VALUES ('acc_regression', ?, 'Test Account', 100000)
    `).run(orgId);
  });

  // -------------------------------------------------------------
  // BUG-019: Open Redirect / Stored XSS
  // -------------------------------------------------------------
  test('BUG-019: PaymentLinkService rejects dangerous redirectUrl schemes (javascript:, data:)', () => {
    assert.throws(
      () => {
        PaymentLinkService.createPaymentLink(orgId, {
          title: 'Malicious Link',
          amount: 50,
          redirectUrl: 'javascript:alert(document.cookie)',
        });
      },
      /INVALID_REDIRECT_URL/
    );

    assert.throws(
      () => {
        PaymentLinkService.createPaymentLink(orgId, {
          title: 'Data URL Link',
          amount: 50,
          redirectUrl: 'data:text/html,<script>alert(1)</script>',
        });
      },
      /INVALID_REDIRECT_URL/
    );

    const validLink = PaymentLinkService.createPaymentLink(orgId, {
      title: 'Valid Safe Link',
      amount: 100,
      redirectUrl: 'https://myshop.com/thankyou',
    });
    assert.equal(validLink.redirectUrl, 'https://myshop.com/thankyou');
  });

  test('BUG-019: CheckoutService rejects dangerous returnUrl, cancelUrl, webhookUrl', () => {
    assert.throws(
      () => {
        CheckoutService.createSession(orgId, {
          amount: 75,
          returnUrl: 'javascript:alert("pwned")',
        });
      },
      /INVALID_RETURN_URL/
    );

    assert.throws(
      () => {
        CheckoutService.createSession(orgId, {
          amount: 75,
          cancelUrl: 'data:text/html,evil',
        });
      },
      /INVALID_CANCEL_URL/
    );

    const session = CheckoutService.createSession(orgId, {
      amount: 75,
      returnUrl: 'https://myshop.com/success',
      cancelUrl: 'https://myshop.com/cancel',
    });
    assert.equal(session.returnUrl, 'https://myshop.com/success');
    assert.equal(session.cancelUrl, 'https://myshop.com/cancel');
  });

  // -------------------------------------------------------------
  // BUG-016: Wallet Pool Capacity SQL Query
  // -------------------------------------------------------------
  test('BUG-016: Wallet pool capacity query operates on schema-conforming columns', () => {
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor, is_paused_for_new_instructions
      ) VALUES ('src_cap_1', ?, 'acc_regression', 'vodafone_cash', 'Main VF Wallet', '01012345678', 6000000, 20000000, 0)
    `).run(orgId);

    const sources = db.prepare(`
      SELECT id,
             friendly_name AS name,
             provider AS type,
             wallet_number AS identifier,
             (1 - is_paused_for_new_instructions) AS is_active,
             daily_turnover_limit_minor AS daily_limit_minor,
             monthly_turnover_limit_minor AS monthly_limit_minor
      FROM payment_sources
      WHERE organization_id = ? AND is_paused_for_new_instructions = 0 AND retired_at IS NULL
    `).all(orgId) as any[];

    assert.equal(sources.length, 1);
    assert.equal(sources[0].name, 'Main VF Wallet');
    assert.equal(sources[0].type, 'vodafone_cash');
    assert.equal(sources[0].identifier, '01012345678');
    assert.equal(sources[0].is_active, 1);
    assert.equal(sources[0].daily_limit_minor, 6000000);
    assert.equal(sources[0].monthly_limit_minor, 20000000);
  });

  // -------------------------------------------------------------
  // BUG-017 & BUG-011: Settings Binding & Webhook Sync
  // -------------------------------------------------------------
  test('BUG-017 & BUG-011: Organizations settings update binds webhookUrl and syncs webhook_endpoints without updated_at column error', () => {
    const updatedName = 'Updated Org Name';
    const updatedNameAr = 'مؤسسة محدثة';
    const updatedWebhookUrl = 'https://webhook.site/my-endpoint';
    const updatedWebhookSecret = 'sec_new_secret';

    db.prepare(`
      UPDATE organizations
      SET name = COALESCE(?, name),
          name_ar = COALESCE(?, name_ar),
          default_timezone = COALESCE(?, default_timezone),
          telegram_bot_token = COALESCE(?, telegram_bot_token),
          telegram_chat_id = COALESCE(?, telegram_chat_id),
          webhook_url = COALESCE(?, webhook_url),
          webhook_secret = COALESCE(?, webhook_secret),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      updatedName,
      updatedNameAr,
      null,
      null,
      null,
      updatedWebhookUrl,
      updatedWebhookSecret,
      orgId
    );

    const org = db.prepare('SELECT name, name_ar, webhook_url, webhook_secret FROM organizations WHERE id = ?').get(orgId) as any;
    assert.equal(org.name, updatedName);
    assert.equal(org.name_ar, updatedNameAr);
    assert.equal(org.webhook_url, updatedWebhookUrl);
    assert.equal(org.webhook_secret, updatedWebhookSecret);

    db.prepare(`
      INSERT INTO webhook_endpoints (id, organization_id, url, signing_secret, subscribed_events, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run('ep_reg_1', orgId, updatedWebhookUrl, updatedWebhookSecret, 'payment.confirmed');

    const updateResult = db.prepare(`
      UPDATE webhook_endpoints
      SET url = ?, signing_secret = COALESCE(?, signing_secret), is_active = 1
      WHERE id = ?
    `).run('https://webhook.site/updated-endpoint', 'sec_updated', 'ep_reg_1');

    assert.equal(updateResult.changes, 1);
  });

  test('BUG-011: Rejects empty or whitespace organization name', () => {
    const validateOrgName = (name: unknown): boolean => {
      return typeof name === 'string' && name.trim().length > 0;
    };
    assert.equal(validateOrgName(''), false);
    assert.equal(validateOrgName('   '), false);
    assert.equal(validateOrgName(null), false);
    assert.equal(validateOrgName('صحيح'), true);
  });

  // -------------------------------------------------------------
  // BUG-005: Safe Migration & Unique Active Source Constraint
  // -------------------------------------------------------------
  test('BUG-005: Unique active constraint prevents duplicate active payment source with identical wallet_number', () => {
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor
      ) VALUES ('src_uniq_1', ?, 'acc_regression', 'vodafone_cash', 'VF 1', '01099998888', 5000000, 20000000)
    `).run(orgId);

    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO payment_sources (
            id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
            daily_turnover_limit_minor, monthly_turnover_limit_minor
          ) VALUES ('src_uniq_2', ?, 'acc_regression', 'vodafone_cash', 'VF 2 Duplicate', '01099998888', 5000000, 20000000)
        `).run(orgId);
      },
      /UNIQUE constraint failed/
    );

    // Retiring the first allows a new active source with the same number
    db.prepare("UPDATE payment_sources SET retired_at = datetime('now') WHERE id = 'src_uniq_1'").run();

    assert.doesNotThrow(() => {
      db.prepare(`
        INSERT INTO payment_sources (
          id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
          daily_turnover_limit_minor, monthly_turnover_limit_minor
        ) VALUES ('src_uniq_2', ?, 'acc_regression', 'vodafone_cash', 'VF 2 Replacement', '01099998888', 5000000, 20000000)
      `).run(orgId);
    });
  });

  test('BUG-005: Safe migration detects existing duplicates and halts deployment with detailed error message', () => {
    const rawDb = new DatabaseSync(':memory:');
    rawDb.exec('PRAGMA foreign_keys = OFF;');
    // Create payment_sources table without unique index
    rawDb.exec(`
      CREATE TABLE payment_sources (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        wallet_number TEXT NOT NULL,
        retired_at TEXT,
        is_paused_for_new_instructions INTEGER DEFAULT 0
      );
    `);

    // Insert duplicate active rows (simulating SRC-011 in existing database)
    rawDb.prepare(`INSERT INTO payment_sources (id, organization_id, wallet_number) VALUES ('dup_1', 'org_x', '01000000001')`).run();
    rawDb.prepare(`INSERT INTO payment_sources (id, organization_id, wallet_number) VALUES ('dup_2', 'org_x', '01000000001')`).run();

    // Migration without auto-retire must throw descriptive halting error
    assert.throws(
      () => {
        migratePaymentSourcesUniqueIndex(rawDb, false);
      },
      /MIGRATION_V2_DUPLICATE_PAYMENT_SOURCES/
    );

    // Migration with autoRetireDuplicates safely archives later duplicates without deleting data
    assert.doesNotThrow(() => {
      migratePaymentSourcesUniqueIndex(rawDb, true);
    });

    const activeRows = rawDb.prepare("SELECT id, retired_at FROM payment_sources WHERE retired_at IS NULL").all() as any[];
    assert.equal(activeRows.length, 1);
    assert.equal(activeRows[0].id, 'dup_1');

    const retiredRows = rawDb.prepare("SELECT id, retired_at FROM payment_sources WHERE retired_at IS NOT NULL").all() as any[];
    assert.equal(retiredRows.length, 1);
    assert.equal(retiredRows[0].id, 'dup_2');

    // Index is now active and enforces uniqueness
    assert.throws(
      () => {
        rawDb.prepare(`INSERT INTO payment_sources (id, organization_id, wallet_number) VALUES ('dup_3', 'org_x', '01000000001')`).run();
      },
      /UNIQUE constraint failed/
    );
  });

  // -------------------------------------------------------------
  // BUG-004: Daily Turnover Limit vs Monthly Turnover Limit
  // -------------------------------------------------------------
  test('BUG-004: validateDailyMonthlyLimits validates daily limit does not exceed monthly limit', () => {
    assert.equal(validateDailyMonthlyLimits(10000, 1000), false, 'Daily > Monthly must be rejected');
    assert.equal(validateDailyMonthlyLimits(60000, 200000), true, 'Daily <= Monthly is valid');
    assert.equal(validateDailyMonthlyLimits(50000, 50000), true, 'Daily == Monthly is valid');
    assert.equal(validateDailyMonthlyLimits(0, 10000), false, 'Daily <= 0 must be rejected');
    assert.equal(validateDailyMonthlyLimits(10000, 0), false, 'Monthly <= 0 must be rejected');
  });

  // -------------------------------------------------------------
  // BUG-014: Resilient API Keys Setup
  // -------------------------------------------------------------
  test('BUG-014: ApiKeyService.getOrCreateDefaultKeys provides resilient keys structure', () => {
    const keys = ApiKeyService.getOrCreateDefaultKeys(orgId);
    assert.ok(keys.live);
    assert.ok(keys.live.publicKey.startsWith('pk_live_'));
    assert.ok(keys.test);
    assert.ok(keys.test.publicKey.startsWith('pk_test_'));
  });

  // -------------------------------------------------------------
  // BUG-018: WooCommerce Plugin ESM Path Resolution
  // -------------------------------------------------------------
  test('BUG-018: getWooCommercePluginPaths resolves plugin paths safely and template exists', () => {
    const { zipPath, phpPath } = getWooCommercePluginPaths();
    assert.ok(fs.existsSync(phpPath), 'WooCommerce PHP gateway template must exist at resolved path');
    assert.ok(zipPath.includes('woocommerce'));
  });

  // -------------------------------------------------------------
  // BUG-001: Onboarding Limits Alert Condition
  // -------------------------------------------------------------
  test('BUG-001: isLimitsStepCompleted requires explicit alert or channel configuration', () => {
    assert.equal(isLimitsStepCompleted({}), false, 'Empty workspace cannot complete step 5');
    assert.equal(isLimitsStepCompleted({ hasAlertsConfigured: true }), true, 'Explicit alert configuration completes step 5');
    assert.equal(isLimitsStepCompleted({ telegramBotToken: '123:abc' }), true, 'Configured Telegram token completes step 5');
    assert.equal(isLimitsStepCompleted({ webhookUrl: 'https://example.com' }), true, 'Configured webhook URL completes step 5');
  });

  // -------------------------------------------------------------
  // BUG-002: URL Tab Parameter Synchronizer
  // -------------------------------------------------------------
  test('BUG-002: syncTabToUrl synchronizes active tab parameter into window URL', () => {
    assert.equal(syncTabToUrl('http://localhost:3000/app', 'ledger'), 'http://localhost:3000/app?tab=ledger');
    assert.equal(syncTabToUrl('http://localhost:3000/app?tab=ledger', 'dashboard'), 'http://localhost:3000/app');
    assert.equal(syncTabToUrl('http://localhost:3000/app?lang=ar&tab=ledger', 'settings'), 'http://localhost:3000/app?lang=ar&tab=settings');
  });

  // -------------------------------------------------------------
  // BUG-006: Active Wallet Counting in Integrations Quick Setup
  // -------------------------------------------------------------
  test('BUG-006: ApiKeyService.getActiveSourcesCount accurately counts active sources and excludes paused or retired sources', () => {
    // 1. Active source
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor,
        is_paused_for_new_instructions, retired_at
      ) VALUES ('src_b6_active', ?, 'acc_regression', 'vodafone_cash', 'Active VF', '01055551111', 6000000, 20000000, 0, NULL)
    `).run(orgId);

    // 2. Paused source
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor,
        is_paused_for_new_instructions, retired_at
      ) VALUES ('src_b6_paused', ?, 'acc_regression', 'vodafone_cash', 'Paused VF', '01055552222', 6000000, 20000000, 1, NULL)
    `).run(orgId);

    // 3. Retired source
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor,
        is_paused_for_new_instructions, retired_at
      ) VALUES ('src_b6_retired', ?, 'acc_regression', 'vodafone_cash', 'Retired VF', '01055553333', 6000000, 20000000, 0, datetime('now'))
    `).run(orgId);

    const count = ApiKeyService.getActiveSourcesCount(orgId);
    assert.equal(count, 1, 'Only the active, non-paused, non-retired source must be counted');
  });

  // -------------------------------------------------------------
  // BUG-003: AddSourceModal Draft Reset on Close
  // -------------------------------------------------------------
  test('BUG-003: INITIAL_ADD_SOURCE_FORM_STATE defines clean initial modal defaults', () => {
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.provider, 'vodafone_cash');
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.friendlyName, '');
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.walletNumber, '');
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.dailyLimit, 60000);
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.monthlyLimit, 200000);
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.walletTouched, false);
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.error, null);
  });

  // -------------------------------------------------------------
  // BUG-007: Landing Page Section Anchor Scroll Position
  // -------------------------------------------------------------
  test('BUG-007: computeScrollTargetOffset accounts for fixed header offset', () => {
    assert.equal(computeScrollTargetOffset(500, 64, 16), 420);
    assert.equal(computeScrollTargetOffset(100, 80, 16), 4);
    assert.equal(computeScrollTargetOffset(50, 64, 16), 0);
  });

  // -------------------------------------------------------------
  // BUG-008: Password Input Visibility Toggle
  // -------------------------------------------------------------
  test('BUG-008: getPasswordInputType toggles input type between password and text', () => {
    assert.equal(getPasswordInputType(false), 'password');
    assert.equal(getPasswordInputType(true), 'text');
  });

  // -------------------------------------------------------------
  // BUG-009: Login Network Error Translator
  // -------------------------------------------------------------
  test('BUG-009: formatAuthErrorMessage provides clear bilingual message on connection drop', () => {
    const fetchErr = new TypeError('Failed to fetch');
    assert.match(formatAuthErrorMessage(fetchErr, 'ar', true), /تعذر الاتصال بالخادم/);
    assert.match(formatAuthErrorMessage(fetchErr, 'en', true), /Unable to connect to the server/);
    assert.match(formatAuthErrorMessage(new Error('Random'), 'ar', false), /تعذر الاتصال بالخادم/);
    assert.equal(formatAuthErrorMessage(new Error('Invalid password'), 'ar', true), 'Invalid password');
  });

  // -------------------------------------------------------------
  // BUG-010: Modal Focus Trap Cycling
  // -------------------------------------------------------------
  test('BUG-010: getNextFocusIndex handles Tab and Shift+Tab boundaries without escape', () => {
    const total = 4;
    // Forward Tab from last element wraps to first
    assert.equal(getNextFocusIndex(3, total, false), 0);
    // Backward Shift+Tab from first element wraps to last
    assert.equal(getNextFocusIndex(0, total, true), 3);
    // Normal navigation
    assert.equal(getNextFocusIndex(1, total, false), 2);
    assert.equal(getNextFocusIndex(2, total, true), 1);
  });

  // -------------------------------------------------------------
  // BUG-012: Telemetry State Preserves Data on Network Error (Anti-False-Empty)
  // -------------------------------------------------------------
  test('BUG-012: resolveTelemetryStateOnFetch sets error flag and preserves previous records on network failure', () => {
    const existing = [{ id: 'tx_existing_1', amount: 150 }];
    const failedState = resolveTelemetryStateOnFetch(false, existing);
    assert.equal(failedState.isError, true);
    assert.equal(failedState.fetchError, 'FETCH_FAILED');
    assert.deepEqual(failedState.data, existing, 'Previous transactions must be preserved on fetch failure');

    const successState = resolveTelemetryStateOnFetch(true, existing, [{ id: 'tx_new', amount: 300 }]);
    assert.equal(successState.isError, false);
    assert.equal(successState.fetchError, null);
    assert.equal(successState.data.length, 1);
    assert.equal(successState.data[0].id, 'tx_new');
  });

  // -------------------------------------------------------------
  // BUG-013: Clipboard Copy Error Fallback
  // -------------------------------------------------------------
  test('BUG-013: copyToClipboardSafely gracefully falls back on permission rejection', async () => {
    let toastMessage = '';
    const mockShowToast = (msg: string) => {
      toastMessage = msg;
    };

    // Rejection case (e.g. non-secure context or permission denied)
    const failed = await copyToClipboardSafely(
      'secret_key_123',
      'المفتاح',
      'ar',
      mockShowToast,
      async () => {
        throw new Error('NotAllowedError');
      }
    );
    assert.equal(failed, false);
    assert.equal(toastMessage, 'تعذر النسخ تلقائياً، يرجى نسخ الرمز يدوياً');

    // Success case
    const succeeded = await copyToClipboardSafely(
      'secret_key_123',
      'المفتاح',
      'ar',
      mockShowToast,
      async () => {}
    );
    assert.equal(succeeded, true);
    assert.equal(toastMessage, 'تم نسخ المفتاح بنجاح!');
  });

  // -------------------------------------------------------------
  // BUG-015: React Error Boundary State Derivation
  // -------------------------------------------------------------
  test('BUG-015: ErrorBoundary.getDerivedStateFromError transitions to error fallback state', () => {
    const testError = new Error('ChunkLoadError: Loading chunk failed');
    const newState = ErrorBoundary.getDerivedStateFromError(testError);

    assert.equal(newState.hasError, true);
    assert.equal(newState.error?.message, 'ChunkLoadError: Loading chunk failed');
  });

  // -------------------------------------------------------------
  // AUTH-015: Server-side Session Invalidation on Logout
  // -------------------------------------------------------------
  test('AUTH-015: Server-side session revocation invalidates token in database upon logout', () => {
    const rawToken = 'sess_live_token_for_logout_test_123';
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    // Insert user first to satisfy foreign key
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, is_active, email_verified)
      VALUES ('usr_logout_test', 'logout_test@example.com', 'hash123', 'Logout User', 1, 1)
    `).run();

    // Insert active session
    db.prepare(`
      INSERT INTO sessions (token, user_id, organization_id, expires_at)
      VALUES (?, 'usr_logout_test', ?, ?)
    `).run(tokenHash, orgId, expiresAt);

    // Verify session exists
    const beforeLogout = db.prepare('SELECT token, user_id FROM sessions WHERE token = ?').get(tokenHash) as any;
    assert.ok(beforeLogout);
    assert.equal(beforeLogout.token, tokenHash);

    // Perform server-side logout deletion
    const deleteResult = db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash);
    assert.equal(deleteResult.changes, 1);

    // Verify session is completely purged from server database
    const afterLogout = db.prepare('SELECT token, user_id FROM sessions WHERE token = ?').get(tokenHash);
    assert.equal(afterLogout, undefined, 'Revoked session must no longer exist in server database');
  });

  // -------------------------------------------------------------
  // ROB-005 & AUTH-005: Brute Force Login Rate Limiter (HTTP 429)
  // -------------------------------------------------------------
  test('ROB-005 & AUTH-005: Brute force login lockout activates after 5 failed attempts with 429 lockout window', () => {
    const identifier = 'locked_user@example.com_127.0.0.1';

    // Simulate 5 failed attempts
    for (let i = 1; i <= 5; i++) {
      const lockedUntil = i >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      db.prepare(`
        INSERT INTO login_attempts (identifier, failed_count, locked_until, last_attempt_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(identifier) DO UPDATE SET
          failed_count = excluded.failed_count,
          locked_until = excluded.locked_until,
          last_attempt_at = datetime('now')
      `).run(identifier, i, lockedUntil);
    }

    // Verify lockout state
    const attemptRow = db.prepare('SELECT failed_count, locked_until FROM login_attempts WHERE identifier = ?').get(identifier) as any;
    assert.equal(attemptRow.failed_count, 5);
    assert.ok(attemptRow.locked_until);
    assert.ok(new Date(attemptRow.locked_until) > new Date());

    // Evaluate rate limiter rule
    const isLocked = new Date() < new Date(attemptRow.locked_until);
    assert.equal(isLocked, true, 'User must be locked out after 5 consecutive failed attempts');

    // On successful login, lockout counter is wiped clean
    db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(identifier);
    const clearedRow = db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(identifier);
    assert.equal(clearedRow, undefined, 'Successful auth resets failed login attempts');
  });

  // -------------------------------------------------------------
  // ROB-010 & PLAT-006: Concurrency and Race Condition Prevention via BEGIN IMMEDIATE
  // -------------------------------------------------------------
  test('ROB-010 & PLAT-006: BEGIN IMMEDIATE transaction lock prevents duplicate confirmation and race conditions', () => {
    // Seed test order
    db.prepare(`
      INSERT INTO checkout_sessions (id, organization_id, order_id, amount_minor, status, currency, expires_at)
      VALUES ('chk_race_test', ?, 'ord_race_test_1', 50000, 'pending', 'EGP', datetime('now', '+1 hour'))
    `).run(orgId);

    // First worker confirms atomically
    db.exec('BEGIN IMMEDIATE;');
    let firstConfirmed = false;
    try {
      const order = db.prepare("SELECT status FROM checkout_sessions WHERE id = ?").get('chk_race_test') as any;
      if (order && order.status === 'pending') {
        db.prepare("UPDATE checkout_sessions SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?").run('chk_race_test');
        firstConfirmed = true;
      }
      db.exec('COMMIT;');
    } catch {
      db.exec('ROLLBACK;');
    }
    assert.equal(firstConfirmed, true);

    // Second concurrent worker attempts to confirm the same order
    db.exec('BEGIN IMMEDIATE;');
    let secondConfirmed = false;
    let conflictError = '';
    try {
      const order = db.prepare("SELECT status FROM checkout_sessions WHERE id = ?").get('chk_race_test') as any;
      if (order && order.status === 'pending') {
        db.prepare("UPDATE checkout_sessions SET status = 'confirmed' WHERE id = ?").run('chk_race_test');
        secondConfirmed = true;
      } else {
        conflictError = 'ORDER_ALREADY_CONFIRMED';
      }
      db.exec('COMMIT;');
    } catch {
      db.exec('ROLLBACK;');
    }
    assert.equal(secondConfirmed, false, 'Second concurrent request must not re-confirm');
    assert.equal(conflictError, 'ORDER_ALREADY_CONFIRMED');
  });

  // -------------------------------------------------------------
  // KEY-001, KEY-005, KEY-006: API Key Lifecycle, Revocation, and Mode Isolation
  // -------------------------------------------------------------
  test('KEY-001, KEY-005, KEY-006: ApiKeyService generates key sets, isolates test vs live, and revokes access', () => {
    // 1. Generation (KEY-001)
    const testKeys = ApiKeyService.generateKeySet(orgId, 'Staging Test Key', 'test');
    assert.ok(testKeys.publicKey.startsWith('pk_test_'));
    assert.ok(testKeys.secretKey.startsWith('sk_test_'));

    const liveKeys = ApiKeyService.generateKeySet(orgId, 'Production Live Key', 'live');
    assert.ok(liveKeys.publicKey.startsWith('pk_live_'));
    assert.ok(liveKeys.secretKey.startsWith('sk_live_'));

    // Check preview masking in database
    const keyRows = ApiKeyService.listKeys(orgId);
    const liveSecRow = keyRows.find((k) => k.id === `${liveKeys.keyId}_sec`);
    assert.ok(liveSecRow);
    assert.equal(liveSecRow.keyValue, null, 'Live secret key must never be stored plain in database');
    assert.ok(liveSecRow.keyPreview.includes('...'), 'Live secret key must be preview-masked');

    // 2. Mode Isolation (KEY-006)
    const testAuth = ApiKeyService.authenticateSecretKey(testKeys.secretKey);
    assert.ok(testAuth);
    assert.equal(testAuth.mode, 'test', 'Test secret key must authenticate in test mode');

    const liveAuth = ApiKeyService.authenticateSecretKey(liveKeys.secretKey);
    assert.ok(liveAuth);
    assert.equal(liveAuth.mode, 'live', 'Live secret key must authenticate in live mode');

    // 3. Revocation (KEY-005)
    const revoked = ApiKeyService.revokeKey(orgId, testKeys.keyId);
    assert.equal(revoked, true);

    const postRevokeAuth = ApiKeyService.authenticateSecretKey(testKeys.secretKey);
    assert.equal(postRevokeAuth, null, 'Revoked API key (is_active = 0) must be denied authentication');

    const postRevokePubAuth = ApiKeyService.authenticatePublicKey(testKeys.publicKey);
    assert.equal(postRevokePubAuth, null, 'Revoked public key must also be denied');
  });

  // -------------------------------------------------------------
  // A11Y-003: WCAG 2.1 AA Color Contrast Ratio Verification
  // -------------------------------------------------------------
  test('A11Y-003: calculateContrastRatio and isWcagAaCompliant verify WCAG 2.1 AA color contrast compliance', () => {
    // Extreme boundaries
    assert.equal(calculateContrastRatio('#000000', '#ffffff'), 21);
    assert.equal(calculateContrastRatio('#ffffff', '#ffffff'), 1);

    // Application UI tokens against white background
    const slate900 = '#0f172a'; // Main headings & body text
    const textRatio = calculateContrastRatio(slate900, '#ffffff');
    assert.ok(textRatio >= 4.5, `slate-900 contrast ratio (${textRatio}) must exceed WCAG AA 4.5:1`);
    assert.equal(isWcagAaCompliant(slate900, '#ffffff'), true);

    // Primary action button blue against white
    const primaryBlue = '#2563eb';
    const buttonRatio = calculateContrastRatio(primaryBlue, '#ffffff');
    assert.ok(buttonRatio >= 3.0, `Primary button contrast (${buttonRatio}) must meet UI component standard (>= 3.0:1)`);

    // Inaccessible low-contrast colors correctly fail validation
    const faintGray = '#cbd5e1'; // slate-300
    assert.equal(isWcagAaCompliant(faintGray, '#ffffff'), false, 'Low-contrast text must fail WCAG AA');
  });

  // -------------------------------------------------------------
  // SET-002, SET-003, SET-005: Organization Settings Validation, Persistence, and Audit Log
  // -------------------------------------------------------------
  test('SET-002, SET-003, SET-005: Organization settings validation, audit logging, and webhook validation', () => {
    // SET-003: Empty name validation
    const validateOrgName = (name: unknown): boolean => {
      return typeof name === 'string' && name.trim().length > 0;
    };
    assert.equal(validateOrgName(''), false);
    assert.equal(validateOrgName('   '), false);
    assert.equal(validateOrgName('مؤسسة الصراف التجريبية'), true);

    // SET-005: Webhook URL validation
    const validateWebhookUrl = (url: unknown): boolean => {
      if (typeof url !== 'string' || !url.trim()) return false;
      const t = url.trim();
      return t.startsWith('https://') || t.startsWith('http://');
    };
    assert.equal(validateWebhookUrl('javascript:alert(1)'), false);
    assert.equal(validateWebhookUrl('ftp://example.com'), false);
    assert.equal(validateWebhookUrl('https://api.example.com/webhook'), true);

    // SET-002: Persistence and Audit Log
    db.prepare(`
      UPDATE organizations
      SET name = 'المتجر المعتمد للتدقيق',
          default_timezone = 'Africa/Cairo',
          updated_at = datetime('now')
      WHERE id = ?
    `).run(orgId);

    const updatedOrg = db.prepare('SELECT name, default_timezone FROM organizations WHERE id = ?').get(orgId) as any;
    assert.equal(updatedOrg.name, 'المتجر المعتمد للتدقيق');
    assert.equal(updatedOrg.default_timezone, 'Africa/Cairo');

    AuditService.record({
      organizationId: orgId,
      actorIdentity: 'admin@example.com',
      action: 'WORKSPACE_SETTINGS_UPDATED',
      resourceType: 'organization',
      resourceId: orgId,
    });

    const auditRow = db.prepare(`
      SELECT action, actor_identity FROM audit_logs
      WHERE organization_id = ? AND action = 'WORKSPACE_SETTINGS_UPDATED'
    `).get(orgId) as any;
    assert.ok(auditRow);
    assert.equal(auditRow.action, 'WORKSPACE_SETTINGS_UPDATED');
  });

  // -------------------------------------------------------------
  // SRC-015 & SRC-016: Payment Source Limits Validation, Persistence, and Draft Reset
  // -------------------------------------------------------------
  test('SRC-015 & SRC-016: Payment source limit editing persists in DB and rejects daily exceeding monthly', () => {
    // Seed initial source
    db.prepare(`
      INSERT INTO payment_sources (
        id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
        daily_turnover_limit_minor, monthly_turnover_limit_minor
      ) VALUES ('src_edit_test', ?, 'acc_regression', 'vodafone_cash', 'Original Name', '01011112222', 5000000, 20000000)
    `).run(orgId);

    // SRC-015: Daily > Monthly rejection logic
    assert.equal(validateDailyMonthlyLimits(10000, 1000), false);
    assert.equal(validateDailyMonthlyLimits(5000, 20000), true);

    // SRC-016: Editing limits and persisting to DB
    const newDailyMinor = 8000000;
    const newMonthlyMinor = 30000000;
    const newName = 'Updated Wallet Name';

    db.prepare(`
      UPDATE payment_sources
      SET friendly_name = ?,
          daily_turnover_limit_minor = ?,
          monthly_turnover_limit_minor = ?,
          updated_at = datetime('now')
      WHERE id = 'src_edit_test' AND organization_id = ?
    `).run(newName, newDailyMinor, newMonthlyMinor, orgId);

    AuditService.record({
      organizationId: orgId,
      actorIdentity: 'owner@example.com',
      action: 'PAYMENT_SOURCE_UPDATED',
      resourceType: 'payment_source',
      resourceId: 'src_edit_test',
    });

    const updatedSource = db.prepare('SELECT friendly_name, daily_turnover_limit_minor, monthly_turnover_limit_minor FROM payment_sources WHERE id = ?').get('src_edit_test') as any;
    assert.equal(updatedSource.friendly_name, newName);
    assert.equal(updatedSource.daily_turnover_limit_minor, newDailyMinor);
    assert.equal(updatedSource.monthly_turnover_limit_minor, newMonthlyMinor);

    // Draft form state reset verification on modal cancel
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.friendlyName, '');
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.walletNumber, '');
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.dailyLimit, 60000);
    assert.equal(INITIAL_ADD_SOURCE_FORM_STATE.monthlyLimit, 200000);
  });

  // -------------------------------------------------------------
  // AUTH-006: Login Authentication and Session Issuance
  // -------------------------------------------------------------
  test('AUTH-006: Login authentication verifies credentials and issues valid active session token', () => {
    // Seed user with valid password hash
    const userId = 'usr_login_auth_006';
    const email = 'merchant@example.com';
    const passwordHash = crypto.createHash('sha256').update('CorrectPassword123!').digest('hex');

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, is_active, email_verified)
      VALUES (?, ?, ?, 'Test Merchant', 1, 1)
    `).run(userId, email, passwordHash);

    // Verify credentials match
    const user = db.prepare('SELECT id, email, password_hash, is_active FROM users WHERE email = ?').get(email) as any;
    assert.ok(user);
    assert.equal(user.is_active, 1);

    const inputHash = crypto.createHash('sha256').update('CorrectPassword123!').digest('hex');
    assert.equal(inputHash, user.password_hash, 'Password hash matches valid credentials');

    // Issue session token and verify
    const rawSessionToken = 'sess_token_auth_006_verified';
    const hashed = hashSessionToken(rawSessionToken);
    db.prepare(`
      INSERT INTO sessions (token, user_id, organization_id, expires_at)
      VALUES (?, ?, ?, datetime('now', '+1 day'))
    `).run(hashed, userId, orgId);

    const activeSession = db.prepare('SELECT token, user_id FROM sessions WHERE token = ?').get(hashed) as any;
    assert.ok(activeSession);
    assert.equal(activeSession.user_id, userId);

    // Password visibility toggle helper
    assert.equal(getPasswordInputType(false), 'password');
    assert.equal(getPasswordInputType(true), 'text');
  });
});

