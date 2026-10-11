import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { resolveConnectedAccount, MethodOwner } from './payment-methods.service';
import { getDecryptedSecrets } from './processor-config.service';
import { getConfiguredAdapter, StripeAdapter } from './payments';
import { finalizePendingTransaction } from './payment-finalization.service';

/**
 * Payment reconciliation poller — the RELIABLE finalization path for async
 * (bank-draw) customer charges.
 *
 * Because every business charges on its OWN provider account (separate Stripe
 * keys, not Connect), the single platform webhook endpoint can't verify a
 * business charge's signature or route it to the right business. So rather than
 * depend on webhooks, this poller actively re-checks each pending processed
 * charge against the provider using the SAME per-business adapter the charge was
 * made with, and finalizes it when the debit has cleared (or failed).
 *
 * Scope: one business at a time (driven by the per-business reconciliation job),
 * matching how Section C charges are owned. A charge is eligible once it's been
 * pending past a short grace window (a freshly-created `processing` intent won't
 * have changed yet, so there's no point hammering the API immediately).
 */

/** Don't re-poll a charge until it's been pending at least this long. */
const GRACE_MINUTES = 10;
/** Safety cap per run so one business can't monopolize a scheduler slot. */
const BATCH_LIMIT = 100;

export interface ReconcileSummary {
  businessId: string;
  checked: number;
  completed: number;
  failed: number;
  stillPending: number;
  skipped: number;        // no connection / mock adapter / no provider ref
  errors: number;
}

/**
 * Reconcile a business's pending processed charges against its provider.
 * Non-throwing overall; per-row failures are counted and logged.
 */
export async function reconcileBusinessPayments(businessId: string): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    businessId, checked: 0, completed: 0, failed: 0, stillPending: 0, skipped: 0, errors: 0,
  };

  // Resolve the business's charging connection + adapter ONCE for the batch — all
  // its pending charges live in the same provider account.
  const owner: MethodOwner = { ownerLevel: 'customer', businessId };
  const account = await resolveConnectedAccount(owner);
  if (!account) {
    logger.info(`Reconcile: business ${businessId} has no active connection; nothing to reconcile`);
    return summary;
  }
  const secrets = await getDecryptedSecrets({ ownerLevel: 'business', businessId });
  const adapter = getConfiguredAdapter(account.provider, secrets);

  // The mock adapter has no real provider state to poll; skip (dev/local).
  if (!(adapter instanceof StripeAdapter)) {
    logger.info(`Reconcile: business ${businessId} uses the mock adapter; skipping provider poll`);
    return summary;
  }

  const { rows } = await adminPool.query(
    `SELECT id, provider_reference, reference_number
     FROM pay_transactions
     WHERE business_id = $1
       AND status = 'pending'
       AND is_processed = true
       AND provider_reference IS NOT NULL
       AND created_at < NOW() - INTERVAL '${GRACE_MINUTES} minutes'
     ORDER BY created_at
     LIMIT ${BATCH_LIMIT}`,
    [businessId],
  );

  for (const row of rows) {
    summary.checked++;
    try {
      const outcome = await adapter.getStatus(row.provider_reference, account);
      if (outcome === 'pending') { summary.stillPending++; continue; }

      const res = await finalizePendingTransaction(row.id, outcome);
      if (res.changed && res.newStatus === 'completed') summary.completed++;
      else if (res.changed && res.newStatus === 'failed') summary.failed++;
      else summary.stillPending++;   // someone else finalized it; treat as resolved
    } catch (e: any) {
      summary.errors++;
      logger.warn(`Reconcile: failed to check charge ${row.reference_number || row.id}: ${e?.message || e}`);
    }
  }

  if (summary.checked > 0) {
    logger.info(`Reconcile (business ${businessId}): ${JSON.stringify(summary)}`);
  }
  return summary;
}

export interface PlatformReconcileSummary {
  businessesSwept: number;
  checked: number;
  completed: number;
  failed: number;
  stillPending: number;
  skipped: number;
  errors: number;
}

/**
 * Platform-wide sweep: reconcile pending processed charges across ALL businesses
 * that have any. Driven by the single platform-scoped `payment_reconciliation`
 * job so a business never has to provision its own schedule — any business with a
 * pending bank draw is picked up automatically.
 *
 * Only businesses that actually have an eligible pending charge are visited (so a
 * quiet platform does almost no work), and each is reconciled independently —
 * one business's connection/API failure never blocks the others.
 */
export async function reconcileAllPendingPayments(): Promise<PlatformReconcileSummary> {
  const total: PlatformReconcileSummary = {
    businessesSwept: 0, checked: 0, completed: 0, failed: 0, stillPending: 0, skipped: 0, errors: 0,
  };

  // Which businesses have eligible pending charges right now? (Same predicate the
  // per-business sweep uses, so we don't spin up adapters for businesses with
  // nothing to do.)
  const { rows } = await adminPool.query(
    `SELECT DISTINCT business_id
     FROM pay_transactions
     WHERE status = 'pending' AND is_processed = true AND provider_reference IS NOT NULL
       AND created_at < NOW() - INTERVAL '${GRACE_MINUTES} minutes'`,
  );

  for (const { business_id } of rows) {
    total.businessesSwept++;
    try {
      const s = await reconcileBusinessPayments(business_id);
      total.checked += s.checked;
      total.completed += s.completed;
      total.failed += s.failed;
      total.stillPending += s.stillPending;
      total.skipped += s.skipped;
      total.errors += s.errors;
    } catch (e: any) {
      total.errors++;
      logger.warn(`Reconcile sweep: business ${business_id} failed: ${e?.message || e}`);
    }
  }

  if (total.businessesSwept > 0) {
    logger.info(`Reconcile sweep: ${JSON.stringify(total)}`);
  }
  return total;
}
