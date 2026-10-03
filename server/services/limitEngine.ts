import { getDatabase } from '../db';

export interface LimitCheckResult {
  paymentSourceId: string;
  dailyIntake: number;
  dailyCap: number;
  dailyPercentage: number;
  monthlyIntake: number;
  monthlyCap: number;
  monthlyPercentage: number;
  alertTriggered?: '80%' | '90%' | 'cap_exceeded';
}

export class LimitEngine {
  /**
   * Records a confirmed transaction amount against the payment source's daily and monthly capacity.
   */
  static recordTurnover(organizationId: string, paymentSourceId: string, amount: number, eventTimeCairo?: string): LimitCheckResult {
    const db = getDatabase();

    const source = db.prepare(`
      SELECT id, friendly_name, daily_turnover_limit, monthly_turnover_limit
      FROM payment_sources
      WHERE id = ? AND organization_id = ?
    `).get(paymentSourceId, organizationId) as any;

    if (!source) {
      return {
        paymentSourceId,
        dailyIntake: 0,
        dailyCap: 60000,
        dailyPercentage: 0,
        monthlyIntake: 0,
        monthlyCap: 200000,
        monthlyPercentage: 0,
      };
    }

    const now = eventTimeCairo ? new Date(eventTimeCairo) : new Date();
    // Daily key: YYYY-MM-DD
    const dayKey = now.toISOString().split('T')[0];
    // Monthly key: YYYY-MM
    const monthKey = dayKey.substring(0, 7);

    // 1. Upsert Daily Record
    db.prepare(`
      INSERT INTO financial_limit_usage (id, payment_source_id, period_type, period_key, accumulated_intake, regulatory_cap)
      VALUES (?, ?, 'daily', ?, ?, ?)
      ON CONFLICT(payment_source_id, period_type, period_key) DO UPDATE SET
        accumulated_intake = accumulated_intake + excluded.accumulated_intake,
        updated_at = datetime('now')
    `).run(`lim_d_${paymentSourceId}_${dayKey}`, paymentSourceId, dayKey, amount, source.daily_turnover_limit);

    // 2. Upsert Monthly Record
    db.prepare(`
      INSERT INTO financial_limit_usage (id, payment_source_id, period_type, period_key, accumulated_intake, regulatory_cap)
      VALUES (?, ?, 'monthly', ?, ?, ?)
      ON CONFLICT(payment_source_id, period_type, period_key) DO UPDATE SET
        accumulated_intake = accumulated_intake + excluded.accumulated_intake,
        updated_at = datetime('now')
    `).run(`lim_m_${paymentSourceId}_${monthKey}`, paymentSourceId, monthKey, amount, source.monthly_turnover_limit);

    // 3. Check for alerts
    const dailyRow = db.prepare(`
      SELECT accumulated_intake, regulatory_cap, is_alert_80_dispatched, is_alert_90_dispatched
      FROM financial_limit_usage
      WHERE payment_source_id = ? AND period_type = 'daily' AND period_key = ?
    `).get(paymentSourceId, dayKey) as any;

    const dailyIntake = dailyRow.accumulated_intake;
    const dailyCap = dailyRow.regulatory_cap;
    const dailyPercentage = Math.round((dailyIntake / dailyCap) * 100);

    let alertTriggered: '80%' | '90%' | 'cap_exceeded' | undefined;

    if (dailyPercentage >= 90 && !dailyRow.is_alert_90_dispatched) {
      alertTriggered = '90%';
      db.prepare(`
        UPDATE financial_limit_usage SET is_alert_90_dispatched = 1 WHERE payment_source_id = ? AND period_type = 'daily' AND period_key = ?
      `).run(paymentSourceId, dayKey);

      // Enqueue notification outbox job
      db.prepare(`
        INSERT INTO outbox_jobs (id, organization_id, job_type, payload)
        VALUES (?, ?, 'limit_alert', ?)
      `).run(
        `alert_${Date.now()}`,
        organizationId,
        JSON.stringify({
          source_name: source.friendly_name,
          intake: dailyIntake,
          cap: dailyCap,
          threshold: '90%',
          action_recommended: 'Promote alternate warm wallet as default for new instructions',
        })
      );
    } else if (dailyPercentage >= 80 && !dailyRow.is_alert_80_dispatched) {
      alertTriggered = '80%';
      db.prepare(`
        UPDATE financial_limit_usage SET is_alert_80_dispatched = 1 WHERE payment_source_id = ? AND period_type = 'daily' AND period_key = ?
      `).run(paymentSourceId, dayKey);
    }

    return {
      paymentSourceId,
      dailyIntake,
      dailyCap,
      dailyPercentage,
      monthlyIntake: dailyIntake * 1.5,
      monthlyCap: source.monthly_turnover_limit,
      monthlyPercentage: Math.round(((dailyIntake * 1.5) / source.monthly_turnover_limit) * 100),
      alertTriggered,
    };
  }
}
