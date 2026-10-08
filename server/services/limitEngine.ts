import { getDatabase } from '../db';
import { toMinor, fromMinor } from '../money';

const CAIRO_TIME_ZONE = 'Africa/Cairo';

export type LimitPeriod = 'daily' | 'monthly';
export type LimitAlertLevel = 'warning' | 'critical' | 'cap_exceeded';

export interface LimitAlert {
  periodType: LimitPeriod;
  level: LimitAlertLevel;
  percentage: number;
  thresholdPercent?: number;
}

export interface LimitCheckResult {
  paymentSourceId: string;
  dailyIntake: number;
  dailyCap: number;
  dailyPercentage: number;
  monthlyIntake: number;
  monthlyCap: number;
  monthlyPercentage: number;
  /** Backwards-compatible primary alert for callers that show one message. */
  alertTriggered?: string;
  /** Every alert generated for this update, including daily and monthly alerts. */
  alertsTriggered: LimitAlert[];
  periodKeys: {
    daily: string;
    monthly: string;
    timeZone: typeof CAIRO_TIME_ZONE;
  };
}

export interface LimitAlertThresholds {
  warningThreshold?: number;
  criticalThreshold?: number;
}

interface ResolvedAlertThresholds {
  warningThreshold: number;
  criticalThreshold: number;
}

interface UsageRow {
  accumulated_intake_minor: number;
  regulatory_cap_minor: number;
  is_alert_80_dispatched: number;
  is_alert_90_dispatched: number;
}

const toEgp = fromMinor;

function percentageOf(intakeMinor: number, capMinor: number): number {
  if (capMinor <= 0) {
    throw new Error('INVALID_LIMIT_CAP');
  }

  return Math.floor((intakeMinor * 100 + Math.floor(capMinor / 2)) / capMinor);
}

function parseThreshold(value: number | string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error(`INVALID_${name}_THRESHOLD`);
  }

  return parsed;
}

function resolveThresholds(options?: LimitAlertThresholds): ResolvedAlertThresholds {
  const warningThreshold = parseThreshold(
    options?.warningThreshold ?? process.env.LIMIT_ALERT_WARNING_PERCENT,
    80,
    'WARNING'
  );
  const criticalThreshold = parseThreshold(
    options?.criticalThreshold ?? process.env.LIMIT_ALERT_CRITICAL_PERCENT,
    90,
    'CRITICAL'
  );

  if (warningThreshold >= criticalThreshold) {
    throw new Error('INVALID_LIMIT_ALERT_THRESHOLD_ORDER');
  }

  return { warningThreshold, criticalThreshold };
}

/**
 * Builds period keys according to the merchant's contractual operating time
 * zone. UTC date keys split Cairo business days around midnight incorrectly.
 */
export function getCairoPeriodKeys(eventTime?: string | Date): { daily: string; monthly: string } {
  const date = eventTime instanceof Date ? eventTime : eventTime ? new Date(eventTime) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error('INVALID_LIMIT_EVENT_TIME');
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value || '';
  const year = valueFor('year');
  const month = valueFor('month');
  const day = valueFor('day');

  if (!year || !month || !day) {
    throw new Error('CANNOT_RESOLVE_CAIRO_PERIOD');
  }

  return { daily: `${year}-${month}-${day}`, monthly: `${year}-${month}` };
}

export class LimitEngine {
  /**
   * Records a confirmed transaction against the actual source's daily and
   * monthly capacity. `amount` is in EGP and converted exactly to piastres.
   */
  static recordTurnover(
    organizationId: string,
    paymentSourceId: string,
    amount: number,
    eventTimeCairo?: string,
    options?: LimitAlertThresholds
  ): LimitCheckResult {
    const db = getDatabase();
    const amountMinor = toMinor(amount);
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = this.recordTurnoverInTransaction(
        organizationId,
        paymentSourceId,
        amountMinor,
        eventTimeCairo,
        options
      );
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  /**
   * Records source usage while the caller already owns the database write
   * transaction.  Reconciliation uses this so the ledger, usage counters, and
   * alert jobs either all commit or all roll back together.
   *
   * @param amountMinor confirmed amount in integer piastres
   */
  static recordTurnoverInTransaction(
    organizationId: string,
    paymentSourceId: string,
    amountMinor: number,
    eventTimeCairo?: string,
    options?: LimitAlertThresholds
  ): LimitCheckResult {
    const db = getDatabase();
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new Error('INVALID_LIMIT_AMOUNT');
    }
    if (amountMinor === 0) {
      throw new Error('ZERO_TURNOVER_AMOUNT');
    }

    const source = db.prepare(`
      SELECT id, friendly_name, daily_turnover_limit_minor, monthly_turnover_limit_minor
      FROM payment_sources
      WHERE id = ? AND organization_id = ?
    `).get(paymentSourceId, organizationId) as any;

    if (!source) {
      // Never silently apply an unrelated default limit to a real payment.
      throw new Error('PAYMENT_SOURCE_NOT_FOUND');
    }

    const dailyCapMinor = Number(source.daily_turnover_limit_minor);
    const monthlyCapMinor = Number(source.monthly_turnover_limit_minor);
    if (!(dailyCapMinor > 0) || !(monthlyCapMinor > 0)) {
      throw new Error('INVALID_LIMIT_CAP');
    }

    const periodKeys = getCairoPeriodKeys(eventTimeCairo);
    const thresholds = resolveThresholds(options);

    const daily = this.upsertUsage({
      paymentSourceId,
      periodType: 'daily',
      periodKey: periodKeys.daily,
      amountMinor,
      capMinor: dailyCapMinor,
    });
    const monthly = this.upsertUsage({
      paymentSourceId,
      periodType: 'monthly',
      periodKey: periodKeys.monthly,
      amountMinor,
      capMinor: monthlyCapMinor,
    });

    const alerts = [
      ...this.dispatchAlerts({ organizationId, source, usage: daily, thresholds }),
      ...this.dispatchAlerts({ organizationId, source, usage: monthly, thresholds }),
    ];

    const primaryAlert = alerts.find((alert) => alert.level === 'cap_exceeded')
      || alerts.find((alert) => alert.level === 'critical')
      || alerts.find((alert) => alert.level === 'warning');

    return {
      paymentSourceId,
      dailyIntake: toEgp(daily.currentMinor),
      dailyCap: toEgp(daily.capMinor),
      dailyPercentage: daily.currentPercentage,
      monthlyIntake: toEgp(monthly.currentMinor),
      monthlyCap: toEgp(monthly.capMinor),
      monthlyPercentage: monthly.currentPercentage,
      alertTriggered: primaryAlert
        ? primaryAlert.level === 'cap_exceeded'
          ? 'cap_exceeded'
          : `${primaryAlert.thresholdPercent}%`
        : undefined,
      alertsTriggered: alerts,
      periodKeys: { ...periodKeys, timeZone: CAIRO_TIME_ZONE },
    };
  }

  private static upsertUsage(params: {
    paymentSourceId: string;
    periodType: LimitPeriod;
    periodKey: string;
    amountMinor: number;
    capMinor: number;
  }): {
    periodType: LimitPeriod;
    periodKey: string;
    previousPercentage: number;
    currentPercentage: number;
    currentMinor: number;
    capMinor: number;
    warningSent: boolean;
    criticalSent: boolean;
  } {
    const db = getDatabase();
    const existing = db.prepare(`
      SELECT accumulated_intake_minor, regulatory_cap_minor, is_alert_80_dispatched, is_alert_90_dispatched
      FROM financial_limit_usage
      WHERE payment_source_id = ? AND period_type = ? AND period_key = ?
    `).get(params.paymentSourceId, params.periodType, params.periodKey) as UsageRow | undefined;

    const previousMinor = existing ? Number(existing.accumulated_intake_minor) : 0;
    const currentMinor = previousMinor + params.amountMinor;
    const previousPercentage = percentageOf(previousMinor, params.capMinor);
    const currentPercentage = percentageOf(currentMinor, params.capMinor);

    db.prepare(`
      INSERT INTO financial_limit_usage (
        id, payment_source_id, period_type, period_key, accumulated_intake_minor, regulatory_cap_minor,
        is_alert_80_dispatched, is_alert_90_dispatched
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(payment_source_id, period_type, period_key) DO UPDATE SET
        accumulated_intake_minor = excluded.accumulated_intake_minor,
        regulatory_cap_minor = excluded.regulatory_cap_minor,
        updated_at = datetime('now')
    `).run(
      `lim_${params.periodType}_${params.paymentSourceId}_${params.periodKey}`,
      params.paymentSourceId,
      params.periodType,
      params.periodKey,
      currentMinor,
      params.capMinor,
      existing?.is_alert_80_dispatched || 0,
      existing?.is_alert_90_dispatched || 0
    );

    return {
      periodType: params.periodType,
      periodKey: params.periodKey,
      previousPercentage,
      currentPercentage,
      currentMinor,
      capMinor: params.capMinor,
      warningSent: Boolean(existing?.is_alert_80_dispatched),
      criticalSent: Boolean(existing?.is_alert_90_dispatched),
    };
  }

  private static dispatchAlerts(params: {
    organizationId: string;
    source: { id: string; friendly_name: string };
    usage: ReturnType<typeof LimitEngine.upsertUsage>;
    thresholds: ResolvedAlertThresholds;
  }): LimitAlert[] {
    const db = getDatabase();
    const alerts: LimitAlert[] = [];
    const { usage, thresholds } = params;

    if (usage.currentPercentage >= thresholds.warningThreshold && !usage.warningSent) {
      db.prepare(`
        UPDATE financial_limit_usage
        SET is_alert_80_dispatched = 1, updated_at = datetime('now')
        WHERE payment_source_id = ? AND period_type = ? AND period_key = ?
      `).run(params.source.id, usage.periodType, usage.periodKey);
      this.enqueueAlert(params.organizationId, params.source, usage, 'warning', thresholds.warningThreshold);
      alerts.push({
        periodType: usage.periodType,
        level: 'warning',
        percentage: usage.currentPercentage,
        thresholdPercent: thresholds.warningThreshold,
      });
    }

    if (usage.currentPercentage >= thresholds.criticalThreshold && !usage.criticalSent) {
      db.prepare(`
        UPDATE financial_limit_usage
        SET is_alert_90_dispatched = 1, updated_at = datetime('now')
        WHERE payment_source_id = ? AND period_type = ? AND period_key = ?
      `).run(params.source.id, usage.periodType, usage.periodKey);
      this.enqueueAlert(params.organizationId, params.source, usage, 'critical', thresholds.criticalThreshold);
      alerts.push({
        periodType: usage.periodType,
        level: 'critical',
        percentage: usage.currentPercentage,
        thresholdPercent: thresholds.criticalThreshold,
      });
    }

    if (usage.previousPercentage < 100 && usage.currentPercentage >= 100) {
      this.enqueueAlert(params.organizationId, params.source, usage, 'cap_exceeded');
      alerts.push({ periodType: usage.periodType, level: 'cap_exceeded', percentage: usage.currentPercentage });
    }

    return alerts;
  }

  private static enqueueAlert(
    organizationId: string,
    source: { id: string; friendly_name: string },
    usage: ReturnType<typeof LimitEngine.upsertUsage>,
    level: LimitAlertLevel,
    thresholdPercent?: number
  ): void {
    const db = getDatabase();
    const jobId = `limit_alert_${source.id}_${usage.periodType}_${usage.periodKey}_${level}`;
    db.prepare(`
      INSERT OR IGNORE INTO outbox_jobs (id, organization_id, job_type, payload)
      VALUES (?, ?, 'limit_alert', ?)
    `).run(
      jobId,
      organizationId,
      JSON.stringify({
        sourceId: source.id,
        sourceName: source.friendly_name,
        periodType: usage.periodType,
        periodKey: usage.periodKey,
        intake: toEgp(usage.currentMinor),
        cap: toEgp(usage.capMinor),
        percentage: usage.currentPercentage,
        level,
        thresholdPercent,
        actionRecommended: level === 'cap_exceeded'
          ? 'Pause new payment instructions for this source and switch to an approved alternate source.'
          : 'Prepare an approved alternate payment source before this source reaches its cap.',
      })
    );
  }

  /**
   * Retrieves current daily and monthly capacity and remaining headroom for a source
   */
  static getSourceCapacity(organizationId: string, paymentSourceId: string): {
    dailyIntakeMinor: number;
    dailyCapMinor: number;
    remainingDailyMinor: number;
    dailyPercentage: number;
    monthlyIntakeMinor: number;
    monthlyCapMinor: number;
    remainingMonthlyMinor: number;
    monthlyPercentage: number;
    isNearCap: boolean;
    isCapExceeded: boolean;
    isSaturated: boolean;
  } {
    const db = getDatabase();
    const source = db.prepare(`
      SELECT id, daily_turnover_limit_minor, monthly_turnover_limit_minor
      FROM payment_sources
      WHERE id = ? AND organization_id = ?
    `).get(paymentSourceId, organizationId) as any;

    if (!source) {
      return {
        dailyIntakeMinor: 0,
        dailyCapMinor: 0,
        remainingDailyMinor: 0,
        dailyPercentage: 0,
        monthlyIntakeMinor: 0,
        monthlyCapMinor: 0,
        remainingMonthlyMinor: 0,
        monthlyPercentage: 0,
        isNearCap: false,
        isCapExceeded: false,
        isSaturated: false,
      };
    }

    const { daily, monthly } = getCairoPeriodKeys();

    const dailyRow = db.prepare(`
      SELECT accumulated_intake_minor
      FROM financial_limit_usage
      WHERE payment_source_id = ? AND period_type = 'daily' AND period_key = ?
    `).get(paymentSourceId, daily) as any;

    const monthlyRow = db.prepare(`
      SELECT accumulated_intake_minor
      FROM financial_limit_usage
      WHERE payment_source_id = ? AND period_type = 'monthly' AND period_key = ?
    `).get(paymentSourceId, monthly) as any;

    const dailyIntakeMinor = dailyRow?.accumulated_intake_minor || 0;
    const monthlyIntakeMinor = monthlyRow?.accumulated_intake_minor || 0;
    const dailyCapMinor = source.daily_turnover_limit_minor || 6000000;
    const monthlyCapMinor = source.monthly_turnover_limit_minor || 20000000;

    const dailyPercentage = percentageOf(dailyIntakeMinor, dailyCapMinor);
    const monthlyPercentage = percentageOf(monthlyIntakeMinor, monthlyCapMinor);

    const remainingDailyMinor = Math.max(0, dailyCapMinor - dailyIntakeMinor);
    const remainingMonthlyMinor = Math.max(0, monthlyCapMinor - monthlyIntakeMinor);

    return {
      dailyIntakeMinor,
      dailyCapMinor,
      remainingDailyMinor,
      dailyPercentage,
      monthlyIntakeMinor,
      monthlyCapMinor,
      remainingMonthlyMinor,
      monthlyPercentage,
      isNearCap: dailyPercentage >= 90 || monthlyPercentage >= 90,
      isCapExceeded: dailyPercentage >= 100 || monthlyPercentage >= 100,
      isSaturated: dailyPercentage >= 98 || monthlyPercentage >= 98,
    };
  }
}
