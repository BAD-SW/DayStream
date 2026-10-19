import { adminPool } from '../db/pool';
import type { DocumentDetailsTable } from '@daystream/shared';
import { queueNotification } from './booking-notifications.service';
import { getInvoice } from './invoice.service';
import { resolvePdfBranding, renderTemplateDocumentPdf } from './document-pdf';
import { resolveDocumentFields, ResolvedDocumentFields } from './document-branding-resolver.service';

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
export type TransactionDocument = 'invoice.issued' | 'payment.receipt' | 'payment.refund_confirmation';

export function documentForTransaction(t: { type: string; invoice_id: string | null; credit_note_id?: string | null; debit_note_id?: string | null }): TransactionDocument {
  if (t.type === 'refund') return 'payment.refund_confirmation';
  // A credit or debit note renders through the Adjustment template (same as an invoice).
  if (t.credit_note_id) return 'invoice.issued';
  if (t.debit_note_id) return 'invoice.issued';
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
            t.credit_note_id, t.debit_note_id, t.refund_reason, t.created_at,
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

  // A credit note: queue the Adjustment template with the note's data (number,
  // total, reason, and its line items as the details table).
  if (t.credit_note_id) {
    const { getCreditNote } = await import('./credit-note.service');
    const cn = await getCreditNote(t.credit_note_id, businessId);
    if (!cn) throw new DocumentSendError('Linked credit note not found', 'NOT_FOUND');
    await queueNotification({
      businessId,
      type: 'invoice.issued',
      recipientId: t.customer_id,
      recipientEmail: t.customer_email,
      data: {
        invoice_number: `CN-${cn.credit_note_number}`,
        total_cents: cn.total_cents,
        currency: cn.currency,
        reason: cn.reason,
        customer_name: customerName,
        customer_email: t.customer_email,
      },
    });
    return { document, recipientEmail: t.customer_email };
  }

  // A debit note: queue the Adjustment template with the note's data (number,
  // total, reason) — the sign-flipped mirror of the credit-note branch above.
  if (t.debit_note_id) {
    const { getDebitNote } = await import('./debit-note.service');
    const dn = await getDebitNote(t.debit_note_id, businessId);
    if (!dn) throw new DocumentSendError('Linked debit note not found', 'NOT_FOUND');
    await queueNotification({
      businessId,
      type: 'invoice.issued',
      recipientId: t.customer_id,
      recipientEmail: t.customer_email,
      data: {
        invoice_number: `DN-${dn.debit_note_number}`,
        total_cents: dn.total_cents,
        currency: dn.currency,
        reason: dn.reason,
        customer_name: customerName,
        customer_email: t.customer_email,
      },
    });
    return { document, recipientEmail: t.customer_email };
  }

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

  if (document === 'payment.refund_confirmation') {
    await queueNotification({
      businessId,
      type: 'payment.refund_confirmation',
      recipientId: t.customer_id,
      recipientEmail: t.customer_email,
      data: {
        reference_number: t.reference_number,
        original_reference: t.original_reference ?? null,
        refund_amount_cents: t.amount,
        amount_cents: t.amount,
        currency: t.currency,
        refund_date: t.created_at,
        reason: t.refund_reason ?? null,
        payment_method: t.payment_method,
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

/**
 * Render a branded RECEIPT PDF for a transaction (spec 10, task 6.3b).
 *
 * Uses the same branding path as the invoice PDF (payment.receipt template → logo,
 * colors, intro note, footer), then renders the transaction's own details:
 * reference, date, method, what it was for, and the amount. When the business has
 * no receipt template, it renders with platform defaults (no regression).
 *
 * Returns null when the transaction isn't found for the business.
 */
export async function renderReceiptPdf(transactionId: string, businessId: string): Promise<Buffer | null> {
  // LEFT JOIN the customer: a walk-in / customerless charge still gets a receipt.
  const { rows } = await adminPool.query(
    `SELECT t.id, t.customer_id, t.type, t.amount, t.currency, t.payment_method,
            t.reference_number, t.created_at, t.description,
            c.first_name, c.last_name, c.email AS customer_email,
            pi.invoice_number AS invoice_number
       FROM pay_transactions t
       JOIN sys_businesses b ON b.id = t.business_id
       LEFT JOIN cus_customers c ON c.id = t.customer_id
       LEFT JOIN pay_invoices pi ON pi.id = t.invoice_id
      WHERE t.id = $1 AND t.business_id = $2`,
    [transactionId, businessId],
  );
  const t = rows[0];
  if (!t) return null;

  const customerName = [t.first_name, t.last_name].filter(Boolean).join(' ').trim();
  const detailsTable = await buildTransactionDetailsTable(t, businessId);

  // Pure template: the receipt IS the payment.receipt template (header/subject/
  // body/footer), rendered exactly like the editor preview. All detail the
  // business wants (amount, method, date, reference) comes from {{placeholders}}
  // in their template body — we feed them here. If the template includes the
  // {{details_table}} token, `detailsTable` is drawn where it sits.
  const branding = await resolvePdfBranding(businessId, 'payment.receipt', {
    reference_number: t.reference_number,
    receipt_number: t.reference_number,
    amount_cents: t.amount,
    currency: t.currency,
    payment_method: t.payment_method,
    payment_date: t.created_at,
    customer_name: customerName,
    customer_email: t.customer_email,
  }, detailsTable);

  return renderTemplateDocumentPdf(branding);
}

/**
 * Build the line-item details table for a transaction's receipt. If the payment
 * paid a checkout order, use that order's line items; otherwise fall back to a
 * single row (the transaction's description, or "Payment", at its amount).
 */
async function buildTransactionDetailsTable(
  t: { id: string; amount: number; currency: string; description: string | null },
  businessId: string,
): Promise<DocumentDetailsTable> {
  const { rows: items } = await adminPool.query(
    `SELECT oi.item_name, oi.variant_name, oi.quantity, oi.total_price
       FROM fin_order_items oi
       JOIN pay_transactions t ON t.id = $1
       JOIN fin_orders o
         ON o.business_id = $2
        AND (t.order_id = o.id OR (o.payment_reference IS NOT NULL AND o.payment_reference = t.reference_number))
      WHERE oi.order_id = o.id
      ORDER BY oi.created_at`,
    [t.id, businessId],
  );

  if (items.length > 0) {
    const rows = items.map((it: any) => ({
      description: it.variant_name ? `${it.item_name} — ${it.variant_name}` : it.item_name,
      qty: it.quantity,
      amountCents: it.total_price,
    }));
    const totalCents = rows.reduce((n: number, r: { amountCents: number }) => n + r.amountCents, 0);
    return { rows, totalCents, currency: t.currency };
  }

  // No itemized order — a single row for the payment itself.
  return {
    rows: [{ description: t.description || 'Payment', qty: 1, amountCents: t.amount }],
    totalCents: t.amount,
    currency: t.currency,
  };
}

/**
 * Resolve the payment transaction that paid an order. A checkout payment links to
 * its order either directly (pay_transactions.order_id) or by reference match
 * (the order's payment_reference equals the transaction's reference_number).
 * Returns the newest completed charge for the order, or null.
 */
export async function transactionForOrder(orderId: string, businessId: string): Promise<string | null> {
  const { rows } = await adminPool.query(
    `SELECT t.id
       FROM pay_transactions t
       JOIN fin_orders o ON o.id = $1 AND o.business_id = $2
      WHERE t.business_id = $2
        AND t.type = 'charge'
        AND (t.order_id = o.id OR (o.payment_reference IS NOT NULL AND t.reference_number = o.payment_reference))
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [orderId, businessId],
  );
  return rows[0]?.id ?? null;
}

/** Email the branded receipt for an order's payment (checkout). */
export async function emailOrderReceipt(orderId: string, businessId: string): Promise<EmailTransactionResult> {
  const txnId = await transactionForOrder(orderId, businessId);
  if (!txnId) throw new DocumentSendError('No payment found for this order', 'NOT_FOUND');
  return emailTransactionDocument(txnId, businessId);
}

/** Render the branded receipt PDF for an order's payment (checkout). */
export async function renderOrderReceiptPdf(orderId: string, businessId: string): Promise<Buffer | null> {
  const txnId = await transactionForOrder(orderId, businessId);
  if (!txnId) return null;
  return renderReceiptPdf(txnId, businessId);
}

/**
 * Resolve the branded receipt FIELDS for an order's payment — for on-screen
 * display (the order receipt page), filled with the order's real values. Same
 * template + resolver as the PDF/email, so the on-screen view matches exactly.
 * Returns null when the order has no linked payment.
 */
export async function resolveOrderReceiptFields(orderId: string, businessId: string): Promise<ResolvedDocumentFields | null> {
  const txnId = await transactionForOrder(orderId, businessId);
  if (!txnId) return null;
  const { rows } = await adminPool.query(
    `SELECT t.id, t.amount, t.currency, t.payment_method, t.reference_number, t.created_at, t.description,
            c.first_name, c.last_name, c.email AS customer_email
       FROM pay_transactions t
       LEFT JOIN cus_customers c ON c.id = t.customer_id
      WHERE t.id = $1 AND t.business_id = $2`,
    [txnId, businessId],
  );
  const t = rows[0];
  if (!t) return null;
  const customerName = [t.first_name, t.last_name].filter(Boolean).join(' ').trim();
  const detailsTable = await buildTransactionDetailsTable(t, businessId);
  return resolveDocumentFields(businessId, 'payment.receipt', {
    reference_number: t.reference_number,
    receipt_number: t.reference_number,
    amount_cents: t.amount,
    currency: t.currency,
    payment_method: t.payment_method,
    payment_date: t.created_at,
    customer_name: customerName,
    customer_email: t.customer_email,
  }, null, detailsTable);
}

export { DocumentSendError };
