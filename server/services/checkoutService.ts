import crypto from 'node:crypto';
import { getDatabase } from '../db';
import { toMinor, fromMinor } from '../money';
import { FraudProtectionService, RiskAssessment } from './fraudProtectionService';
import { LimitEngine } from './limitEngine';

export interface CheckoutSessionData {
  id: string;
  organizationId: string;
  orderId: string;
  amountMinor: number;
  amount: number;
  currency: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  mode: 'live' | 'test';
  status: 'pending' | 'confirmed' | 'expired' | 'failed';
  selectedProvider?: string | null;
  returnUrl?: string | null;
  cancelUrl?: string | null;
  webhookUrl?: string | null;
  metadata?: Record<string, any> | null;
  matchedTransactionId?: string | null;
  customerReportedRef?: string | null;
  customerReportedPhone?: string | null;
  paymentLinkId?: string | null;
  expiresAt: string;
  confirmedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRailOption {
  provider: 'vodafone_cash' | 'instapay' | 'orange_cash' | 'etisalat_cash';
  providerLabel: string;
  providerLabelAr: string;
  walletNumber: string;
  instapayAddress?: string | null;
  instructionsAr: string;
  sourceId?: string;
  remainingDailyMinor?: number;
  dailyPercentage?: number;
  isSmartRouted?: boolean;
}

export class CheckoutService {
  /**
   * Creates a new Checkout Session
   */
  static createSession(
    organizationId: string,
    params: {
      orderId?: string;
      amount: number;
      currency?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      mode?: 'live' | 'test';
      returnUrl?: string;
      cancelUrl?: string;
      webhookUrl?: string;
      metadata?: Record<string, any>;
      paymentLinkId?: string;
      expiresInMinutes?: number;
    }
  ): CheckoutSessionData & { checkoutUrl: string } {
    const amountMinor = toMinor(params.amount, { allowZero: false });
    const mode = params.mode === 'test' ? 'test' : 'live';
    const orderId = params.orderId?.trim() || `ORD-${Date.now().toString(36).toUpperCase()}`;
    const id = `cs_${mode}_${crypto.randomBytes(12).toString('hex')}`;

    // Anti-Fraud check: Ensure customer phone is not blacklisted
    if (params.customerPhone) {
      const risk = FraudProtectionService.assessSender(organizationId, params.customerPhone);
      if (risk.isBlocked) {
        throw new Error('CUSTOMER_BLOCKED: رقم الهاتف هذا محظور من إجراء عمليات الدفع لدى هذا المتجر');
      }
    }

    const minutes = params.expiresInMinutes && params.expiresInMinutes > 0 ? params.expiresInMinutes : 30;
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const db = getDatabase();
    db.prepare(`
      INSERT INTO checkout_sessions (
        id, organization_id, order_id, amount_minor, currency,
        customer_name, customer_phone, customer_email, mode, status,
        return_url, cancel_url, webhook_url, metadata_json, payment_link_id,
        expires_at
      ) VALUES (?, ?, ?, ?, 'EGP', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      organizationId,
      orderId,
      amountMinor,
      params.customerName?.trim() || null,
      params.customerPhone?.trim() || null,
      params.customerEmail?.trim() || null,
      mode,
      params.returnUrl?.trim() || null,
      params.cancelUrl?.trim() || null,
      params.webhookUrl?.trim() || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.paymentLinkId || null,
      expiresAt
    );

    const session = this.getSession(id);
    if (!session) {
      throw new Error('SESSION_CREATION_FAILED');
    }

    return {
      ...session,
      checkoutUrl: `/pay/${id}`,
    };
  }

  /**
   * Retrieves a Checkout Session by ID along with merchant payment rails
   */
  static getSession(sessionId: string): (CheckoutSessionData & {
    merchantName: string;
    merchantNameAr: string;
    rails: PaymentRailOption[];
  }) | null {
    const db = getDatabase();

    // Check if this is a direct Payment Link (plink_...)
    if (sessionId && sessionId.startsWith('plink_')) {
      const link = db.prepare(`
        SELECT pl.*, o.name as org_name, o.name_ar as org_name_ar
        FROM payment_links pl
        JOIN organizations o ON pl.organization_id = o.id
        WHERE pl.id = ? AND pl.is_active = 1
      `).get(sessionId) as any;

      if (!link) return null;

      const sources = db.prepare(`
        SELECT ps.id, ps.provider, ps.friendly_name, ps.wallet_number,
               (SELECT address_value FROM payment_addresses WHERE payment_source_id = ps.id AND address_type = 'instapay_vpa' LIMIT 1) as instapay_vpa
        FROM payment_sources ps
        WHERE ps.organization_id = ? AND ps.is_paused_for_new_instructions = 0 AND ps.retired_at IS NULL
      `).all(link.organization_id) as any[];

      const providerLabelsAr: Record<string, string> = {
        vodafone_cash: 'فودافون كاش',
        instapay: 'إنستاباي (InstaPay)',
        orange_cash: 'أورانج كاش',
        etisalat_cash: 'إي آند كاش (اتصالات كاش)',
      };

      const providerLabelsEn: Record<string, string> = {
        vodafone_cash: 'Vodafone Cash',
        instapay: 'InstaPay',
        orange_cash: 'Orange Cash',
        etisalat_cash: 'e& Cash',
      };

      const rails: PaymentRailOption[] = sources.map((s) => ({
        provider: s.provider,
        providerLabel: providerLabelsEn[s.provider] || s.provider,
        providerLabelAr: providerLabelsAr[s.provider] || s.friendly_name,
        walletNumber: s.wallet_number,
        instapayAddress: s.instapay_vpa || (s.provider === 'instapay' ? s.wallet_number : null),
        instructionsAr: s.provider === 'instapay'
          ? `حوّل المبلغ المطلوب عبر تطبيق إنستاباي إلى العنوان/الرقم: ${s.wallet_number}`
          : `حوّل المبلغ المطلوب عبر محفظة ${providerLabelsAr[s.provider] || 'المحفظة'} إلى الرقم: ${s.wallet_number}`,
      }));

      if (rails.length === 0) {
        rails.push(
          {
            provider: 'vodafone_cash',
            providerLabel: 'Vodafone Cash (Demo Sandbox)',
            providerLabelAr: 'فودافون كاش (تجريبي - Sandbox)',
            walletNumber: '01000000000',
            instructionsAr: 'بيئة تجريبية: يمكنك محاكاة التحويل دون إرسال أموال حقيقية.',
          },
          {
            provider: 'instapay',
            providerLabel: 'InstaPay (Demo Sandbox)',
            providerLabelAr: 'إنستاباي (تجريبي - Sandbox)',
            walletNumber: 'sandbox@instapay',
            instapayAddress: 'sandbox@instapay',
            instructionsAr: 'بيئة تجريبية: يمكنك محاكاة التحويل دون إرسال أموال حقيقية.',
          }
        );
      }

      return {
        id: link.id,
        organizationId: link.organization_id,
        orderId: `LINK-${link.id.slice(-6).toUpperCase()}`,
        amountMinor: link.amount_minor,
        amount: fromMinor(link.amount_minor),
        currency: link.currency || 'EGP',
        customerName: null,
        customerPhone: null,
        customerEmail: null,
        mode: 'live',
        status: 'pending',
        returnUrl: link.redirect_url,
        cancelUrl: null,
        webhookUrl: null,
        metadata: { is_payment_link: true, title: link.title, description: link.description },
        paymentLinkId: link.id,
        expiresAt: new Date(Date.now() + 86400000 * 365).toISOString(),
        createdAt: link.created_at,
        updatedAt: link.updated_at,
        merchantName: link.org_name,
        merchantNameAr: link.org_name_ar || link.org_name,
        rails,
      };
    }

    const row = db.prepare(`
      SELECT s.*, o.name as org_name, o.name_ar as org_name_ar
      FROM checkout_sessions s
      JOIN organizations o ON s.organization_id = o.id
      WHERE s.id = ?
    `).get(sessionId) as any;

    if (!row) return null;

    // Check expiry
    let status = row.status;
    const now = new Date().toISOString();
    if (status === 'pending' && row.expires_at < now) {
      status = 'expired';
      db.prepare("UPDATE checkout_sessions SET status = 'expired', updated_at = datetime('now') WHERE id = ?").run(sessionId);
    }

    // Fetch active payment sources for merchant
    const sources = db.prepare(`
      SELECT ps.id, ps.provider, ps.friendly_name, ps.wallet_number,
             (SELECT address_value FROM payment_addresses WHERE payment_source_id = ps.id AND address_type = 'instapay_vpa' LIMIT 1) as instapay_vpa
      FROM payment_sources ps
      WHERE ps.organization_id = ? AND ps.is_paused_for_new_instructions = 0 AND ps.retired_at IS NULL
    `).all(row.organization_id) as any[];

    const providerLabelsAr: Record<string, string> = {
      vodafone_cash: 'فودافون كاش',
      instapay: 'إنستاباي (InstaPay)',
      orange_cash: 'أورانج كاش',
      etisalat_cash: 'إي آند كاش (اتصالات كاش)',
    };

    const providerLabelsEn: Record<string, string> = {
      vodafone_cash: 'Vodafone Cash',
      instapay: 'InstaPay',
      orange_cash: 'Orange Cash',
      etisalat_cash: 'e& Cash',
    };

    // Smart Wallet Cascading: calculate remaining capacity and route optimally
    const sourcesWithCapacity = sources.map((s) => ({
      ...s,
      capacity: LimitEngine.getSourceCapacity(row.organization_id, s.id),
    }));

    // If multiple sources exist for same provider, filter out saturated (>=98%) ones
    const healthySources = sourcesWithCapacity.filter((s) => {
      if (s.capacity.dailyPercentage >= 98) {
        const hasAlternate = sourcesWithCapacity.some(
          (other) => other.provider === s.provider && other.id !== s.id && other.capacity.dailyPercentage < 98
        );
        if (hasAlternate) return false;
      }
      return true;
    });

    // Sort by remaining daily capacity descending (healthiest wallet first)
    healthySources.sort((a, b) => b.capacity.remainingDailyMinor - a.capacity.remainingDailyMinor);

    // Group by provider so customer is offered the single healthiest wallet for each payment method
    const seenProviders = new Set<string>();
    const bestSourcesPerProvider = healthySources.filter((s) => {
      if (seenProviders.has(s.provider)) return false;
      seenProviders.add(s.provider);
      return true;
    });

    const rails: PaymentRailOption[] = bestSourcesPerProvider.map((s) => ({
      provider: s.provider,
      providerLabel: providerLabelsEn[s.provider] || s.provider,
      providerLabelAr: providerLabelsAr[s.provider] || s.friendly_name,
      walletNumber: s.wallet_number,
      instapayAddress: s.instapay_vpa || (s.provider === 'instapay' ? s.wallet_number : null),
      instructionsAr: s.provider === 'instapay'
        ? `حوّل المبلغ المطلوب عبر تطبيق إنستاباي إلى العنوان/الرقم: ${s.wallet_number}`
        : `حوّل المبلغ المطلوب عبر محفظة ${providerLabelsAr[s.provider] || 'المحفظة'} إلى الرقم: ${s.wallet_number}`,
      sourceId: s.id,
      remainingDailyMinor: s.capacity.remainingDailyMinor,
      dailyPercentage: s.capacity.dailyPercentage,
      isSmartRouted: true,
    }));

    // Sandbox test mode demo fallback rails if merchant has not added any real sources yet
    if (rails.length === 0 && row.mode === 'test') {
      rails.push(
        {
          provider: 'vodafone_cash',
          providerLabel: 'Vodafone Cash (Demo Sandbox)',
          providerLabelAr: 'فودافون كاش (تجريبي - Sandbox)',
          walletNumber: '01000000000',
          instructionsAr: 'بيئة تجريبية: يمكنك محاكاة التحويل دون إرسال أموال حقيقية.',
        },
        {
          provider: 'instapay',
          providerLabel: 'InstaPay (Demo Sandbox)',
          providerLabelAr: 'إنستاباي (تجريبي - Sandbox)',
          walletNumber: 'sandbox@instapay',
          instapayAddress: 'sandbox@instapay',
          instructionsAr: 'بيئة تجريبية: يمكنك محاكاة التحويل دون إرسال أموال حقيقية.',
        }
      );
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      orderId: row.order_id,
      amountMinor: row.amount_minor,
      amount: fromMinor(row.amount_minor),
      currency: row.currency || 'EGP',
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerEmail: row.customer_email,
      mode: row.mode || 'live',
      status,
      selectedProvider: row.selected_provider,
      returnUrl: row.return_url,
      cancelUrl: row.cancel_url,
      webhookUrl: row.webhook_url,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      matchedTransactionId: row.matched_transaction_id,
      customerReportedRef: row.customer_reported_ref,
      customerReportedPhone: row.customer_reported_phone,
      paymentLinkId: row.payment_link_id,
      expiresAt: row.expires_at,
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      merchantName: row.org_name,
      merchantNameAr: row.org_name_ar || row.org_name,
      rails,
    };
  }

  /**
   * Lightweight status check for live polling
   */
  static getSessionStatus(sessionId: string): {
    id: string;
    status: 'pending' | 'confirmed' | 'expired' | 'failed';
    confirmedAt?: string | null;
    returnUrl?: string | null;
    matchedExternalTrxId?: string | null;
  } | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT s.id, s.status, s.expires_at, s.confirmed_at, s.return_url, t.external_trx_id
      FROM checkout_sessions s
      LEFT JOIN transactions t ON s.matched_transaction_id = t.id
      WHERE s.id = ?
    `).get(sessionId) as any;

    if (!row) return null;

    let status = row.status;
    if (status === 'pending' && row.expires_at < new Date().toISOString()) {
      status = 'expired';
      db.prepare("UPDATE checkout_sessions SET status = 'expired', updated_at = datetime('now') WHERE id = ?").run(sessionId);
    }

    return {
      id: row.id,
      status,
      confirmedAt: row.confirmed_at,
      returnUrl: row.return_url,
      matchedExternalTrxId: row.external_trx_id || null,
    };
  }

  /**
   * Matches an incoming transaction against pending checkout sessions for this tenant
   */
  static matchIncomingTransaction(
    db: any,
    organizationId: string,
    trx: {
      id: string;
      external_trx_id: string;
      amount_minor: number;
      currency: string;
      provider: string;
      sender_phone?: string;
      financial_event_at: string;
    }
  ): string | null {
    // 1. Look for pending checkout sessions for this merchant with exact amount_minor that have not expired
    const candidateSessions = db.prepare(`
      SELECT *
      FROM checkout_sessions
      WHERE organization_id = ?
        AND status = 'pending'
        AND amount_minor = ?
        AND expires_at >= datetime('now')
      ORDER BY created_at ASC
    `).all(organizationId, trx.amount_minor) as any[];

    if (candidateSessions.length === 0) {
      return null;
    }

    let matchedSession: any = null;

    // A. Check for matching customer_reported_ref
    if (trx.external_trx_id) {
      matchedSession = candidateSessions.find(
        (s) => s.customer_reported_ref && s.customer_reported_ref.trim() === trx.external_trx_id.trim()
      );
    }

    // B. Check for matching phone number
    if (!matchedSession && trx.sender_phone) {
      const cleanTrxPhone = trx.sender_phone.replace(/\D/g, '').slice(-10);
      matchedSession = candidateSessions.find((s) => {
        const phone = s.customer_reported_phone || s.customer_phone;
        if (!phone) return false;
        const cleanSessionPhone = phone.replace(/\D/g, '').slice(-10);
        return cleanSessionPhone === cleanTrxPhone;
      });
    }

    // C. Otherwise fallback to the oldest active pending session with exact amount
    if (!matchedSession) {
      matchedSession = candidateSessions[0];
    }

    // 2. Mark session as confirmed
    const confirmedAt = new Date().toISOString();
    db.prepare(`
      UPDATE checkout_sessions
      SET status = 'confirmed',
          matched_transaction_id = ?,
          selected_provider = ?,
          confirmed_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(trx.id, trx.provider, confirmedAt, matchedSession.id);

    // 3. Update payment_link counters if this was created from a payment link
    if (matchedSession.payment_link_id) {
      db.prepare(`
        UPDATE payment_links
        SET total_collected_minor = total_collected_minor + ?,
            successful_payments_count = successful_payments_count + 1,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(trx.amount_minor, matchedSession.payment_link_id);
    }

    // 4. Enqueue webhook dispatch for merchant
    const webhookPayload = {
      event: 'payment.confirmed',
      session_id: matchedSession.id,
      order_id: matchedSession.order_id,
      amount: fromMinor(trx.amount_minor),
      amount_minor: trx.amount_minor,
      currency: trx.currency || 'EGP',
      provider: trx.provider,
      transaction_id: trx.id,
      external_trx_id: trx.external_trx_id,
      customer_name: matchedSession.customer_name,
      customer_phone: matchedSession.customer_phone,
      confirmed_at: confirmedAt,
      metadata: matchedSession.metadata_json ? JSON.parse(matchedSession.metadata_json) : null,
      session_webhook_url: matchedSession.webhook_url || null,
      webhook_url: matchedSession.webhook_url || null,
    };

    db.prepare(`
      INSERT OR IGNORE INTO outbox_jobs (id, organization_id, job_type, payload)
      VALUES (?, ?, 'dispatch_webhook', ?)
    `).run(
      `job_checkout_${matchedSession.id}`,
      organizationId,
      JSON.stringify(webhookPayload)
    );

    return matchedSession.id;
  }

  /**
   * Customer claims payment by submitting their sender phone or transaction reference
   */
  static claimManualReference(
    sessionId: string,
    data: { senderPhone?: string; transferRef?: string }
  ): { matched: boolean; session: CheckoutSessionData } {
    const db = getDatabase();
    const session = this.getSession(sessionId);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (session.status === 'confirmed') return { matched: true, session };

    const cleanRef = data.transferRef?.trim() || null;
    const cleanPhone = data.senderPhone?.trim() || null;

    if (cleanPhone) {
      const risk = FraudProtectionService.assessSender(session.organizationId, cleanPhone);
      if (risk.isBlocked) {
        throw new Error('SENDER_BLOCKED: رقم الهاتف محظور من المطالبة بسبب نشاط مشبوه سابق');
      }
    }

    db.prepare(`
      UPDATE checkout_sessions
      SET customer_reported_ref = COALESCE(?, customer_reported_ref),
          customer_reported_phone = COALESCE(?, customer_reported_phone),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(cleanRef, cleanPhone, sessionId);

    // Check if there is an unattached confirmed transaction in the last 60 minutes
    const candidates = db.prepare(`
      SELECT t.*
      FROM transactions t
      WHERE t.organization_id = ?
        AND t.status = 'confirmed'
        AND t.amount_minor = ?
        AND t.financial_event_at >= datetime('now', '-60 minutes')
        AND NOT EXISTS (
          SELECT 1 FROM checkout_sessions cs WHERE cs.matched_transaction_id = t.id
        )
      ORDER BY t.financial_event_at DESC
    `).all(session.organizationId, session.amountMinor) as any[];

    for (const trx of candidates) {
      let isMatch = false;
      if (cleanRef && trx.external_trx_id && trx.external_trx_id.trim() === cleanRef) {
        isMatch = true;
      }
      if (!isMatch && cleanPhone && trx.sender_phone) {
        const cleanTrxPhone = trx.sender_phone.replace(/\D/g, '').slice(-10);
        const cleanUserPhone = cleanPhone.replace(/\D/g, '').slice(-10);
        if (cleanTrxPhone === cleanUserPhone) {
          isMatch = true;
        }
      }

      if (isMatch) {
        db.exec('BEGIN IMMEDIATE;');
        try {
          this.matchIncomingTransaction(db, session.organizationId, trx);
          db.exec('COMMIT;');
          const updated = this.getSession(sessionId)!;
          return { matched: true, session: updated };
        } catch (e) {
          db.exec('ROLLBACK;');
        }
      }
    }

    const updated = this.getSession(sessionId)!;
    return { matched: updated.status === 'confirmed', session: updated };
  }

  /**
   * Sandbox & Live Simulator: simulates a successful incoming customer payment
   */
  static simulateConfirmation(sessionId: string): CheckoutSessionData {
    const db = getDatabase();
    const session = this.getSession(sessionId);
    if (!session) throw new Error('SESSION_NOT_FOUND');

    if (session.status === 'confirmed') return session;

    const fakeTrxId = `trx_sim_${Date.now().toString(36)}`;
    const fakeExternalTrxId = `SIM-${Math.floor(10000000 + Math.random() * 90000000)}`;
    const provider = session.rails[0]?.provider || 'vodafone_cash';

    db.exec('BEGIN IMMEDIATE;');
    try {
      // Find or create balance account
      let balanceAccount = db.prepare('SELECT id FROM balance_accounts WHERE organization_id = ? LIMIT 1').get(session.organizationId) as any;
      if (!balanceAccount) {
        balanceAccount = { id: `acc_${session.organizationId}` };
        db.prepare('INSERT INTO balance_accounts (id, organization_id, account_name) VALUES (?, ?, ?)').run(balanceAccount.id, session.organizationId, 'Simulated Ledger');
      }

      let source = db.prepare('SELECT id FROM payment_sources WHERE organization_id = ? LIMIT 1').get(session.organizationId) as any;
      if (!source) {
        source = { id: `src_sim_${session.organizationId}` };
        db.prepare(`
          INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit_minor, monthly_turnover_limit_minor)
          VALUES (?, ?, ?, ?, ?, '01000000000', 10000000, 30000000)
        `).run(source.id, session.organizationId, balanceAccount.id, provider, 'Simulated Wallet');
      }

      // Insert transaction
      db.prepare(`
        INSERT INTO transactions (
          id, organization_id, balance_account_id, payment_source_id, external_trx_id,
          provider, amount_minor, currency, status, reconciliation_state,
          provenance_confidence, financial_event_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'EGP', 'confirmed', 'consistent', 1.0, datetime('now'))
      `).run(fakeTrxId, session.organizationId, balanceAccount.id, source.id, fakeExternalTrxId, provider, session.amountMinor);

      this.matchIncomingTransaction(db, session.organizationId, {
        id: fakeTrxId,
        external_trx_id: fakeExternalTrxId,
        amount_minor: session.amountMinor,
        currency: 'EGP',
        provider,
        financial_event_at: new Date().toISOString(),
      });

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    return this.getSession(sessionId)!;
  }

  /**
   * List recent sessions for merchant dashboard
   */
  static listSessions(organizationId: string, limit = 50): CheckoutSessionData[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT *
      FROM checkout_sessions
      WHERE organization_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(organizationId, limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      orderId: row.order_id,
      amountMinor: row.amount_minor,
      amount: fromMinor(row.amount_minor),
      currency: row.currency || 'EGP',
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerEmail: row.customer_email,
      mode: row.mode || 'live',
      status: row.status,
      selectedProvider: row.selected_provider,
      returnUrl: row.return_url,
      cancelUrl: row.cancel_url,
      webhookUrl: row.webhook_url,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      matchedTransactionId: row.matched_transaction_id,
      customerReportedRef: row.customer_reported_ref,
      customerReportedPhone: row.customer_reported_phone,
      paymentLinkId: row.payment_link_id,
      expiresAt: row.expires_at,
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Generates a pre-filled, compliant WhatsApp receipt URL for the customer
   */
  static generateWhatsAppReceiptUrl(sessionOrId: string | CheckoutSessionData, merchantPhone?: string): string | null {
    let session: any = null;
    let merchantNameAr = '';
    let merchantName = '';

    if (typeof sessionOrId === 'string') {
      const db = getDatabase();
      const row = db.prepare(`
        SELECT cs.*, o.name as org_name, o.name_ar as org_name_ar, o.whatsapp_business_phone
        FROM checkout_sessions cs
        JOIN organizations o ON cs.organization_id = o.id
        WHERE cs.id = ?
      `).get(sessionOrId) as any;

      if (!row) return null;
      merchantPhone = merchantPhone || row.whatsapp_business_phone;
      merchantNameAr = row.org_name_ar || '';
      merchantName = row.org_name || '';
      session = {
        id: row.id,
        orderId: row.order_id,
        amount: fromMinor(row.amount_minor),
        amountMinor: row.amount_minor,
        currency: row.currency,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        status: row.status,
        selectedProvider: row.selected_provider,
        confirmedAt: row.confirmed_at,
        customerReportedPhone: row.customer_reported_phone,
        matchedTransactionId: row.matched_transaction_id,
      };
    } else {
      session = sessionOrId;
      merchantNameAr = (session as any).merchantNameAr || '';
      merchantName = (session as any).merchantName || '';
    }

    if (!session) return null;

    const rawTarget = merchantPhone || session.customerReportedPhone || session.customerPhone || '';
    let cleanPhone = rawTarget.replace(/\D/g, '');
    if (cleanPhone.startsWith('01') && cleanPhone.length === 11) {
      cleanPhone = `2${cleanPhone}`;
    }

    const providerNames: Record<string, string> = {
      vodafone_cash: 'فودافون كاش',
      instapay: 'إنستاباي (InstaPay)',
      orange_cash: 'أورانج كاش',
      etisalat_cash: 'إي آند كاش',
    };

    const method = providerNames[session.selectedProvider || ''] || 'المحفظة الإلكترونية';
    const amountStr = Number(session.amount).toFixed(2);
    const dateStr = session.confirmedAt
      ? new Date(session.confirmedAt).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })
      : new Date().toLocaleDateString('ar-EG');
    const storeDisplayName = merchantNameAr || merchantName || 'صرّاف';

    const message =
      `*🧾 إيصال تأكيد سداد إلكتروني معتمد - ${storeDisplayName}*\n` +
      `──────────────────\n` +
      `📦 *رقم الطلب:* ${session.orderId}\n` +
      `💰 *المبلغ المسدد:* ${amountStr} ج.م\n` +
      `💳 *وسيلة الدفع:* ${method}\n` +
      `✅ *حالة السداد:* مؤكد بنجاح ومطابق بنكياً\n` +
      `📅 *التوقيت:* ${dateStr}\n` +
      (session.matchedTransactionId ? `🔖 *رقم العملية:* ${session.matchedTransactionId}\n` : '') +
      `──────────────────\n` +
      `شكراً لتعاملكم مع ${storeDisplayName}!`;

    const baseUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : 'https://wa.me/';
    return `${baseUrl}?text=${encodeURIComponent(message)}`;
  }
}
