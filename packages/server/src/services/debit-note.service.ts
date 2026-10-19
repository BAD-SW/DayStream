import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { logAudit } from './audit.service';
import { resolveBusinessCurrency } from './customer-payment.service';
import { buildRevenueCreditLines, sumCreditLines, RevenueLine } from './revenue-mapping.service';
import type { SaleItemType } from './revenue-mapping.service';
import * as journal from './journal.service';

/**
 * Debit notes — the "debit" side of an Adjustment (spec 10, Adjustment feature).
 *
 * Transaction model (canonical): there are four financial transaction types —
 * Charge, Payment, Credit, Debit. A DEBIT IS A CREDIT WITH THE OPPOSITE SIGN.
 * A debit note is therefore the exact mirror of a credit note (see
 * credit-note.service.ts): the SAME per-line revenue split, with the debit/credit
 * sides SWAPPED, posted at ISSUANCE:
 *
 *   Debit  2500 Customer Deposits            (draw the drawable balance DOWN)
 *   Credit <per-line revenue account(s)>     (re-recognise revenue — service 4100, etc.)
 *   Credit 2300 Tax Payable                  (re-apply tax)
 *
 * It then records a `pay_account_credits` row with a NEGATIVE amount so the net
 * drawable balance sums DOWN through the existing balance machinery unchanged.
 * There is no zero-floor: a debit is a credit with the sign flipped, so the
 * account may go negative (an owing position). This mirrors the credit note,
 * which has a positive amount and moves the balance up.
 *
 * Isolation: adminPool, scoped by business_id + tenant_id (Section C convention).
 */

const CUSTOMER_DEPOSITS_CODE = '2500';

class DebitNoteError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DebitNoteError';
    this.code = code;
  }
}

export interface DebitNoteLineInput {
  description: string;
  quantity?: number;         // defaults to 1
  unitPriceCents: number;
  taxCents?: number;         // per-line tax (re-applied to 2300)
  itemType?: SaleItemType;   // revenue classification; defaults to 'service'
}

export interface IssueDebitNoteInput {
  businessId: string;
  tenantId: string;
  customerId: string;
  reason: string;
  lineItems: DebitNoteLineInput[];
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
 * Issue a debit note: allocate a gapless number, write the note + lines, draw the
 * customer's account balance down (a NEGATIVE account-credit row), and post the
 * re-recognised-revenue GL entry — the sign-flipped mirror of a credit note.
 */
export async function issueDebitNote(input: IssueDebitNoteInput): Promise<any> {
  if (!input.reason || !input.reason.trim()) {
    throw new DebitNoteError('A reason is required for a debit note', 'REASON_REQUIRED');
  }
  if (!input.lineItems || input.lineItems.length === 0) {
    throw new DebitNoteError('A debit note needs at least one line item', 'NO_LINE_ITEMS');
  }

  const currency = await resolveBusinessCurrency(input.businessId);

  // Compute line amounts + totals (cents), same as a credit note.
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
  if (totalCents <= 0) throw new DebitNoteError('Debit note total must be greater than zero', 'INVALID_TOTAL');

  const client = await adminPool.connect();
  let debitNote: any;
  let accountCreditId: string | null = null;
  try {
    await client.query('BEGIN');

    // Gapless per-business number (counter created on first use, starts at 1000).
    await client.query(
      `INSERT INTO pay_debit_note_number_seq (business_id, next_number)
       VALUES ($1, 1000) ON CONFLICT (business_id) DO NOTHING`,
      [input.businessId],
    );
    const { rows: seqRows } = await client.query(
      `SELECT next_number FROM pay_debit_note_number_seq WHERE business_id = $1 FOR UPDATE`,
      [input.businessId],
    );
    const debitNoteNumber = Number(seqRows[0].next_number);
    await client.query(
      `UPDATE pay_debit_note_number_seq SET next_number = next_number + 1 WHERE business_id = $1`,
      [input.businessId],
    );

    const { rows: dnRows } = await client.query(
      `INSERT INTO pay_debit_notes
         (tenant_id, business_id, customer_id, debit_note_number, issue_date, currency,
          subtotal_cents, tax_cents, total_cents, reason, status, created_by)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$8,$9,'issued',$10)
       RETURNING *`,
      [
        input.tenantId, input.businessId, input.customerId, debitNoteNumber, currency,
        subtotalCents, taxCents, totalCents, input.reason.trim(), input.createdBy,
      ],
    );
    debitNote = dnRows[0];

    for (const l of lines) {
      await client.query(
        `INSERT INTO pay_debit_note_line_items
           (debit_note_id, description, item_type, quantity, unit_price_cents, amount_cents, tax_cents, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [debitNote.id, l.description, l.itemType, l.quantity, l.unitPriceCents, l.amountCents, l.taxCents, l.displayOrder],
      );
    }

    // Draw the account down: a NEGATIVE account-credit row. The balance query sums
    // remaining_cents of 'available' rows, so a negative row reduces the net total
    // (and can take it below zero — a debit is a credit with the opposite sign).
    const { rows: acRows } = await client.query(
      `INSERT INTO pay_account_credits
         (tenant_id, business_id, customer_id, source_transaction_id, currency,
          original_cents, remaining_cents, status, note)
       VALUES ($1,$2,$3,NULL,$4,$5,$5,'available',$6)
       RETURNING id`,
      [input.tenantId, input.businessId, input.customerId, currency, -totalCents,
       `Debit note #${debitNoteNumber}: ${input.reason.trim()}`],
    );
    accountCreditId = acRows[0].id;
    await client.query(
      `UPDATE pay_debit_notes SET account_credit_id = $1 WHERE id = $2`,
      [accountCreditId, debitNote.id],
    );

    // Display-only ledger row so the debit note shows in the transaction history.
    // type 'debit', method 'account_debit', is_processed=false — a bare insert that
    // does NOT trigger a journal post; the debit note already posts its own GL
    // below. Linked via debit_note_id for the history label + Print/Email.
    await client.query(
      `INSERT INTO pay_transactions
         (business_id, customer_id, type, status, amount, currency, payment_method,
          reference_number, description, processed_by, is_processed, debit_note_id)
       VALUES ($1,$2,'debit','completed',$3,$4,'account_debit',$5,$6,$7,false,$8)`,
      [
        input.businessId, input.customerId, totalCents, currency,
        `DN-${debitNoteNumber}`, `Debit note #${debitNoteNumber}: ${input.reason.trim()}`,
        input.createdBy, debitNote.id,
      ],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Post the GL entry AFTER commit (non-blocking): the re-recognised-revenue split.
  await postDebitNoteJournal(debitNote, lines, currency).catch((e) =>
    logger.warn(`Debit note #${debitNote.debit_note_number}: GL post failed: ${e?.message || e}`),
  );

  await logAudit({
    tenantId: input.tenantId, userId: input.createdBy, action: 'debit_note.issued',
    resourceType: 'debit_note', resourceId: debitNote.id,
    details: { debit_note_number: debitNote.debit_note_number, total_cents: totalCents, currency, reason: input.reason.trim(), customer_id: input.customerId },
  }).catch(() => {});

  return { ...debitNote, account_credit_id: accountCreditId };
}

/**
 * Post the re-recognised-revenue journal entry for a debit note — the sign-flipped
 * mirror of a credit note:
 *   Debit  2500 Customer Deposits (total)             (draw the account down)
 *   Credit <per-line revenue accounts> + 2300 Tax     (re-recognise what the sale earned)
 * Idempotent on ('debit_note', id); non-throwing.
 */
async function postDebitNoteJournal(debitNote: any, lines: { itemType: SaleItemType; amountCents: number; taxCents: number }[], currency: string): Promise<void> {
  const businessId: string = debitNote.business_id;

  // Already posted?
  const { rows: existing } = await adminPool.query(
    `SELECT 1 FROM fin_journal_entries WHERE reference_type = 'debit_note' AND reference_id = $1 AND is_void = false LIMIT 1`,
    [debitNote.id],
  );
  if (existing.length > 0) return;

  // Reuse the invoice revenue mapping to get the per-account split, then put those
  // amounts on the CREDIT side (re-recognising revenue) and debit 2500 for the total.
  const revenueLines: RevenueLine[] = lines.map((l) => ({ itemType: l.itemType, amountCents: l.amountCents, taxCents: l.taxCents }));
  const split = buildRevenueCreditLines(revenueLines); // [{code, amountCents}] incl. 2300 tax
  const total = sumCreditLines(split);
  if (total <= 0) return;

  const codes = [CUSTOMER_DEPOSITS_CODE, ...split.map((s) => s.code)];
  const accounts = await accountIds(businessId, Array.from(new Set(codes)));
  const depositsId = accounts.get(CUSTOMER_DEPOSITS_CODE);
  if (!depositsId) {
    logger.warn(`Debit note journal: ${CUSTOMER_DEPOSITS_CODE} not seeded for business ${businessId}; skipping GL post for debit note ${debitNote.id}`);
    return;
  }

  const creditLines: Array<{ account_id: string; debit: number; credit: number; description?: string }> = [];
  for (const s of split) {
    const accId = accounts.get(s.code);
    if (!accId) {
      logger.warn(`Debit note journal: revenue account ${s.code} not seeded for business ${businessId}; skipping GL post for debit note ${debitNote.id}`);
      return;
    }
    creditLines.push({ account_id: accId, debit: 0, credit: s.amountCents, description: `Debit note — re-recognise ${s.description}` });
  }

  await journal.createEntry({
    businessId,
    entryDate: await postingDate(businessId),
    description: `Debit note #${debitNote.debit_note_number}`,
    referenceType: 'debit_note',
    referenceId: debitNote.id,
    createdBy: debitNote.created_by || undefined,
    lines: [
      { account_id: depositsId, debit: total, credit: 0, description: 'Customer balance drawn down (debit)' },
      ...creditLines,
    ],
  });
}

/**
 * Render a debit note to a branded PDF — the same Adjustment template as a credit
 * note (header/subject/body/footer), with the debit-note line items as the
 * {{details_table}}. Returns null when the note isn't found for the business.
 */
export async function renderDebitNotePdf(id: string, businessId: string): Promise<Buffer | null> {
  const dn = await getDebitNote(id, businessId);
  if (!dn) return null;

  const { resolvePdfBranding, renderTemplateDocumentPdf } = await import('./document-pdf');
  const detailsTable = {
    rows: (dn.line_items as any[]).map((li) => ({ description: li.description, qty: li.quantity, amountCents: li.amount_cents })),
    totalCents: dn.total_cents,
    currency: dn.currency as string,
  };

  const branding = await resolvePdfBranding(businessId, 'invoice.issued', {
    invoice_number: `DN-${dn.debit_note_number}`,
    total_cents: dn.total_cents,
    amount_due_cents: dn.total_cents,
    currency: dn.currency,
    invoice_date: dn.issue_date,
    reason: dn.reason,
    customer_name: [dn.customer_first_name, dn.customer_last_name].filter(Boolean).join(' ').trim(),
    customer_email: dn.customer_email,
  }, detailsTable);

  return renderTemplateDocumentPdf(branding);
}

/** Full debit-note detail: the note, its lines, and customer info. */
export async function getDebitNote(id: string, businessId: string): Promise<any | null> {
  const { rows } = await adminPool.query(
    `SELECT dn.*,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            c.email AS customer_email
       FROM pay_debit_notes dn
       JOIN cus_customers c ON c.id = dn.customer_id
      WHERE dn.id = $1 AND dn.business_id = $2`,
    [id, businessId],
  );
  const dn = rows[0];
  if (!dn) return null;
  const { rows: items } = await adminPool.query(
    `SELECT id, description, item_type, quantity, unit_price_cents, amount_cents, tax_cents, display_order
       FROM pay_debit_note_line_items WHERE debit_note_id = $1 ORDER BY display_order, created_at`,
    [id],
  );
  dn.line_items = items;
  return dn;
}

/** List a business's debit notes (newest first), with customer name. */
export async function listDebitNotes(businessId: string, customerId?: string): Promise<any[]> {
  const params: any[] = [businessId];
  let where = 'dn.business_id = $1';
  if (customerId) { params.push(customerId); where += ` AND dn.customer_id = $2`; }
  const { rows } = await adminPool.query(
    `SELECT dn.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email
       FROM pay_debit_notes dn
       JOIN cus_customers c ON c.id = dn.customer_id
      WHERE ${where}
      ORDER BY dn.debit_note_number DESC`,
    params,
  );
  return rows;
}

export { DebitNoteError };
