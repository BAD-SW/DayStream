import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { logAudit } from './audit.service';
import { resolveBusinessCurrency } from './customer-payment.service';
import { buildRevenueCreditLines, sumCreditLines, RevenueLine } from './revenue-mapping.service';
import type { SaleItemType } from './revenue-mapping.service';
import * as journal from './journal.service';

/**
 * Credit notes — the "credit" side of an Adjustment (spec 10, Requirement C4/C5).
 *
 * A credit note is the cash-free mirror of an invoice: it reverses revenue and
 * grants the customer drawable account credit. It posts its GL entry at ISSUANCE
 * (an invoice posts at payment), reusing the invoice's per-line revenue mapping
 * with debit/credit SWAPPED:
 *
 *   Debit  <per-line revenue account(s)>   (reduce revenue — service 4100, etc.)
 *   Debit  2300 Tax Payable                 (reverse collected tax)
 *   Credit 2500 Customer Deposits            (new drawable liability)
 *
 * It then records a `pay_account_credits` row so the credit flows through the
 * existing balance / apply-to-invoice machinery unchanged. Revenue is recognised
 * only once overall: reduced here, re-recognised when the credit is later applied.
 *
 * Isolation: adminPool, scoped by business_id + tenant_id (Section C convention).
 */

const CUSTOMER_DEPOSITS_CODE = '2500';

class CreditNoteError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'CreditNoteError';
    this.code = code;
  }
}

export interface CreditNoteLineInput {
  description: string;
  quantity?: number;         // defaults to 1
  unitPriceCents: number;
  taxCents?: number;         // per-line tax (reversed to 2300)
  itemType?: SaleItemType;   // revenue classification; defaults to 'service'
}

export interface IssueCreditNoteInput {
  businessId: string;
  tenantId: string;
  customerId: string;
  reason: string;
  lineItems: CreditNoteLineInput[];
  createdBy: string;
}

/** Business timezone-local posting date (YYYY-MM-DD). */
async function postingDate(businessId: string): Promise<string> {
  const { rows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]);
  const tz = rows[0]?.timezone || 'UTC';
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
}

/** Resolve chart-of-accounts ids by code for a business. */
async function accountIds(businessId: string, codes: string[]): Promise<Map<string, string>> {
  const { rows } = await adminPool.query(
    `SELECT id, code FROM fin_chart_of_accounts WHERE business_id = $1 AND code = ANY($2)`,
    [businessId, codes],
  );
  return new Map(rows.map((r) => [r.code, r.id]));
}

/**
 * Issue a credit note: allocate a gapless number, write the note + lines, grant
 * drawable account credit, and post the reversed-revenue GL entry — all so a
 * credit always has a matching liability on the books.
 */
export async function issueCreditNote(input: IssueCreditNoteInput): Promise<any> {
  if (!input.reason || !input.reason.trim()) {
    throw new CreditNoteError('A reason is required for a credit note', 'REASON_REQUIRED');
  }
  if (!input.lineItems || input.lineItems.length === 0) {
    throw new CreditNoteError('A credit note needs at least one line item', 'NO_LINE_ITEMS');
  }

  const currency = await resolveBusinessCurrency(input.businessId);

  // Compute line amounts + totals (cents), same as an invoice.
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
  if (totalCents <= 0) throw new CreditNoteError('Credit note total must be greater than zero', 'INVALID_TOTAL');

  const client = await adminPool.connect();
  let creditNote: any;
  let accountCreditId: string | null = null;
  try {
    await client.query('BEGIN');

    // Gapless per-business number (counter created on first use, starts at 1000).
    await client.query(
      `INSERT INTO pay_credit_note_number_seq (business_id, next_number)
       VALUES ($1, 1000) ON CONFLICT (business_id) DO NOTHING`,
      [input.businessId],
    );
    const { rows: seqRows } = await client.query(
      `SELECT next_number FROM pay_credit_note_number_seq WHERE business_id = $1 FOR UPDATE`,
      [input.businessId],
    );
    const creditNoteNumber = Number(seqRows[0].next_number);
    await client.query(
      `UPDATE pay_credit_note_number_seq SET next_number = next_number + 1 WHERE business_id = $1`,
      [input.businessId],
    );

    const { rows: cnRows } = await client.query(
      `INSERT INTO pay_credit_notes
         (tenant_id, business_id, customer_id, credit_note_number, issue_date, currency,
          subtotal_cents, tax_cents, total_cents, reason, status, created_by)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$8,$9,'issued',$10)
       RETURNING *`,
      [
        input.tenantId, input.businessId, input.customerId, creditNoteNumber, currency,
        subtotalCents, taxCents, totalCents, input.reason.trim(), input.createdBy,
      ],
    );
    creditNote = cnRows[0];

    for (const l of lines) {
      await client.query(
        `INSERT INTO pay_credit_note_line_items
           (credit_note_id, description, item_type, quantity, unit_price_cents, amount_cents, tax_cents, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [creditNote.id, l.description, l.itemType, l.quantity, l.unitPriceCents, l.amountCents, l.taxCents, l.displayOrder],
      );
    }

    // Grant the drawable account credit (same shape as a payment-on-account credit,
    // but funded by a credit note rather than a transaction).
    const { rows: acRows } = await client.query(
      `INSERT INTO pay_account_credits
         (tenant_id, business_id, customer_id, source_transaction_id, currency,
          original_cents, remaining_cents, status, note)
       VALUES ($1,$2,$3,NULL,$4,$5,$5,'available',$6)
       RETURNING id`,
      [input.tenantId, input.businessId, input.customerId, currency, totalCents,
       `Credit note #${creditNoteNumber}: ${input.reason.trim()}`],
    );
    accountCreditId = acRows[0].id;
    await client.query(
      `UPDATE pay_credit_notes SET account_credit_id = $1 WHERE id = $2`,
      [accountCreditId, creditNote.id],
    );

    // Display-only ledger row so the credit note shows in the transaction history.
    // type 'credit', method 'account_credit', is_processed=false — a bare insert
    // (like applyCreditToInvoice) that does NOT trigger a journal post; the credit
    // note already posts its own GL below. Linked via credit_note_id for the
    // history label + Print/Email.
    await client.query(
      `INSERT INTO pay_transactions
         (business_id, customer_id, type, status, amount, currency, payment_method,
          reference_number, description, processed_by, is_processed, credit_note_id)
       VALUES ($1,$2,'credit','completed',$3,$4,'account_credit',$5,$6,$7,false,$8)`,
      [
        input.businessId, input.customerId, totalCents, currency,
        `CN-${creditNoteNumber}`, `Credit note #${creditNoteNumber}: ${input.reason.trim()}`,
        input.createdBy, creditNote.id,
      ],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Post the GL entry AFTER commit (non-blocking): the reversed-revenue split.
  await postCreditNoteJournal(creditNote, lines, currency).catch((e) =>
    logger.warn(`Credit note #${creditNote.credit_note_number}: GL post failed: ${e?.message || e}`),
  );

  await logAudit({
    tenantId: input.tenantId, userId: input.createdBy, action: 'credit_note.issued',
    resourceType: 'credit_note', resourceId: creditNote.id,
    details: { credit_note_number: creditNote.credit_note_number, total_cents: totalCents, currency, reason: input.reason.trim(), customer_id: input.customerId },
  }).catch(() => {});

  return { ...creditNote, account_credit_id: accountCreditId };
}

/**
 * Post the reversed-revenue journal entry for a credit note:
 *   Debit  <per-line revenue accounts> + 2300 Tax   (reverse what the sale earned)
 *   Credit 2500 Customer Deposits (total)             (new drawable liability)
 * Idempotent on ('credit_note', id); non-throwing.
 */
async function postCreditNoteJournal(creditNote: any, lines: { itemType: SaleItemType; amountCents: number; taxCents: number }[], currency: string): Promise<void> {
  const businessId: string = creditNote.business_id;

  // Already posted?
  const { rows: existing } = await adminPool.query(
    `SELECT 1 FROM fin_journal_entries WHERE reference_type = 'credit_note' AND reference_id = $1 AND is_void = false LIMIT 1`,
    [creditNote.id],
  );
  if (existing.length > 0) return;

  // Reuse the invoice revenue mapping to get the per-account split, then put those
  // amounts on the DEBIT side (reversing revenue) and credit 2500 for the total.
  const revenueLines: RevenueLine[] = lines.map((l) => ({ itemType: l.itemType, amountCents: l.amountCents, taxCents: l.taxCents }));
  const split = buildRevenueCreditLines(revenueLines); // [{code, amountCents}] incl. 2300 tax
  const total = sumCreditLines(split);
  if (total <= 0) return;

  const codes = [CUSTOMER_DEPOSITS_CODE, ...split.map((s) => s.code)];
  const accounts = await accountIds(businessId, Array.from(new Set(codes)));
  const depositsId = accounts.get(CUSTOMER_DEPOSITS_CODE);
  if (!depositsId) {
    logger.warn(`Credit note journal: ${CUSTOMER_DEPOSITS_CODE} not seeded for business ${businessId}; skipping GL post for credit note ${creditNote.id}`);
    return;
  }

  const debitLines: Array<{ account_id: string; debit: number; credit: number; description?: string }> = [];
  for (const s of split) {
    const accId = accounts.get(s.code);
    if (!accId) {
      logger.warn(`Credit note journal: revenue account ${s.code} not seeded for business ${businessId}; skipping GL post for credit note ${creditNote.id}`);
      return;
    }
    debitLines.push({ account_id: accId, debit: s.amountCents, credit: 0, description: `Credit note — reverse ${s.description}` });
  }

  await journal.createEntry({
    businessId,
    entryDate: await postingDate(businessId),
    description: `Credit note #${creditNote.credit_note_number}`,
    referenceType: 'credit_note',
    referenceId: creditNote.id,
    createdBy: creditNote.created_by || undefined,
    lines: [
      ...debitLines,
      { account_id: depositsId, debit: 0, credit: total, description: 'Customer credit granted (drawable)' },
    ],
  });
}

/**
 * Render a credit note to a branded PDF — the same Adjustment template as an
 * invoice (header/subject/body/footer), with the credit-note line items as the
 * {{details_table}}. Returns null when the note isn't found for the business.
 */
export async function renderCreditNotePdf(id: string, businessId: string): Promise<Buffer | null> {
  const cn = await getCreditNote(id, businessId);
  if (!cn) return null;

  const { resolvePdfBranding, renderTemplateDocumentPdf } = await import('./document-pdf');
  const detailsTable = {
    rows: (cn.line_items as any[]).map((li) => ({ description: li.description, qty: li.quantity, amountCents: li.amount_cents })),
    totalCents: cn.total_cents,
    currency: cn.currency as string,
  };

  const branding = await resolvePdfBranding(businessId, 'invoice.issued', {
    invoice_number: `CN-${cn.credit_note_number}`,
    total_cents: cn.total_cents,
    amount_due_cents: cn.total_cents,
    currency: cn.currency,
    invoice_date: cn.issue_date,
    reason: cn.reason,
    customer_name: [cn.customer_first_name, cn.customer_last_name].filter(Boolean).join(' ').trim(),
    customer_email: cn.customer_email,
  }, detailsTable);

  return renderTemplateDocumentPdf(branding);
}

/** Full credit-note detail: the note, its lines, and customer + business info. */
export async function getCreditNote(id: string, businessId: string): Promise<any | null> {
  const { rows } = await adminPool.query(
    `SELECT cn.*,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            c.email AS customer_email
       FROM pay_credit_notes cn
       JOIN cus_customers c ON c.id = cn.customer_id
      WHERE cn.id = $1 AND cn.business_id = $2`,
    [id, businessId],
  );
  const cn = rows[0];
  if (!cn) return null;
  const { rows: items } = await adminPool.query(
    `SELECT id, description, item_type, quantity, unit_price_cents, amount_cents, tax_cents, display_order
       FROM pay_credit_note_line_items WHERE credit_note_id = $1 ORDER BY display_order, created_at`,
    [id],
  );
  cn.line_items = items;
  return cn;
}

/** List a business's credit notes (newest first), with customer name. */
export async function listCreditNotes(businessId: string, customerId?: string): Promise<any[]> {
  const params: any[] = [businessId];
  let where = 'cn.business_id = $1';
  if (customerId) { params.push(customerId); where += ` AND cn.customer_id = $2`; }
  const { rows } = await adminPool.query(
    `SELECT cn.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email
       FROM pay_credit_notes cn
       JOIN cus_customers c ON c.id = cn.customer_id
      WHERE ${where}
      ORDER BY cn.credit_note_number DESC`,
    params,
  );
  return rows;
}

export { CreditNoteError };
