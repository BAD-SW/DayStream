import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { PoolClient } from 'pg';
import {
  resolveConnectedAccount, getProviderToken, getCustomerRef, MethodOwner,
} from './payment-methods.service';
import { getDecryptedSecrets } from './processor-config.service';
import { getConfiguredAdapter } from './payments';
import { METHOD_CATALOG, CatalogMethod } from './payment-catalog.service';
import { confirmBooking, cancelBooking } from './booking-lifecycle.service';
import { queueNotification } from './booking-notifications.service';
import { postPaymentJournalEntry } from './payment-journal.service';

/**
 * Section C — One-time customer payments (spec 10-payment-platform, task 4.2).
 *
 * A business collects a one-off payment from a customer via one of three paths,
 * selected by the method's catalog class:
 *   - processed      (card / bank_draw / wallet): charged through the provider
 *     adapter against the BUSINESS's connected account, using the customer's
 *     stored vault method.
 *   - manual_record  (cash / check / bank_transfer / other): recorded only; no
 *     money moves through DayStream.
 *   - internal       (gift_card): redeemed against a business gift-card balance.
 *
 * Every path writes a row to the shared customer ledger (pay_transactions). On a
 * settled charge tied to a pending booking, the booking is confirmed; on a failed
 * charge it is released (cancelled). A receipt is queued on success.
 *
 * Funds settle into the business's own account — DayStream never holds them.
 */

export interface OneTimePaymentInput {
  businessId: string;
  tenantId: string;
  customerId: string;
  method: CatalogMethod;
  amountCents: number;
  /** Required for processed charges — the customer's stored vault method. */
  paymentMethodId?: string | null;
  /** Required for gift_card — the card code to redeem against. */
  giftCardCode?: string | null;
  bookingId?: string | null;
  membershipId?: string | null;
  description?: string | null;
  /** Manual-record metadata (optional, for the receipt/record). */
  checkNumber?: string | null;
  /** The staff user recording/taking the payment. */
  processedBy: string;
}

export type PaymentStatus = 'completed' | 'pending' | 'failed';

export interface OneTimePaymentResult {
  transactionId: string;
  referenceNumber: string;
  status: PaymentStatus;
  amountCents: number;
  method: CatalogMethod;
  isProcessed: boolean;
  providerReference?: string | null;
  giftCardBalanceCents?: number | null;
  bookingConfirmed?: boolean;
  failureReason?: string | null;
}

class PaymentError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
  }
}

/**
 * Charge a customer's stored (vaulted) method through the business's connected
 * account. This is the single processed-charge primitive shared by one-time
 * payments (task 4.2) and recurring membership renewals (task 4.3): it resolves
 * the business connection, the vault token, and the provider Customer, builds the
 * adapter from the business's secrets, and executes an off-session charge.
 *
 * Returns the mapped outcome; it does NOT write the ledger — the caller records
 * the pay_transactions row with whatever linkage (booking / enrollment / invoice)
 * applies to its context. Throws PaymentError for setup problems (no connection,
 * method gone); a provider decline comes back as outcome 'failed' with a reason.
 */
export interface ChargeStoredMethodInput {
  owner: MethodOwner;              // { ownerLevel:'customer', businessId, tenantId, customerId }
  amountCents: number;
  currency: string;
  paymentMethodId: string;         // the customer's stored vault method
  idempotencyKey: string;          // stable per logical charge (never double-charge on retry)
  description?: string;
  metadata?: Record<string, string>;
}

export interface ChargeStoredMethodResult {
  outcome: 'succeeded' | 'pending' | 'failed';
  providerReference?: string | null;
  failureReason?: string | null;
}

export async function chargeStoredMethod(input: ChargeStoredMethodInput): Promise<ChargeStoredMethodResult> {
  const { owner } = input;
  if (!owner.businessId) throw new PaymentError('A business is required to charge a stored method', 'NO_BUSINESS');

  const account = await resolveConnectedAccount(owner);
  if (!account) throw new PaymentError('Business has no active payment processor connection', 'NO_CONNECTION');

  const tokenInfo = await getProviderToken(input.paymentMethodId);
  if (!tokenInfo) throw new PaymentError('Stored payment method is no longer available', 'METHOD_UNAVAILABLE');

  // Off-session charge of a vaulted method must reference the provider Customer
  // it's attached to. The business connection owns both.
  const customerRef = await getCustomerRef(owner, account.provider);
  const secrets = await getDecryptedSecrets({ ownerLevel: 'business', businessId: owner.businessId });
  const adapter = getConfiguredAdapter(account.provider, secrets);

  try {
    const res = await adapter.charge({
      account,
      amount: input.amountCents,
      currency: input.currency,
      methodToken: tokenInfo.token,
      methodType: tokenInfo.methodType as any,
      customerRef,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      metadata: input.metadata,
    });
    return { outcome: res.outcome, providerReference: res.providerReference, failureReason: res.failureReason };
  } catch (e: any) {
    return { outcome: 'failed', failureReason: e?.message || 'Charge failed' };
  }
}

/** Business currency is authoritative for a customer→business charge. */
export async function resolveBusinessCurrency(businessId: string): Promise<string> {
  const { rows } = await adminPool.query('SELECT currency FROM sys_businesses WHERE id = $1', [businessId]);
  return rows[0]?.currency || process.env.PLATFORM_CURRENCY || 'EUR';
}

/** Short, human-readable, reasonably-unique reference for the ledger row. */
export function generateReference(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PAY-${stamp}-${rand}`;
}

/**
 * Insert a pay_transactions charge row (including the Section C columns added in
 * migration 127). Returns the created row. Uses the given client when provided so
 * the write can share a transaction (gift-card path); otherwise uses adminPool.
 */
export async function insertChargeRow(
  exec: PoolClient | typeof adminPool,
  input: {
    businessId: string; customerId: string; bookingId?: string | null; membershipId?: string | null;
    enrollmentId?: string | null; invoiceId?: string | null;
    amountCents: number; currency: string; method: CatalogMethod; status: PaymentStatus;
    referenceNumber: string; description?: string | null; processedBy?: string | null;
    isProcessed: boolean; providerReference?: string | null; paymentMethodId?: string | null;
    checkNumber?: string | null; giftCardCode?: string | null;
    cardLast4?: string | null; cardBrand?: string | null;
  },
): Promise<any> {
  const { rows } = await exec.query(
    `INSERT INTO pay_transactions
       (business_id, customer_id, booking_id, membership_id, type, status, amount, currency,
        payment_method, reference_number, description, processed_by,
        is_processed, provider_reference, payment_method_id, check_number, gift_card_code,
        card_last4, card_brand, enrollment_id, invoice_id)
     VALUES ($1,$2,$3,$4,'charge',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      input.businessId, input.customerId, input.bookingId ?? null, input.membershipId ?? null,
      input.status, input.amountCents, input.currency, input.method,
      input.referenceNumber, input.description ?? null, input.processedBy ?? null,
      input.isProcessed, input.providerReference ?? null, input.paymentMethodId ?? null,
      input.checkNumber ?? null, input.giftCardCode ?? null,
      input.cardLast4 ?? null, input.cardBrand ?? null,
      input.enrollmentId ?? null, input.invoiceId ?? null,
    ],
  );
  return rows[0];
}

/**
 * Take a one-time customer payment. Validates the method against the business's
 * catalog, runs the appropriate path, writes the ledger row, reconciles the
 * booking, and issues a receipt.
 */
export async function takeOneTimePayment(input: OneTimePaymentInput): Promise<OneTimePaymentResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PaymentError('Amount must be a positive integer (cents)', 'INVALID_AMOUNT');
  }
  const def = METHOD_CATALOG[input.method];
  if (!def) throw new PaymentError(`Unknown payment method: ${input.method}`, 'INVALID_METHOD');

  const currency = await resolveBusinessCurrency(input.businessId);
  const reference = generateReference();

  let result: OneTimePaymentResult;
  if (def.processed) {
    result = await runProcessed(input, currency, reference);
  } else if (def.klass === 'internal') {
    result = await runGiftCard(input, currency, reference);
  } else {
    result = await runManualRecord(input, currency, reference);
  }

  // Reconcile the booking: confirm when the money is in (settled/pending both
  // mean "payment accepted"; pending bank debits finalize via webhook later),
  // release it only on an outright failure.
  if (input.bookingId) {
    if (result.status === 'failed') {
      const rel = await cancelBooking(input.bookingId, input.businessId, input.processedBy, input.tenantId, 'Payment failed');
      if (!rel.success) logger.warn(`Payment ${reference}: booking release failed: ${rel.error}`);
      result.bookingConfirmed = false;
    } else {
      const conf = await confirmBooking(input.bookingId, input.businessId, input.processedBy, input.tenantId);
      // A non-pending booking (already confirmed, etc.) isn't an error for payment.
      result.bookingConfirmed = conf.success;
      if (!conf.success) logger.info(`Payment ${reference}: booking not transitioned to confirmed: ${conf.error}`);
    }
  }

  if (result.status !== 'failed') {
    await issueReceipt(input, result, currency).catch((e) =>
      logger.warn(`Payment ${reference}: receipt enqueue failed: ${e?.message || e}`),
    );
  }

  return result;
}

/** Processed path: charge the customer's stored method via the shared primitive. */
async function runProcessed(
  input: OneTimePaymentInput, currency: string, reference: string,
): Promise<OneTimePaymentResult> {
  if (!input.paymentMethodId) {
    throw new PaymentError('A stored payment method is required for a processed payment', 'METHOD_REQUIRED');
  }
  const owner: MethodOwner = {
    ownerLevel: 'customer', businessId: input.businessId, tenantId: input.tenantId, customerId: input.customerId,
  };

  const { outcome, providerReference, failureReason } = await chargeStoredMethod({
    owner,
    amountCents: input.amountCents,
    currency,
    paymentMethodId: input.paymentMethodId,
    // Stable per logical payment so a retry never double-charges.
    idempotencyKey: `onetime:${reference}`,
    description: input.description || `Payment ${reference}`,
    metadata: {
      kind: 'customer_one_time',
      business_id: input.businessId,
      customer_id: input.customerId,
      reference,
      ...(input.bookingId ? { booking_id: input.bookingId } : {}),
    },
  });

  const status: PaymentStatus = outcome === 'succeeded' ? 'completed' : outcome === 'pending' ? 'pending' : 'failed';

  const row = await insertChargeRow(adminPool, {
    businessId: input.businessId, customerId: input.customerId, bookingId: input.bookingId,
    membershipId: input.membershipId, amountCents: input.amountCents, currency, method: input.method,
    status, referenceNumber: reference, description: input.description, processedBy: input.processedBy,
    isProcessed: true, providerReference: providerReference ?? null, paymentMethodId: input.paymentMethodId,
  });

  if (status === 'completed') await postPaymentJournalEntry(row);

  return {
    transactionId: row.id, referenceNumber: reference, status, amountCents: input.amountCents,
    method: input.method, isProcessed: true, providerReference: providerReference ?? null,
    failureReason: status === 'failed' ? (failureReason ?? 'Declined') : null,
  };
}

/** Manual-record path: no money moves through DayStream; record the ledger row. */
async function runManualRecord(
  input: OneTimePaymentInput, currency: string, reference: string,
): Promise<OneTimePaymentResult> {
  const row = await insertChargeRow(adminPool, {
    businessId: input.businessId, customerId: input.customerId, bookingId: input.bookingId,
    membershipId: input.membershipId, amountCents: input.amountCents, currency, method: input.method,
    status: 'completed', referenceNumber: reference, description: input.description, processedBy: input.processedBy,
    isProcessed: false, checkNumber: input.checkNumber ?? null,
  });
  await postPaymentJournalEntry(row);
  return {
    transactionId: row.id, referenceNumber: reference, status: 'completed', amountCents: input.amountCents,
    method: input.method, isProcessed: false,
  };
}

/**
 * Gift-card path: redeem (partially) against a business gift card. Validates and
 * decrements the balance and writes the ledger row in one transaction so a
 * concurrent redemption can't overspend the balance.
 */
async function runGiftCard(
  input: OneTimePaymentInput, currency: string, reference: string,
): Promise<OneTimePaymentResult> {
  const code = (input.giftCardCode || '').trim();
  if (!code) throw new PaymentError('A gift card code is required for gift-card redemption', 'CODE_REQUIRED');

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // Lock the card row for the balance check + decrement.
    const { rows: cardRows } = await client.query(
      `SELECT id, balance_cents, currency, status, expires_at
       FROM pay_gift_cards
       WHERE code = $1 AND business_id = $2 AND tenant_id = $3
       FOR UPDATE`,
      [code, input.businessId, input.tenantId],
    );
    const card = cardRows[0];
    if (!card) throw new PaymentError('Gift card not found for this business', 'GIFT_CARD_NOT_FOUND');
    if (card.status !== 'active') throw new PaymentError(`Gift card is ${card.status}`, 'GIFT_CARD_INACTIVE');
    if (card.expires_at && new Date(card.expires_at) < new Date()) {
      throw new PaymentError('Gift card has expired', 'GIFT_CARD_EXPIRED');
    }
    if (card.currency !== currency) {
      throw new PaymentError('Gift card currency does not match the business currency', 'GIFT_CARD_CURRENCY');
    }
    if (card.balance_cents < input.amountCents) {
      throw new PaymentError(
        `Gift card balance (${card.balance_cents}) is less than the amount (${input.amountCents})`,
        'GIFT_CARD_INSUFFICIENT',
      );
    }

    const newBalance = card.balance_cents - input.amountCents;
    const newStatus = newBalance === 0 ? 'depleted' : 'active';
    await client.query(
      `UPDATE pay_gift_cards SET balance_cents = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [newBalance, newStatus, card.id],
    );

    const row = await insertChargeRow(client, {
      businessId: input.businessId, customerId: input.customerId, bookingId: input.bookingId,
      membershipId: input.membershipId, amountCents: input.amountCents, currency, method: 'gift_card',
      status: 'completed', referenceNumber: reference, description: input.description, processedBy: input.processedBy,
      isProcessed: false, giftCardCode: code,
    });

    await client.query('COMMIT');
    // NOTE: gift-card redemption is intentionally NOT journaled as Cash→Revenue.
    // The cash arrived (and a gift-card liability was created) when the card was
    // SOLD; redemption moves liability→revenue, not cash→revenue. Journaling it
    // like a cash charge would double-count cash. Correct gift-card GL (Debit
    // gift-card liability / Credit revenue, plus the purchase-side entry) is a
    // follow-up once a gift-card liability account + purchase journaling exist.
    return {
      transactionId: row.id, referenceNumber: reference, status: 'completed', amountCents: input.amountCents,
      method: 'gift_card', isProcessed: false, giftCardBalanceCents: newBalance,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Queue a payment receipt for the customer. Modeled on the booking-notification
 * queue; delivery is handled by the notification worker. Never blocks or fails
 * the payment itself (caller swallows errors).
 */
async function issueReceipt(
  input: OneTimePaymentInput, result: OneTimePaymentResult, currency: string,
): Promise<void> {
  const { rows } = await adminPool.query(
    'SELECT email, first_name, last_name FROM cus_customers WHERE id = $1',
    [input.customerId],
  );
  const cust = rows[0];
  await queueNotification({
    businessId: input.businessId,
    type: 'payment.receipt',
    recipientId: input.customerId,
    recipientEmail: cust?.email || undefined,
    data: {
      reference_number: result.referenceNumber,
      amount_cents: result.amountCents,
      currency,
      method: result.method,
      status: result.status,
      is_processed: result.isProcessed,
      booking_id: input.bookingId || null,
      customer_name: cust ? [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() : null,
    },
  });
}

export { PaymentError };
