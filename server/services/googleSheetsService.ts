import { getDatabase } from '../db';
import { fromMinor } from '../money';

export interface GoogleSheetsConfig {
  sheetUrl: string | null;
  sheetName: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  syncedCount: number;
}

export interface SyncTransactionPayload {
  id: string;
  externalTrxId: string;
  amount: number;
  currency?: string;
  provider: string;
  senderName?: string | null;
  senderPhone?: string | null;
  status: string;
  balanceAfter?: number | null;
  financialEventAt?: string;
}

const PROVIDER_NAMES_AR: Record<string, string> = {
  vodafone_cash: 'فودافون كاش (Vodafone Cash)',
  instapay: 'شبكة المدفوعات اللحظية (InstaPay)',
  orange_cash: 'أورنج كاش (Orange Cash)',
  etisalat_cash: 'اتصالات كاش (Etisalat Cash)',
  we_pay: 'وي باي (WE Pay)',
};

const STATUS_NAMES_AR: Record<string, string> = {
  confirmed: 'مؤكدة ومطابقة',
  review_required: 'قيد المراجعة',
  pending_ordering: 'بانتظار الترتيب',
  failed: 'فاشلة / مرفوضة',
};

export class GoogleSheetsService {
  /**
   * Returns current Google Sheets integration status for an organization.
   */
  static getStatus(organizationId: string): GoogleSheetsConfig {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT google_sheet_url, google_sheet_name, google_sheet_connected_at, google_sheet_last_sync_at, google_sheet_synced_count
      FROM organizations
      WHERE id = ?
    `).get(organizationId) as any;

    if (!row) {
      return {
        sheetUrl: null,
        sheetName: null,
        connectedAt: null,
        lastSyncAt: null,
        syncedCount: 0,
      };
    }

    return {
      sheetUrl: row.google_sheet_url || null,
      sheetName: row.google_sheet_name || null,
      connectedAt: row.google_sheet_connected_at || null,
      lastSyncAt: row.google_sheet_last_sync_at || null,
      syncedCount: Number(row.google_sheet_synced_count || 0),
    };
  }

  /**
   * Connects a new Google Sheet to the organization.
   */
  static connectSheet(organizationId: string, sheetUrl: string, sheetName?: string): GoogleSheetsConfig {
    const url = sheetUrl.trim();
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('INVALID_URL: Google Sheet webhook URL must start with https://');
    }

    const name = sheetName?.trim() || 'Google Sheet - مدفوعات صرّاف';
    const db = getDatabase();

    db.prepare(`
      UPDATE organizations
      SET google_sheet_url = ?,
          google_sheet_name = ?,
          google_sheet_connected_at = datetime('now'),
          google_sheet_last_sync_at = NULL,
          google_sheet_synced_count = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(url, name, organizationId);

    return this.getStatus(organizationId);
  }

  /**
   * Disconnects the active Google Sheet completely from the organization.
   */
  static disconnectSheet(organizationId: string): boolean {
    const db = getDatabase();
    db.prepare(`
      UPDATE organizations
      SET google_sheet_url = NULL,
          google_sheet_name = NULL,
          google_sheet_connected_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(organizationId);

    return true;
  }

  /**
   * Sends a test ping to the Google Sheets webhook URL.
   */
  static async testConnection(sheetUrl: string): Promise<{ success: boolean; message: string }> {
    const url = sheetUrl.trim();
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('رابط غير صالح. يجب أن يبدأ بـ https://');
    }

    const payload = {
      action: 'test_connection',
      timestamp: new Date().toISOString(),
      message: 'اختبار الاتصال مع منصة صرّاف - Sarraf Ops ناجح',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      if (!response.ok && response.status !== 302 && response.status !== 200) {
        throw new Error(`تعذر الاتصال بالشيت. رمز الاستجابة: ${response.status}`);
      }

      return {
        success: true,
        message: 'تم التحقق من الاتصال برابط Google Sheets بنجاح!',
      };
    } catch (err: any) {
      throw new Error(err.message || 'تعذر الوصول إلى رابط Google Sheets. تأكد من نشر السكريبت كـ Web App مع صلاحية Anyone.');
    }
  }

  /**
   * Dispatches a single transaction to the connected Google Sheet.
   * Fire-and-forget safe: will never throw to disrupt the transaction lifecycle.
   */
  static async syncTransaction(organizationId: string, tx: SyncTransactionPayload): Promise<void> {
    try {
      const db = getDatabase();
      const row = db.prepare(`
        SELECT google_sheet_url
        FROM organizations
        WHERE id = ?
      `).get(organizationId) as { google_sheet_url?: string } | undefined;

      if (!row || !row.google_sheet_url) {
        return; // No sheet connected
      }

      const sheetUrl = row.google_sheet_url;
      const formattedDate = tx.financialEventAt
        ? new Date(tx.financialEventAt).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })
        : new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });

      const payload = {
        action: 'append_transaction',
        id: tx.id,
        externalTrxId: tx.externalTrxId,
        provider: tx.provider,
        providerName: PROVIDER_NAMES_AR[tx.provider] || tx.provider,
        amount: tx.amount,
        currency: tx.currency || 'EGP',
        senderName: tx.senderName || '-',
        senderPhone: tx.senderPhone || '-',
        status: tx.status,
        statusName: STATUS_NAMES_AR[tx.status] || tx.status,
        balanceAfter: tx.balanceAfter !== undefined && tx.balanceAfter !== null ? tx.balanceAfter : '-',
        date: formattedDate,
      };

      const res = await fetch(sheetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      if (res.ok || res.status === 200 || res.status === 302) {
        db.prepare(`
          UPDATE organizations
          SET google_sheet_last_sync_at = datetime('now'),
              google_sheet_synced_count = COALESCE(google_sheet_synced_count, 0) + 1
          WHERE id = ?
        `).run(organizationId);
      }
    } catch (err) {
      console.warn(`[GoogleSheetsService] Failed to sync transaction ${tx.id} to sheet:`, err);
    }
  }

  /**
   * Backfills / syncs all confirmed transactions for an organization to the sheet.
   */
  static async syncAllTransactions(organizationId: string): Promise<{ syncedCount: number }> {
    const db = getDatabase();
    const org = db.prepare(`
      SELECT google_sheet_url
      FROM organizations
      WHERE id = ?
    `).get(organizationId) as { google_sheet_url?: string } | undefined;

    if (!org || !org.google_sheet_url) {
      throw new Error('NO_SHEET_CONNECTED: لم يتم ربط أي Google Sheet بعد.');
    }

    const rows = db.prepare(`
      SELECT id, external_trx_id, provider, amount_minor, currency, sender_name, sender_phone,
             status, stated_balance_after_minor, financial_event_at, created_at
      FROM transactions
      WHERE organization_id = ?
      ORDER BY financial_event_at ASC
    `).all(organizationId) as any[];

    if (rows.length === 0) {
      return { syncedCount: 0 };
    }

    const transactions = rows.map((r) => {
      const formattedDate = r.financial_event_at
        ? new Date(r.financial_event_at).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })
        : new Date(r.created_at).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });

      return {
        id: r.id,
        externalTrxId: r.external_trx_id,
        provider: r.provider,
        providerName: PROVIDER_NAMES_AR[r.provider] || r.provider,
        amount: fromMinor(r.amount_minor),
        currency: r.currency || 'EGP',
        senderName: r.sender_name || '-',
        senderPhone: r.sender_phone || '-',
        status: r.status,
        statusName: STATUS_NAMES_AR[r.status] || r.status,
        balanceAfter: r.stated_balance_after_minor !== null ? fromMinor(r.stated_balance_after_minor) : '-',
        date: formattedDate,
      };
    });

    // Send in chunks of 50 to avoid Apps Script execution timeout
    const CHUNK_SIZE = 50;
    let totalSent = 0;

    for (let i = 0; i < transactions.length; i += CHUNK_SIZE) {
      const chunk = transactions.slice(i, i + CHUNK_SIZE);
      const res = await fetch(org.google_sheet_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch_transactions', transactions: chunk }),
        redirect: 'follow',
      });

      if (res.ok || res.status === 200 || res.status === 302) {
        totalSent += chunk.length;
      }
    }

    db.prepare(`
      UPDATE organizations
      SET google_sheet_last_sync_at = datetime('now'),
          google_sheet_synced_count = COALESCE(google_sheet_synced_count, 0) + ?
      WHERE id = ?
    `).run(totalSent, organizationId);

    return { syncedCount: totalSent };
  }
}
