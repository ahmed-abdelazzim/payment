import { getDatabase } from '../db';
import { fromMinor } from '../money';

export interface GoogleSheetsConfig {
  authType: 'oauth' | 'webhook';
  sheetUrl: string | null;
  sheetName: string | null;
  accountEmail: string | null;
  spreadsheetId: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  syncedCount: number;
  isOAuthConfigured: boolean;
  googleClientId?: string | null;
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
   * Resolves Google OAuth credentials from env or platform_settings.
   */
  static getGoogleCredentials(): { clientId: string | null; clientSecret: string | null } {
    let clientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
    let clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || null;

    if (!clientId || !clientSecret) {
      try {
        const db = getDatabase();
        const settings = db.prepare('SELECT google_client_id, google_client_secret FROM platform_settings WHERE id = ?').get('current') as any;
        if (settings) {
          if (!clientId && settings.google_client_id) clientId = settings.google_client_id.trim();
          if (!clientSecret && settings.google_client_secret) clientSecret = settings.google_client_secret.trim();
        }
      } catch {}
    }

    return { clientId, clientSecret };
  }

  /**
   * Updates platform Google OAuth Client credentials.
   */
  static updatePlatformGoogleCredentials(clientId: string, clientSecret: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE platform_settings
      SET google_client_id = ?,
          google_client_secret = ?,
          updated_at = datetime('now')
      WHERE id = 'current'
    `).run(clientId.trim(), clientSecret.trim());
  }

  /**
   * Generates the Google OAuth 2.0 authorization URL for 1-click merchant linking.
   */
  static getOAuthAuthUrl(organizationId: string, redirectUri: string): { authUrl: string | null; isConfigured: boolean } {
    const { clientId } = this.getGoogleCredentials();
    if (!clientId) {
      return { authUrl: null, isConfigured: false };
    }

    const scope = encodeURIComponent('https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${encodeURIComponent(organizationId)}`;

    return { authUrl, isConfigured: true };
  }

  /**
   * Handles Google OAuth callback: exchanges code for tokens, creates the spreadsheet in Google Drive,
   * initializes columns, and saves the connection.
   */
  static async handleOAuthCallback(code: string, organizationId: string, redirectUri: string): Promise<GoogleSheetsConfig> {
    const { clientId, clientSecret } = this.getGoogleCredentials();
    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED: Google Client ID / Secret not set on server.');
    }

    // 1. Exchange code for access & refresh tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange authorization code with Google');
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = Number(tokenData.expires_in || 3600);
    const tokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

    // 2. Fetch user's Google email
    let userEmail: string | null = null;
    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userRes.ok) {
        const u = await userRes.json();
        userEmail = u.email || null;
      }
    } catch {}

    // 3. Fetch org info
    const db = getDatabase();
    const org = db.prepare('SELECT name, name_ar FROM organizations WHERE id = ?').get(organizationId) as any;
    const orgName = org?.name_ar || org?.name || 'صرّاف';

    // 4. Automatically create a Google Spreadsheet in user's Drive via Google Sheets API v4
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title: `صرّاف - سجل المدفوعات (${orgName})`,
        },
        sheets: [
          {
            properties: {
              title: 'المدفوعات الواردة',
              gridProperties: {
                frozenRowCount: 1,
              },
            },
            data: [
              {
                startRow: 0,
                startColumn: 0,
                rowData: [
                  {
                    values: [
                      { userEnteredValue: { stringValue: 'التاريخ والوقت' } },
                      { userEnteredValue: { stringValue: 'رقم العملية (TRX ID)' } },
                      { userEnteredValue: { stringValue: 'مزود الدفع' } },
                      { userEnteredValue: { stringValue: 'المبلغ (ج.م)' } },
                      { userEnteredValue: { stringValue: 'رقم هاتف الراسل' } },
                      { userEnteredValue: { stringValue: 'اسم الراسل' } },
                      { userEnteredValue: { stringValue: 'الحالة' } },
                      { userEnteredValue: { stringValue: 'الرصيد بعد العملية' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok || !createData.spreadsheetId) {
      throw new Error(createData.error?.message || 'Failed to create Google Spreadsheet via Google Sheets API');
    }

    const spreadsheetId = createData.spreadsheetId;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    const sheetName = `صرّاف - سجل المدفوعات (${orgName})`;

    // 5. Save credentials in database
    db.prepare(`
      UPDATE organizations
      SET google_auth_type = 'oauth',
          google_spreadsheet_id = ?,
          google_sheet_url = ?,
          google_sheet_name = ?,
          google_sheet_account_email = ?,
          google_access_token = ?,
          google_refresh_token = COALESCE(?, google_refresh_token),
          google_token_expiry = ?,
          google_sheet_connected_at = datetime('now'),
          google_sheet_last_sync_at = NULL,
          google_sheet_synced_count = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      spreadsheetId,
      sheetUrl,
      sheetName,
      userEmail,
      accessToken,
      refreshToken || null,
      tokenExpiry,
      organizationId
    );

    return this.getStatus(organizationId);
  }

  /**
   * Refreshes access token if expired for an organization.
   */
  static async getValidAccessToken(organizationId: string): Promise<string | null> {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT google_access_token, google_refresh_token, google_token_expiry
      FROM organizations
      WHERE id = ?
    `).get(organizationId) as any;

    if (!row || !row.google_access_token) return null;

    const isExpired = !row.google_token_expiry || new Date(row.google_token_expiry).getTime() <= Date.now();
    if (!isExpired) {
      return row.google_access_token;
    }

    // Refresh if we have refresh_token
    if (!row.google_refresh_token) {
      return row.google_access_token;
    }

    const { clientId, clientSecret } = this.getGoogleCredentials();
    if (!clientId || !clientSecret) return row.google_access_token;

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: row.google_refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const nextAccessToken = data.access_token;
        const expiresIn = Number(data.expires_in || 3600);
        const nextExpiry = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

        db.prepare(`
          UPDATE organizations
          SET google_access_token = ?,
              google_token_expiry = ?
          WHERE id = ?
        `).run(nextAccessToken, nextExpiry, organizationId);

        return nextAccessToken;
      }
    } catch (err) {
      console.warn('[GoogleSheetsService] Token refresh failed:', err);
    }

    return row.google_access_token;
  }

  /**
   * Returns current Google Sheets integration status for an organization.
   */
  static getStatus(organizationId: string): GoogleSheetsConfig {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT google_auth_type, google_sheet_url, google_sheet_name, google_sheet_account_email,
             google_spreadsheet_id, google_sheet_connected_at, google_sheet_last_sync_at, google_sheet_synced_count
      FROM organizations
      WHERE id = ?
    `).get(organizationId) as any;

    const { clientId } = this.getGoogleCredentials();

    if (!row) {
      return {
        authType: 'oauth',
        sheetUrl: null,
        sheetName: null,
        accountEmail: null,
        spreadsheetId: null,
        connectedAt: null,
        lastSyncAt: null,
        syncedCount: 0,
        isOAuthConfigured: !!clientId,
        googleClientId: clientId,
      };
    }

    return {
      authType: (row.google_auth_type as any) || (row.google_spreadsheet_id ? 'oauth' : 'webhook'),
      sheetUrl: row.google_sheet_url || null,
      sheetName: row.google_sheet_name || null,
      accountEmail: row.google_sheet_account_email || null,
      spreadsheetId: row.google_spreadsheet_id || null,
      connectedAt: row.google_sheet_connected_at || null,
      lastSyncAt: row.google_sheet_last_sync_at || null,
      syncedCount: Number(row.google_sheet_synced_count || 0),
      isOAuthConfigured: !!clientId,
      googleClientId: clientId,
    };
  }

  /**
   * Connects an existing Google Spreadsheet by URL or ID, or webhook URL.
   */
  static connectSheet(organizationId: string, sheetUrlOrId: string, sheetName?: string): GoogleSheetsConfig {
    const val = sheetUrlOrId.trim();
    const db = getDatabase();

    // Check if it's a standard Google Docs Spreadsheet link:
    // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit...
    const match = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      const spreadsheetId = match[1];
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      const name = sheetName?.trim() || 'Google Sheet - مدفوعات صرّاف';

      db.prepare(`
        UPDATE organizations
        SET google_auth_type = 'oauth',
            google_spreadsheet_id = ?,
            google_sheet_url = ?,
            google_sheet_name = ?,
            google_sheet_connected_at = datetime('now'),
            google_sheet_last_sync_at = NULL,
            google_sheet_synced_count = 0,
            updated_at = datetime('now')
      WHERE id = ?
      `).run(spreadsheetId, url, name, organizationId);

      return this.getStatus(organizationId);
    }

    // Webhook mode
    if (!val.startsWith('https://') && !val.startsWith('http://')) {
      throw new Error('INVALID_URL: يرجى إدخال رابط صالح (رابط شيت Google أو رابط Webhook).');
    }

    const name = sheetName?.trim() || 'Google Sheet - مدفوعات صرّاف';
    db.prepare(`
      UPDATE organizations
      SET google_auth_type = 'webhook',
          google_spreadsheet_id = NULL,
          google_sheet_url = ?,
          google_sheet_name = ?,
          google_sheet_connected_at = datetime('now'),
          google_sheet_last_sync_at = NULL,
          google_sheet_synced_count = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(val, name, organizationId);

    return this.getStatus(organizationId);
  }

  /**
   * Disconnects the active Google Sheet completely from the organization.
   */
  static disconnectSheet(organizationId: string): boolean {
    const db = getDatabase();
    db.prepare(`
      UPDATE organizations
      SET google_auth_type = 'oauth',
          google_sheet_url = NULL,
          google_sheet_name = NULL,
          google_spreadsheet_id = NULL,
          google_sheet_account_email = NULL,
          google_access_token = NULL,
          google_refresh_token = NULL,
          google_token_expiry = NULL,
          google_sheet_connected_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(organizationId);

    return true;
  }

  /**
   * Dispatches a single transaction to the connected Google Sheet via Google Sheets API v4 or Webhook.
   * Fire-and-forget safe: will never throw to disrupt the transaction lifecycle.
   */
  static async syncTransaction(organizationId: string, tx: SyncTransactionPayload): Promise<void> {
    try {
      const db = getDatabase();
      const row = db.prepare(`
        SELECT google_auth_type, google_spreadsheet_id, google_sheet_url
        FROM organizations
        WHERE id = ?
      `).get(organizationId) as { google_auth_type?: string; google_spreadsheet_id?: string; google_sheet_url?: string } | undefined;

      if (!row || (!row.google_spreadsheet_id && !row.google_sheet_url)) {
        return; // No sheet connected
      }

      const formattedDate = tx.financialEventAt
        ? new Date(tx.financialEventAt).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })
        : new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });

      const providerName = PROVIDER_NAMES_AR[tx.provider] || tx.provider;
      const statusName = STATUS_NAMES_AR[tx.status] || tx.status;
      const balanceAfter = tx.balanceAfter !== undefined && tx.balanceAfter !== null ? tx.balanceAfter : '-';

      // 1. If OAuth with Google Sheets API v4
      if (row.google_spreadsheet_id) {
        const accessToken = await this.getValidAccessToken(organizationId);
        if (accessToken) {
          const spreadsheetId = row.google_spreadsheet_id;
          const range = encodeURIComponent('A1');
          const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

          const apiRes = await fetch(appendUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [
                [
                  formattedDate,
                  tx.externalTrxId || tx.id,
                  providerName,
                  tx.amount,
                  tx.senderPhone || '-',
                  tx.senderName || '-',
                  statusName,
                  balanceAfter,
                ],
              ],
            }),
          });

          if (apiRes.ok || apiRes.status === 200) {
            db.prepare(`
              UPDATE organizations
              SET google_sheet_last_sync_at = datetime('now'),
                  google_sheet_synced_count = COALESCE(google_sheet_synced_count, 0) + 1
              WHERE id = ?
            `).run(organizationId);
            return;
          }
        }
      }

      // 2. Fallback to Webhook URL if set
      if (row.google_sheet_url && row.google_sheet_url.startsWith('http')) {
        const payload = {
          action: 'append_transaction',
          id: tx.id,
          externalTrxId: tx.externalTrxId,
          provider: tx.provider,
          providerName,
          amount: tx.amount,
          currency: tx.currency || 'EGP',
          senderName: tx.senderName || '-',
          senderPhone: tx.senderPhone || '-',
          status: tx.status,
          statusName,
          balanceAfter,
          date: formattedDate,
        };

        const res = await fetch(row.google_sheet_url, {
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
      SELECT google_auth_type, google_spreadsheet_id, google_sheet_url
      FROM organizations
      WHERE id = ?
    `).get(organizationId) as { google_auth_type?: string; google_spreadsheet_id?: string; google_sheet_url?: string } | undefined;

    if (!org || (!org.google_spreadsheet_id && !org.google_sheet_url)) {
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

    const tableRows = rows.map((r) => {
      const formattedDate = r.financial_event_at
        ? new Date(r.financial_event_at).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })
        : new Date(r.created_at).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });

      return [
        formattedDate,
        r.external_trx_id || r.id,
        PROVIDER_NAMES_AR[r.provider] || r.provider,
        fromMinor(r.amount_minor),
        r.sender_phone || '-',
        r.sender_name || '-',
        STATUS_NAMES_AR[r.status] || r.status,
        r.stated_balance_after_minor !== null ? fromMinor(r.stated_balance_after_minor) : '-',
      ];
    });

    // 1. If Google Sheets API v4
    if (org.google_spreadsheet_id) {
      const accessToken = await this.getValidAccessToken(organizationId);
      if (accessToken) {
        const range = encodeURIComponent('A1');
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${org.google_spreadsheet_id}/values/${range}:append?valueInputOption=USER_ENTERED`;

        const res = await fetch(appendUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: tableRows }),
        });

        if (res.ok) {
          db.prepare(`
            UPDATE organizations
            SET google_sheet_last_sync_at = datetime('now'),
                google_sheet_synced_count = COALESCE(google_sheet_synced_count, 0) + ?
            WHERE id = ?
          `).run(tableRows.length, organizationId);

          return { syncedCount: tableRows.length };
        }
      }
    }

    // 2. If Webhook
    if (org.google_sheet_url) {
      const structuredItems = rows.map((r) => {
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

      const res = await fetch(org.google_sheet_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch_transactions', transactions: structuredItems }),
        redirect: 'follow',
      });

      if (res.ok || res.status === 200 || res.status === 302) {
        db.prepare(`
          UPDATE organizations
          SET google_sheet_last_sync_at = datetime('now'),
              google_sheet_synced_count = COALESCE(google_sheet_synced_count, 0) + ?
          WHERE id = ?
        `).run(structuredItems.length, organizationId);

        return { syncedCount: structuredItems.length };
      }
    }

    return { syncedCount: 0 };
  }
}
