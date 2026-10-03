import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db';
import { AuditService } from './auditService';

export interface SubscriptionPlan {
  id: string;
  name_en: string;
  name_ar: string;
  billing_cycle: 'monthly' | 'annual';
  price_egp: number;
  device_limit: number;
  features_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionOrder {
  id: string;
  order_number: string;
  organization_id: string;
  user_id: string;
  plan_id: string;
  plan_name_en: string;
  plan_name_ar: string;
  billing_cycle: 'monthly' | 'annual';
  price_egp: number;
  currency: string;
  device_limit: number;
  features_json: string;
  instapay_target_number: string;
  status: 'pending_payment' | 'payment_reported' | 'in_review' | 'confirmed' | 'rejected' | 'expired';
  reported_transfer_ref?: string;
  reported_sender_info?: string;
  reported_transfer_time?: string;
  reported_notes?: string;
  reported_at?: string;
  matched_transaction_id?: string;
  approved_by_user_id?: string;
  approval_type?: 'automatic' | 'manual';
  rejection_reason?: string;
  review_notes?: string;
  expires_at: string;
  confirmed_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Accurately adds calendar months in UTC, respecting varying month lengths (28/29/30/31 days).
 */
export function addCalendarMonthsUTC(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const expectedDay = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  // If date rolled over to next month (e.g. Jan 31 -> Mar 2/3), set to last day of intended month
  if (result.getUTCDate() < expectedDay) {
    result.setUTCDate(0);
  }
  return result;
}

/**
 * Accurately adds calendar years in UTC, correctly handling Feb 29 leap years.
 */
export function addCalendarYearsUTC(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  const expectedMonth = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + years);
  if (result.getUTCMonth() !== expectedMonth) {
    result.setUTCDate(0);
  }
  return result;
}

export class SubscriptionService {
  /**
   * Calculates the exact period end timestamp in ISO UTC format.
   */
  static calculatePeriodEnd(startDate: Date | string, cycle: 'monthly' | 'annual'): string {
    const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
    const end = cycle === 'annual' ? addCalendarYearsUTC(start, 1) : addCalendarMonthsUTC(start, 1);
    return end.toISOString();
  }

  /**
   * Retrieves active subscription plans.
   */
  static getPlans(): SubscriptionPlan[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price_egp ASC').all() as unknown as SubscriptionPlan[];
  }

  /**
   * Retrieves current platform payment settings (InstaPay number and beneficiary name).
   */
  static getPlatformSettings(): { instapay_number: string; beneficiary_name: string; platform_org_id: string } {
    const db = getDatabase();
    const row = db.prepare('SELECT instapay_number, beneficiary_name, platform_org_id FROM platform_settings WHERE id = ?').get('current') as any;
    return {
      instapay_number: row?.instapay_number || '01551234263',
      beneficiary_name: row?.beneficiary_name || 'عبدالرحمن عبده',
      platform_org_id: row?.platform_org_id || 'org_platform_ops',
    };
  }

  /**
   * Creates a fresh subscription order with immutable snapshots of terms and platform InstaPay number.
   */
  static createOrder(params: {
    organizationId: string;
    userId: string;
    planId: string;
  }): SubscriptionOrder {
    const db = getDatabase();
    const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ? AND is_active = 1').get(params.planId) as unknown as SubscriptionPlan;
    if (!plan) {
      throw new Error('INVALID_PLAN');
    }

    const settings = this.getPlatformSettings();
    const orderId = `sub_ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = `SUB-${datePrefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48-hour order validity

    db.prepare(`
      INSERT INTO subscription_orders (
        id, order_number, organization_id, user_id, plan_id,
        plan_name_en, plan_name_ar, billing_cycle, price_egp, currency,
        device_limit, features_json, instapay_target_number, status,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EGP', ?, ?, ?, 'pending_payment', ?)
    `).run(
      orderId,
      orderNumber,
      params.organizationId,
      params.userId,
      plan.id,
      plan.name_en,
      plan.name_ar,
      plan.billing_cycle,
      plan.price_egp,
      plan.device_limit,
      plan.features_json,
      settings.instapay_number,
      expiresAt
    );

    AuditService.record({
      organizationId: params.organizationId,
      actorIdentity: params.userId,
      action: 'SUBSCRIPTION_ORDER_CREATED',
      resourceType: 'subscription_order',
      resourceId: orderId,
      details: { orderNumber, planId: plan.id, priceEgp: plan.price_egp, instapayNumber: settings.instapay_number },
    });

    return db.prepare('SELECT * FROM subscription_orders WHERE id = ?').get(orderId) as unknown as SubscriptionOrder;
  }

  /**
   * Merchant reports payment execution from their InstaPay app with transfer proof details.
   */
  static reportPayment(params: {
    orderId: string;
    organizationId: string;
    reportedTransferRef?: string;
    reportedSenderInfo?: string;
    reportedTransferTime?: string;
    reportedNotes?: string;
  }): { order: SubscriptionOrder; matched: boolean } {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM subscription_orders WHERE id = ? AND organization_id = ?').get(
      params.orderId,
      params.organizationId
    ) as unknown as SubscriptionOrder;

    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    if (order.status === 'confirmed') {
      return { order, matched: true };
    }

    const ref = params.reportedTransferRef?.trim() || null;
    const sender = params.reportedSenderInfo?.trim() || null;
    const time = params.reportedTransferTime?.trim() || new Date().toISOString();
    const notes = params.reportedNotes?.trim() || null;

    db.prepare(`
      UPDATE subscription_orders
      SET status = 'payment_reported',
          reported_transfer_ref = ?,
          reported_sender_info = ?,
          reported_transfer_time = ?,
          reported_notes = ?,
          reported_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(ref, sender, time, notes, params.orderId);

    // Attempt automatic matching with real platform inbound transactions
    const matchResult = this.attemptMatchOrder(params.orderId);

    const updatedOrder = db.prepare('SELECT * FROM subscription_orders WHERE id = ?').get(params.orderId) as unknown as SubscriptionOrder;
    return { order: updatedOrder, matched: matchResult.matched };
  }

  /**
   * Attempts matching a reported order with unassigned verified transactions on the platform's operational account.
   */
  static attemptMatchOrder(orderId: string): { matched: boolean; transactionId?: string } {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM subscription_orders WHERE id = ?').get(orderId) as unknown as SubscriptionOrder;
    if (!order || order.status === 'confirmed') {
      return { matched: false };
    }

    // Find candidate transactions in the platform owner's tenant (org_platform_ops)
    // Constraint: Exactly matching amount, confirmed status, and never previously assigned to an order
    const candidates = db.prepare(`
      SELECT t.id, t.external_trx_id, t.amount, t.sender_name, t.sender_phone, t.financial_event_at
      FROM transactions t
      WHERE t.organization_id = 'org_platform_ops'
        AND t.status = 'confirmed'
        AND t.amount = ?
        AND t.id NOT IN (
          SELECT matched_transaction_id FROM subscription_orders WHERE matched_transaction_id IS NOT NULL AND status = 'confirmed'
        )
      ORDER BY t.financial_event_at ASC
    `).all(order.price_egp) as any[];

    if (candidates.length === 0) {
      // No matching amount arrived yet; put in review so owner can inspect
      if (order.status === 'payment_reported') {
        db.prepare("UPDATE subscription_orders SET status = 'in_review', updated_at = datetime('now') WHERE id = ?").run(orderId);
      }
      return { matched: false };
    }

    // Check candidate with cryptographic/telecom reference equality
    let matchedCandidate: any = null;

    if (order.reported_transfer_ref) {
      const cleanReportedRef = order.reported_transfer_ref.toLowerCase().trim();
      matchedCandidate = candidates.find((c) => {
        const ext = (c.external_trx_id || '').toLowerCase().trim();
        return ext === cleanReportedRef || ext.includes(cleanReportedRef) || cleanReportedRef.includes(ext);
      });
    }

    if (!matchedCandidate && order.reported_sender_info) {
      const cleanSender = order.reported_sender_info.toLowerCase().trim();
      matchedCandidate = candidates.find((c) => {
        const phone = (c.sender_phone || '').toLowerCase().trim();
        const name = (c.sender_name || '').toLowerCase().trim();
        return (phone && phone.includes(cleanSender)) || (name && name.includes(cleanSender));
      });
    }

    // If there is only ONE candidate with this exact amount and the user reported a payment claim,
    // we require either reference verification OR route to manual owner review queue!
    if (!matchedCandidate) {
      db.prepare(`
        UPDATE subscription_orders
        SET status = 'in_review',
            review_notes = 'Candidate transaction detected with matching amount but unverified reference; routed to platform owner review queue.',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(orderId);
      return { matched: false };
    }

    // Authentic Match Verified! Execute single-spend activation
    this.activateSubscriptionFromOrder({
      orderId,
      transactionId: matchedCandidate.id,
      matchedExternalTrxId: matchedCandidate.external_trx_id,
      approvalType: 'automatic',
    });

    return { matched: true, transactionId: matchedCandidate.id };
  }

  /**
   * Invoked whenever a new transaction is processed on org_platform_ops via real device message ingestion.
   */
  static handleInboundPlatformTransaction(tx: {
    id: string;
    amount: number;
    externalTrxId: string;
    senderPhone?: string;
    senderName?: string;
  }): { autoActivatedOrderId?: string } {
    const db = getDatabase();

    // Check if any pending, payment_reported, or in_review orders match this transaction
    const candidateOrders = db.prepare(`
      SELECT * FROM subscription_orders
      WHERE status IN ('payment_reported', 'in_review', 'pending_payment')
        AND price_egp = ?
        AND matched_transaction_id IS NULL
      ORDER BY created_at ASC
    `).all(tx.amount) as unknown as SubscriptionOrder[];

    if (candidateOrders.length === 0) {
      return {};
    }

    // 1. Look for order with matching reported reference
    const cleanExt = tx.externalTrxId.toLowerCase().trim();
    let matchedOrder = candidateOrders.find((ord) => {
      if (!ord.reported_transfer_ref) return false;
      const ref = ord.reported_transfer_ref.toLowerCase().trim();
      return ref === cleanExt || cleanExt.includes(ref) || ref.includes(cleanExt);
    });

    // 2. Look for order with matching sender info
    if (!matchedOrder && (tx.senderPhone || tx.senderName)) {
      matchedOrder = candidateOrders.find((ord) => {
        if (!ord.reported_sender_info) return false;
        const sender = ord.reported_sender_info.toLowerCase().trim();
        return (tx.senderPhone && tx.senderPhone.includes(sender)) || (tx.senderName && tx.senderName.toLowerCase().includes(sender));
      });
    }

    if (matchedOrder) {
      this.activateSubscriptionFromOrder({
        orderId: matchedOrder.id,
        transactionId: tx.id,
        matchedExternalTrxId: tx.externalTrxId,
        approvalType: 'automatic',
      });
      return { autoActivatedOrderId: matchedOrder.id };
    }

    return {};
  }

  /**
   * Activates or extends an organization subscription from an approved/matched order.
   * Atomic and strictly idempotent (cannot be activated twice).
   */
  static activateSubscriptionFromOrder(params: {
    orderId: string;
    transactionId: string | null;
    matchedExternalTrxId?: string;
    approvalType: 'automatic' | 'manual';
    approvedByUserId?: string;
    reviewNotes?: string;
  }): void {
    const db = getDatabase();

    db.exec('BEGIN IMMEDIATE;');
    try {
      const order = db.prepare('SELECT * FROM subscription_orders WHERE id = ?').get(params.orderId) as unknown as SubscriptionOrder;
      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }

      if (order.status === 'confirmed') {
        db.exec('COMMIT;');
        return; // Idempotent
      }

      // If a transaction was provided, verify it has not been used by any other confirmed order
      if (params.transactionId) {
        const doubleSpendCheck = db.prepare(`
          SELECT id, order_number FROM subscription_orders
          WHERE matched_transaction_id = ? AND status = 'confirmed' AND id != ?
        `).get(params.transactionId, params.orderId) as any;

        if (doubleSpendCheck) {
          throw new Error(`TRANSACTION_ALREADY_USED_BY_ORDER_${doubleSpendCheck.order_number}`);
        }
      }

      const now = new Date();
      const nowIso = now.toISOString();

      // Check current subscription of the organization
      const existingSub = db.prepare('SELECT * FROM organization_subscriptions WHERE organization_id = ?').get(order.organization_id) as any;

      let startsAt = nowIso;
      let endsAt = this.calculatePeriodEnd(now, order.billing_cycle);

      if (existingSub) {
        const existingEnd = new Date(existingSub.ends_at);
        // If renewing while currently active, extend from the existing ends_at!
        if (existingSub.status === 'active' && existingEnd > now && existingSub.plan_id === order.plan_id) {
          startsAt = existingSub.starts_at;
          endsAt = this.calculatePeriodEnd(existingEnd, order.billing_cycle);
        } else if (existingSub.status === 'active' && existingEnd > now) {
          // Plan upgrade/change: begins immediately and extends from current expiration or now
          startsAt = nowIso;
          endsAt = this.calculatePeriodEnd(existingEnd > now ? existingEnd : now, order.billing_cycle);
        }
      }

      // 1. Mark Order as Confirmed
      db.prepare(`
        UPDATE subscription_orders
        SET status = 'confirmed',
            matched_transaction_id = ?,
            approval_type = ?,
            approved_by_user_id = ?,
            review_notes = COALESCE(?, review_notes),
            confirmed_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        params.transactionId,
        params.approvalType,
        params.approvedByUserId || null,
        params.reviewNotes || null,
        nowIso,
        nowIso,
        order.id
      );

      // 2. Upsert Organization Subscription
      const subId = existingSub?.id || `sub_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      db.prepare(`
        INSERT INTO organization_subscriptions (
          id, organization_id, plan_id, status, starts_at, ends_at,
          device_limit, features_json, last_order_id, updated_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id) DO UPDATE SET
          plan_id = excluded.plan_id,
          status = 'active',
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          device_limit = excluded.device_limit,
          features_json = excluded.features_json,
          last_order_id = excluded.last_order_id,
          updated_at = excluded.updated_at
      `).run(
        subId,
        order.organization_id,
        order.plan_id,
        startsAt,
        endsAt,
        order.device_limit,
        order.features_json,
        order.id,
        nowIso
      );

      // 3. Issue Subscription Receipt
      const receiptId = `rcpt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const receiptNumber = `RCPT-${now.getUTCFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      db.prepare(`
        INSERT INTO subscription_receipts (
          id, receipt_number, order_id, organization_id, plan_id,
          amount_paid, currency, payment_method, matched_external_trx_id,
          billing_cycle, period_start, period_end, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'EGP', 'instapay_manual', ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        receiptNumber,
        order.id,
        order.organization_id,
        order.plan_id,
        order.price_egp,
        params.matchedExternalTrxId || null,
        order.billing_cycle,
        startsAt,
        endsAt,
        nowIso
      );

      // 4. Audit Log
      AuditService.record({
        organizationId: order.organization_id,
        actorIdentity: params.approvedByUserId || 'system_auto_reconciler',
        action: 'SUBSCRIPTION_ACTIVATED',
        resourceType: 'subscription',
        resourceId: subId,
        details: {
          orderId: order.id,
          orderNumber: order.order_number,
          planId: order.plan_id,
          approvalType: params.approvalType,
          receiptNumber,
          startsAt,
          endsAt,
          deviceLimit: order.device_limit,
        },
      });

      db.exec('COMMIT;');
    } catch (err: any) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Manual approval by the Platform Owner with mandatory reason & audit trail.
   */
  static manualApproveOrder(params: {
    orderId: string;
    platformOwnerUserId: string;
    transactionId?: string;
    reason: string;
  }): void {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM subscription_orders WHERE id = ?').get(params.orderId) as unknown as SubscriptionOrder;
    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    let externalTrxId: string | undefined;
    if (params.transactionId) {
      const tx = db.prepare("SELECT external_trx_id FROM transactions WHERE id = ? AND organization_id = 'org_platform_ops'").get(params.transactionId) as any;
      if (!tx) {
        throw new Error('INVALID_PLATFORM_TRANSACTION');
      }
      externalTrxId = tx.external_trx_id;
    }

    this.activateSubscriptionFromOrder({
      orderId: params.orderId,
      transactionId: params.transactionId || null,
      matchedExternalTrxId: externalTrxId,
      approvalType: 'manual',
      approvedByUserId: params.platformOwnerUserId,
      reviewNotes: params.reason,
    });
  }

  /**
   * Manual rejection by the Platform Owner with mandatory reason.
   */
  static rejectOrder(params: {
    orderId: string;
    platformOwnerUserId: string;
    reason: string;
  }): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE subscription_orders
      SET status = 'rejected',
          rejection_reason = ?,
          approved_by_user_id = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(params.reason, params.platformOwnerUserId, params.orderId);

    const order = db.prepare('SELECT organization_id, order_number FROM subscription_orders WHERE id = ?').get(params.orderId) as any;
    if (order) {
      AuditService.record({
        organizationId: order.organization_id,
        actorIdentity: params.platformOwnerUserId,
        action: 'SUBSCRIPTION_ORDER_REJECTED',
        resourceType: 'subscription_order',
        resourceId: params.orderId,
        details: { orderNumber: order.order_number, reason: params.reason },
      });
    }
  }

  /**
   * Starts a 14-day (336 hours) free trial with 1 capture phone limit for a newly registered workspace.
   */
  static startFreeTrial(organizationId: string): void {
    const db = getDatabase();
    // Check if organization already has an existing subscription or trial
    const existing = db.prepare('SELECT id FROM organization_subscriptions WHERE organization_id = ?').get(organizationId);
    if (existing) {
      return; // Trial or subscription already provisioned
    }

    const now = new Date();
    const startsAt = now.toISOString();
    // Exactly 14 days (336 calendar hours in UTC)
    const endsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const trialSubId = `sub_trial_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const trialFeatures = JSON.stringify([
      'realtime_reconciliation',
      'macrodroid_agent',
      'hmac_security',
      'cbe_limits',
      'audit_trail',
      'csv_export',
    ]);

    db.prepare(`
      INSERT INTO organization_subscriptions (
        id, organization_id, plan_id, status, starts_at, ends_at,
        device_limit, features_json, trial_warn_48h_sent, trial_warn_24h_sent, created_at, updated_at
      ) VALUES (?, ?, 'plan_trial_14d', 'trial', ?, ?, 1, ?, 0, 0, ?, ?)
    `).run(trialSubId, organizationId, startsAt, endsAt, trialFeatures, startsAt, startsAt);

    AuditService.record({
      organizationId,
      actorIdentity: 'system_onboarding',
      action: 'FREE_TRIAL_STARTED',
      resourceType: 'subscription',
      resourceId: trialSubId,
      details: {
        startsAt,
        endsAt,
        durationHours: 336,
        deviceLimit: 1,
      },
    });
  }

  /**
   * Server-side check for device connection limits according to active plan entitlement.
   */
  static checkDeviceLimit(organizationId: string): {
    allowed: boolean;
    currentCount: number;
    maxLimit: number;
    planName: string;
    subscriptionStatus: string;
    daysRemaining: number;
    hoursRemaining?: number;
  } {
    const db = getDatabase();

    // Platform operations organization has unlimited internal devices
    if (organizationId === 'org_platform_ops') {
      return { allowed: true, currentCount: 1, maxLimit: 999, planName: 'Platform Operations', subscriptionStatus: 'active', daysRemaining: 365, hoursRemaining: 8760 };
    }

    const sub = db.prepare(`
      SELECT s.*, p.name_ar as plan_name_ar, p.name_en as plan_name_en, p.device_limit as plan_limit
      FROM organization_subscriptions s
      LEFT JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.organization_id = ?
    `).get(organizationId) as any;

    const currentCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM devices WHERE organization_id = ? AND status != 'revoked'
    `).get(organizationId) as { count: number };
    const currentCount = currentCountRow?.count || 0;

    const now = new Date();

    if (!sub) {
      // Unsubscribed merchant has starter limit of 1 device
      return {
        allowed: currentCount < 1,
        currentCount,
        maxLimit: 1,
        planName: 'Starter (1 Phone)',
        subscriptionStatus: 'inactive',
        daysRemaining: 0,
        hoursRemaining: 0,
      };
    }

    const endsAt = new Date(sub.ends_at);
    const msRemaining = endsAt.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    const hoursRemaining = Math.max(0, Math.round(msRemaining / (1000 * 60 * 60)));

    let status = sub.status;
    let allowed = true;
    const maxLimit = sub.device_limit || sub.plan_limit || 1;

    // Handle 14-Day Free Trial lifecycle
    if (status === 'trial') {
      if (now > endsAt) {
        status = 'trial_expired';
        db.prepare("UPDATE organization_subscriptions SET status = 'trial_expired', updated_at = datetime('now') WHERE organization_id = ?").run(organizationId);
        allowed = false; // Trial expired: completely prohibit adding/pairing new devices
      } else {
        allowed = currentCount < 1; // Strict 1-phone limit during trial
      }

      return {
        allowed,
        currentCount,
        maxLimit: 1,
        planName: status === 'trial' ? 'تجربة مجانية 14 يوم (هاتف واحد)' : 'انتهت التجربة المجانية',
        subscriptionStatus: status,
        daysRemaining,
        hoursRemaining,
      };
    }

    if (status === 'trial_expired') {
      return {
        allowed: false,
        currentCount,
        maxLimit: 1,
        planName: 'انتهت التجربة المجانية',
        subscriptionStatus: 'trial_expired',
        daysRemaining: 0,
        hoursRemaining: 0,
      };
    }

    // Handle Paid Subscription lifecycle
    if (now > endsAt) {
      // Grace period: 3 calendar days after expiry before hard stop
      const graceEnd = new Date(endsAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      if (now < graceEnd) {
        status = 'grace_period';
        allowed = currentCount < maxLimit;
      } else {
        status = 'expired';
        allowed = false; // Expired past grace period: cannot add new devices
      }
    } else {
      status = 'active';
      allowed = currentCount < maxLimit;
    }

    return {
      allowed,
      currentCount,
      maxLimit,
      planName: sub.plan_name_ar || sub.plan_name_en || 'Active Plan',
      subscriptionStatus: status,
      daysRemaining,
      hoursRemaining,
    };
  }

  /**
   * Retrieves active subscription details for an organization with usage metrics.
   */
  static getOrganizationSubscription(organizationId: string) {
    const db = getDatabase();
    const sub = db.prepare(`
      SELECT s.*, p.name_ar as plan_name_ar, p.name_en as plan_name_en, p.price_egp, p.billing_cycle,
             p.features_json as plan_features
      FROM organization_subscriptions s
      LEFT JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.organization_id = ?
    `).get(organizationId) as any;

    const currentCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM devices WHERE organization_id = ? AND status != 'revoked'
    `).get(organizationId) as { count: number };
    const deviceCount = currentCountRow?.count || 0;

    if (!sub) {
      return {
        hasSubscription: false,
        isTrial: false,
        trialExpired: false,
        status: 'inactive',
        planNameAr: 'بدون اشتراك',
        planNameEn: 'No Active Subscription',
        deviceLimit: 1,
        devicesUsed: deviceCount,
        devicesRemaining: Math.max(0, 1 - deviceCount),
        startsAt: '',
        endsAt: '',
        daysRemaining: 0,
        hoursRemaining: 0,
        features: [],
      };
    }

    const now = new Date();
    const endsAt = new Date(sub.ends_at);
    const msRemaining = endsAt.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    const hoursRemaining = Math.max(0, Math.round(msRemaining / (1000 * 60 * 60)));

    let status = sub.status;
    const isTrial = sub.status === 'trial' || sub.status === 'trial_expired';
    let trialExpired = false;

    if (sub.status === 'trial') {
      if (now > endsAt) {
        status = 'trial_expired';
        trialExpired = true;
        db.prepare("UPDATE organization_subscriptions SET status = 'trial_expired', updated_at = datetime('now') WHERE organization_id = ?").run(organizationId);
      } else {
        // Check for 48h and 24h warning dispatches
        this.checkTrialWarnings(sub, hoursRemaining);
      }
    } else if (sub.status === 'trial_expired') {
      trialExpired = true;
    } else if (now > endsAt) {
      const graceEnd = new Date(endsAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      status = now < graceEnd ? 'grace_period' : 'expired';
    }

    let features: string[] = [];
    try {
      features = JSON.parse(sub.features_json || sub.plan_features || '[]');
    } catch {
      features = [];
    }

    return {
      hasSubscription: true,
      id: sub.id,
      planId: sub.plan_id,
      planNameAr: sub.status === 'trial' ? 'تجربة مجانية 14 يوم' : sub.status === 'trial_expired' ? 'انتهت التجربة المجانية' : (sub.plan_name_ar || 'باقة معتمدة'),
      planNameEn: sub.status === 'trial' ? '14-Day Free Trial' : sub.status === 'trial_expired' ? 'Trial Expired' : (sub.plan_name_en || 'Active Plan'),
      billingCycle: sub.billing_cycle || 'monthly',
      priceEgp: sub.price_egp || 0,
      status,
      isTrial,
      trialExpired,
      hoursRemaining,
      deviceLimit: sub.device_limit,
      devicesUsed: deviceCount,
      devicesRemaining: Math.max(0, sub.device_limit - deviceCount),
      startsAt: sub.starts_at,
      endsAt: sub.ends_at,
      daysRemaining,
      features,
      lastOrderId: sub.last_order_id,
    };
  }

  /**
   * Sends 48h and 24h warning notifications without spam or fake messages.
   */
  private static checkTrialWarnings(sub: any, hoursRemaining: number): void {
    const db = getDatabase();
    try {
      if (hoursRemaining <= 48 && hoursRemaining > 24 && !sub.trial_warn_48h_sent) {
        db.prepare("UPDATE organization_subscriptions SET trial_warn_48h_sent = 1, updated_at = datetime('now') WHERE id = ?").run(sub.id);
        AuditService.record({
          organizationId: sub.organization_id,
          actorIdentity: 'system_trial_scheduler',
          action: 'TRIAL_EXPIRATION_WARNING_48H',
          resourceType: 'subscription',
          resourceId: sub.id,
          details: { hoursRemaining },
        });

        // If organization has Telegram configured, send real message
        const org = db.prepare('SELECT telegram_bot_token, telegram_chat_id FROM organizations WHERE id = ?').get(sub.organization_id) as any;
        if (org?.telegram_bot_token && org?.telegram_chat_id) {
          const msg = encodeURIComponent(
            '⚠️ تنبيه صرّاف: تجربتك المجانية قربت تخلص (باقي أقل من 48 ساعة).\nنتمنى صرّاف يكون ساعدك تتابع تحويلاتك بشكل أوضح. اختار الباقة المناسبة قبل انتهاء التجربة عشان تستمر متابعة الرسائل الجديدة بدون توقف.'
          );
          fetch(`https://api.telegram.org/bot${org.telegram_bot_token}/sendMessage?chat_id=${org.telegram_chat_id}&text=${msg}`).catch(() => {});
        }
      } else if (hoursRemaining <= 24 && !sub.trial_warn_24h_sent) {
        db.prepare("UPDATE organization_subscriptions SET trial_warn_24h_sent = 1, updated_at = datetime('now') WHERE id = ?").run(sub.id);
        AuditService.record({
          organizationId: sub.organization_id,
          actorIdentity: 'system_trial_scheduler',
          action: 'TRIAL_EXPIRATION_WARNING_24H',
          resourceType: 'subscription',
          resourceId: sub.id,
          details: { hoursRemaining },
        });

        const org = db.prepare('SELECT telegram_bot_token, telegram_chat_id FROM organizations WHERE id = ?').get(sub.organization_id) as any;
        if (org?.telegram_bot_token && org?.telegram_chat_id) {
          const msg = encodeURIComponent(
            '🚨 تنبيه أخير من صرّاف: باقٍ أقل من 24 ساعة على انتهاء التجربة المجانية.\nاختار باقتك الآن لتفادي توقف معالجة واستقبال الرسائل الجديدة على هواتف الالتقاط.'
          );
          fetch(`https://api.telegram.org/bot${org.telegram_bot_token}/sendMessage?chat_id=${org.telegram_chat_id}&text=${msg}`).catch(() => {});
        }
      }
    } catch {}
  }
}
