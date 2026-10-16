import { adminPool } from '../db/pool';
import { queueNotification } from './booking-notifications.service';
import { getInvoice } from './invoice.service';

/**
 * Manual (re)send of the customer-facing document that corresponds to a payment
 * transaction (spec 10, task 6.3b).
 *
 * The Transaction History kebab exposes a single, consistent "Email" action; the
 * document it sends is derived from the row, NOT chosen by the user:
 *   - a charge that settled an invoice (invoice_id set) → the Invoice
 *   - a refund row                                      → the Credit Note
 *   - any other charge (plain payment, on-account, ...) → the Receipt
 *
 * This is a RE-send: it rebuilds the same notification the original event queued,
 * so the branding resolver renders the identical branded document. Business-scoped
 * via adminPool + explicit business_id, matching Section C convention.
 */

class DocumentSendError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DocumentSendError';
    this.code = code;
  }
}

/** Which document a transaction row maps to. */
export type TransactionDocument = 'invoice.issued' | 'payment.receipt' | 'payment.credit_note';

export function documentForTransaction(t: { type: string; invoice_id: string | null }): TransactionDocument {
  if (t.type === 'refund') return 'payment.credit_note';
  if (t.invoice_id) return 'invoice.issued';
  return 'payment.receipt';
}

export interface EmailTransactionResult {
  document: TransactionDocument;
  recipientEmail: string;
}

/**
 * Email (or re-email) the document for a transaction. Loads the transaction scoped
 * to the business, resolves which document it is, rebuilds the data bag, and
 * queues it for the branding resolver to render + send.
 */
export async function emailTransactionDocument(
  transactionId: string,
  businessId: string,
): Promise<EmailTransactionResult> {
  const { rows } = await adminPool.query(
    `SELECT t.id, t.business_id, t.customer_id, t.type, t.amount, t.currency,
            t.payment_method, t.reference_number, t.invoice_id, t.refund_of_id,
            t.refund_reason, t.created_at,
            c.email AS customer_email, c.first_name, c.last_name,
            pi.invoice_number       AS invoice_number,
            orig.reference_number   AS original_reference
       FROM pay_transactions t
       JOIN cus_customers c ON c.id = t.customer_id
       LEFT JOIN pay_invoices pi ON pi.id = t.invoice_id
       LEFT JOIN pay_transactions orig ON orig.id = t.refund_of_id
      WHERE t.id = $1 AND t.business_id = $2`,
    [transactionId, businessId],
  );
  const t = rows[0];
  if (!t) throw new DocumentSendError('Transaction not found for this business', 'NOT_FOUND');
  if (!t.customer_email) {
    throw new DocumentSendError('Customer has no email address on file', 'NO_RECIPIENT');
  }

  const document = documentForTransaction(t);
  const customerName = [t.first_name, t.last_name].filter(Boolean).join(' ').trim();

  // The Invoice carries richer data (number, due date, totals) — reuse the
  // invoice's own queuer so the data bag matches the original issue path exactly.
  if (document === 'invoice.issued') {
    const invoice = await getInvoice(t.invoice_id, businessId);
    if (!invoice) throw new DocumentSendError('Linked invoice not found', 'NOT_FOUND');
    await queueNotification({
      businessId,
      type: 'invoice.issued',
      recipientId: t.customer_id,
      recipientEmail: t.customer_email,
      data: {
        invoice_number: invoice.invoice_number,
        total_cents: invoice.total_cents,
        currency: invoice.currency,
        due_date: invoice.due_date,
        customer_name: [invoice.customer_first_name, invoice.customer_last_name].filter(Boolean).join(' ').trim(),
        customer_email: invoice.customer_email,
      },
    });
    return { document, recipientEmail: t.customer_email };
  }

  if (document === 'payment.credit_note') {
    await queueNotification({
      businessId,
      type: 'payment.credit_note',
      recipientId: t.customer_id,
      recipientEmail: t.customer_email,
      data: {
        reference_number: t.reference_number,
        original_invoice_number: t.invoice_number ?? null,
        credit_amount_cents: t.amount,
        currency: t.currency,
        credit_note_date: t.created_at,
        reason: t.refund_reason ?? null,
        customer_name: customerName,
        customer_email: t.customer_email,
      },
    });
    return { document, recipientEmail: t.customer_email };
  }

  // Receipt (plain charge / on-account / membership / gift-card redemption).
  await queueNotification({
    businessId,
    type: 'payment.receipt',
    recipientId: t.customer_id,
    recipientEmail: t.customer_email,
    data: {
      reference_number: t.reference_number,
      amount_cents: t.amount,
      currency: t.currency,
      payment_method: t.payment_method,
      payment_date: t.created_at,
      customer_name: customerName,
      customer_email: t.customer_email,
    },
  });
  return { document, recipientEmail: t.customer_email };
}

export { DocumentSendError };
