import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { logAudit } from './audit.service';
import { generateReference } from './customer-payment.service';

/**
 * Customer account credit (unapplied payments).
 *
 * A payment taken "on account" — with no booking, enrollment, or invoice — is
 * money received but not yet earned. It is posted to the 2500 Customer Deposits
 * liability (see payment-journal.service.ts) and recorded as a drawable row in
 * `pay_account_credits`. This service reads a customer's available credit and
 * APPLIES it to an outstanding invoice, which is the point revenue is earned:
 *
 *   Apply:  Debit  2500 Customer Deposits   (reduce the liability)
 *           Credit <per-line revenue>        (now earned — see revenue-mapping)
 *
 * The revenue credit is split per invoice line into the correct accounts
 * (service/product/no-show immediately; membership/package deferred to 2400; tax
 * to 2300) by postInvoicePaymentJournalEntry, so applying credit books revenue
 * identically to paying the invoice with cash. Applying also draws down the
 * credit rows (oldest first), records a pay_transactions row linked to the
 * invoice, marks the invoice paid when fully covered, and writes an audit trail.
 *
 * Note: cash (1100) is NOT touched when credit is applied — the cash arrived when
 * the deposit was originally taken. Applying only moves liability -> revenue.
 */

class AccountCreditError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'AccountCreditError';
    this.code = code;
  }
}

export interface CustomerCreditBalance {
  customerId: string;
  currency: string | null;
  availableCents: number;
}

/** A customer's total available (unapplied) credit at a business. */
export async function getCustomerCreditBalance(
  businessId: string, customerId: string,
): Promise<CustomerCreditBalance> {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(remaining_cents), 0)::int AS available, MAX(currency) AS currency
     FROM pay_account_credits
     WHERE business_id = $1 AND customer_id = $2 AND status = 'available'`,
    [businessId, customerId],
  );
  return {
    customerId,
    currency: rows[0]?.currency ?? null,
    availableCents: rows[0]?.available ?? 0,
  };
}

/** The individual credit rows for a customer (newest first), for display. */
export async function listCustomerCredits(businessId: string, customerId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT id, source_transaction_id, currency, original_cents, remaining_cents, status, note, created_at
     FROM pay_account_credits
     WHERE business_id = $1 AND customer_id = $2
     ORDER BY created_at DESC`,
    [businessId, customerId],
  );
  return rows;
}

export interface ApplyCreditResult {
  invoiceId: string;
  appliedCents: number;
  invoiceStatus: string;
  transactionId: string;
  referenceNumber: string;
  remainingCreditCents: number;
  invoiceOutstandingCents: number;
}

/**
 * Apply a customer's available account credit to an outstanding invoice. Applies
 * up to min(available credit, invoice outstanding). Everything runs in one
 * transaction so the ledger, the invoice, and the credit rows never diverge; the
 * GL entry is posted after commit (non-blocking, same pattern as the rest of
 * Section C).
 */
export async function applyCreditToInvoice(args: {
  businessId: string;
  tenantId: string;
  invoiceId: string;
  userId: string;
  /** Optional cap; defaults to the full applicable amount. */
  amountCents?: number | null;
}): Promise<ApplyCreditResult> {
  const { businessId, tenantId, invoiceId, userId } = args;

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // Lock the invoice.
    const { rows: invRows } = await client.query(
      `SELECT id, customer_id, currency, total_cents, amount_paid_cents, status, invoice_number
       FROM pay_invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [invoiceId, businessId],
    );
    const invoice = invRows[0];
    if (!invoice) throw new AccountCreditError('Invoice not found for this business', 'INVOICE_NOT_FOUND');
    if (invoice.status === 'paid') throw new AccountCreditError('Invoice is already paid', 'ALREADY_PAID');
    if (invoice.status === 'void') throw new AccountCreditError('Invoice is void', 'INVOICE_VOID');

    const outstanding = invoice.total_cents - invoice.amount_paid_cents;
    if (outstanding <= 0) throw new AccountCreditError('Invoice has no outstanding balance', 'NO_BALANCE');

    // Available credit rows for this customer, oldest first (lock them).
    const { rows: creditRows } = await client.query(
      `SELECT id, currency, remaining_cents
       FROM pay_account_credits
       WHERE business_id = $1 AND customer_id = $2 AND status = 'available' AND remaining_cents > 0
       ORDER BY created_at
       FOR UPDATE`,
      [businessId, invoice.customer_id],
    );
    const totalAvailable = creditRows.reduce((n, r) => n + r.remaining_cents, 0);
    if (totalAvailable <= 0) throw new AccountCreditError('Customer has no available account credit', 'NO_CREDIT');

    // Currency must match the invoice (credit currency is the business currency).
    const mismatched = creditRows.find((r) => r.currency && invoice.currency && r.currency !== invoice.currency);
    if (mismatched) throw new AccountCreditError('Account credit currency does not match the invoice', 'CURRENCY_MISMATCH');

    const requested = args.amountCents && args.amountCents > 0 ? args.amountCents : outstanding;
    const toApply = Math.min(requested, outstanding, totalAvailable);
    if (toApply <= 0) throw new AccountCreditError('Nothing to apply', 'NOTHING_TO_APPLY');

    const reference = generateReference();

    // Record a ledger row for the credit application, linked to the invoice. It is
    // a non-processed charge (no money moves at the provider; it was collected when
    // the deposit was taken).
    const { rows: txnRows } = await client.query(
      `INSERT INTO pay_transactions
         (business_id, customer_id, type, status, amount, currency, payment_method,
          reference_number, description, processed_by, is_processed, invoice_id)
       VALUES ($1,$2,'charge','completed',$3,$4,'account_credit',$5,$6,$7,false,$8)
       RETURNING id`,
      [
        businessId, invoice.customer_id, toApply, invoice.currency, reference,
        `Applied account credit to invoice #${invoice.invoice_number}`, userId, invoiceId,
      ],
    );
    const transactionId = txnRows[0].id;

    // Draw down the credit rows oldest-first, recording each application.
    let remainingToApply = toApply;
    for (const credit of creditRows) {
      if (remainingToApply <= 0) break;
      const take = Math.min(credit.remaining_cents, remainingToApply);
      const newRemaining = credit.remaining_cents - take;
      await client.query(
        `UPDATE pay_account_credits
         SET remaining_cents = $1, status = CASE WHEN $1 = 0 THEN 'applied' ELSE status END, updated_at = NOW()
         WHERE id = $2`,
        [newRemaining, credit.id],
      );
      await client.query(
        `INSERT INTO pay_account_credit_applications (credit_id, invoice_id, transaction_id, amount_cents, applied_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [credit.id, invoiceId, transactionId, take, userId],
      );
      remainingToApply -= take;
    }

    // Update the invoice. Fully covered => paid; otherwise partially paid, still open.
    const newPaid = invoice.amount_paid_cents + toApply;
    const newStatus = newPaid >= invoice.total_cents ? 'paid' : invoice.status;
    await client.query(
      `UPDATE pay_invoices SET amount_paid_cents = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [newPaid, newStatus, invoiceId],
    );

    await client.query('COMMIT');

    // Post the GL entry after commit: Debit 2500 Customer Deposits / Credit the
    // correct revenue accounts per invoice line (service/product/no-show
    // immediately, membership/package deferred to 2400, tax to 2300). Non-blocking
    // — a GL hiccup must not undo an applied credit.
    const { postInvoicePaymentJournalEntry } = await import('./payment-journal.service');
    await postInvoicePaymentJournalEntry({
      businessId, invoiceId, transactionId, amountCents: toApply,
      debitCode: '2500', referenceType: 'account_credit_application',
      description: `Account credit applied to invoice #${invoice.invoice_number}`,
    }).catch((e) =>
      logger.warn(`Account credit apply ${reference}: GL post failed: ${e?.message || e}`),
    );

    await logAudit({
      tenantId, userId, action: 'account_credit.applied', resourceType: 'invoice', resourceId: invoiceId,
      details: { invoice_number: invoice.invoice_number, applied_cents: toApply, currency: invoice.currency, reference },
    }).catch(() => {});

    return {
      invoiceId,
      appliedCents: toApply,
      invoiceStatus: newStatus,
      transactionId,
      referenceNumber: reference,
      remainingCreditCents: totalAvailable - toApply,
      invoiceOutstandingCents: invoice.total_cents - newPaid,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export { AccountCreditError };
