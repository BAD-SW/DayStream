import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { resolveConnectedAccount } from './payment-methods.service';
import { getDecryptedSecrets } from './processor-config.service';
import { getConfiguredAdapter, StripeAdapter } from './payments';
import { generateReference } from './customer-payment.service';

/**
 * Walk-in (customerless) one-time card payments.
 *
 * A walk-in has no customer record (we don't create a person they never consented
 * to). Their card is charged ONCE via a PaymentIntent and NEVER vaulted:
 *
 *   1. beginOneTimeOrderCharge → server creates a card PaymentIntent for the order
 *      total on the business's connected account (no Stripe Customer, no
 *      future-use). Returns the client_secret + publishable key.
 *   2. The browser confirms the intent with the card (raw PAN never touches us).
 *   3. finalizeOneTimeOrderCharge → server retrieves the intent, confirms it
 *      actually succeeded, and writes a CUSTOMERLESS pay_transactions row linked to
 *      the order. The order's own journal entry books revenue/tax per line, so this
 *      payment is NOT journaled again and is never treated as money "on account".
 *
 * Only the business's own connection is used (a business charges its customers),
 * mirroring the stored-method path — just without the customer/vault.
 */

export class WalkinPaymentError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

export interface OneTimeChargeSession {
  providerReference: string;      // PaymentIntent id the client confirms + we finalize
  clientSecret?: string;
  publishableKey?: string;
  amountCents: number;
  currency: string;
}

/** Resolve the business's processor publishable key (non-secret config). */
async function businessPublishableKey(businessId: string): Promise<string | undefined> {
  const { rows } = await adminPool.query(
    `SELECT config_json FROM pay_processor_connections
     WHERE owner_level = 'business' AND business_id = $1 LIMIT 1`,
    [businessId],
  );
  return rows[0]?.config_json?.publishable_key;
}

/** Business currency is authoritative for a business→customer charge. */
async function businessCurrency(businessId: string): Promise<string> {
  const { rows } = await adminPool.query('SELECT currency FROM sys_businesses WHERE id = $1', [businessId]);
  return rows[0]?.currency || process.env.PLATFORM_CURRENCY || 'EUR';
}

/**
 * Begin a one-time card charge for an OPEN order with no customer. Creates the
 * PaymentIntent the client will confirm. Does not write any ledger row yet (the
 * money isn't in until the client confirms and we finalize).
 */
export async function beginOneTimeOrderCharge(
  businessId: string, orderId: string,
): Promise<OneTimeChargeSession> {
  const { rows: orderRows } = await adminPool.query(
    `SELECT id, status, total_amount, customer_id FROM fin_orders WHERE id = $1 AND business_id = $2`,
    [orderId, businessId],
  );
  const order = orderRows[0];
  if (!order) throw new WalkinPaymentError('Order not found', 'ORDER_NOT_FOUND');
  if (order.status !== 'open') throw new WalkinPaymentError('Order is not open', 'ORDER_NOT_OPEN');
  if (order.total_amount <= 0) throw new WalkinPaymentError('Order total must be greater than zero', 'INVALID_AMOUNT');

  const account = await resolveConnectedAccount({ ownerLevel: 'customer', businessId });
  if (!account) throw new WalkinPaymentError('Business has no active payment processor connection', 'NO_CONNECTION');

  const secrets = await getDecryptedSecrets({ ownerLevel: 'business', businessId });
  const adapter = getConfiguredAdapter(account.provider, secrets);
  const currency = await businessCurrency(businessId);

  const session = await adapter.createOneTimeIntent({
    account,
    amount: order.total_amount,
    currency,
    description: `Order ${orderId} (walk-in)`,
    metadata: { kind: 'walkin_order', business_id: businessId, order_id: orderId },
  });

  return {
    providerReference: session.providerReference,
    clientSecret: session.clientSecret,
    publishableKey: adapter instanceof StripeAdapter ? await businessPublishableKey(businessId) : undefined,
    amountCents: order.total_amount,
    currency,
  };
}

export interface FinalizeOneTimeChargeResult {
  transactionId: string;
  referenceNumber: string;
  status: 'completed' | 'pending' | 'failed';
  amountCents: number;
  providerReference: string;
  cardLast4?: string | null;
  cardBrand?: string | null;
  failureReason?: string | null;
}

/**
 * Finalize a one-time order charge the client confirmed. Verifies the intent at
 * the provider (authoritative), then writes a customerless pay_transactions row
 * linked to the order. Returns the outcome; the caller (order completion) decides
 * whether to close the order. Does NOT post a payment journal entry — the order
 * journal books the GL for an order sale.
 */
export async function finalizeOneTimeOrderCharge(args: {
  businessId: string;
  orderId: string;
  providerReference: string;
  processedBy: string;
}): Promise<FinalizeOneTimeChargeResult> {
  const { businessId, orderId, providerReference, processedBy } = args;

  const { rows: orderRows } = await adminPool.query(
    `SELECT id, customer_id, total_amount FROM fin_orders WHERE id = $1 AND business_id = $2`,
    [orderId, businessId],
  );
  const order = orderRows[0];
  if (!order) throw new WalkinPaymentError('Order not found', 'ORDER_NOT_FOUND');

  const account = await resolveConnectedAccount({ ownerLevel: 'customer', businessId });
  if (!account) throw new WalkinPaymentError('Business has no active payment processor connection', 'NO_CONNECTION');
  const secrets = await getDecryptedSecrets({ ownerLevel: 'business', businessId });
  const adapter = getConfiguredAdapter(account.provider, secrets);

  // Authoritative read: what did the intent actually do? Never trust the browser.
  const res = await adapter.finalizeOneTimeIntent(providerReference, account);
  const status = res.outcome === 'succeeded' ? 'completed' : res.outcome === 'pending' ? 'pending' : 'failed';
  const currency = res.currency || await businessCurrency(businessId);
  const reference = generateReference();

  // Guard: the confirmed intent must be for the order's amount (defend against a
  // tampered client sending a cheaper intent). A failed/pending intent skips this.
  if (status === 'completed' && res.amount !== order.total_amount) {
    logger.warn(`Walk-in charge ${reference}: intent amount ${res.amount} != order total ${order.total_amount} for order ${orderId}`);
    throw new WalkinPaymentError('Payment amount does not match the order total', 'AMOUNT_MISMATCH');
  }

  // Customerless charge row linked to the order. No payment-journal post: the
  // order's generateJournalEntries books revenue/tax per line.
  const { rows } = await adminPool.query(
    `INSERT INTO pay_transactions
       (business_id, customer_id, type, status, amount, currency, payment_method,
        reference_number, description, processed_by, is_processed, provider_reference, order_id)
     VALUES ($1, NULL, 'charge', $2, $3, $4, 'card', $5, $6, $7, true, $8, $9)
     RETURNING id`,
    [
      businessId, status, order.total_amount, currency, reference,
      'Walk-in card payment', processedBy, providerReference, orderId,
    ],
  );

  return {
    transactionId: rows[0].id,
    referenceNumber: reference,
    status,
    amountCents: order.total_amount,
    providerReference,
    failureReason: status === 'failed' ? (res.failureReason ?? 'Declined') : null,
  };
}
