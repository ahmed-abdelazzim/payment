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
      input.details ? JSON.stringify(input.details) : null
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
