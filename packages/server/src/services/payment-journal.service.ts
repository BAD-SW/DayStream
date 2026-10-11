import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import * as journal from './journal.service';
import { buildRevenueCreditLines, sumCreditLines } from './revenue-mapping.service';

/**
 * Section C → General Ledger bridge.
 *
 * Section C customer payments are recorded in the `pay_transactions` ledger, but
 * that ledger is NOT the accounting journal. This service posts a balanced
 * double-entry to `fin_journal_entries` for a settled customer charge or refund,
 * mirroring the pattern `order-journal.service.ts` already uses for POS orders —
 * so Section C revenue reaches the accounting books.
 *
 * NOTE (scope): GL/journal posting for Section C is NOT part of the
 * 10-payment-platform spec (which defers downstream consumption to the Reporting
 * phase). This integration was added during validation to close the gap; it is
 * documented here for KIRO to formalize as a spec item.
 *
 * Account mapping (chart of accounts, codes seeded by the Accounts Payable phase):
 *   1100 Cash & Bank            (asset)
 *   2400 Deferred Revenue       (liability) — membership/enrollment-linked charges
 *   4100 Service Revenue        (revenue)   — default for a plain customer charge
 *
 * Design decisions / current limitations:
 *   - Posts only for COMPLETED charges/refunds. A bank-debit charge that is
 *     `pending` is NOT journaled until it settles (that finalization arrives via
 *     webhook; posting it then is a follow-up).
 *   - A membership renewal (enrollment-linked) credits DEFERRED revenue (2400),
 *     NOT revenue directly, so the existing revenue-recognition job can move it to
 *     Membership Revenue (4200) over the period and stay balanced.
 *   - `pay_transactions` carries no tax breakdown, so the whole amount is credited
 *     to revenue (no 2300 Tax Payable split). When Section C captures tax per line
 *     this should split it out.
 *   - If the business's chart of accounts isn't seeded (missing 1100 / target
 *     revenue account), this no-ops with a warning rather than throwing — a
 *     missing GL must never block taking a payment.
 */

const CASH_CODE = '1100';
const DEFERRED_REVENUE_CODE = '2400';
const SERVICE_REVENUE_CODE = '4100';
const CUSTOMER_DEPOSITS_CODE = '2500';

interface JournalTxn {
  id: string;
  business_id: string;
  tenant_id?: string | null;
  customer_id?: string | null;
  amount: number;              // cents
  currency?: string | null;
  payment_method: string;
  reference_number: string | null;
  booking_id?: string | null;
  enrollment_id?: string | null;
  invoice_id?: string | null;
}

/**
 * A charge is "unapplied" — money received but not yet earned — when it is tied
 * to nothing the business has delivered or billed: no booking, no membership
 * enrollment, no invoice. That is a customer DEPOSIT (a liability), not revenue.
 * Such a payment credits 2500 Customer Deposits and creates a drawable account
 * credit; revenue is only recognised later when the credit is APPLIED to an
 * invoice (see account-credit.service.ts).
 */
function isUnapplied(txn: JournalTxn): boolean {
  return !txn.booking_id && !txn.enrollment_id && !txn.invoice_id;
}

/** Resolve chart-of-accounts ids by code for a business. */
async function accountIds(businessId: string, codes: string[]): Promise<Map<string, string>> {
  const { rows } = await adminPool.query(
    `SELECT id, code FROM fin_chart_of_accounts WHERE business_id = $1 AND code = ANY($2)`,
    [businessId, codes],
  );
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Business timezone-local posting date (YYYY-MM-DD). */
async function postingDate(businessId: string): Promise<string> {
  const { rows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]);
  const tz = rows[0]?.timezone || 'UTC';
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
}

/** Has a journal entry already been posted for this transaction + direction? */
async function alreadyPosted(referenceType: string, referenceId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT 1 FROM fin_journal_entries WHERE reference_type = $1 AND reference_id = $2 AND is_void = false LIMIT 1`,
    [referenceType, referenceId],
  );
  return rows.length > 0;
}

/** The revenue account a charge credits: deferred for memberships, else service revenue. */
function revenueCodeFor(txn: JournalTxn): string {
  return txn.enrollment_id ? DEFERRED_REVENUE_CODE : SERVICE_REVENUE_CODE;
}

/**
 * Post the GL entry for a settled customer charge:
 *   Debit  1100 Cash & Bank         (amount collected)
 *   Credit 4100 Service Revenue      (plain charge)   — OR —
 *   Credit 2400 Deferred Revenue     (membership/enrollment-linked)
 *
 * Idempotent and non-throwing. Call only when the charge is COMPLETED.
 */
export async function postPaymentJournalEntry(txn: JournalTxn): Promise<void> {
  try {
    if (txn.amount <= 0) return;
    if (await alreadyPosted('payment', txn.id)) return;

    // Unapplied payment (payment "on account"): Debit Cash / Credit the Customer
    // Deposits liability, and record a drawable account credit. Revenue is NOT
    // recognised here — only when the credit is applied to an invoice.
    if (isUnapplied(txn)) {
      await postUnappliedPayment(txn);
      return;
    }

    const revenueCode = revenueCodeFor(txn);
    const accounts = await accountIds(txn.business_id, [CASH_CODE, revenueCode]);
    const cashId = accounts.get(CASH_CODE);
    const revenueId = accounts.get(revenueCode);
    if (!cashId || !revenueId) {
      logger.warn(`Payment journal: chart of accounts not seeded for business ${txn.business_id} (need ${CASH_CODE}, ${revenueCode}); skipping GL post for txn ${txn.id}`);
      return;
    }

    const label = txn.reference_number || txn.id.slice(0, 8);
    await journal.createEntry({
      businessId: txn.business_id,
      entryDate: await postingDate(txn.business_id),
      description: `Customer payment ${label}`,
      referenceType: 'payment',
      referenceId: txn.id,
      lines: [
        { account_id: cashId, debit: txn.amount, credit: 0, description: `Payment received — ${txn.payment_method}` },
        { account_id: revenueId, debit: 0, credit: txn.amount, description: txn.enrollment_id ? 'Deferred (membership)' : 'Customer revenue' },
      ],
    });
  } catch (e: any) {
    logger.warn(`Payment journal: failed to post GL entry for txn ${txn.id}: ${e?.message || e}`);
  }
}

/**
 * Post an unapplied payment: Debit 1100 Cash & Bank / Credit 2500 Customer
 * Deposits, then record a `pay_account_credits` row the business can later apply
 * to an invoice. The GL post and the credit-ledger row are created together so a
 * credit always has a matching liability on the books (and vice versa).
 */
async function postUnappliedPayment(txn: JournalTxn): Promise<void> {
  const accounts = await accountIds(txn.business_id, [CASH_CODE, CUSTOMER_DEPOSITS_CODE]);
  const cashId = accounts.get(CASH_CODE);
  const depositsId = accounts.get(CUSTOMER_DEPOSITS_CODE);
  if (!cashId || !depositsId) {
    logger.warn(`Payment journal: chart of accounts not seeded for business ${txn.business_id} (need ${CASH_CODE}, ${CUSTOMER_DEPOSITS_CODE}); skipping GL post for txn ${txn.id}`);
    return;
  }

  const label = txn.reference_number || txn.id.slice(0, 8);
  await journal.createEntry({
    businessId: txn.business_id,
    entryDate: await postingDate(txn.business_id),
    description: `Customer payment on account ${label}`,
    referenceType: 'payment',
    referenceId: txn.id,
    lines: [
      { account_id: cashId, debit: txn.amount, credit: 0, description: `Payment received — ${txn.payment_method}` },
      { account_id: depositsId, debit: 0, credit: txn.amount, description: 'Customer deposit (unapplied)' },
    ],
  });

  // Record the drawable account credit. Needs the customer; resolve it from the
  // transaction if the caller didn't carry it on the object.
  let customerId = txn.customer_id ?? null;
  let tenantId = txn.tenant_id ?? null;
  let currency = txn.currency ?? null;
  if (!customerId || !tenantId || !currency) {
    const { rows } = await adminPool.query(
      `SELECT t.customer_id, t.currency, b.tenant_id
       FROM pay_transactions t JOIN sys_businesses b ON b.id = t.business_id
       WHERE t.id = $1`,
      [txn.id],
    );
    customerId = customerId ?? rows[0]?.customer_id ?? null;
    tenantId = tenantId ?? rows[0]?.tenant_id ?? null;
    currency = currency ?? rows[0]?.currency ?? null;
  }
  if (!customerId || !tenantId) {
    logger.warn(`Payment journal: cannot create account credit for txn ${txn.id} (missing customer/tenant); GL deposit posted but credit not recorded`);
    return;
  }

  await adminPool.query(
    `INSERT INTO pay_account_credits
       (tenant_id, business_id, customer_id, source_transaction_id, currency,
        original_cents, remaining_cents, status, note)
     VALUES ($1,$2,$3,$4,$5,$6,$6,'available',$7)`,
    [tenantId, txn.business_id, customerId, txn.id, currency || 'USD', txn.amount, `Payment on account ${label}`],
  );
}

/**
 * Post the GL entry for a settled refund — the reverse of a charge:
 *   Debit  revenue account (reduce revenue / deferred)
 *   Credit 1100 Cash & Bank  (money returned)
 *
 * The refund row carries `refund_of_id`; its enrollment linkage (if any) is
 * inherited by the service when it writes the refund row, so the same mapping
 * applies. Idempotent and non-throwing.
 */
export async function postRefundJournalEntry(txn: JournalTxn): Promise<void> {
  try {
    if (txn.amount <= 0) return;
    if (await alreadyPosted('payment_refund', txn.id)) return;

    // Refund of an unapplied deposit: reverse the deposit liability, not revenue,
    // and draw down the account credit it funded.
    if (isUnapplied(txn)) {
      await postUnappliedRefund(txn);
      return;
    }

    const revenueCode = revenueCodeFor(txn);
    const accounts = await accountIds(txn.business_id, [CASH_CODE, revenueCode]);
    const cashId = accounts.get(CASH_CODE);
    const revenueId = accounts.get(revenueCode);
    if (!cashId || !revenueId) {
      logger.warn(`Refund journal: chart of accounts not seeded for business ${txn.business_id}; skipping GL post for refund ${txn.id}`);
      return;
    }

    const label = txn.reference_number || txn.id.slice(0, 8);
    await journal.createEntry({
      businessId: txn.business_id,
      entryDate: await postingDate(txn.business_id),
      description: `Customer refund ${label}`,
      referenceType: 'payment_refund',
      referenceId: txn.id,
      lines: [
        { account_id: revenueId, debit: txn.amount, credit: 0, description: 'Refund — reduce revenue' },
        { account_id: cashId, debit: 0, credit: txn.amount, description: `Refund paid — ${txn.payment_method}` },
      ],
    });
  } catch (e: any) {
    logger.warn(`Refund journal: failed to post GL entry for refund ${txn.id}: ${e?.message || e}`);
  }
}

/**
 * Refund of an unapplied customer deposit:
 *   Debit  2500 Customer Deposits   (reduce the liability)
 *   Credit 1100 Cash & Bank          (money returned)
 * and reduce the still-available account credit this payment created. Only the
 * UNAPPLIED remainder of a credit can be refunded this way; if the customer
 * already spent the credit on an invoice, that portion is revenue and must be
 * refunded through the normal revenue-reducing path.
 */
async function postUnappliedRefund(txn: JournalTxn): Promise<void> {
  const accounts = await accountIds(txn.business_id, [CASH_CODE, CUSTOMER_DEPOSITS_CODE]);
  const cashId = accounts.get(CASH_CODE);
  const depositsId = accounts.get(CUSTOMER_DEPOSITS_CODE);
  if (!cashId || !depositsId) {
    logger.warn(`Refund journal: chart of accounts not seeded for business ${txn.business_id} (need ${CASH_CODE}, ${CUSTOMER_DEPOSITS_CODE}); skipping GL post for refund ${txn.id}`);
    return;
  }

  const label = txn.reference_number || txn.id.slice(0, 8);
  await journal.createEntry({
    businessId: txn.business_id,
    entryDate: await postingDate(txn.business_id),
    description: `Customer deposit refund ${label}`,
    referenceType: 'payment_refund',
    referenceId: txn.id,
    lines: [
      { account_id: depositsId, debit: txn.amount, credit: 0, description: 'Deposit refunded — reduce liability' },
      { account_id: cashId, debit: 0, credit: txn.amount, description: `Refund paid — ${txn.payment_method}` },
    ],
  });

  // Draw down the account credit funded by the original payment. The refund row
  // carries refund_of_id -> the source charge; find its credit and reduce the
  // still-available remainder (never below zero).
  try {
    const { rows } = await adminPool.query(
      `SELECT ac.id, ac.remaining_cents
       FROM pay_account_credits ac
       JOIN pay_transactions r ON r.refund_of_id = ac.source_transaction_id
       WHERE r.id = $1 AND ac.status = 'available'
       ORDER BY ac.created_at
       LIMIT 1
       FOR UPDATE`,
      [txn.id],
    );
    const credit = rows[0];
    if (credit) {
      const reduce = Math.min(credit.remaining_cents, txn.amount);
      const newRemaining = credit.remaining_cents - reduce;
      await adminPool.query(
        `UPDATE pay_account_credits
         SET remaining_cents = $1, status = CASE WHEN $1 = 0 THEN 'refunded' ELSE status END, updated_at = NOW()
         WHERE id = $2`,
        [newRemaining, credit.id],
      );
    }
  } catch (e: any) {
    logger.warn(`Refund journal: deposit refund ${txn.id} posted but credit draw-down failed: ${e?.message || e}`);
  }
}

/**
 * Post the revenue-recognition entry for an invoice that was just PAID — whether
 * paid with cash/card (settleInvoice) or by applying customer account credit
 * (applyCreditToInvoice). The credit side is split per invoice line into the
 * correct revenue accounts (service/product/no-show immediately; membership &
 * package deferred to 2400) plus tax to 2300, using the shared revenue map so it
 * matches how POS orders are booked. The debit side is supplied by the caller:
 *
 *   settle (cash/card):   Debit 1100 Cash & Bank         / Credit <revenue split>
 *   apply credit:         Debit 2500 Customer Deposits    / Credit <revenue split>
 *
 * `amountCents` is what was actually paid this time (full or partial). When it is
 * less than the invoice's remaining balance, revenue is recognised proportionally
 * across the lines so a partial payment never over- or under-books any account.
 *
 * Idempotent on (referenceType, transactionId). Non-throwing: a GL hiccup must
 * never undo a payment that already moved money.
 */
export async function postInvoicePaymentJournalEntry(args: {
  businessId: string;
  invoiceId: string;
  transactionId: string;
  amountCents: number;
  debitCode: '1100' | '2500';
  referenceType: 'payment' | 'account_credit_application';
  description: string;
}): Promise<void> {
  const { businessId, invoiceId, transactionId, amountCents, debitCode, referenceType, description } = args;
  try {
    if (amountCents <= 0) return;
    if (await alreadyPosted(referenceType, transactionId)) return;

    // Load the invoice total + its lines (classified) to split revenue.
    const { rows: invRows } = await adminPool.query(
      `SELECT total_cents, tax_cents FROM pay_invoices WHERE id = $1 AND business_id = $2`,
      [invoiceId, businessId],
    );
    const invoice = invRows[0];
    if (!invoice) {
      logger.warn(`Invoice payment journal: invoice ${invoiceId} not found; skipping GL post for txn ${transactionId}`);
      return;
    }

    const { rows: lineRows } = await adminPool.query(
      `SELECT item_type, amount_cents, tax_cents FROM pay_invoice_line_items WHERE invoice_id = $1`,
      [invoiceId],
    );

    // Build the full-invoice revenue split, then scale to the amount actually paid
    // (handles partial payments). If scaling leaves a rounding remainder, drop it
    // on the largest line so credits still sum exactly to amountCents.
    const fullLines = lineRows.map((r) => ({
      itemType: r.item_type as string, amountCents: r.amount_cents as number, taxCents: r.tax_cents as number,
    }));
    let creditLines = buildRevenueCreditLines(fullLines);

    const fullTotal = sumCreditLines(creditLines);
    if (fullTotal <= 0) {
      logger.warn(`Invoice payment journal: invoice ${invoiceId} has no positive revenue lines; skipping GL post for txn ${transactionId}`);
      return;
    }

    if (amountCents !== fullTotal) {
      // Proportional recognition for a partial (or rounding-mismatched) payment.
      const scaled = creditLines.map((l) => ({
        ...l, amountCents: Math.round((l.amountCents * amountCents) / fullTotal),
      })).filter((l) => l.amountCents > 0);
      // Fix any rounding drift so the entry balances exactly.
      const drift = amountCents - sumCreditLines(scaled);
      if (scaled.length > 0 && drift !== 0) {
        const biggest = scaled.reduce((a, b) => (b.amountCents > a.amountCents ? b : a), scaled[0]);
        biggest.amountCents += drift;
      }
      creditLines = scaled;
    }

    const codes = [debitCode, ...creditLines.map((l) => l.code)];
    const accounts = await accountIds(businessId, Array.from(new Set(codes)));
    const debitId = accounts.get(debitCode);
    if (!debitId) {
      logger.warn(`Invoice payment journal: debit account ${debitCode} not seeded for business ${businessId}; skipping GL post for txn ${transactionId}`);
      return;
    }

    const lines: Array<{ account_id: string; debit: number; credit: number; description?: string }> = [
      { account_id: debitId, debit: amountCents, credit: 0, description },
    ];
    for (const cl of creditLines) {
      const accId = accounts.get(cl.code);
      if (!accId) {
        logger.warn(`Invoice payment journal: revenue account ${cl.code} not seeded for business ${businessId}; skipping GL post for txn ${transactionId}`);
        return;
      }
      lines.push({ account_id: accId, debit: 0, credit: cl.amountCents, description: cl.description });
    }

    await journal.createEntry({
      businessId,
      entryDate: await postingDate(businessId),
      description,
      referenceType,
      referenceId: transactionId,
      lines,
    });
  } catch (e: any) {
    logger.warn(`Invoice payment journal: failed to post GL entry for txn ${transactionId}: ${e?.message || e}`);
  }
}
