import { getDatabase } from '../db';
import { ParsedTransaction } from '../parser/engine';
import { LimitEngine } from './limitEngine';
import { toMinor, fromMinor, MoneyError } from '../money';

export interface IngestionEventInput {
  organizationId: string;
  deviceId: string;
  /** The source bound to the capture device during pairing. Never infer this from SMS text. */
  paymentSourceId?: string | null;
  rawEventId: string;
  adapterType: string;
  boundPaymentAddress: string;
  parsed: ParsedTransaction;
  financialEventAt: string;
  signature?: string;
  /**
   * Set only by a future bank/wallet settlement connector or a controlled
   * operator workflow. A signed SMS capture is deliberately not independent
   * settlement proof by itself.
   */
  independentSettlementEvidence?: boolean;
}

export interface ReconciliationResult {
  transactionId: string;
  externalTrxId: string;
  status: 'confirmed' | 'review_required' | 'pending_ordering' | 'failed';
  reconciliationState: 'consistent' | 'gap_detected' | 'pending_ordering';
  /** EGP, derived from integer piastres for API compatibility. */
  balanceBefore: number;
  /** EGP, derived from integer piastres for API compatibility. */
  balanceAfter: number;
  isDuplicate: boolean;
  reviewReason?: string;
  unresolvedGapsCount?: number;
}

function markRawEvent(db: any, rawEventId: string, organizationId: string, status: string): void {
  db.prepare(`
    UPDATE raw_events
    SET processing_status = ?
    WHERE id = ? AND organization_id = ?
  `).run(status, rawEventId, organizationId);
}

function reviewResult(input: IngestionEventInput, reviewReason: string): ReconciliationResult {
  return {
    transactionId: input.rawEventId,
    externalTrxId: input.parsed.externalTrxId,
    status: 'review_required',
    reconciliationState: 'gap_detected',
    balanceBefore: 0,
    balanceAfter: 0,
    isDuplicate: false,
    reviewReason,
  };
}

export class ReconciliationService {
  /**
   * Reconciles an inbound parsed transaction with atomic per-account database locking.
   * All ledger arithmetic is performed in integer piastres.
   */
  static processInboundTransaction(input: IngestionEventInput): ReconciliationResult {
    const db = getDatabase();

    // 1. Resolve the source that was bound to the capture device at pairing time.
    // SMS sender labels and a caller-provided address are useful metadata only; they are
    // never allowed to select a wallet or bank ledger automatically.
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

    const deviceBinding = !input.paymentSourceId
      ? db.prepare(`
          SELECT payment_source_id
          FROM devices
          WHERE id = ? AND organization_id = ?
        `).get(input.deviceId, input.organizationId) as { payment_source_id?: string | null } | undefined
      : undefined;
    const paymentSourceIdFromDevice = input.paymentSourceId || deviceBinding?.payment_source_id || null;

    const source = paymentSourceIdFromDevice
      ? db.prepare(`
          SELECT id, balance_account_id, provider
          FROM payment_sources
          WHERE id = ? AND organization_id = ?
        `).get(paymentSourceIdFromDevice, input.organizationId) as any
      : null;

    if (!source) {
      markRawEvent(db, input.rawEventId, input.organizationId, 'review_required_source_binding');
      return reviewResult(input, 'Capture device is not bound to an approved payment source.');
    }

    const paymentSourceId = source.id as string;
    const balanceAccountId = source.balance_account_id as string;
    const provider = source.provider as string;

    if (input.parsed.provider !== provider) {
      markRawEvent(db, input.rawEventId, input.organizationId, 'review_required_provider_mismatch');
      return reviewResult(
        input,
        `Parsed provider ${input.parsed.provider} does not match the device-bound source provider ${provider}.`
      );
    }

    // Exact amounts. A malformed or sub-piastre amount is never rounded into the ledger.
    let amountMinor: number;
    let statedBalanceMinor: number | undefined;
    try {
      amountMinor = toMinor(input.parsed.amount, { allowZero: false });
      statedBalanceMinor = input.parsed.statedBalance !== undefined
        ? toMinor(input.parsed.statedBalance, { allowNegative: true })
        : undefined;
    } catch (err) {
      if (err instanceof MoneyError) {
        markRawEvent(db, input.rawEventId, input.organizationId, 'review_required_invalid_amount');
        return reviewResult(input, `Parsed amount is not an exact EGP value (${err.message}).`);
      }
      throw err;
    }

    // 2. Financial Idempotency Check: Prevent Duplicate Transactions
    const existingTrx = db.prepare(`
      SELECT id, status, reconciliation_state, stated_balance_after_minor, amount_minor
      FROM transactions
      WHERE organization_id = ? AND provider = ? AND external_trx_id = ?
    `).get(input.organizationId, provider, input.parsed.externalTrxId) as any;

    if (existingTrx) {
      const afterMinor = Number(existingTrx.stated_balance_after_minor ?? 0);
      return {
        transactionId: existingTrx.id,
        externalTrxId: input.parsed.externalTrxId,
        status: existingTrx.status,
        reconciliationState: existingTrx.reconciliation_state,
        balanceBefore: fromMinor(afterMinor - Number(existingTrx.amount_minor)),
        balanceAfter: fromMinor(afterMinor),
        isDuplicate: true,
      };
    }

    // 3. Atomically Lock & Fetch Balance Account Anchor (Section 12A)
    // In SQLite, BEGIN IMMEDIATE ensures atomic write lock per database transaction
    db.exec('BEGIN IMMEDIATE;');

    try {
      const account = db.prepare(`
        SELECT id, current_balance_minor, version
        FROM balance_accounts
        WHERE id = ?
      `).get(balanceAccountId) as any;

      const currentMinor = Number(account?.current_balance_minor ?? 0);
      let balanceBeforeMinor = currentMinor;
      let balanceAfterMinor = currentMinor;
      let status: 'confirmed' | 'review_required' | 'pending_ordering' | 'failed' = 'confirmed';
      let reconciliationState: 'consistent' | 'gap_detected' | 'pending_ordering' = 'consistent';
      let reviewReason = input.parsed.unverifiedWarning;

      // 4. Invariant Check: Does Math Match?
      // Rule: Arithmetic consistency does NOT prove authenticity!
      const isUnverifiedChannel = input.adapterType === 'manual' || !input.signature;
      const hasAnomalyWarning = !!input.parsed.unverifiedWarning;
      const hasIndependentSettlementEvidence = input.independentSettlementEvidence === true;

      const checkpoint = db.prepare(`
        SELECT id, checkpoint_type
        FROM balance_checkpoints
        WHERE balance_account_id = ?
        ORDER BY as_of_timestamp DESC, created_at DESC
        LIMIT 1
      `).get(balanceAccountId) as { id?: string; checkpoint_type?: string } | undefined;
      const hasAnchor = Boolean(checkpoint?.id);

      const advanceLedger = (nextMinor: number) => {
        db.prepare(`
          UPDATE balance_accounts
          SET current_balance_minor = ?, version = version + 1, updated_at = datetime('now')
          WHERE id = ?
        `).run(nextMinor, balanceAccountId);
      };

      if (!hasAnchor) {
        status = 'review_required';
        reconciliationState = 'gap_detected';
        reviewReason = 'A trusted opening balance checkpoint is required before automatic reconciliation.';
      } else if (isUnverifiedChannel || hasAnomalyWarning) {
        // Quarantined into Review Queue; canonical balance does not advance until review.
        status = 'review_required';
        reconciliationState = hasAnomalyWarning ? 'gap_detected' : 'consistent';
      } else if (!hasIndependentSettlementEvidence) {
        // Device HMAC proves that a registered device captured these bytes. It
        // does not prove bank settlement. Keep the message and its arithmetic
        // evidence available to the operator without advancing the ledger.
        status = 'review_required';
        reconciliationState = 'consistent';
        reviewReason = 'Signed capture is not independent settlement evidence; operator verification is required.';
      } else if (statedBalanceMinor !== undefined) {
        // Out-of-Order Permutation Engine (Section 12A Algorithm)
        const inferredPriorMinor = statedBalanceMinor - amountMinor;

        if (inferredPriorMinor === currentMinor) {
          // Continuous link in the chain from an explicit, trusted checkpoint.
          status = 'confirmed';
          reconciliationState = 'consistent';
          balanceBeforeMinor = currentMinor;
          balanceAfterMinor = statedBalanceMinor;
          advanceLedger(balanceAfterMinor);
        } else {
          // Out-of-Order: inferred prior balance does NOT match current anchor.
          // Place into pending_ordering without declaring fake or dropping!
          status = 'pending_ordering';
          reconciliationState = 'pending_ordering';
          reviewReason = `Out-of-order arrival: prior balance ${fromMinor(inferredPriorMinor).toFixed(2)} does not match anchor ${fromMinor(currentMinor).toFixed(2)}`;
        }
      } else {
        // Standard credit without explicit post-balance string
        balanceBeforeMinor = currentMinor;
        balanceAfterMinor = currentMinor + amountMinor;
        advanceLedger(balanceAfterMinor);
      }

      // 5. Insert Reconciled Transaction
      const trxId = `tx_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const recordedStatedMinor = statedBalanceMinor !== undefined ? statedBalanceMinor : balanceAfterMinor;

      db.prepare(`
        INSERT INTO transactions (
          id, organization_id, balance_account_id, payment_source_id, raw_event_id,
          external_trx_id, provider, amount_minor, currency, stated_balance_after_minor,
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
        amountMinor,
        input.parsed.currency,
        recordedStatedMinor,
        input.parsed.senderName,
        input.parsed.senderPhone,
        status,
        reconciliationState,
        input.parsed.confidenceScore,
        reviewReason || null,
        input.signature || null,
        input.financialEventAt
      );

      markRawEvent(db, input.rawEventId, input.organizationId, status);

      // 6. Confirmed movements update the source limits inside the same
      // database transaction. A crash cannot leave a ledger entry without its
      // source usage or alert job.
      if (status === 'confirmed') {
        LimitEngine.recordTurnoverInTransaction(
          input.organizationId,
          paymentSourceId,
          amountMinor,
          input.financialEventAt
        );

        ReconciliationService.enqueueConfirmedWebhook(db, input.organizationId, {
          id: trxId,
          external_trx_id: input.parsed.externalTrxId,
          amount_minor: amountMinor,
          currency: input.parsed.currency,
          provider,
          financial_event_at: input.financialEventAt,
        });

        // Cascade Resolution: Check if any pending_ordering transactions can now resolve!
        ReconciliationService.resolvePendingCascade(db, input.organizationId, balanceAccountId, balanceAfterMinor);
      }

      db.exec('COMMIT;');

      return {
        transactionId: trxId,
        externalTrxId: input.parsed.externalTrxId,
        status,
        reconciliationState,
        balanceBefore: fromMinor(balanceBeforeMinor),
        balanceAfter: fromMinor(balanceAfterMinor),
        isDuplicate: false,
        reviewReason,
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /** Queues the transaction.confirmed webhook. Idempotent per transaction id. */
  static enqueueConfirmedWebhook(
    db: any,
    organizationId: string,
    trx: { id: string; external_trx_id: string; amount_minor: number; currency: string; provider: string; financial_event_at: string }
  ): void {
    db.prepare(`
      INSERT OR IGNORE INTO outbox_jobs (id, organization_id, job_type, payload)
      VALUES (?, ?, 'dispatch_webhook', ?)
    `).run(
      `job_tx_${trx.id}`,
      organizationId,
      JSON.stringify({
        event: 'transaction.confirmed',
        transaction_id: trx.id,
        external_trx_id: trx.external_trx_id,
        amount: fromMinor(trx.amount_minor),
        amount_minor: trx.amount_minor,
        currency: trx.currency,
        provider: trx.provider,
        financial_event_at: trx.financial_event_at,
      })
    );
  }

  /**
   * Cascade re-evaluation: When ledger balance advances to B, check if any pending_ordering
   * transactions were waiting for prior balance = B. Returns the final balance in piastres.
   */
  private static resolvePendingCascade(db: any, organizationId: string, balanceAccountId: string, currentMinor: number): number {
    let activeMinor = currentMinor;
    let resolvedAny = true;

    while (resolvedAny) {
      resolvedAny = false;
      const pendingRows = db.prepare(`
        SELECT id, raw_event_id, payment_source_id, amount_minor, currency, provider,
               stated_balance_after_minor, external_trx_id, financial_event_at
        FROM transactions
        WHERE organization_id = ? AND balance_account_id = ? AND status = 'pending_ordering'
        ORDER BY financial_event_at ASC, created_at ASC
      `).all(organizationId, balanceAccountId) as any[];

      for (const row of pendingRows) {
        const rowAmount = Number(row.amount_minor);
        const rowStated = Number(row.stated_balance_after_minor);
        if (rowStated - rowAmount !== activeMinor) continue;

        activeMinor = rowStated;

        db.prepare(`
          UPDATE transactions
          SET status = 'confirmed', reconciliation_state = 'consistent', review_reason = NULL
          WHERE id = ?
        `).run(row.id);

        db.prepare(`
          UPDATE balance_accounts
          SET current_balance_minor = ?, version = version + 1, updated_at = datetime('now')
          WHERE id = ?
        `).run(activeMinor, balanceAccountId);

        LimitEngine.recordTurnoverInTransaction(
          organizationId,
          row.payment_source_id,
          rowAmount,
          row.financial_event_at
        );

        if (row.raw_event_id) {
          markRawEvent(db, row.raw_event_id, organizationId, 'confirmed');
        }

        ReconciliationService.enqueueConfirmedWebhook(db, organizationId, { ...row, amount_minor: rowAmount });

        resolvedAny = true;
        break; // restart scan with new balance
      }
    }

    return activeMinor;
  }
}
