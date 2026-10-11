import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import type { ChargeOutcome } from './payments/adapter';

/**
 * Payment finalization — the pending → completed/failed transition for
 * asynchronous (bank-draw) customer charges.
 *
 * A SEPA/ACH/Bacs debit confirms at the provider as `processing` and settles days
 * later. The charge row is written `pending`; this service performs the terminal
 * transition when the debit's real outcome is known — whether that outcome comes
 * from the reconciliation poller (the reliable path, since each business charges
 * on its OWN provider account) or, best-effort, from a provider webhook.
 *
 * On SUCCESS it does everything that was deferred because the money wasn't in yet:
 *   - flips status → completed, stamps settled_at,
 *   - posts the GL entry (invoice-aware: per-line revenue for an invoice payment,
 *     otherwise the deposit/revenue/deferred mapping of postPaymentJournalEntry),
 *   - confirms the linked booking,
 *   - marks the linked invoice paid.
 * On FAILURE it flips status → failed, stamps settled_at, and releases a linked
 * booking (the hold is void now the debit bounced).
 *
 * Idempotent: it only acts on a row that is STILL `pending`, and the GL post is
 * itself idempotent, so a webhook and the poller racing on the same row is safe.
 * Non-throwing: a single row's failure is logged and never aborts a batch.
 */

export interface FinalizeResult {
  transactionId: string;
  changed: boolean;                 // did we transition the row this call?
  newStatus?: 'completed' | 'failed';
}

/**
 * Finalize one pending processed charge given its resolved provider outcome.
 * `outcome` is what the provider now reports: 'succeeded' | 'failed' | 'pending'.
 * A still-'pending' outcome is a no-op (the debit hasn't cleared yet).
 */
export async function finalizePendingTransaction(
  txnId: string, outcome: ChargeOutcome,
): Promise<FinalizeResult> {
  if (outcome === 'pending') return { transactionId: txnId, changed: false };

  // Claim the transition atomically: flip ONLY if still pending. The RETURNING row
  // tells us whether we won the claim (so webhook/poller races don't double-post).
  const newStatus: 'completed' | 'failed' = outcome === 'succeeded' ? 'completed' : 'failed';
  const { rows } = await adminPool.query(
    `UPDATE pay_transactions
     SET status = $2, settled_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [txnId, newStatus],
  );
  const row = rows[0];
  if (!row) return { transactionId: txnId, changed: false };   // already finalized by someone else

  try {
    if (newStatus === 'completed') {
      await onSettled(row);
    } else {
      await onFailed(row);
    }
  } catch (e: any) {
    // The status transition stands (money state is known); only the side effects
    // failed. Log loudly — GL/booking may need a manual nudge — but don't throw.
    logger.warn(`Finalize ${row.reference_number || txnId}: side effects after ${newStatus} failed: ${e?.message || e}`);
  }

  return { transactionId: txnId, changed: true, newStatus };
}

/** Settled: post the GL, confirm the booking, mark the invoice paid. */
async function onSettled(row: any): Promise<void> {
  const journal = await import('./payment-journal.service');

  if (row.invoice_id) {
    // Invoice payment: per-line revenue split (service/product immediate,
    // membership/package deferred, tax to 2300), debiting Cash.
    const { rows: invRows } = await adminPool.query(
      'SELECT invoice_number FROM pay_invoices WHERE id = $1', [row.invoice_id],
    );
    await journal.postInvoicePaymentJournalEntry({
      businessId: row.business_id, invoiceId: row.invoice_id, transactionId: row.id,
      amountCents: row.amount, debitCode: '1100', referenceType: 'payment',
      description: `Invoice #${invRows[0]?.invoice_number ?? ''} payment`.trim(),
    });
    // Mark the invoice paid (mirrors settleInvoice's own update).
    await adminPool.query(
      `UPDATE pay_invoices SET amount_paid_cents = total_cents, status = 'paid', updated_at = NOW()
       WHERE id = $1 AND status <> 'void'`,
      [row.invoice_id],
    );
  } else {
    // Non-invoice charge: deposit (2500) if unapplied, deferred (2400) if
    // enrollment-linked, else service revenue (4100). postPaymentJournalEntry
    // reads the linkage off the row and also creates the account-credit row for
    // an unapplied deposit.
    await journal.postPaymentJournalEntry(row);
  }

  // Confirm a held booking now the money is in.
  if (row.booking_id) {
    const { confirmBooking } = await import('./booking-lifecycle.service');
    const tenantId = await tenantForBusiness(row.business_id);
    const conf = await confirmBooking(row.booking_id, row.business_id, row.processed_by, tenantId);
    if (!conf.success) {
      logger.info(`Finalize ${row.reference_number}: booking not transitioned to confirmed: ${conf.error}`);
    }
  }
}

/** Failed: release a held booking (the debit bounced, so the hold is void). */
async function onFailed(row: any): Promise<void> {
  if (row.booking_id) {
    const { cancelBooking } = await import('./booking-lifecycle.service');
    const tenantId = await tenantForBusiness(row.business_id);
    const rel = await cancelBooking(row.booking_id, row.business_id, row.processed_by, tenantId, 'Bank debit failed to settle');
    if (!rel.success) logger.warn(`Finalize ${row.reference_number}: booking release failed: ${rel.error}`);
  }

  if (row.enrollment_id) {
    // KNOWN LIMITATION: a membership renewal advances its period optimistically on
    // the 'pending' charge. If that debit later FAILS, the period was extended but
    // never paid. Unwinding it here would risk double-handling with the dunning
    // retry cycle, so for now we log it for follow-up rather than auto-reverse.
    logger.warn(`Finalize ${row.reference_number}: enrollment ${row.enrollment_id} bank debit failed AFTER period advance — needs dunning/clawback review`);
  }
}

/** pay_transactions has no tenant_id; resolve it from the business for booking calls. */
async function tenantForBusiness(businessId: string): Promise<string> {
  const { rows } = await adminPool.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);
  return rows[0]?.tenant_id;
}
