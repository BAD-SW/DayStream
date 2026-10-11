import PDFDocument from 'pdfkit';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import {
  chargeStoredMethod, insertChargeRow, resolveBusinessCurrency, generateReference,
} from './customer-payment.service';
import { logAudit } from './audit.service';
import { queueNotification } from './booking-notifications.service';
import type { MethodOwner } from './payment-methods.service';
import type { SaleItemType } from './revenue-mapping.service';

/**
 * Section C — Invoicing (spec 10-payment-platform, task 4.7 / Requirement C5).
 *
 * A true payable document a customer settles against — distinct from the
 * auto-settled charge records in Sections A/B. Invoicing is per-business opt-in
 * (`invoicing.enabled` business config). Invoice numbers are sequential per
 * business with NO gaps (compliance), allocated from `pay_invoice_number_seq`.
 * Outstanding invoices can be settled online via any Processed method, produce a
 * PDF, and can be emailed to the customer.
 */

class InvoiceError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'InvoiceError';
    this.code = code;
  }
}

export interface InvoiceLineItemInput {
  description: string;
  quantity?: number;        // defaults to 1
  unitPriceCents: number;
  taxCents?: number;        // per-line tax (optional)
  /** What the line earns — drives revenue recognition. Defaults to 'service'. */
  itemType?: SaleItemType;
}

export interface IssueInvoiceInput {
  businessId: string;
  tenantId: string;
  customerId: string;
  dueDate: string;          // YYYY-MM-DD
  lineItems: InvoiceLineItemInput[];
  notes?: string | null;
  createdBy: string;
}

/** Whether a business has opted into invoice-based billing (C5.1). */
export async function isInvoicingEnabled(businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT value FROM sys_business_configurations WHERE business_id = $1 AND key = 'invoicing.enabled'`,
    [businessId],
  );
  return rows[0]?.value === 'true';
}

/** Turn invoice-based billing on/off for a business (C5.1). */
export async function setInvoicingEnabled(businessId: string, enabled: boolean, userId: string): Promise<boolean> {
  await adminPool.query(
    `INSERT INTO sys_business_configurations (business_id, key, value, updated_by, updated_at)
     VALUES ($1, 'invoicing.enabled', $2, $3, NOW())
     ON CONFLICT (business_id, key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
    [businessId, enabled ? 'true' : 'false', userId],
  );
  return enabled;
}

/**
 * Issue a payable invoice. Allocates the next gapless per-business number inside
 * the same transaction as the insert, so a rollback never burns a number.
 */
export async function issueInvoice(input: IssueInvoiceInput): Promise<any> {
  if (!(await isInvoicingEnabled(input.businessId))) {
    throw new InvoiceError('Invoicing is not enabled for this business', 'INVOICING_DISABLED');
  }
  if (!input.lineItems || input.lineItems.length === 0) {
    throw new InvoiceError('An invoice needs at least one line item', 'NO_LINE_ITEMS');
  }
  if (!input.dueDate) throw new InvoiceError('A due date is required', 'DUE_DATE_REQUIRED');

  const currency = await resolveBusinessCurrency(input.businessId);

  // Compute line amounts + totals (cents).
  const lines = input.lineItems.map((li, idx) => {
    const quantity = li.quantity && li.quantity > 0 ? li.quantity : 1;
    const amountCents = Math.round(li.unitPriceCents * quantity);
    const taxCents = li.taxCents && li.taxCents > 0 ? li.taxCents : 0;
    const itemType: SaleItemType = li.itemType ?? 'service';
    return { ...li, quantity, amountCents, taxCents, itemType, displayOrder: idx };
  });
  const subtotalCents = lines.reduce((n, l) => n + l.amountCents, 0);
  const taxCents = lines.reduce((n, l) => n + l.taxCents, 0);
  const totalCents = subtotalCents + taxCents;
  if (totalCents <= 0) throw new InvoiceError('Invoice total must be greater than zero', 'INVALID_TOTAL');

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // Allocate the next gapless number. The per-business counter row is created on
    // first use (starts at 1000) and locked FOR UPDATE while we take the number.
    await client.query(
      `INSERT INTO pay_invoice_number_seq (business_id, next_number)
       VALUES ($1, 1000) ON CONFLICT (business_id) DO NOTHING`,
      [input.businessId],
    );
    const { rows: seqRows } = await client.query(
      `SELECT next_number FROM pay_invoice_number_seq WHERE business_id = $1 FOR UPDATE`,
      [input.businessId],
    );
    const invoiceNumber: number = Number(seqRows[0].next_number);
    await client.query(
      `UPDATE pay_invoice_number_seq SET next_number = next_number + 1 WHERE business_id = $1`,
      [input.businessId],
    );

    const { rows: invRows } = await client.query(
      `INSERT INTO pay_invoices
         (tenant_id, business_id, customer_id, invoice_number, issue_date, due_date, currency,
          subtotal_cents, tax_cents, total_cents, amount_paid_cents, status, notes, created_by)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$8,$9,0,'issued',$10,$11)
       RETURNING *`,
      [
        input.tenantId, input.businessId, input.customerId, invoiceNumber, input.dueDate, currency,
        subtotalCents, taxCents, totalCents, input.notes ?? null, input.createdBy,
      ],
    );
    const invoice = invRows[0];

    for (const l of lines) {
      await client.query(
        `INSERT INTO pay_invoice_line_items
           (invoice_id, description, quantity, unit_price_cents, amount_cents, tax_cents, item_type, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoice.id, l.description, l.quantity, l.unitPriceCents, l.amountCents, l.taxCents, l.itemType, l.displayOrder],
      );
    }

    await client.query('COMMIT');

    await logAudit({
      tenantId: input.tenantId, userId: input.createdBy, action: 'invoice.issued',
      resourceType: 'invoice', resourceId: invoice.id,
      details: { invoice_number: invoiceNumber, total_cents: totalCents, currency, customer_id: input.customerId },
    }).catch(() => {});

    return invoice;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export interface InvoiceFilters {
  customerId?: string;
  status?: string;
}

/** List a business's invoices (newest first), with customer name for display. */
export async function listInvoices(businessId: string, filters: InvoiceFilters = {}): Promise<any[]> {
  const conditions = ['i.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;
  if (filters.customerId) { conditions.push(`i.customer_id = $${idx++}`); params.push(filters.customerId); }
  if (filters.status) { conditions.push(`i.status = $${idx++}`); params.push(filters.status); }

  const { rows } = await adminPool.query(
    `SELECT i.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email
     FROM pay_invoices i
     JOIN cus_customers c ON c.id = i.customer_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.invoice_number DESC`,
    params,
  );
  return rows;
}

/** Full invoice detail: the invoice, its line items, and business + customer info. */
export async function getInvoice(id: string, businessId: string): Promise<any | null> {
  const { rows } = await adminPool.query(
    `SELECT i.*,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            c.email AS customer_email, c.phone AS customer_phone,
            b.name AS business_name, b.address AS business_address,
            b.email AS business_email, b.phone AS business_phone, b.tax_id AS business_tax_id
     FROM pay_invoices i
     JOIN cus_customers c ON c.id = i.customer_id
     JOIN sys_businesses b ON b.id = i.business_id
     WHERE i.id = $1 AND i.business_id = $2`,
    [id, businessId],
  );
  const invoice = rows[0];
  if (!invoice) return null;

  const { rows: items } = await adminPool.query(
    `SELECT id, description, quantity, unit_price_cents, amount_cents, display_order
     FROM pay_invoice_line_items WHERE invoice_id = $1 ORDER BY display_order, created_at`,
    [id],
  );
  invoice.line_items = items;
  return invoice;
}

/** Void an unpaid invoice. A paid invoice must be refunded, not voided. */
export async function voidInvoice(id: string, businessId: string, tenantId: string, userId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `UPDATE pay_invoices SET status = 'void', updated_at = NOW()
     WHERE id = $1 AND business_id = $2 AND status IN ('draft', 'issued', 'overdue')
     RETURNING id, invoice_number`,
    [id, businessId],
  );
  if (rows.length === 0) return false;
  await logAudit({
    tenantId, userId, action: 'invoice.voided', resourceType: 'invoice', resourceId: id,
    details: { invoice_number: rows[0].invoice_number },
  }).catch(() => {});
  return true;
}

export interface SettleInvoiceResult {
  invoiceId: string;
  status: 'paid' | 'pending' | 'failed';
  transactionId: string;
  referenceNumber: string;
  amountCents: number;
  providerReference?: string | null;
  failureReason?: string | null;
}

/**
 * Settle an outstanding invoice online via a Processed method (C5.10). Charges the
 * customer's stored method for the full outstanding amount, records a ledger row
 * linked to the invoice, and marks the invoice paid.
 */
export async function settleInvoice(
  invoiceId: string, businessId: string, tenantId: string, paymentMethodId: string, userId: string,
): Promise<SettleInvoiceResult> {
  const { rows } = await adminPool.query(
    `SELECT id, customer_id, currency, total_cents, amount_paid_cents, status, invoice_number
     FROM pay_invoices WHERE id = $1 AND business_id = $2`,
    [invoiceId, businessId],
  );
  const invoice = rows[0];
  if (!invoice) throw new InvoiceError('Invoice not found for this business', 'INVOICE_NOT_FOUND');
  if (invoice.status === 'paid') throw new InvoiceError('Invoice is already paid', 'ALREADY_PAID');
  if (invoice.status === 'void') throw new InvoiceError('Invoice is void', 'INVOICE_VOID');

  const outstanding = invoice.total_cents - invoice.amount_paid_cents;
  if (outstanding <= 0) throw new InvoiceError('Invoice has no outstanding balance', 'NO_BALANCE');

  const reference = generateReference();
  const owner: MethodOwner = {
    ownerLevel: 'customer', businessId, tenantId, customerId: invoice.customer_id,
  };

  const charge = await chargeStoredMethod({
    owner,
    amountCents: outstanding,
    currency: invoice.currency,
    paymentMethodId,
    idempotencyKey: `invoice:${invoiceId}`,
    description: `Invoice #${invoice.invoice_number}`,
    metadata: { kind: 'invoice_settlement', business_id: businessId, invoice_id: invoiceId },
  });

  const status = charge.outcome === 'succeeded' ? 'completed' : charge.outcome === 'pending' ? 'pending' : 'failed';

  const txn = await insertChargeRow(adminPool, {
    businessId, customerId: invoice.customer_id, invoiceId,
    amountCents: outstanding, currency: invoice.currency, method: 'card', status,
    referenceNumber: reference, description: `Invoice #${invoice.invoice_number}`,
    processedBy: userId, isProcessed: true, providerReference: charge.providerReference ?? null,
    paymentMethodId,
  });

  if (status === 'completed') {
    // Post the GL entry for the settled invoice payment: Debit Cash / Credit the
    // correct revenue accounts per line (service/product/no-show immediately,
    // membership/package deferred to 2400, tax to 2300).
    const { postInvoicePaymentJournalEntry } = await import('./payment-journal.service');
    await postInvoicePaymentJournalEntry({
      businessId, invoiceId, transactionId: txn.id, amountCents: outstanding,
      debitCode: '1100', referenceType: 'payment',
      description: `Invoice #${invoice.invoice_number} payment`,
    });
  }

  if (status !== 'failed') {
    // Settled (or async-pending for bank debits): mark paid, record the amount.
    await adminPool.query(
      `UPDATE pay_invoices SET amount_paid_cents = total_cents, status = 'paid', updated_at = NOW() WHERE id = $1`,
      [invoiceId],
    );
    await logAudit({
      tenantId, userId, action: 'invoice.paid', resourceType: 'invoice', resourceId: invoiceId,
      details: { invoice_number: invoice.invoice_number, amount_cents: outstanding, reference },
    }).catch(() => {});
    issueInvoiceReceipt(invoice, businessId, reference, outstanding).catch((e) =>
      logger.warn(`Invoice ${invoice.invoice_number}: receipt enqueue failed: ${e?.message || e}`),
    );
  }

  return {
    invoiceId,
    status: status === 'completed' ? 'paid' : status,
    transactionId: txn.id,
    referenceNumber: reference,
    amountCents: outstanding,
    providerReference: charge.providerReference ?? null,
    failureReason: status === 'failed' ? (charge.failureReason ?? 'Payment failed') : null,
  };
}

async function issueInvoiceReceipt(invoice: any, businessId: string, reference: string, amountCents: number): Promise<void> {
  const { rows } = await adminPool.query('SELECT email FROM cus_customers WHERE id = $1', [invoice.customer_id]);
  await queueNotification({
    businessId, type: 'invoice.paid', recipientId: invoice.customer_id, recipientEmail: rows[0]?.email || undefined,
    data: { invoice_number: invoice.invoice_number, amount_cents: amountCents, currency: invoice.currency, reference_number: reference },
  });
}

/** Queue the issued invoice to the customer (C5.6). */
export async function emailInvoice(invoiceId: string, businessId: string): Promise<boolean> {
  const invoice = await getInvoice(invoiceId, businessId);
  if (!invoice) return false;
  await queueNotification({
    businessId, type: 'invoice.issued', recipientId: invoice.customer_id,
    recipientEmail: invoice.customer_email || undefined,
    data: {
      invoice_number: invoice.invoice_number,
      total_cents: invoice.total_cents,
      currency: invoice.currency,
      due_date: invoice.due_date,
    },
  });
  return true;
}

/** Human currency formatting for the PDF. */
function fmtMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Render an invoice to a PDF buffer (C5.5). Platform-default layout — full
 * per-business branding is Phase 6 (Requirement C12).
 */
export async function renderInvoicePdf(invoiceId: string, businessId: string): Promise<Buffer | null> {
  const invoice = await getInvoice(invoiceId, businessId);
  if (!invoice) return null;
  const currency: string = invoice.currency;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header — business identity.
    doc.fontSize(20).text(invoice.business_name || 'Invoice', { continued: false });
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#555');
    if (invoice.business_address) doc.text(invoice.business_address);
    if (invoice.business_email) doc.text(invoice.business_email);
    if (invoice.business_phone) doc.text(invoice.business_phone);
    if (invoice.business_tax_id) doc.text(`Tax ID: ${invoice.business_tax_id}`);
    doc.fillColor('#000');

    // Invoice meta.
    doc.moveDown(1);
    doc.fontSize(16).text(`Invoice #${invoice.invoice_number}`);
    doc.fontSize(10).fillColor('#555')
      .text(`Issued: ${new Date(invoice.issue_date).toLocaleDateString()}`)
      .text(`Due: ${new Date(invoice.due_date).toLocaleDateString()}`)
      .text(`Status: ${String(invoice.status).toUpperCase()}`)
      .fillColor('#000');

    // Bill-to.
    doc.moveDown(1);
    const customerName = [invoice.customer_first_name, invoice.customer_last_name].filter(Boolean).join(' ').trim();
    doc.fontSize(11).text('Bill To:', { underline: true });
    doc.fontSize(10).text(customerName || 'Customer');
    if (invoice.customer_email) doc.text(invoice.customer_email);

    // Line items table.
    doc.moveDown(1);
    const startX = 50;
    let y = doc.y;
    doc.fontSize(10).fillColor('#555');
    doc.text('Description', startX, y);
    doc.text('Qty', 330, y, { width: 40, align: 'right' });
    doc.text('Unit', 380, y, { width: 70, align: 'right' });
    doc.text('Amount', 460, y, { width: 90, align: 'right' });
    doc.fillColor('#000');
    y += 16;
    doc.moveTo(startX, y).lineTo(545, y).strokeColor('#ccc').stroke();
    y += 6;

    for (const li of invoice.line_items as any[]) {
      doc.fontSize(10).text(li.description, startX, y, { width: 270 });
      doc.text(String(li.quantity), 330, y, { width: 40, align: 'right' });
      doc.text(fmtMoney(li.unit_price_cents, currency), 380, y, { width: 70, align: 'right' });
      doc.text(fmtMoney(li.amount_cents, currency), 460, y, { width: 90, align: 'right' });
      y = doc.y + 4;
    }

    // Totals.
    y += 8;
    doc.moveTo(330, y).lineTo(545, y).strokeColor('#ccc').stroke();
    y += 8;
    const totalRow = (label: string, value: string, bold = false) => {
      doc.fontSize(bold ? 12 : 10).text(label, 380, y, { width: 70, align: 'right' });
      doc.text(value, 460, y, { width: 90, align: 'right' });
      y = doc.y + 4;
    };
    totalRow('Subtotal', fmtMoney(invoice.subtotal_cents, currency));
    if (invoice.tax_cents > 0) totalRow('Tax', fmtMoney(invoice.tax_cents, currency));
    totalRow('Total', fmtMoney(invoice.total_cents, currency), true);
    if (invoice.amount_paid_cents > 0) totalRow('Paid', fmtMoney(invoice.amount_paid_cents, currency));

    if (invoice.notes) {
      doc.moveDown(2).fontSize(9).fillColor('#555').text(invoice.notes, startX, undefined, { width: 495 }).fillColor('#000');
    }

    doc.end();
  });
}

export { InvoiceError };
