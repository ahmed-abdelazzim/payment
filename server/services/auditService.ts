import { getDatabase } from '../db';
import crypto from 'node:crypto';

export interface AuditLogInput {
  organizationId: string;
  actorIdentity: string;
  action: string;
  resourceType: string;
  resourceId: string;
  originIp?: string;
  details?: Record<string, any>;
}

const SENSITIVE_DETAIL_KEY = /(?:token|secret|password|authorization|cookie|api[_-]?key|hmac|raw_?payload|sms_?body)/i;
const SENSITIVE_QUERY_VALUE = /([?&](?:token|secret|password|authorization|api[_-]?key)=)[^&#\s]+/gi;

function redactAuditDetails(value: unknown, key = '', depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (SENSITIVE_DETAIL_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value.replace(SENSITIVE_QUERY_VALUE, '$1[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditDetails(item, key, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactAuditDetails(childValue, childKey, depth + 1),
      ])
    );
  }
  return value;
}

export class AuditService {
  static record(input: AuditLogInput): void {
    const db = getDatabase();
    const id = `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, actor_identity, action, resource_type, resource_id, origin_ip, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.organizationId,
      input.actorIdentity,
      input.action,
      input.resourceType,
      input.resourceId,
      input.originIp || '127.0.0.1',
      input.details ? JSON.stringify(redactAuditDetails(input.details)) : null
    );
  }

  static getLogs(organizationId: string, limit = 50): any[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT id, actor_identity, action, resource_type, resource_id, origin_ip, details, created_at
      FROM audit_logs
      WHERE organization_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(organizationId, limit);
  }
}

export class WebhookService {
  /**
   * Dispatches signed webhook payload to an endpoint with HMAC signature
   */
  static dispatch(signingSecret: string, payload: any): { signature: string; timestamp: number } {
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyStr = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', signingSecret)
      .update(`${timestamp}.${bodyStr}`)
      .digest('hex');

    return { signature: `t=${timestamp},v1=${signature}`, timestamp };
  }
}
