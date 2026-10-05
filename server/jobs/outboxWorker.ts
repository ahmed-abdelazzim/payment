import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { getDatabase } from '../db';
import { AuditService, WebhookService } from '../services/auditService';

export type OutboxJobType = 'reconcile_event' | 'send_telegram' | 'dispatch_webhook' | 'limit_alert';

interface StoredOutboxJob {
  id: string;
  organization_id: string;
  job_type: OutboxJobType;
  payload: string;
  attempts: number;
  next_retry_at: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface ClaimedOutboxJob {
  id: string;
  organizationId: string;
  jobType: OutboxJobType;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: string;
}

export class OutboxDeliveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'OutboxDeliveryError';
  }
}

export interface OutboxRuntimeConfig {
  enabled: boolean;
  deliveryEnabled: boolean;
  embedded: boolean;
  pollIntervalMs: number;
  maxAttempts: number;
  leaseMs: number;
  deliveryTimeoutMs: number;
  batchSize: number;
  allowInsecureHttp: boolean;
}

export interface OutboxWorkerOptions {
  pollIntervalMs?: number;
  maxAttempts?: number;
  leaseMs?: number;
  deliveryTimeoutMs?: number;
  batchSize?: number;
  allowInsecureHttp?: boolean;
  handlers?: Partial<Record<OutboxJobType, (job: ClaimedOutboxJob) => Promise<void>>>;
  logger?: (event: string, details?: Record<string, unknown>) => void;
}

export interface OutboxProcessResult {
  processed: boolean;
  jobId?: string;
  outcome?: 'completed' | 'retry_scheduled' | 'dead_lettered';
}

function parseBoundedPositiveInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function getOutboxRuntimeConfig(): OutboxRuntimeConfig {
  const deliveryTimeoutMs = parseBoundedPositiveInteger(process.env.OUTBOX_DELIVERY_TIMEOUT_MS, 10_000, 1_000, 60_000);
  const configuredLeaseMs = parseBoundedPositiveInteger(process.env.OUTBOX_LEASE_MS, 90_000, 10_000, 15 * 60_000);

  return {
    // Both switches are intentional. Merely deploying the application must not begin sending
    // Telegram messages or customer webhooks.
    enabled: process.env.OUTBOX_WORKER_ENABLED === 'true',
    deliveryEnabled: process.env.OUTBOX_DELIVERY_ENABLED === 'true',
    embedded: process.env.OUTBOX_WORKER_EMBEDDED === 'true',
    pollIntervalMs: parseBoundedPositiveInteger(process.env.OUTBOX_POLL_INTERVAL_MS, 10_000, 1_000, 60_000),
    maxAttempts: parseBoundedPositiveInteger(process.env.OUTBOX_MAX_ATTEMPTS, 8, 1, 20),
    // A delivery cannot outlive its lease. This prevents a second worker from reclaiming a
    // job while a bounded network request is still in flight.
    leaseMs: Math.max(configuredLeaseMs, deliveryTimeoutMs + 5_000),
    deliveryTimeoutMs,
    batchSize: parseBoundedPositiveInteger(process.env.OUTBOX_BATCH_SIZE, 10, 1, 100),
    allowInsecureHttp: process.env.OUTBOX_ALLOW_INSECURE_HTTP === 'true' && process.env.NODE_ENV !== 'production',
  };
}

export function toSqliteTimestamp(timeMs = Date.now()): string {
  return new Date(timeMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

export function computeOutboxBackoffMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 8));
  return Math.min(15 * 60_000, 5_000 * (2 ** exponent));
}

function parsePayload(rawPayload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('payload is not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new OutboxDeliveryError('INVALID_OUTBOX_PAYLOAD', false);
  }
}

function asDisplayText(value: unknown, fallback: string, maxLength = 160): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function asAmount(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 'غير متاح';
  return numeric.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function isUnsafeIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(normalized);
  if (family === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }

  if (family === 6) {
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedIpv4) return isUnsafeIpAddress(mappedIpv4[1]);
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }

  return true;
}

interface ResolvedTarget {
  url: URL;
  address: string;
  family: number;
}

async function resolveSafeTarget(rawUrl: string, allowInsecureHttp: boolean): Promise<ResolvedTarget> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new OutboxDeliveryError('INVALID_WEBHOOK_URL', false);
  }

  const protocolAllowed = target.protocol === 'https:' || (allowInsecureHttp && target.protocol === 'http:');
  if (!protocolAllowed || target.username || target.password || !target.hostname) {
    throw new OutboxDeliveryError('UNSAFE_WEBHOOK_URL', false);
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new OutboxDeliveryError('UNSAFE_WEBHOOK_TARGET', false);
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new OutboxDeliveryError('WEBHOOK_DNS_LOOKUP_FAILED', true);
  }

  if (!addresses.length || addresses.some(({ address }) => isUnsafeIpAddress(address))) {
    throw new OutboxDeliveryError('UNSAFE_WEBHOOK_TARGET', false);
  }

  return { url: target, address: addresses[0].address, family: addresses[0].family };
}

async function postJson(target: ResolvedTarget, payload: unknown, headers: Record<string, string>, timeoutMs: number): Promise<{ statusCode: number; body: string }> {
  const body = JSON.stringify(payload);
  const client = target.url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request({
      protocol: target.url.protocol,
      hostname: target.url.hostname,
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
        'User-Agent': 'Sarraf-Ops-Outbox/1.0',
        ...headers,
      },
      // Keep the DNS answer we validated above. Redirects are not followed by this client.
      lookup: ((_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => {
        callback(null, target.address, target.family);
      }) as any,
      timeout: timeoutMs,
    }, (response) => {
      // The response is used only to validate the provider acknowledgement. It is bounded,
      // never logged, and never written to the database because it may include user content.
      let responseBody = '';
      response.on('data', (chunk: Buffer) => {
        if (responseBody.length < 4_096) {
          responseBody += chunk.toString('utf8').slice(0, 4_096 - responseBody.length);
        }
      });
      response.once('end', () => resolve({ statusCode: response.statusCode || 0, body: responseBody }));
    });

    request.once('timeout', () => {
      request.destroy(new OutboxDeliveryError('DELIVERY_TIMEOUT', true));
    });
    request.once('error', () => reject(new OutboxDeliveryError('DELIVERY_NETWORK_ERROR', true)));
    request.end(body);
  });
}

function isRetryableHttpStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function eventIsSubscribed(subscribedEvents: string, event: string): boolean {
  return subscribedEvents
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry === '*' || entry === event);
}

export class OutboxWorker {
  private readonly config: Required<Pick<OutboxWorkerOptions, 'pollIntervalMs' | 'maxAttempts' | 'leaseMs' | 'deliveryTimeoutMs' | 'batchSize' | 'allowInsecureHttp'>>;
  private readonly handlers: OutboxWorkerOptions['handlers'];
  private readonly logger: NonNullable<OutboxWorkerOptions['logger']>;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private lastRunAt: string | null = null;
  private lastFailureCode: string | null = null;

  constructor(options: OutboxWorkerOptions = {}) {
    const env = getOutboxRuntimeConfig();
    this.config = {
      pollIntervalMs: options.pollIntervalMs ?? env.pollIntervalMs,
      maxAttempts: options.maxAttempts ?? env.maxAttempts,
      leaseMs: Math.max(options.leaseMs ?? env.leaseMs, (options.deliveryTimeoutMs ?? env.deliveryTimeoutMs) + 5_000),
      deliveryTimeoutMs: options.deliveryTimeoutMs ?? env.deliveryTimeoutMs,
      batchSize: options.batchSize ?? env.batchSize,
      allowInsecureHttp: options.allowInsecureHttp ?? env.allowInsecureHttp,
    };
    this.handlers = options.handlers;
    this.logger = options.logger ?? ((event, details) => {
      // Deliberately log only operational identifiers and result codes, never payloads or secrets.
      console.info(`[Outbox] ${event}`, details ?? '');
    });
  }

  start(): void {
    const env = getOutboxRuntimeConfig();
    if (!env.enabled || !env.deliveryEnabled) {
      throw new Error('OUTBOX_WORKER_AND_DELIVERY_MUST_BE_EXPLICITLY_ENABLED');
    }
    if (this.timer) return;
    void this.drain();
    this.timer = setInterval(() => void this.drain(), this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.draining) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  getStatus(): { running: boolean; lastRunAt: string | null; lastFailureCode: string | null } {
    return { running: this.timer !== null, lastRunAt: this.lastRunAt, lastFailureCode: this.lastFailureCode };
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let index = 0; index < this.config.batchSize; index += 1) {
        const result = await this.processOnce();
        if (!result.processed) break;
      }
      this.lastRunAt = new Date().toISOString();
      this.lastFailureCode = null;
    } catch (error) {
      this.lastFailureCode = error instanceof OutboxDeliveryError ? error.code : 'OUTBOX_WORKER_ERROR';
      this.logger('drain_failed', { code: this.lastFailureCode });
    } finally {
      this.draining = false;
    }
  }

  async processOnce(): Promise<OutboxProcessResult> {
    const job = this.claimNextJob();
    if (!job) return { processed: false };

    try {
      const customHandler = this.handlers?.[job.jobType];
      if (customHandler) {
        await customHandler(job);
      } else {
        await this.deliver(job);
      }
      this.markCompleted(job);
      return { processed: true, jobId: job.id, outcome: 'completed' };
    } catch (error) {
      const deliveryError = error instanceof OutboxDeliveryError
        ? error
        : new OutboxDeliveryError('UNEXPECTED_DELIVERY_FAILURE', true);

      if (!deliveryError.retryable || job.attempts >= this.config.maxAttempts) {
        this.markDeadLetter(job, deliveryError.code);
        return { processed: true, jobId: job.id, outcome: 'dead_lettered' };
      }

      this.scheduleRetry(job, deliveryError.code, deliveryError.retryAfterMs);
      return { processed: true, jobId: job.id, outcome: 'retry_scheduled' };
    }
  }

  private claimNextJob(): ClaimedOutboxJob | null {
    const db = getDatabase();
    const now = Date.now();
    const nowSql = toSqliteTimestamp(now);
    const leaseUntil = toSqliteTimestamp(now + this.config.leaseMs);
    let transactionOpen = false;

    try {
      db.exec('BEGIN IMMEDIATE;');
      transactionOpen = true;

      // A process may stop after claiming a job. The lease gives a later worker a safe way to
      // recover it without treating it as delivered.
      db.prepare(`
        UPDATE outbox_jobs
        SET status = 'queued', next_retry_at = ?, last_error = 'LEASE_EXPIRED'
        WHERE status = 'processing' AND next_retry_at <= ?
      `).run(nowSql, nowSql);

      const candidate = db.prepare(`
        SELECT id, organization_id, job_type, payload, attempts, next_retry_at, status, created_at
        FROM outbox_jobs
        WHERE status = 'queued' AND next_retry_at <= ?
        ORDER BY next_retry_at ASC, created_at ASC, id ASC
        LIMIT 1
      `).get(nowSql) as StoredOutboxJob | undefined;

      if (!candidate) {
        db.exec('COMMIT;');
        return null;
      }

      const update = db.prepare(`
        UPDATE outbox_jobs
        SET status = 'processing', attempts = attempts + 1, next_retry_at = ?, last_error = NULL
        WHERE id = ? AND status = 'queued'
      `).run(leaseUntil, candidate.id);

      if (update.changes !== 1) {
        db.exec('ROLLBACK;');
        return null;
      }

      db.exec('COMMIT;');
      return {
        id: candidate.id,
        organizationId: candidate.organization_id,
        jobType: candidate.job_type,
        payload: parsePayload(candidate.payload),
        attempts: candidate.attempts + 1,
        createdAt: candidate.created_at,
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          db.exec('ROLLBACK;');
        } catch {
          // The database may already have rolled the transaction back.
        }
      }
      if (error instanceof OutboxDeliveryError) throw error;
      throw new OutboxDeliveryError('OUTBOX_CLAIM_FAILED', true);
    }
  }

  private async deliver(job: ClaimedOutboxJob): Promise<void> {
    switch (job.jobType) {
      case 'dispatch_webhook':
        await this.dispatchWebhook(job);
        return;
      case 'limit_alert':
        await this.sendLimitAlert(job);
        return;
      case 'send_telegram':
        await this.sendTelegram(job, asDisplayText(job.payload.text, 'تنبيه من صرّاف أوبس', 3_500));
        return;
      default:
        throw new OutboxDeliveryError('UNSUPPORTED_OUTBOX_JOB_TYPE', false);
    }
  }

  private async sendLimitAlert(job: ClaimedOutboxJob): Promise<void> {
    // LimitEngine owns this payload and uses camelCase. Accept the former
    // snake_case keys as a short migration bridge so queued historical jobs
    // still produce a useful alert.
    const sourceName = asDisplayText(job.payload.sourceName ?? job.payload.source_name, 'مصدر استقبال');
    const thresholdPercent = job.payload.thresholdPercent ?? job.payload.threshold;
    const level = asDisplayText(job.payload.level, 'تنبيه');
    const normalizedThreshold = typeof thresholdPercent === 'number' || typeof thresholdPercent === 'string'
      ? asDisplayText(String(thresholdPercent), '—')
      : null;
    const threshold = normalizedThreshold
      ? normalizedThreshold.endsWith('%') ? normalizedThreshold : `${normalizedThreshold}%`
      : level;
    const intake = asAmount(job.payload.intake);
    const cap = asAmount(job.payload.cap);
    const action = asDisplayText(
      job.payload.actionRecommended ?? job.payload.action_recommended,
      'راجع مصدر الاستقبال والحد المتاح.',
      300,
    );
    const message = `⚠️ تنبيه حدود صرّاف أوبس\nالمصدر: ${sourceName}\nالاستهلاك: ${intake} من ${cap} جنيه\nالحد: ${threshold}\nالإجراء: ${action}`;
    await this.sendTelegram(job, message);
  }

  private async sendTelegram(job: ClaimedOutboxJob, text: string): Promise<void> {
    const db = getDatabase();
    const organization = db.prepare(`
      SELECT telegram_bot_token, telegram_chat_id
      FROM organizations
      WHERE id = ?
    `).get(job.organizationId) as { telegram_bot_token?: string; telegram_chat_id?: string } | undefined;

    const botToken = organization?.telegram_bot_token?.trim();
    const chatId = organization?.telegram_chat_id?.trim();
    if (!botToken || !chatId) {
      throw new OutboxDeliveryError('TELEGRAM_NOT_CONFIGURED', false);
    }

    this.extendLease(job.id);
    const target = await resolveSafeTarget(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, this.config.allowInsecureHttp);
    const response = await postJson(target, {
      chat_id: chatId,
      text: text.slice(0, 3_500),
      disable_web_page_preview: true,
    }, {}, this.config.deliveryTimeoutMs);

    let telegramResult: { ok?: boolean; parameters?: { retry_after?: number } } | undefined;
    try {
      telegramResult = JSON.parse(response.body) as { ok?: boolean; parameters?: { retry_after?: number } };
    } catch {
      // A 2xx response without Telegram's documented JSON acknowledgement is not proof of
      // delivery, so retry it instead of silently marking the notification completed.
      if (response.statusCode >= 200 && response.statusCode < 300) {
        throw new OutboxDeliveryError('TELEGRAM_INVALID_ACKNOWLEDGEMENT', true);
      }
    }

    const retryAfterMs = typeof telegramResult?.parameters?.retry_after === 'number'
      ? Math.max(0, telegramResult.parameters.retry_after * 1_000)
      : undefined;
    if (response.statusCode < 200 || response.statusCode >= 300 || telegramResult?.ok !== true) {
      throw new OutboxDeliveryError(
        `TELEGRAM_HTTP_${response.statusCode}`,
        isRetryableHttpStatus(response.statusCode),
        retryAfterMs,
      );
    }
  }

  private async dispatchWebhook(job: ClaimedOutboxJob): Promise<void> {
    const event = asDisplayText(job.payload.event, '', 128);
    if (!event || !/^[a-z0-9._-]+$/i.test(event)) {
      throw new OutboxDeliveryError('INVALID_WEBHOOK_EVENT', false);
    }

    const db = getDatabase();
    const endpoints = db.prepare(`
      SELECT id, url, signing_secret, subscribed_events
      FROM webhook_endpoints
      WHERE organization_id = ? AND is_active = 1
    `).all(job.organizationId) as Array<{ id: string; url: string; signing_secret: string; subscribed_events: string }>;

    const failures: OutboxDeliveryError[] = [];
    for (const endpoint of endpoints) {
      if (!eventIsSubscribed(endpoint.subscribed_events, event) || this.endpointAlreadyReceived(endpoint.id, job.id)) {
        continue;
      }

      try {
        this.extendLease(job.id);
        const target = await resolveSafeTarget(endpoint.url, this.config.allowInsecureHttp);
        const webhookEvent = {
          id: job.id,
          type: event,
          occurred_at: job.createdAt,
          data: job.payload,
        };
        const signature = WebhookService.dispatch(endpoint.signing_secret, webhookEvent);
        const response = await postJson(target, webhookEvent, {
          'X-Sarraf-Event': event,
          'X-Sarraf-Event-Id': job.id,
          'X-Sarraf-Signature': signature.signature,
          'Idempotency-Key': job.id,
        }, this.config.deliveryTimeoutMs);

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new OutboxDeliveryError(`WEBHOOK_HTTP_${response.statusCode}`, isRetryableHttpStatus(response.statusCode));
        }

        this.recordWebhookDelivery(endpoint.id, job, response.statusCode, 'delivered');
      } catch (error) {
        const failure = error instanceof OutboxDeliveryError
          ? error
          : new OutboxDeliveryError('WEBHOOK_DELIVERY_FAILED', true);
        this.recordWebhookDelivery(endpoint.id, job, null, failure.code);
        failures.push(failure);
      }
    }

    if (failures.length) {
      const permanentFailure = failures.find((failure) => !failure.retryable);
      throw permanentFailure ?? failures[0];
    }

    AuditService.record({
      organizationId: job.organizationId,
      actorIdentity: 'system_outbox_worker',
      action: endpoints.length ? 'OUTBOX_WEBHOOK_DISPATCHED' : 'OUTBOX_WEBHOOK_NO_ACTIVE_ENDPOINT',
      resourceType: 'outbox_job',
      resourceId: job.id,
      details: { event },
    });
  }

  private endpointAlreadyReceived(endpointId: string, eventId: string): boolean {
    const db = getDatabase();
    const delivered = db.prepare(`
      SELECT 1
      FROM webhook_deliveries
      WHERE endpoint_id = ? AND event_id = ? AND http_status BETWEEN 200 AND 299
      LIMIT 1
    `).get(endpointId, eventId);
    return Boolean(delivered);
  }

  private recordWebhookDelivery(endpointId: string, job: ClaimedOutboxJob, statusCode: number | null, resultCode: string): void {
    const db = getDatabase();
    const id = `whd_${job.id}_${endpointId}_${job.attempts}`.slice(0, 250);
    try {
      db.prepare(`
        INSERT OR REPLACE INTO webhook_deliveries (id, endpoint_id, event_id, http_status, response_body, attempt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, endpointId, job.id, statusCode, resultCode.slice(0, 120), job.attempts);
    } catch {
      // Delivery tracking must not expose payloads or cause a retry after an already successful
      // external acknowledgement. The job's idempotency key remains the receiving side's guard.
    }
  }

  private extendLease(jobId: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE outbox_jobs
      SET next_retry_at = ?
      WHERE id = ? AND status = 'processing'
    `).run(toSqliteTimestamp(Date.now() + this.config.leaseMs), jobId);
  }

  private markCompleted(job: ClaimedOutboxJob): void {
    const db = getDatabase();
    const update = db.prepare(`
      UPDATE outbox_jobs
      SET status = 'completed', next_retry_at = ?, last_error = NULL
      WHERE id = ? AND status = 'processing'
    `).run(toSqliteTimestamp(), job.id);
    if (update.changes === 1) {
      this.logger('completed', { jobId: job.id, type: job.jobType, attempt: job.attempts });
    }
  }

  private scheduleRetry(job: ClaimedOutboxJob, failureCode: string, retryAfterMs?: number): void {
    const delay = Math.max(retryAfterMs ?? 0, computeOutboxBackoffMs(job.attempts));
    const db = getDatabase();
    const update = db.prepare(`
      UPDATE outbox_jobs
      SET status = 'queued', next_retry_at = ?, last_error = ?
      WHERE id = ? AND status = 'processing'
    `).run(toSqliteTimestamp(Date.now() + delay), failureCode.slice(0, 120), job.id);
    if (update.changes === 1) {
      AuditService.record({
        organizationId: job.organizationId,
        actorIdentity: 'system_outbox_worker',
        action: 'OUTBOX_JOB_RETRY_SCHEDULED',
        resourceType: 'outbox_job',
        resourceId: job.id,
        details: { jobType: job.jobType, attempt: job.attempts, failureCode },
      });
      this.logger('retry_scheduled', { jobId: job.id, type: job.jobType, attempt: job.attempts, failureCode });
    }
  }

  private markDeadLetter(job: ClaimedOutboxJob, failureCode: string): void {
    const db = getDatabase();
    const update = db.prepare(`
      UPDATE outbox_jobs
      SET status = 'failed', next_retry_at = ?, last_error = ?
      WHERE id = ? AND status = 'processing'
    `).run(toSqliteTimestamp(), failureCode.slice(0, 120), job.id);
    if (update.changes === 1) {
      AuditService.record({
        organizationId: job.organizationId,
        actorIdentity: 'system_outbox_worker',
        action: 'OUTBOX_JOB_DEAD_LETTERED',
        resourceType: 'outbox_job',
        resourceId: job.id,
        details: { jobType: job.jobType, attempt: job.attempts, failureCode },
      });
      this.logger('dead_lettered', { jobId: job.id, type: job.jobType, attempt: job.attempts, failureCode });
    }
  }
}

export function getOutboxQueueSnapshot(): { queued: number; processing: number; failed: number } {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM outbox_jobs
  `).get() as { queued?: number; processing?: number; failed?: number };
  return { queued: row?.queued ?? 0, processing: row?.processing ?? 0, failed: row?.failed ?? 0 };
}
