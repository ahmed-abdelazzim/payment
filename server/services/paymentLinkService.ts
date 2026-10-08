import crypto from 'node:crypto';
import { getDatabase } from '../db';
import { toMinor, fromMinor } from '../money';

export interface PaymentLink {
  id: string;
  organizationId: string;
  title: string;
  description?: string | null;
  amountMinor: number;
  amount: number;
  currency: string;
  isActive: boolean;
  reusable: boolean;
  redirectUrl?: string | null;
  totalCollectedMinor: number;
  totalCollected: number;
  successfulPaymentsCount: number;
  createdAt: string;
  updatedAt: string;
}

export class PaymentLinkService {
  static createPaymentLink(
    organizationId: string,
    data: {
      title: string;
      description?: string;
      amount: number;
      reusable?: boolean;
      redirectUrl?: string;
    }
  ): PaymentLink {
    if (!data.title || !data.title.trim()) {
      throw new Error('TITLE_REQUIRED: Title is required for payment link');
    }
    const amountMinor = toMinor(data.amount, { allowZero: false });
    const id = `plink_${crypto.randomBytes(8).toString('hex')}`;
    const db = getDatabase();

    db.prepare(`
      INSERT INTO payment_links (
        id, organization_id, title, description, amount_minor, currency, is_active, reusable, redirect_url
      ) VALUES (?, ?, ?, ?, ?, 'EGP', 1, ?, ?)
    `).run(
      id,
      organizationId,
      data.title.trim(),
      data.description ? data.description.trim() : null,
      amountMinor,
      data.reusable !== false ? 1 : 0,
      data.redirectUrl ? data.redirectUrl.trim() : null
    );

    return this.getPaymentLink(id)!;
  }

  static listPaymentLinks(organizationId: string): PaymentLink[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT *
      FROM payment_links
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(organizationId) as any[];

    return rows.map(this.mapRow);
  }

  static getPaymentLink(linkId: string): PaymentLink | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT *
      FROM payment_links
      WHERE id = ?
    `).get(linkId) as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  static togglePaymentLink(organizationId: string, linkId: string): boolean {
    const db = getDatabase();
    const res = db.prepare(`
      UPDATE payment_links
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
          updated_at = datetime('now')
      WHERE id = ? AND organization_id = ?
    `).run(linkId, organizationId);

    return res.changes > 0;
  }

  static deletePaymentLink(organizationId: string, linkId: string): boolean {
    const db = getDatabase();
    const res = db.prepare(`
      DELETE FROM payment_links
      WHERE id = ? AND organization_id = ?
    `).run(linkId, organizationId);

    return res.changes > 0;
  }

  private static mapRow(row: any): PaymentLink {
    return {
      id: row.id,
      organizationId: row.organization_id,
      title: row.title,
      description: row.description,
      amountMinor: row.amount_minor,
      amount: fromMinor(row.amount_minor),
      currency: row.currency || 'EGP',
      isActive: Boolean(row.is_active),
      reusable: Boolean(row.reusable),
      redirectUrl: row.redirect_url,
      totalCollectedMinor: row.total_collected_minor || 0,
      totalCollected: fromMinor(row.total_collected_minor || 0),
      successfulPaymentsCount: row.successful_payments_count || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
