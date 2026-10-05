import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db';
import { AuditService } from './auditService';
import { fromMinor } from '../money';

/** SQL fragment exposing an order/plan price as EGP for API consumers only. */
const PRICE_EGP_COLUMN = 'price_minor / 100.0 AS price_egp';

/**
 * Product terms are kept here so the server never creates an order from a
 * modified database row with a different price or device entitlement.
 */
export const OFFICIAL_SUBSCRIPTION_PLANS = {
  plan_monthly_3: {
    billingCycle: 'monthly',
    priceMinor: 49900,
    priceEgp: 499,
    deviceLimit: 3,
  },
  plan_monthly_5: {
    billingCycle: 'monthly',
    priceMinor: 79900,
    priceEgp: 799,
    deviceLimit: 5,
  },
  plan_annual_10: {
    billingCycle: 'annual',
    priceMinor: 799000,
    priceEgp: 7990,
    deviceLimit: 10,
  },
} as const;

export const FREE_TRIAL_PLAN_ID = 'plan_trial_7d';
export const FREE_TRIAL_DURATION_HOURS = 7 * 24;
export const FREE_TRIAL_DEVICE_LIMIT = 1;

type OfficialPlanId = keyof typeof OFFICIAL_SUBSCRIPTION_PLANS;

function sameMinor(left: unknown, right: unknown): boolean {
  const l = Number(left);
  const r = Number(right);
  return Number.isSafeInteger(l) && Number.isSafeInteger(r) && l === r;
}

function normalizeTransferReference(value?: string | null): string | null {
  const normalized = value?.trim().toLocaleLowerCase('en-US');
  return normalized || null;
}

function getOfficialPlan(planId: string): (typeof OFFICIAL_SUBSCRIPTION_PLANS)[OfficialPlanId] | null {
  return Object.prototype.hasOwnProperty.call(OFFICIAL_SUBSCRIPTION_PLANS, planId)
    ? OFFICIAL_SUBSCRIPTION_PLANS[planId as OfficialPlanId]
    : null;
}

export interface SubscriptionPlan {
  id: string;
  name_en: string;
  name_ar: string;
  billing_cycle: 'monthly' | 'annual';
  price_minor: number;
  /** Derived for API consumers; never use for arithmetic. */
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
  price_minor: number;
  /** Derived for API consumers; never use for arithmetic. */
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

  private static assertOfficialPlanTerms(plan: SubscriptionPlan): void {
    const expected = getOfficialPlan(plan.id);
    if (!expected) {
      throw new Error('INVALID_PLAN');
    }

    if (
      plan.billing_cycle !== expected.billingCycle ||
      !sameMinor(plan.price_minor, expected.priceMinor) ||
      Number(plan.device_limit) !== expected.deviceLimit
    ) {
      throw new Error(`PLAN_TERMS_MISMATCH_${plan.id}`);
    }
  }

  /**
   * Retrieves active subscription plans.
   */
  static getPlans(): SubscriptionPlan[] {
    const db = getDatabase();
    const plans = db.prepare(`
      SELECT *, ${PRICE_EGP_COLUMN} FROM subscription_plans
      WHERE id IN ('plan_monthly_3', 'plan_monthly_5', 'plan_annual_10')
        AND is_active = 1
      ORDER BY CASE id
        WHEN 'plan_monthly_3' THEN 1
        WHEN 'plan_monthly_5' THEN 2
        WHEN 'plan_annual_10' THEN 3
      END
    `).all() as unknown as SubscriptionPlan[];

    if (plans.length !== Object.keys(OFFICIAL_SUBSCRIPTION_PLANS).length) {
      throw new Error('OFFICIAL_PLAN_CONFIGURATION_INCOMPLETE');
    }

    for (const plan of plans) {
      this.assertOfficialPlanTerms(plan);
    }

    return plans;
  }

  /**
   * Retrieves current platform payment settings (InstaPay number and beneficiary name).
   */
  static getPlatformSettings(): {
    instapay_number: string;
    beneficiary_name: string;
    platform_org_id: string;
    platform_source_id: string;
  } {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT instapay_number, beneficiary_name, platform_org_id, platform_source_id
      FROM platform_settings
      WHERE id = ?
    `).get('current') as any;
    return {
      instapay_number: row?.instapay_number || '01551234263',
      beneficiary_name: row?.beneficiary_name || 'عبدالرحمن عبده',
      platform_org_id: row?.platform_org_id || 'org_platform_ops',
      platform_source_id: row?.platform_source_id || 'src_platform_instapay',
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
    if (!getOfficialPlan(params.planId)) {
      throw new Error('INVALID_PLAN');
    }

    const plan = db.prepare(`SELECT *, ${PRICE_EGP_COLUMN} FROM subscription_plans WHERE id = ? AND is_active = 1`).get(params.planId) as unknown as SubscriptionPlan;
    if (!plan) {
      throw new Error('INVALID_PLAN');
    }
    this.assertOfficialPlanTerms(plan);

    const settings = this.getPlatformSettings();
    const orderId = `sub_ord_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderNumber = `SUB-${datePrefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48-hour order validity

    db.prepare(`
      INSERT INTO subscription_orders (
        id, order_number, organization_id, user_id, plan_id,
        plan_name_en, plan_name_ar, billing_cycle, price_minor, currency,
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
      plan.price_minor,
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
      details: { orderNumber, planId: plan.id, priceMinor: plan.price_minor, priceEgp: fromMinor(plan.price_minor), instapayNumber: settings.instapay_number },
    });

    return this.getOrderById(orderId)!;
  }

  /** Reads one order with its derived EGP price. */
  static getOrderById(orderId: string, organizationId?: string): SubscriptionOrder | undefined {
    const db = getDatabase();
    return (organizationId
      ? db.prepare(`SELECT *, ${PRICE_EGP_COLUMN} FROM subscription_orders WHERE id = ? AND organization_id = ?`).get(orderId, organizationId)
      : db.prepare(`SELECT *, ${PRICE_EGP_COLUMN} FROM subscription_orders WHERE id = ?`).get(orderId)) as unknown as SubscriptionOrder | undefined;
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
    const order = this.getOrderById(params.orderId, params.organizationId) as SubscriptionOrder;

    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    if (order.status === 'confirmed') {
      return { order, matched: true };
    }

    if (order.status === 'rejected') {
      throw new Error('ORDER_REJECTED');
    }

    const ref = params.reportedTransferRef?.trim() || null;
    const sender = params.reportedSenderInfo?.trim() || null;
    const time = params.reportedTransferTime?.trim() || new Date().toISOString();
    const notes = params.reportedNotes?.trim() || null;
    const orderHasExpired = new Date(order.expires_at).getTime() <= Date.now();

    // A merchant claim is never enough to activate a subscription. Expired
    // orders must also be inspected by a platform operator, even if a later
    // transfer looks similar to the original amount.
    const nextStatus = order.status === 'expired' || orderHasExpired ? 'in_review' : 'payment_reported';
    const reviewNote = order.status === 'expired' || orderHasExpired
      ? 'Payment was reported after the order expiry window and requires platform-owner review.'
      : null;

    db.prepare(`
      UPDATE subscription_orders
      SET status = ?,
          reported_transfer_ref = ?,
          reported_sender_info = ?,
          reported_transfer_time = ?,
          reported_notes = ?,
          review_notes = COALESCE(?, review_notes),
          reported_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(nextStatus, ref, sender, time, notes, reviewNote, params.orderId);

    if (nextStatus === 'in_review') {
      const updatedOrder = this.getOrderById(params.orderId) as SubscriptionOrder;
      return { order: updatedOrder, matched: false };
    }

    // Automatic activation is allowed only when the platform has a separate,
    // trusted inbound record with the exact same unique transfer reference.
    const matchResult = this.attemptMatchOrder(params.orderId);

    const updatedOrder = this.getOrderById(params.orderId) as SubscriptionOrder;
    return { order: updatedOrder, matched: matchResult.matched };
  }

  /**
   * Attempts matching a reported order with unassigned verified transactions on the platform's operational account.
   */
  static attemptMatchOrder(orderId: string): { matched: boolean; transactionId?: string } {
    const db = getDatabase();
    const order = this.getOrderById(orderId) as SubscriptionOrder;
    if (!order || order.status !== 'payment_reported') {
      return { matched: false };
    }

    const reference = normalizeTransferReference(order.reported_transfer_ref);
    if (!reference) {
      this.markOrderForReview(orderId, 'A unique platform transfer reference is required before automatic subscription activation.');
      return { matched: false };
    }

    const settings = this.getPlatformSettings();

    // A matching amount, sender name, or phone is only supporting evidence. The
    // platform must have one independently captured, signed transaction on its
    // own registered receiving source with the exact transfer reference.
    const candidates = db.prepare(`
      SELECT t.id, t.external_trx_id, t.amount_minor, t.sender_name, t.sender_phone, t.financial_event_at,
             t.payment_source_id, t.reconciliation_state, t.provenance_confidence, t.signature
      FROM transactions t
      WHERE t.organization_id = ?
        AND t.payment_source_id = ?
        AND t.status = 'confirmed'
        AND t.reconciliation_state = 'consistent'
        AND t.provenance_confidence >= 1
        AND t.signature IS NOT NULL
        AND trim(t.signature) != ''
        AND t.signature != 'webhook_token_verified'
        AND t.amount_minor = ?
        AND lower(trim(t.external_trx_id)) = ?
        AND t.id NOT IN (
          SELECT matched_transaction_id FROM subscription_orders WHERE matched_transaction_id IS NOT NULL AND status = 'confirmed'
        )
      ORDER BY t.financial_event_at ASC
    `).all(settings.platform_org_id, settings.platform_source_id, order.price_minor, reference) as any[];

    if (candidates.length !== 1) {
      this.markOrderForReview(
        orderId,
        candidates.length === 0
          ? 'No independently captured platform transaction with this exact trusted reference was found.'
          : 'More than one platform transaction has the same trusted reference and requires platform-owner review.'
      );
      return { matched: false };
    }

    const matchedCandidate = candidates[0];
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
    /** Amount in integer piastres. */
    amountMinor: number;
    externalTrxId: string;
    senderPhone?: string;
    senderName?: string;
  }): { autoActivatedOrderId?: string } {
    const db = getDatabase();
    const settings = this.getPlatformSettings();
    const incoming = db.prepare(`
      SELECT t.id, t.external_trx_id, t.amount_minor
      FROM transactions t
      WHERE t.id = ?
        AND t.organization_id = ?
        AND t.payment_source_id = ?
        AND t.status = 'confirmed'
        AND t.reconciliation_state = 'consistent'
        AND t.provenance_confidence >= 1
        AND t.signature IS NOT NULL
        AND trim(t.signature) != ''
        AND t.signature != 'webhook_token_verified'
    `).get(tx.id, settings.platform_org_id, settings.platform_source_id) as any;

    const reference = normalizeTransferReference(incoming?.external_trx_id);
    if (!incoming || !reference || !sameMinor(incoming.amount_minor, tx.amountMinor)) {
      return {};
    }

    // An inbound transaction cannot activate an order until the merchant has
    // reported its exact reference. Sender details and equal amounts are never
    // sufficient to choose an order.
    const candidateOrders = db.prepare(`
      SELECT *, ${PRICE_EGP_COLUMN} FROM subscription_orders
      WHERE status = 'payment_reported'
        AND price_minor = ?
        AND matched_transaction_id IS NULL
        AND lower(trim(reported_transfer_ref)) = ?
      ORDER BY created_at ASC
    `).all(incoming.amount_minor, reference) as unknown as SubscriptionOrder[];

    if (candidateOrders.length !== 1) {
      if (candidateOrders.length > 1) {
        for (const order of candidateOrders) {
          this.markOrderForReview(order.id, 'Multiple subscription orders claim the same platform transfer reference.');
        }
      }
      return {};
    }

    const matchedOrder = candidateOrders[0];
    this.activateSubscriptionFromOrder({
      orderId: matchedOrder.id,
      transactionId: incoming.id,
      matchedExternalTrxId: incoming.external_trx_id,
      approvalType: 'automatic',
    });
    return { autoActivatedOrderId: matchedOrder.id };
  }

  private static markOrderForReview(orderId: string, reason: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE subscription_orders
      SET status = 'in_review', review_notes = ?, updated_at = datetime('now')
      WHERE id = ? AND status != 'confirmed'
    `).run(reason, orderId);
  }

  private static getPlatformTransaction(db: DatabaseSync, transactionId: string): any | null {
    const settings = this.getPlatformSettings();
    return db.prepare(`
      SELECT t.id, t.external_trx_id, t.amount_minor, t.status, t.reconciliation_state,
             t.provenance_confidence, t.signature, t.organization_id, t.payment_source_id
      FROM transactions t
      WHERE t.id = ?
        AND t.organization_id = ?
        AND t.payment_source_id = ?
    `).get(transactionId, settings.platform_org_id, settings.platform_source_id) as any | null;
  }

  private static isTrustedPlatformTransaction(transaction: any): boolean {
    return Boolean(
      transaction &&
      transaction.status === 'confirmed' &&
      transaction.reconciliation_state === 'consistent' &&
      Number(transaction.provenance_confidence) >= 1 &&
      typeof transaction.signature === 'string' &&
      transaction.signature.trim() !== '' &&
      transaction.signature !== 'webhook_token_verified' &&
      normalizeTransferReference(transaction.external_trx_id)
    );
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
      const order = this.getOrderById(params.orderId) as SubscriptionOrder;
      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }

      if (order.status === 'confirmed') {
        db.exec('COMMIT;');
        return; // Idempotent
      }

      if (params.approvalType === 'automatic' && !params.transactionId) {
        throw new Error('AUTO_ACTIVATION_REQUIRES_TRUSTED_PLATFORM_TRANSACTION');
      }

      if (params.approvalType === 'manual' && !params.approvedByUserId?.trim()) {
        throw new Error('MANUAL_APPROVAL_REQUIRES_PLATFORM_OWNER');
      }

      if (params.approvalType === 'manual' && !params.reviewNotes?.trim()) {
        throw new Error('MANUAL_APPROVAL_REQUIRES_REASON');
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

        const platformTransaction = this.getPlatformTransaction(db, params.transactionId);
        if (!platformTransaction || !sameMinor(platformTransaction.amount_minor, order.price_minor)) {
          throw new Error('INVALID_PLATFORM_TRANSACTION');
        }

        if (params.approvalType === 'automatic') {
          const externalReference = normalizeTransferReference(params.matchedExternalTrxId);
          const transactionReference = normalizeTransferReference(platformTransaction.external_trx_id);
          if (!this.isTrustedPlatformTransaction(platformTransaction) || !externalReference || externalReference !== transactionReference) {
            throw new Error('AUTO_ACTIVATION_REQUIRES_TRUSTED_PLATFORM_TRANSACTION');
          }
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
          amount_paid_minor, currency, payment_method, matched_external_trx_id,
          billing_cycle, period_start, period_end, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'EGP', 'instapay_manual', ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        receiptNumber,
        order.id,
        order.organization_id,
        order.plan_id,
        order.price_minor,
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
    const order = this.getOrderById(params.orderId) as SubscriptionOrder;
    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }
    if (!params.platformOwnerUserId?.trim() || !params.reason?.trim()) {
      throw new Error('MANUAL_APPROVAL_REQUIRES_PLATFORM_OWNER_AND_REASON');
    }

    let externalTrxId: string | undefined;
    if (params.transactionId) {
      const tx = this.getPlatformTransaction(db, params.transactionId);
      if (!tx || !sameMinor(tx.amount_minor, order.price_minor)) {
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
   * Starts exactly seven days (168 hours) of trial access with one capture phone.
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
    const endsAt = new Date(now.getTime() + FREE_TRIAL_DURATION_HOURS * 60 * 60 * 1000).toISOString();
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
      ) VALUES (?, ?, ?, 'trial', ?, ?, ?, ?, 0, 0, ?, ?)
    `).run(
      trialSubId,
      organizationId,
      FREE_TRIAL_PLAN_ID,
      startsAt,
      endsAt,
      FREE_TRIAL_DEVICE_LIMIT,
      trialFeatures,
      startsAt,
      startsAt
    );

    AuditService.record({
      organizationId,
      actorIdentity: 'system_onboarding',
      action: 'FREE_TRIAL_STARTED',
      resourceType: 'subscription',
      resourceId: trialSubId,
      details: {
        startsAt,
        endsAt,
        durationHours: FREE_TRIAL_DURATION_HOURS,
        deviceLimit: FREE_TRIAL_DEVICE_LIMIT,
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

    // Free trial lifecycle: exactly seven days and one capture phone.
    if (status === 'trial') {
      if (now >= endsAt) {
        status = 'trial_expired';
        db.prepare("UPDATE organization_subscriptions SET status = 'trial_expired', updated_at = datetime('now') WHERE organization_id = ?").run(organizationId);
        allowed = false; // Trial expired: completely prohibit adding/pairing new devices
      } else {
        allowed = currentCount < FREE_TRIAL_DEVICE_LIMIT;
      }

      return {
        allowed,
        currentCount,
        maxLimit: FREE_TRIAL_DEVICE_LIMIT,
        planName: status === 'trial' ? 'تجربة مجانية 7 أيام (هاتف واحد)' : 'انتهت التجربة المجانية',
        subscriptionStatus: status,
        daysRemaining,
        hoursRemaining,
      };
    }

    if (status === 'trial_expired') {
      return {
        allowed: false,
        currentCount,
        maxLimit: FREE_TRIAL_DEVICE_LIMIT,
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
      SELECT s.*, p.name_ar as plan_name_ar, p.name_en as plan_name_en, p.price_minor, p.billing_cycle,
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
      if (now >= endsAt) {
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
      planNameAr: status === 'trial' ? 'تجربة مجانية 7 أيام' : status === 'trial_expired' ? 'انتهت التجربة المجانية' : (sub.plan_name_ar || 'باقة معتمدة'),
      planNameEn: status === 'trial' ? '7-Day Free Trial' : status === 'trial_expired' ? 'Trial Expired' : (sub.plan_name_en || 'Active Plan'),
      billingCycle: sub.billing_cycle || 'monthly',
      priceEgp: fromMinor(sub.price_minor ?? 0),
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
   * Queues 48h and 24h trial warnings once. Delivery is handled by the durable
   * outbox worker, so a browser request never exposes Telegram credentials or
   * pretends that a notification was sent.
   */
  private static checkTrialWarnings(sub: any, hoursRemaining: number): void {
    const db = getDatabase();
    const warning = hoursRemaining <= 24 && !sub.trial_warn_24h_sent
      ? {
          window: '24h' as const,
          flagColumn: 'trial_warn_24h_sent',
          auditAction: 'TRIAL_EXPIRATION_WARNING_24H',
          text: '🚨 تنبيه أخير من صرّاف: باقٍ أقل من 24 ساعة على انتهاء التجربة المجانية. اختار باقتك الآن لتفادي توقف معالجة واستقبال الرسائل الجديدة على هواتف الالتقاط.',
        }
      : hoursRemaining <= 48 && !sub.trial_warn_48h_sent
        ? {
            window: '48h' as const,
            flagColumn: 'trial_warn_48h_sent',
            auditAction: 'TRIAL_EXPIRATION_WARNING_48H',
            text: '⚠️ تنبيه صرّاف: تجربتك المجانية قربت تخلص (باقي أقل من 48 ساعة). اختار الباقة المناسبة قبل انتهاء التجربة عشان تستمر متابعة الرسائل الجديدة بدون توقف.',
          }
        : null;

    if (!warning) {
      return;
    }

    try {
      db.exec('BEGIN IMMEDIATE;');
      const current = db.prepare(`
        SELECT ${warning.flagColumn} as sent
        FROM organization_subscriptions
        WHERE id = ? AND organization_id = ? AND status = 'trial'
      `).get(sub.id, sub.organization_id) as { sent?: number } | undefined;

      if (!current || current.sent) {
        db.exec('COMMIT;');
        return;
      }

      db.prepare(`
        UPDATE organization_subscriptions
        SET ${warning.flagColumn} = 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(sub.id);
      this.enqueueTrialWarning(sub, warning.window, warning.text);
      db.exec('COMMIT;');

      AuditService.record({
        organizationId: sub.organization_id,
        actorIdentity: 'system_trial_scheduler',
        action: warning.auditAction,
        resourceType: 'subscription',
        resourceId: sub.id,
        details: { hoursRemaining },
      });
    } catch {
      try {
        db.exec('ROLLBACK;');
      } catch {}
    }
  }

  private static enqueueTrialWarning(sub: { id: string; organization_id: string }, warningWindow: '48h' | '24h', text: string): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR IGNORE INTO outbox_jobs (id, organization_id, job_type, payload)
      VALUES (?, ?, 'send_telegram', ?)
    `).run(
      `trial_warning_${sub.id}_${warningWindow}`,
      sub.organization_id,
      JSON.stringify({ text, event: 'trial_expiration_warning', warningWindow, subscriptionId: sub.id })
    );
  }
}
