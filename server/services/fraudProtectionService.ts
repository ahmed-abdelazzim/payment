import crypto from 'node:crypto';
import { getDatabase } from '../db';

export interface BlockedSenderRecord {
  id: string;
  organizationId: string;
  phoneNumber: string;
  reason: string;
  severity: 'blocked' | 'flagged';
  createdAt: string;
}

export interface RiskAssessment {
  riskScore: number; // 0 (safest) to 100 (highest risk)
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
  isBlocked: boolean;
  reasons: string[];
}

export class FraudProtectionService {
  /**
   * Fast boolean check if a phone number is blocked
   */
  static isSenderBlocked(organizationId: string, phoneNumber?: string | null): boolean {
    if (!phoneNumber || !phoneNumber.trim()) return false;
    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-11);
    const db = getDatabase();
    const row = db.prepare(`
      SELECT 1 FROM merchant_fraud_blocklist
      WHERE organization_id = ? AND phone_number = ?
    `).get(organizationId, cleanPhone);
    return Boolean(row);
  }

  /**
   * Evaluates the risk score of a customer sender phone or transaction reference
   */
  static assessSender(organizationId: string, phoneNumber?: string | null): RiskAssessment {
    if (!phoneNumber || !phoneNumber.trim()) {
      return {
        riskScore: 0,
        riskLevel: 'low',
        isBlocked: false,
        reasons: [],
      };
    }

    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-11);
    const db = getDatabase();

    // 1. Check merchant blocklist
    const blocked = db.prepare(`
      SELECT *
      FROM merchant_fraud_blocklist
      WHERE organization_id = ? AND phone_number = ?
    `).get(organizationId, cleanPhone) as any;

    if (blocked) {
      return {
        riskScore: 100,
        riskLevel: 'blocked',
        isBlocked: true,
        reasons: [blocked.reason || 'الرقم مدرج في قائمة الحظر والمكافحة الأمنية'],
      };
    }

    const reasons: string[] = [];
    let riskScore = 0;

    // 2. Velocity check: how many unconfirmed claims did this phone make in the last 15 minutes?
    const recentClaims = db.prepare(`
      SELECT COUNT(*) as claim_count
      FROM checkout_sessions
      WHERE organization_id = ?
        AND (customer_reported_phone = ? OR customer_phone = ?)
        AND status = 'pending'
        AND created_at >= datetime('now', '-15 minutes')
    `).get(organizationId, cleanPhone, cleanPhone) as any;

    const count = recentClaims?.claim_count || 0;
    if (count >= 5) {
      riskScore += 65;
      reasons.push(`نشاط متكرر غير معتاد: ${count} محاولات سداد معلقة خلال 15 دقيقة`);
    } else if (count >= 3) {
      riskScore += 30;
      reasons.push(`تكرار محاولات السداد: ${count} طلبات نشطة في نفس الوقت`);
    }

    // 3. Format integrity check: Standard Egyptian mobile format starts with 010, 011, 012, 015
    if (cleanPhone.length === 11 && !/^01[0125]\d{8}$/.test(cleanPhone)) {
      riskScore += 25;
      reasons.push('صيغة رقم الهاتف لا تطابق شبكات المحمول المصرية المعتمدة');
    }

    let riskLevel: 'low' | 'medium' | 'high' | 'blocked' = 'low';
    if (riskScore >= 60) riskLevel = 'high';
    else if (riskScore >= 25) riskLevel = 'medium';

    return {
      riskScore,
      riskLevel,
      isBlocked: false,
      reasons,
    };
  }

  /**
   * Adds a phone number to merchant fraud blocklist
   */
  static blockSender(
    organizationId: string,
    phoneNumber: string,
    reason: string = 'محاولة سداد مشبوهة أو تزوير إيصال'
  ): BlockedSenderRecord {
    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-11);
    if (!cleanPhone) {
      throw new Error('PHONE_REQUIRED');
    }

    const db = getDatabase();
    const id = `blk_${crypto.randomBytes(8).toString('hex')}`;

    db.prepare(`
      INSERT INTO merchant_fraud_blocklist (id, organization_id, phone_number, reason, severity)
      VALUES (?, ?, ?, ?, 'blocked')
      ON CONFLICT(organization_id, phone_number) DO UPDATE SET
        reason = excluded.reason,
        created_at = datetime('now')
    `).run(id, organizationId, cleanPhone, reason.trim());

    return {
      id,
      organizationId,
      phoneNumber: cleanPhone,
      reason,
      severity: 'blocked',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Removes a phone number from blocklist
   */
  static unblockSender(organizationId: string, phoneNumber: string): boolean {
    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-11);
    const db = getDatabase();
    const res = db.prepare(`
      DELETE FROM merchant_fraud_blocklist
      WHERE organization_id = ? AND phone_number = ?
    `).run(organizationId, cleanPhone);

    return res.changes > 0;
  }

  /**
   * Lists all blocked numbers for merchant
   */
  static listBlockedSenders(organizationId: string): BlockedSenderRecord[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, organization_id, phone_number, reason, severity, created_at
      FROM merchant_fraud_blocklist
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(organizationId) as any[];

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      phoneNumber: r.phone_number,
      reason: r.reason,
      severity: r.severity,
      createdAt: r.created_at,
    }));
  }
}
