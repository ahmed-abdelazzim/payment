import { getDatabase } from '../db';
import { ParsedTransaction } from '../parser/engine';

export interface IngestionEventInput {
  organizationId: string;
  deviceId: string;
  rawEventId: string;
  adapterType: string;
  boundPaymentAddress: string;
  parsed: ParsedTransaction;
  financialEventAt: string;
  signature?: string;
}

export interface ReconciliationResult {
  transactionId: string;
  externalTrxId: string;
  status: 'confirmed' | 'review_required' | 'pending_ordering' | 'failed';
  reconciliationState: 'consistent' | 'gap_detected' | 'pending_ordering';
  balanceBefore: number;
  balanceAfter: number;
  isDuplicate: boolean;
  reviewReason?: string;
  unresolvedGapsCount?: number;
}

export class ReconciliationService {
  /**
   * Reconciles an inbound parsed transaction with atomic per-account database locking.
   */
  static processInboundTransaction(input: IngestionEventInput): ReconciliationResult {
    const db = getDatabase();

    // 1. Resolve Bound Payment Source and Balance Account
    if (input.rawEventId) {
      const existingRaw = db.prepare('SELECT id FROM raw_events WHERE id = ?').get(input.rawEventId);
      if (!existingRaw) {
        const devExists = input.deviceId ? db.prepare('SELECT id FROM devices WHERE id = ?').get(input.deviceId) : null;
        db.prepare(`
          INSERT INTO raw_events (id, organization_id, device_id, adapter_type, nonce, client_timestamp, raw_payload)
          VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
        `).run(input.rawEventId, input.organizationId, devExists ? input.deviceId : null, input.adapterType, `nonce_${input.rawEventId}`, 'Auto-recorded payload');
      }
    }

    const addressRow = db.prepare(`
      SELECT a.payment_source_id, s.balance_account_id, s.provider, s.is_paused_for_new_instructions
      FROM payment_addresses a
      JOIN payment_sources s ON a.payment_source_id = s.id
      WHERE s.organization_id = ? AND a.address_value = ?
      LIMIT 1
    `).get(input.organizationId, input.boundPaymentAddress) as any;

    let paymentSourceId = addressRow?.payment_source_id;
    let balanceAccountId = addressRow?.balance_account_id;
    let provider = addressRow?.provider || input.parsed.provider;

    if (!paymentSourceId || !balanceAccountId) {
      // Fallback to first provider source in organization
      const fallbackSource = db.prepare(`
        SELECT id, balance_account_id, provider
        FROM payment_sources
        WHERE organization_id = ? AND provider = ?
        LIMIT 1
      `).get(input.organizationId, input.parsed.provider) as any;

      if (fallbackSource) {
        paymentSourceId = fallbackSource.id;
        balanceAccountId = fallbackSource.balance_account_id;
        provider = fallbackSource.provider;
      } else {
        // Find or create default balance account
        const defaultAcc = db.prepare(`
          SELECT id FROM balance_accounts WHERE organization_id = ? LIMIT 1
        `).get(input.organizationId) as any;
        balanceAccountId = defaultAcc?.id;

        if (!balanceAccountId) {
          balanceAccountId = `acc_${input.organizationId}`;
          db.prepare(`
            INSERT INTO balance_accounts (id, organization_id, account_name, currency, current_balance)
            VALUES (?, ?, 'Main Account', 'EGP', 0.0)
          `).run(balanceAccountId, input.organizationId);
        }

        // Auto-create payment source so foreign key constraint is satisfied!
        paymentSourceId = `src_${input.organizationId}_${input.parsed.provider}`;
        const sourceExists = db.prepare('SELECT id FROM payment_sources WHERE id = ?').get(paymentSourceId);
        if (!sourceExists) {
          const providerLabels: Record<string, string> = {
            vodafone_cash: 'فودافون كاش',
            instapay: 'إنستاباي',
            orange_cash: 'أورنج كاش',
            etisalat_cash: 'اتصالات كاش',
          };
          db.prepare(`
            INSERT INTO payment_sources (id, organization_id, balance_account_id, provider, friendly_name, wallet_number, daily_turnover_limit, monthly_turnover_limit)
            VALUES (?, ?, ?, ?, ?, ?, 60000.0, 200000.0)
          `).run(
            paymentSourceId,
            input.organizationId,
            balanceAccountId,
            input.parsed.provider,
            providerLabels[input.parsed.provider] || `${input.parsed.provider} Wallet`,
            input.boundPaymentAddress || '01000000000'
          );

          db.prepare(`
            INSERT INTO payment_addresses (id, payment_source_id, address_type, address_value, is_default_for_invoices)
            VALUES (?, ?, 'msisdn', ?, 1)
          `).run(`addr_${paymentSourceId}`, paymentSourceId, input.boundPaymentAddress || '01000000000');
        }
      }
    }

    // 2. Financial Idempotency Check: Prevent Duplicate Transactions
    const existingTrx = db.prepare(`
      SELECT id, status, reconciliation_state, stated_balance_after, amount
      FROM transactions
      WHERE organization_id = ? AND provider = ? AND external_trx_id = ?
    `).get(input.organizationId, provider, input.parsed.externalTrxId) as any;

    if (existingTrx) {
      return {
        transactionId: existingTrx.id,
        externalTrxId: input.parsed.externalTrxId,
        status: existingTrx.status,
        reconciliationState: existingTrx.reconciliation_state,
        balanceBefore: (existingTrx.stated_balance_after || 0) - existingTrx.amount,
        balanceAfter: existingTrx.stated_balance_after || 0,
        isDuplicate: true,
      };
    }

    // 3. Atomically Lock & Fetch Balance Account Anchor (Section 12A)
    // In SQLite, BEGIN IMMEDIATE ensures atomic write lock per database transaction
    db.exec('BEGIN IMMEDIATE;');

    try {
      const account = db.prepare(`
        SELECT id, current_balance, version
        FROM balance_accounts
        WHERE id = ?
      `).get(balanceAccountId) as any;

      const currentBalance = account?.current_balance || 0.0;
      let balanceBefore = currentBalance;
      let balanceAfter = currentBalance;
      let status: 'confirmed' | 'review_required' | 'pending_ordering' | 'failed' = 'confirmed';
      let reconciliationState: 'consistent' | 'gap_detected' | 'pending_ordering' = 'consistent';
      let reviewReason = input.parsed.unverifiedWarning;

      // 4. Invariant Check: Does Math Match?
      // Rule: Arithmetic consistency does NOT prove authenticity!
      const isUnverifiedChannel = input.adapterType === 'manual' || !input.signature;
      const hasAnomalyWarning = !!input.parsed.unverifiedWarning;

      if (isUnverifiedChannel || hasAnomalyWarning) {
        // Quarantined into Review Queue
        status = 'review_required';
        reconciliationState = hasAnomalyWarning ? 'gap_detected' : 'consistent';
        balanceAfter = currentBalance; // do not advance canonical balance until review
      } else if (input.parsed.statedBalance !== undefined) {
        // Out-of-Order Permutation Engine (Section 12A Algorithm)
        const inferredPriorBalance = Math.round((input.parsed.statedBalance - input.parsed.amount) * 100) / 100;
        const currentBalanceRounded = Math.round(currentBalance * 100) / 100;

        if (inferredPriorBalance === currentBalanceRounded || currentBalanceRounded === 0) {
          // Continuous link in the chain or fresh new merchant anchor: Apply immediately!
          status = 'confirmed';
          reconciliationState = 'consistent';
          balanceBefore = currentBalanceRounded === 0 ? inferredPriorBalance : currentBalance;
          balanceAfter = input.parsed.statedBalance;

          db.prepare(`
            UPDATE balance_accounts 
            SET current_balance = ?, version = version + 1, updated_at = datetime('now')
            WHERE id = ?
          `).run(balanceAfter, balanceAccountId);
        } else {
          // Out-of-Order: Inferred prior balance does NOT match current anchor.
          // Place into pending_ordering without declaring fake or dropping!
          status = 'pending_ordering';
          reconciliationState = 'pending_ordering';
          reviewReason = `Out-of-order arrival: prior balance ${inferredPriorBalance} does not match anchor ${currentBalanceRounded}`;
        }
      } else {
        // Standard credit without explicit post-balance string
        balanceBefore = currentBalance;
        balanceAfter = currentBalance + input.parsed.amount;

        db.prepare(`
          UPDATE balance_accounts 
          SET current_balance = ?, version = version + 1, updated_at = datetime('now')
          WHERE id = ?
        `).run(balanceAfter, balanceAccountId);
      }

      // 5. Insert Reconciled Transaction
      const trxId = `tx_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const recordedStatedBalance = input.parsed.statedBalance !== undefined ? input.parsed.statedBalance : balanceAfter;

      db.prepare(`
        INSERT INTO transactions (
          id, organization_id, balance_account_id, payment_source_id, raw_event_id,
          external_trx_id, provider, amount, currency, stated_balance_after,
          sender_name, sender_phone, status, reconciliation_state, provenance_confidence,
          review_reason, signature, financial_event_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        trxId,
        input.organizationId,
        balanceAccountId,
        paymentSourceId,
        input.rawEventId,
        input.parsed.externalTrxId,
        provider,
        input.parsed.amount,
        input.parsed.currency,
        recordedStatedBalance,
        input.parsed.senderName,
        input.parsed.senderPhone,
        status,
        reconciliationState,
        input.parsed.confidenceScore,
        reviewReason || null,
        input.signature || null,
        input.financialEventAt
      );

      // 6. Cascade Resolution: Check if any pending_ordering transactions can now resolve!
      if (status === 'confirmed') {
        ReconciliationService.resolvePendingCascade(db, input.organizationId, balanceAccountId, balanceAfter);
      }

      // 7. Enqueue Outbox Dispatch Jobs if Confirmed
      if (status === 'confirmed') {
        db.prepare(`
          INSERT INTO outbox_jobs (id, organization_id, job_type, payload)
          VALUES (?, ?, 'dispatch_webhook', ?)
        `).run(
          `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          input.organizationId,
          JSON.stringify({
            event: 'transaction.confirmed',
            transaction_id: trxId,
            external_trx_id: input.parsed.externalTrxId,
            amount: input.parsed.amount,
            currency: input.parsed.currency,
            provider,
            financial_event_at: input.financialEventAt,
          })
        );
      }

      db.exec('COMMIT;');

      return {
        transactionId: trxId,
        externalTrxId: input.parsed.externalTrxId,
        status,
        reconciliationState,
        balanceBefore,
        balanceAfter,
        isDuplicate: false,
        reviewReason,
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Cascade re-evaluation: When ledger balance advances to B, check if any pending_ordering
   * transactions were waiting for prior balance = B.
   */
  private static resolvePendingCascade(db: any, organizationId: string, balanceAccountId: string, currentBalance: number): void {
    let activeBalance = currentBalance;
    let resolvedAny = true;

    while (resolvedAny) {
      resolvedAny = false;
      const pendingRows = db.prepare(`
        SELECT id, amount, stated_balance_after, external_trx_id
        FROM transactions
        WHERE organization_id = ? AND balance_account_id = ? AND status = 'pending_ordering'
      `).all(organizationId, balanceAccountId) as any[];

      for (const row of pendingRows) {
        const requiredPrior = Math.round((row.stated_balance_after - row.amount) * 100) / 100;
        const currentRounded = Math.round(activeBalance * 100) / 100;

        if (requiredPrior === currentRounded) {
          activeBalance = row.stated_balance_after;

          db.prepare(`
            UPDATE transactions
            SET status = 'confirmed', reconciliation_state = 'consistent', review_reason = NULL
            WHERE id = ?
          `).run(row.id);

          db.prepare(`
            UPDATE balance_accounts
            SET current_balance = ?, version = version + 1, updated_at = datetime('now')
            WHERE id = ?
          `).run(activeBalance, balanceAccountId);

          resolvedAny = true;
          break; // restart scan with new balance
        }
      }
    }
  }
}
