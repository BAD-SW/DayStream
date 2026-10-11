import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { resolveConnectedAccount } from './payment-methods.service';
import { getDecryptedSecrets } from './processor-config.service';
import { getConfiguredAdapter } from './payments';
import { generateReference } from './customer-payment.service';
import { logAudit } from './audit.service';
import { queueNotification } from './booking-notifications.service';

/**
 * Section C — Refund processing (spec 10-payment-platform, task 4.6 / Requirement C4).
 *
 * Full or partial refund of a prior customer charge, validated not to exceed the
 * original (less any prior refunds). A reason is required. Processed charges are
 * returned to the original method via `adapter.refund` against the stored provider
 * reference; manually-recorded charges (cash/check/bank_transfer/gift_card) are
 * refunded out-of-band and only recorded in the ledger. Writes a `refund`
 * transaction linked to the parent, emits a credit note, and audits the operation
 * with the initiating user.
 */

class RefundError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'RefundError';
    this.code = code;
  }
}

export interface RefundInput {
  businessId: string;
  tenantId: string;
  transactionId: string;      // the original charge to refund
  amountCents?: number | null; // omit/null for a full refund of the remaining balance
  reason: string;              // required (C4.6)
  processedBy: string;         // initiating user (C4.9)
}

export interface RefundResult {
  refundTransactionId: string;
  referenceNumber: string;
  amountCents: number;
  status: 'completed' | 'pending' | 'failed';
  isProcessed: boolean;
  providerReference?: string | null;
  originalTransactionId: string;
  remainingRefundableCents: number;
  failureReason?: string | null;
}

/**
 * Process a refund against an original charge. Returns the refund result.
 */
export async function refundTransaction(input: RefundInput): Promise<RefundResult> {
  if (!input.reason || !input.reason.trim()) {
    throw new RefundError('A reason is required to process a refund', 'REASON_REQUIRED');
  }

  // Load the original charge (scoped to the business) and compute what's left.
  const { rows: origRows } = await adminPool.query(
    `SELECT id, business_id, customer_id, booking_id, membership_id, enrollment_id, invoice_id,
            amount, currency, payment_method, reference_number, is_processed, provider_reference,
            card_last4, card_brand
     FROM pay_transactions
     WHERE id = $1 AND business_id = $2 AND type = 'charge'`,
    [input.transactionId, input.businessId],
  );
  const original = origRows[0];
  if (!original) throw new RefundError('Original charge not found for this business', 'CHARGE_NOT_FOUND');

  // Only completed charges are refundable (a pending/failed charge has no funds to return).
  const { rows: statusRows } = await adminPool.query(
    `SELECT status FROM pay_transactions WHERE id = $1`, [input.transactionId],
  );
  if (statusRows[0]?.status !== 'completed') {
    throw new RefundError('Only a completed charge can be refunded', 'CHARGE_NOT_COMPLETED');
  }

  const { rows: refundedRows } = await adminPool.query(
    `SELECT COALESCE(SUM(amount), 0)::int AS total_refunded
     FROM pay_transactions
     WHERE refund_of_id = $1 AND type = 'refund' AND status IN ('completed', 'pending')`,
    [input.transactionId],
  );
  const alreadyRefunded = refundedRows[0].total_refunded as number;
  const remaining = original.amount - alreadyRefunded;
  if (remaining <= 0) throw new RefundError('This charge has already been fully refunded', 'ALREADY_REFUNDED');

  // Default to a full refund of what remains.
  const amountCents = input.amountCents == null ? remaining : input.amountCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RefundError('Refund amount must be a positive integer (cents)', 'INVALID_AMOUNT');
  }
  if (amountCents > remaining) {
    throw new RefundError(
      `Refund amount (${amountCents}) exceeds the remaining refundable balance (${remaining})`,
      'EXCEEDS_REFUNDABLE',
    );
  }

  const reference = generateReference();
  const currency: string = original.currency;

  let status: 'completed' | 'pending' | 'failed' = 'completed';
  let providerReference: string | null = null;
  let failureReason: string | null = null;

  // Processed charge → return to the original method through the provider.
  if (original.is_processed && original.provider_reference) {
    const owner = {
      ownerLevel: 'customer' as const, businessId: input.businessId,
      tenantId: input.tenantId, customerId: original.customer_id,
    };
    const account = await resolveConnectedAccount(owner);
    if (!account) throw new RefundError('Business has no active payment processor connection', 'NO_CONNECTION');

    const secrets = await getDecryptedSecrets({ ownerLevel: 'business', businessId: input.businessId });
    const adapter = getConfiguredAdapter(account.provider, secrets);
    try {
      const res = await adapter.refund({
        account,
        providerReference: original.provider_reference,
        amount: amountCents,                          // partial supported; omit = full at provider
        // Stable per (charge, amount) so a retry never double-refunds.
        idempotencyKey: `refund:${original.id}:${amountCents}`,
        reason: input.reason,
      });
      status = res.outcome === 'succeeded' ? 'completed' : res.outcome === 'pending' ? 'pending' : 'failed';
      providerReference = res.providerReference ?? null;
      failureReason = res.failureReason ?? null;
    } catch (e: any) {
      status = 'failed';
      failureReason = e?.message || 'Refund failed at provider';
    }
  }
  // Manual-record / gift-card charges: refunded out-of-band; just record the row.

  // Write the refund ledger row linked to the parent charge. Mirrors the parent's
  // method + any booking/enrollment linkage so reporting and net-collections net
  // out correctly.
  const { rows: refundRows } = await adminPool.query(
    `INSERT INTO pay_transactions
       (business_id, customer_id, booking_id, membership_id, enrollment_id, type, status, amount, currency,
        payment_method, reference_number, description, refund_of_id, refund_reason, processed_by,
        is_processed, provider_reference, card_last4, card_brand)
     VALUES ($1,$2,$3,$4,$5,'refund',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      input.businessId, original.customer_id, original.booking_id, original.membership_id, original.enrollment_id,
      status, amountCents, currency, original.payment_method, reference,
      `Refund of ${original.reference_number || original.id}`, original.id, input.reason, input.processedBy,
      original.is_processed, providerReference, original.card_last4, original.card_brand,
    ],
  );
  const refundId = refundRows[0].id;

  // Post the reversing GL entry for a settled refund (Debit revenue / Credit Cash),
  // mirroring the charge mapping (enrollment-linked → Deferred Revenue). Non-blocking.
  if (status === 'completed') {
    const { postRefundJournalEntry } = await import('./payment-journal.service');
    await postRefundJournalEntry({
      id: refundId,
      business_id: input.businessId,
      amount: amountCents,
      payment_method: original.payment_method,
      reference_number: reference,
      booking_id: original.booking_id,
      enrollment_id: original.enrollment_id,
      invoice_id: original.invoice_id,
    });
  }

  const result: RefundResult = {
    refundTransactionId: refundId,
    referenceNumber: reference,
    amountCents,
    status,
    isProcessed: original.is_processed,
    providerReference,
    originalTransactionId: original.id,
    remainingRefundableCents: status === 'failed' ? remaining : remaining - amountCents,
    failureReason: status === 'failed' ? (failureReason ?? 'Refund failed') : null,
  };

  // Audit every refund with the initiating user (C4.9).
  await logAudit({
    tenantId: input.tenantId,
    userId: input.processedBy,
    action: 'payment.refunded',
    resourceType: 'payment_transaction',
    resourceId: original.id,
    details: {
      refund_transaction_id: refundId,
      amount_cents: amountCents,
      currency,
      reason: input.reason,
      status,
      is_processed: original.is_processed,
      original_reference: original.reference_number ?? null,
    },
  }).catch(() => { /* audit must never block the refund */ });

  // Emit a credit note / refund receipt to the customer (C4.8). Non-blocking.
  if (status !== 'failed') {
    issueCreditNote(input, original, result, currency).catch((e) =>
      logger.warn(`Refund ${reference}: credit-note enqueue failed: ${e?.message || e}`),
    );
  }

  return result;
}

/** Queue a credit note / refund receipt for the customer. */
async function issueCreditNote(
  input: RefundInput, original: any, result: RefundResult, currency: string,
): Promise<void> {
  const { rows } = await adminPool.query(
    'SELECT email, first_name, last_name FROM cus_customers WHERE id = $1',
    [original.customer_id],
  );
  const cust = rows[0];
  await queueNotification({
    businessId: input.businessId,
    type: 'payment.credit_note',
    recipientId: original.customer_id,
    recipientEmail: cust?.email || undefined,
    data: {
      reference_number: result.referenceNumber,
      original_reference: original.reference_number ?? null,
      amount_cents: result.amountCents,
      currency,
      reason: input.reason,
      method: original.payment_method,
      is_processed: result.isProcessed,
      customer_name: cust ? [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() : null,
    },
  });
}

export { RefundError };
