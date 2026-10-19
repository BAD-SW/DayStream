import { adminPool } from '../db/pool';
import PDFDocument from 'pdfkit';
import { queueNotification } from './booking-notifications.service';
import { getInvoice } from './invoice.service';
import { resolvePdfBranding, drawBrandedHeader, drawBrandedFooter } from './document-pdf';

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

/** Currency formatting for the receipt PDF (matches the invoice renderer). */
function fmtMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
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
  // LEFT JOIN the customer: a walk-in / customerless charge still gets a receipt
  // (just without a named recipient). Business is the inner anchor.
  const { rows } = await adminPool.query(
    `SELECT t.id, t.customer_id, t.type, t.amount, t.currency, t.payment_method,
            t.reference_number, t.created_at, t.description,
            c.first_name, c.last_name, c.email AS customer_email,
            b.name AS business_name, b.address AS business_address,
            b.email AS business_email, b.phone AS business_phone, b.tax_id AS business_tax_id,
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

  const currency: string = t.currency;
  const customerName = [t.first_name, t.last_name].filter(Boolean).join(' ').trim();
  const forLabel = t.invoice_number ? `Invoice #${t.invoice_number}` : (t.description || 'Payment');

  const branding = await resolvePdfBranding(businessId, 'payment.receipt', {
    reference_number: t.reference_number,
    amount_cents: t.amount,
    currency,
    payment_method: t.payment_method,
    payment_date: t.created_at,
    customer_name: customerName,
    customer_email: t.customer_email,
  });
  const { primary, secondary, introText } = branding;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const startX = 50;

    drawBrandedHeader(doc, branding, {
      name: t.business_name || 'Receipt',
      address: t.business_address,
      email: t.business_email,
      phone: t.business_phone,
      taxId: t.business_tax_id,
    }, startX);

    // Receipt heading in the brand's primary color.
    doc.moveDown(1);
    doc.fontSize(16).fillColor(primary).text('Receipt', startX).fillColor('#000');
    doc.fontSize(10).fillColor('#555')
      .text(`Date: ${new Date(t.created_at).toLocaleDateString()}`)
      .text(`Reference: ${t.reference_number || '—'}`)
      .fillColor('#000');

    // Received-from.
    doc.moveDown(1);
    doc.fontSize(11).text('Received From:', { underline: true });
    doc.fontSize(10).text(customerName || 'Customer');
    if (t.customer_email) doc.text(t.customer_email);

    // Optional intro note from the template body.
    if (introText) {
      doc.moveDown(0.8).fontSize(10).fillColor('#333').text(introText, startX, undefined, { width: 495 }).fillColor('#000');
    }

    // Payment detail — a single-line "table" (for / method / amount).
    doc.moveDown(1);
    let y = doc.y;
    doc.fontSize(10).fillColor(primary);
    doc.text('Description', startX, y);
    doc.text('Method', 330, y, { width: 100, align: 'left' });
    doc.text('Amount', 460, y, { width: 90, align: 'right' });
    doc.fillColor('#000');
    y += 16;
    doc.moveTo(startX, y).lineTo(545, y).strokeColor(primary).stroke().strokeColor('#000');
    y += 6;
    doc.fontSize(10).text(forLabel, startX, y, { width: 270 });
    doc.text(String(t.payment_method || '—'), 330, y, { width: 100, align: 'left' });
    doc.text(fmtMoney(t.amount, currency), 460, y, { width: 90, align: 'right' });
    y = doc.y + 4;

    // Total paid — rule in the secondary color.
    y += 8;
    doc.moveTo(330, y).lineTo(545, y).strokeColor(secondary).stroke().strokeColor('#000');
    y += 8;
    doc.fontSize(12).text('Total Paid', 380, y, { width: 70, align: 'right' });
    doc.text(fmtMoney(t.amount, currency), 460, y, { width: 90, align: 'right' });

    drawBrandedFooter(doc, branding, startX);

    doc.end();
  });
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

export { DocumentSendError };
