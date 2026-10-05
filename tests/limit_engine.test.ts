import test from 'node:test';
import assert from 'node:assert';
import { initTestDatabase, setDatabase } from '../server/db';
import { getCairoPeriodKeys, LimitEngine } from '../server/services/limitEngine';

function setupLimitSource(caps: { daily: number; monthly: number } = { daily: 200000, monthly: 100000 }) {
  const db = initTestDatabase();
  setDatabase(db);

  const orgId = `org_limits_${Math.random().toString(36).slice(2)}`;
  const accountId = `acc_limits_${Math.random().toString(36).slice(2)}`;
  const sourceId = `src_limits_${Math.random().toString(36).slice(2)}`;

  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Limits Co', 'شركة الحدود', ?)`)
    .run(orgId, orgId);
  db.prepare(`INSERT INTO balance_accounts (id, organization_id, account_name) VALUES (?, ?, 'Main')`)
    .run(accountId, orgId);
  db.prepare(`
    INSERT INTO payment_sources (
      id, organization_id, balance_account_id, provider, friendly_name, wallet_number,
      daily_turnover_limit_minor, monthly_turnover_limit_minor
    ) VALUES (?, ?, ?, 'instapay', 'Limit Test Source', 'limit-test@instapay', ?, ?)
  `).run(sourceId, orgId, accountId, Math.round(caps.daily * 100), Math.round(caps.monthly * 100));

  return { db, orgId, sourceId };
}

test('Limit Engine: uses Africa/Cairo day and month keys across UTC midnight', () => {
  const { db, orgId, sourceId } = setupLimitSource();
  const eventTime = '2026-01-31T22:30:00.000Z'; // 00:30 on 1 February in Cairo

  assert.deepStrictEqual(getCairoPeriodKeys(eventTime), { daily: '2026-02-01', monthly: '2026-02' });

  const result = LimitEngine.recordTurnover(orgId, sourceId, 123.45, eventTime);
  assert.strictEqual(result.dailyIntake, 123.45);
  assert.strictEqual(result.monthlyIntake, 123.45);
  assert.deepStrictEqual(result.periodKeys, {
    daily: '2026-02-01',
    monthly: '2026-02',
    timeZone: 'Africa/Cairo',
  });

  const usage = db.prepare(`
    SELECT period_type, period_key, accumulated_intake_minor
    FROM financial_limit_usage WHERE payment_source_id = ? ORDER BY period_type
  `).all(sourceId) as any[];
  assert.deepStrictEqual(
    usage.map((row) => ({ ...row })),
    [
      { period_type: 'daily', period_key: '2026-02-01', accumulated_intake_minor: 12345 },
      { period_type: 'monthly', period_key: '2026-02', accumulated_intake_minor: 12345 },
    ]
  );
});

test('Limit Engine: monthly usage is the real monthly sum and threshold alerts are durable', () => {
  const { db, orgId, sourceId } = setupLimitSource({ daily: 200000, monthly: 1000 });
  const result = LimitEngine.recordTurnover(orgId, sourceId, 800, '2026-02-04T10:00:00.000Z');

  assert.strictEqual(result.dailyIntake, 800);
  assert.strictEqual(result.monthlyIntake, 800, 'monthly turnover must not be derived from the daily total');
  assert.strictEqual(result.monthlyPercentage, 80);
  assert.strictEqual(result.alertTriggered, '80%');
  assert.deepStrictEqual(
    result.alertsTriggered.map((alert) => ({ periodType: alert.periodType, level: alert.level })),
    [{ periodType: 'monthly', level: 'warning' }]
  );

  const outbox = db.prepare(`SELECT job_type, payload FROM outbox_jobs WHERE organization_id = ?`).all(orgId) as any[];
  assert.strictEqual(outbox.length, 1);
  assert.strictEqual(outbox[0].job_type, 'limit_alert');
  assert.strictEqual(JSON.parse(outbox[0].payload).periodType, 'monthly');
});

test('Limit Engine: rounds in piastres and dispatches both warning and critical thresholds crossed together', () => {
  const { db, orgId, sourceId } = setupLimitSource({ daily: 1000, monthly: 1000 });
  const eventTime = '2026-03-02T09:00:00.000Z';

  LimitEngine.recordTurnover(orgId, sourceId, 0.1, eventTime);
  LimitEngine.recordTurnover(orgId, sourceId, 0.1, eventTime);
  const result = LimitEngine.recordTurnover(orgId, sourceId, 949.8, eventTime);

  assert.strictEqual(result.dailyIntake, 950, '0.1 + 0.1 + 949.8 must remain exactly 950.00 EGP');
  assert.strictEqual(result.dailyPercentage, 95);
  assert.strictEqual(result.alertTriggered, '90%');
  assert.deepStrictEqual(
    result.alertsTriggered
      .filter((alert) => alert.periodType === 'daily')
      .map((alert) => alert.level)
      .sort(),
    ['critical', 'warning']
  );

  const dailyJobs = db.prepare(`
    SELECT COUNT(*) as count FROM outbox_jobs
    WHERE organization_id = ? AND job_type = 'limit_alert' AND payload LIKE '%"periodType":"daily"%'
  `).get(orgId) as any;
  assert.strictEqual(dailyJobs.count, 2, 'each threshold is queued once even when both are crossed in one payment');
});

test('Limit Engine: supports validated custom thresholds and rejects an unknown source', () => {
  const { orgId, sourceId } = setupLimitSource({ daily: 1000, monthly: 5000 });
  const result = LimitEngine.recordTurnover(
    orgId,
    sourceId,
    750,
    '2026-04-02T09:00:00.000Z',
    { warningThreshold: 75, criticalThreshold: 95 }
  );

  assert.strictEqual(result.alertTriggered, '75%');
  assert.throws(
    () => LimitEngine.recordTurnover(orgId, 'missing_source', 1),
    /PAYMENT_SOURCE_NOT_FOUND/
  );
});
