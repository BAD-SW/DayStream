import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { resolveConnectedAccount } from './payment-methods.service';
import { getDecryptedSecrets } from './processor-config.service';
import { getConfiguredAdapter } from './payments';
import { generateReference } from './customer-payment.service';
import { logAudit } from './audit.service';
import * as journal from './journal.service';

/**
 * Order refunds — partial / line-item returns against a completed order.
 *
 * A customer can return some (or all) items from an order: "keep 3 products,
 * return the 4th." We refund per line, tracking how much of each line has already
 * been returned (fin_order_items.refunded_quantity/amount) so nothing is
 * over-refunded, and record each refund's line breakdown (pay_order_refund_lines)
 * for audit and the GL reversal.
 *
 * Money side:
 *   - Reverse the returned amount at the provider (card) or record it (manual).
 *   - Write a pay_transactions refund row linked to the order + original charge.
 *   - Post a PER-LINE GL reversal that credits Cash and debits the SAME accounts
 *     the sale credited: each returned line's revenue account (4100/4300/…) for
 *     its net share, plus 2300 Tax Payable for its tax share. Mirrors
 *     order-journal.service's sale mapping, reversed.
 *   - Mark the order 'refunded' (all returned) or 'partially_refunded'.
 *
 * Works for walk-in (customerless) orders too — the original charge may have a
 * null customer; the refund row inherits that.
 */

const REVENUE_ACCOUNT_CODES: Record<string, string> = {
  service: '4100', product: '4300', membership: '4200', package: '4500', no_show_fee: '4600',
};
const DEFERRED_ITEM_TYPES = ['membership', 'package'];

/**
 * Which line types can be refunded through the order-refund flow.
 *   - product     : a returnable good.
 *   - no_show_fee : a penalty that may be waived for extenuating circumstances.
 * Everything else is deliberately NOT refundable here:
 *   - service     : once delivered it's not returned — dissatisfaction is handled
 *                   with a discount, not a refund.
 *   - membership / package : these start an entitlement; they are CANCELLED
 *                   (service runs to end of the billing period), never refunded.
 *   - gift_card   : stored value — a sold gift card is a liability, not a return.
 */
export const REFUNDABLE_ITEM_TYPES: ReadonlySet<string> = new Set(['product', 'no_show_fee']);
const DEFERRED_REVENUE_CODE = '2400';
const CASH_CODE = '1100';
const TAX_PAYABLE_CODE = '2300';

export class OrderRefundError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

export interface RefundLineRequest {
  orderItemId: string;
  quantity: number;        // how many units of this line to return (>=1)
}

export interface OrderRefundResult {
  refundTransactionId: string;
  referenceNumber: string;
  status: 'completed' | 'pending' | 'failed';
  amountCents: number;
  orderStatus: string;
  failureReason?: string | null;
}

/**
 * Refund specific line quantities from an order. Amounts are derived from the
 * line's own total_price (so discounts/tax captured at sale are respected),
 * prorated by the returned quantity.
 */
export async function refundOrderLines(args: {
  businessId: string;
  tenantId: string;
  orderId: string;
  lines: RefundLineRequest[];
  reason: string;
  processedBy: string;
}): Promise<OrderRefundResult> {
  const { businessId, tenantId, orderId, lines, reason, processedBy } = args;
  if (!reason || !reason.trim()) throw new OrderRefundError('A reason is required to refund', 'REASON_REQUIRED');
  if (!lines || lines.length === 0) throw new OrderRefundError('Select at least one item to refund', 'NO_LINES');

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      `SELECT id, status, customer_id, order_number, payment_method, total_amount
       FROM fin_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, businessId],
    );
    const order = orderRows[0];
    if (!order) throw new OrderRefundError('Order not found for this business', 'ORDER_NOT_FOUND');
    if (!['completed', 'partially_refunded'].includes(order.status)) {
      throw new OrderRefundError('Only a completed order can be refunded', 'ORDER_NOT_REFUNDABLE');
    }

    // The original charge for this order (processed card/one-time, or recorded manual).
    const { rows: chargeRows } = await client.query(
      `SELECT id, is_processed, provider_reference, payment_method, customer_id, currency
       FROM pay_transactions
       WHERE order_id = $1 AND business_id = $2 AND type = 'charge' AND status = 'completed'
       ORDER BY created_at LIMIT 1`,
      [orderId, businessId],
    );
    const charge = chargeRows[0] || null;

    // Lock + load the requested order items.
    const itemIds = lines.map((l) => l.orderItemId);
    const { rows: itemRows } = await client.query(
      `SELECT id, item_type, item_name, quantity, unit_price, discount_amount, tax_amount, total_price,
              refunded_quantity, refunded_amount_cents
       FROM fin_order_items WHERE order_id = $1 AND id = ANY($2) FOR UPDATE`,
      [orderId, itemIds],
    );
    const itemById = new Map(itemRows.map((r) => [r.id, r]));

    // Compute per-line refund amounts (revenue + tax), validating quantities.
    interface Computed { item: any; qty: number; revenueCents: number; taxCents: number; amountCents: number; }
    const computed: Computed[] = [];
    let totalRefund = 0;

    for (const req of lines) {
      const item = itemById.get(req.orderItemId);
      if (!item) throw new OrderRefundError(`Line item ${req.orderItemId} not found on this order`, 'LINE_NOT_FOUND');
      if (!REFUNDABLE_ITEM_TYPES.has(item.item_type)) {
        throw new OrderRefundError(
          `${item.item_type === 'service' ? 'Services are not refundable (issue a discount instead)'
            : item.item_type === 'membership' || item.item_type === 'package' ? `A ${item.item_type} cannot be refunded — cancel it instead`
            : item.item_type === 'gift_card' ? 'Gift cards are not refundable'
            : `"${item.item_name}" is not refundable`}`,
          'ITEM_NOT_REFUNDABLE',
        );
      }
      const remainingQty = item.quantity - item.refunded_quantity;
      if (req.quantity < 1 || req.quantity > remainingQty) {
        throw new OrderRefundError(
          `Cannot refund ${req.quantity} of "${item.item_name}" (${remainingQty} remaining)`,
          'INVALID_QUANTITY',
        );
      }

      // Per-unit split from the line's captured figures. total_price already nets
      // discount and includes tax; split proportionally by unit.
      const perUnitTotal = Math.round(item.total_price / item.quantity);
      const perUnitTax = Math.round(item.tax_amount / item.quantity);
      let lineAmount = perUnitTotal * req.quantity;
      let lineTax = perUnitTax * req.quantity;
      // If returning the whole remaining line, use exact remainders to avoid rounding drift.
      if (req.quantity === remainingQty) {
        lineAmount = item.total_price - item.refunded_amount_cents;
        lineTax = item.tax_amount - Math.round(item.tax_amount / item.quantity) * item.refunded_quantity;
      }
      const lineRevenue = lineAmount - lineTax;
      computed.push({ item, qty: req.quantity, revenueCents: lineRevenue, taxCents: lineTax, amountCents: lineAmount });
      totalRefund += lineAmount;
    }

    if (totalRefund <= 0) throw new OrderRefundError('Nothing to refund', 'NOTHING_TO_REFUND');

    // Reverse at the provider for a processed charge; manual charges are recorded only.
    let status: 'completed' | 'pending' | 'failed' = 'completed';
    let refundProviderRef: string | null = null;
    let failureReason: string | null = null;
    const reference = generateReference();
    const currency = charge?.currency || 'USD';

    if (charge && charge.is_processed && charge.provider_reference) {
      const account = await resolveConnectedAccount({ ownerLevel: 'customer', businessId });
      if (!account) throw new OrderRefundError('Business has no active payment processor connection', 'NO_CONNECTION');
      const secrets = await getDecryptedSecrets({ ownerLevel: 'business', businessId });
      const adapter = getConfiguredAdapter(account.provider, secrets);
      try {
        const res = await adapter.refund({
          account,
          providerReference: charge.provider_reference,
          amount: totalRefund,
          idempotencyKey: `orderrefund:${orderId}:${reference}`,
          reason,
        });
        status = res.outcome === 'succeeded' ? 'completed' : res.outcome === 'pending' ? 'pending' : 'failed';
        refundProviderRef = res.providerReference ?? null;
        failureReason = res.failureReason ?? null;
      } catch (e: any) {
        status = 'failed';
        failureReason = e?.message || 'Refund failed at provider';
      }
      if (status === 'failed') {
        await client.query('ROLLBACK');
        return {
          refundTransactionId: '', referenceNumber: reference, status: 'failed',
          amountCents: totalRefund, orderStatus: order.status, failureReason: failureReason ?? 'Refund failed',
        };
      }
    }

    // Refund ledger row (type 'refund'), linked to the order + original charge.
    const { rows: refundRows } = await client.query(
      `INSERT INTO pay_transactions
         (business_id, customer_id, type, status, amount, currency, payment_method,
          reference_number, description, refund_of_id, refund_reason, processed_by,
          is_processed, provider_reference, order_id)
       VALUES ($1,$2,'refund',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        businessId, charge?.customer_id ?? null, status, totalRefund, currency,
        order.payment_method || 'card', reference, `Refund of order ${order.order_number}`,
        charge?.id ?? null, reason, processedBy,
        charge?.is_processed ?? false, refundProviderRef, orderId,
      ],
    );
    const refundTxnId = refundRows[0].id;

    // Draw down each line + record the refund-line breakdown.
    for (const c of computed) {
      await client.query(
        `UPDATE fin_order_items
         SET refunded_quantity = refunded_quantity + $1, refunded_amount_cents = refunded_amount_cents + $2
         WHERE id = $3`,
        [c.qty, c.amountCents, c.item.id],
      );
      await client.query(
        `INSERT INTO pay_order_refund_lines
           (business_id, order_id, order_item_id, refund_transaction_id, item_type, quantity,
            revenue_cents, tax_cents, amount_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [businessId, orderId, c.item.id, refundTxnId, c.item.item_type, c.qty, c.revenueCents, c.taxCents, c.amountCents],
      );
    }

    // Order status: fully returned => 'refunded', otherwise 'partially_refunded'.
    const { rows: remainingRows } = await client.query(
      `SELECT COALESCE(SUM(quantity - refunded_quantity), 0)::int AS remaining_qty
       FROM fin_order_items WHERE order_id = $1`,
      [orderId],
    );
    const newStatus = remainingRows[0].remaining_qty <= 0 ? 'refunded' : 'partially_refunded';
    await client.query(`UPDATE fin_orders SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, orderId]);

    await client.query('COMMIT');

    // Post the per-line GL reversal after commit (non-blocking).
    await postOrderRefundJournal(businessId, orderId, refundTxnId, computed, order.order_number).catch((e) =>
      logger.warn(`Order refund ${reference}: GL reversal failed: ${e?.message || e}`),
    );

    await logAudit({
      tenantId, userId: processedBy, action: 'order.refunded', resourceType: 'order', resourceId: orderId,
      details: { order_number: order.order_number, amount_cents: totalRefund, lines: computed.map((c) => ({ item: c.item.item_name, qty: c.qty, amount: c.amountCents })), reason },
    }).catch(() => {});

    return {
      refundTransactionId: refundTxnId,
      referenceNumber: reference,
      status,
      amountCents: totalRefund,
      orderStatus: newStatus,
      failureReason: null,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Reverse the sale's GL for the returned lines: Credit 1100 Cash (money returned);
 * Debit each returned line's revenue account for its net share (membership/package
 * reverse Deferred Revenue 2400); Debit 2300 Tax Payable for the tax share. Mirrors
 * order-journal.service's sale posting, reversed. Idempotent on
 * (reference_type='order_refund', reference_id=refundTxnId).
 */
async function postOrderRefundJournal(
  businessId: string, orderId: string, refundTxnId: string,
  computed: Array<{ item: any; qty: number; revenueCents: number; taxCents: number; amountCents: number }>,
  orderNumber: string,
): Promise<void> {
  const { rows: existing } = await adminPool.query(
    `SELECT 1 FROM fin_journal_entries WHERE reference_type = 'order_refund' AND reference_id = $1 AND is_void = false LIMIT 1`,
    [refundTxnId],
  );
  if (existing.length > 0) return;

  // Aggregate the debits by account code.
  const revenueByCode = new Map<string, number>();
  let totalTax = 0;
  let totalCash = 0;
  for (const c of computed) {
    const code = DEFERRED_ITEM_TYPES.includes(c.item.item_type)
      ? DEFERRED_REVENUE_CODE
      : (REVENUE_ACCOUNT_CODES[c.item.item_type] || '4100');
    if (c.revenueCents > 0) revenueByCode.set(code, (revenueByCode.get(code) ?? 0) + c.revenueCents);
    totalTax += c.taxCents;
    totalCash += c.amountCents;
  }
  if (totalCash <= 0) return;

  const codes = [CASH_CODE, TAX_PAYABLE_CODE, ...revenueByCode.keys()];
  const { rows: acctRows } = await adminPool.query(
    `SELECT id, code FROM fin_chart_of_accounts WHERE business_id = $1 AND code = ANY($2)`,
    [businessId, Array.from(new Set(codes))],
  );
  const accounts = new Map(acctRows.map((r) => [r.code, r.id]));
  const cashId = accounts.get(CASH_CODE);
  if (!cashId) {
    logger.warn(`Order refund journal: Cash (${CASH_CODE}) not seeded for business ${businessId}; skipping GL for refund ${refundTxnId}`);
    return;
  }

  const { rows: bizRows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]);
  const tz = bizRows[0]?.timezone || 'UTC';
  const entryDate = new Date().toLocaleDateString('sv-SE', { timeZone: tz });

  const linesOut: Array<{ account_id: string; debit: number; credit: number; description?: string }> = [];
  for (const [code, amount] of revenueByCode) {
    const accId = accounts.get(code);
    if (!accId || amount <= 0) continue;
    linesOut.push({ account_id: accId, debit: amount, credit: 0, description: `Refund — reverse revenue ${code}` });
  }
  const taxId = accounts.get(TAX_PAYABLE_CODE);
  if (totalTax > 0 && taxId) {
    linesOut.push({ account_id: taxId, debit: totalTax, credit: 0, description: 'Refund — reverse tax collected' });
  }
  linesOut.push({ account_id: cashId, debit: 0, credit: totalCash, description: 'Refund paid' });

  await journal.createEntry({
    businessId,
    entryDate,
    description: `Refund of order ${orderNumber}`,
    referenceType: 'order_refund',
    referenceId: refundTxnId,
    lines: linesOut,
  });
}
