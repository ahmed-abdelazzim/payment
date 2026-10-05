import test from 'node:test';
import assert from 'node:assert';
import { initTestDatabase, setDatabase } from '../server/db';
import { OutboxDeliveryError, OutboxWorker, computeOutboxBackoffMs } from '../server/jobs/outboxWorker';
import { AuditService } from '../server/services/auditService';

function setupOutboxJob(status: 'queued' | 'processing' = 'queued', attempts = 0): { db: any; organizationId: string; jobId: string } {
  const db = initTestDatabase();
  setDatabase(db);
  const organizationId = `org_outbox_${Math.random().toString(36).slice(2, 8)}`;
  const jobId = `job_outbox_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO organizations (id, name, name_ar, slug) VALUES (?, 'Outbox Org', 'مؤسسة الصادر', ?)`)
    .run(organizationId, organizationId);
  db.prepare(`
    INSERT INTO outbox_jobs (id, organization_id, job_type, payload, attempts, status, next_retry_at)
    VALUES (?, ?, 'dispatch_webhook', '{}', ?, ?, datetime('now', '-1 minute'))
  `).run(jobId, organizationId, attempts, status);
  return { db, organizationId, jobId };
}

test('Outbox: claims and completes a queued job exactly once', async () => {
  const { db, jobId } = setupOutboxJob();
  let calls = 0;
  const worker = new OutboxWorker({
    handlers: {
      dispatch_webhook: async () => { calls += 1; },
    },
    logger: () => undefined,
  });

  const first = await worker.processOnce();
  const second = await worker.processOnce();
  const row = db.prepare('SELECT status, attempts FROM outbox_jobs WHERE id = ?').get(jobId) as any;

  assert.deepStrictEqual(first.outcome, 'completed');
  assert.strictEqual(second.processed, false);
  assert.strictEqual(calls, 1);
  assert.strictEqual(row.status, 'completed');
  assert.strictEqual(row.attempts, 1);
});

test('Outbox: retries transient failure then moves a job to the dead-letter state', async () => {
  const { db, jobId } = setupOutboxJob();
  const worker = new OutboxWorker({
    maxAttempts: 2,
    handlers: {
      dispatch_webhook: async () => { throw new OutboxDeliveryError('TEMPORARY_ENDPOINT_FAILURE', true); },
    },
    logger: () => undefined,
  });

  const first = await worker.processOnce();
  let row = db.prepare('SELECT status, attempts, last_error FROM outbox_jobs WHERE id = ?').get(jobId) as any;
  assert.deepStrictEqual(first.outcome, 'retry_scheduled');
  assert.strictEqual(row.status, 'queued');
  assert.strictEqual(row.attempts, 1);
  assert.strictEqual(row.last_error, 'TEMPORARY_ENDPOINT_FAILURE');

  db.prepare("UPDATE outbox_jobs SET next_retry_at = datetime('now', '-1 minute') WHERE id = ?").run(jobId);
  const second = await worker.processOnce();
  row = db.prepare('SELECT status, attempts, last_error FROM outbox_jobs WHERE id = ?').get(jobId) as any;
  assert.deepStrictEqual(second.outcome, 'dead_lettered');
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.attempts, 2);
  assert.strictEqual(row.last_error, 'TEMPORARY_ENDPOINT_FAILURE');
});

test('Outbox: recovers an expired processing lease before processing the job', async () => {
  const { db, jobId } = setupOutboxJob('processing', 1);
  const worker = new OutboxWorker({
    handlers: { dispatch_webhook: async () => undefined },
    logger: () => undefined,
  });

  const result = await worker.processOnce();
  const row = db.prepare('SELECT status, attempts FROM outbox_jobs WHERE id = ?').get(jobId) as any;

  assert.deepStrictEqual(result.outcome, 'completed');
  assert.strictEqual(row.status, 'completed');
  assert.strictEqual(row.attempts, 2);
});

test('Outbox: rejects a private webhook target without opening a network connection', async () => {
  const { db, organizationId, jobId } = setupOutboxJob();
  db.prepare(`
    INSERT INTO webhook_endpoints (id, organization_id, url, signing_secret, subscribed_events)
    VALUES ('wh_private', ?, 'http://127.0.0.1/internal', 'test_secret', 'transaction.confirmed')
  `).run(organizationId);
  db.prepare("UPDATE outbox_jobs SET payload = ? WHERE id = ?")
    .run(JSON.stringify({ event: 'transaction.confirmed', transaction_id: 'txn_test' }), jobId);

  const worker = new OutboxWorker({
    maxAttempts: 1,
    allowInsecureHttp: true,
    logger: () => undefined,
  });
  const result = await worker.processOnce();
  const row = db.prepare('SELECT status, last_error FROM outbox_jobs WHERE id = ?').get(jobId) as any;

  assert.strictEqual(result.outcome, 'dead_lettered');
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.last_error, 'UNSAFE_WEBHOOK_TARGET');
});

test('Outbox: exponential backoff is bounded', () => {
  assert.strictEqual(computeOutboxBackoffMs(1), 5_000);
  assert.strictEqual(computeOutboxBackoffMs(2), 10_000);
  assert.strictEqual(computeOutboxBackoffMs(20), 15 * 60_000);
});

test('Outbox: audit details redact credentials and URL query secrets', () => {
  const { db, organizationId } = setupOutboxJob();
  AuditService.record({
    organizationId,
    actorIdentity: 'system_test',
    action: 'TEST_AUDIT_REDACTION',
    resourceType: 'outbox_job',
    resourceId: 'job_redaction',
    details: {
      accessToken: 'should-not-be-stored',
      destination: 'https://merchant.example/callback?token=should-not-be-stored',
      outcome: 'queued',
    },
  });

  const audit = db.prepare("SELECT details FROM audit_logs WHERE action = 'TEST_AUDIT_REDACTION'").get() as any;
  const details = JSON.parse(audit.details);
  assert.strictEqual(details.accessToken, '[REDACTED]');
  assert.strictEqual(details.destination, 'https://merchant.example/callback?token=[REDACTED]');
  assert.strictEqual(details.outcome, 'queued');
});
