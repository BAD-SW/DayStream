import { reportDb } from '../lib/report-db';
import { ReportDefinition } from '../types';

/**
 * Reconciliation report (Accounting).
 *
 * REBUILD IN PROGRESS: cleared to a bare date spine. We are rebuilding this
 * report column by column, defining precisely what drives each column before
 * adding it. The goal is to give a business owner confidence in the reported
 * financial numbers.
 *
 * Columns defined so far:
 *   - Date
 *   - Sales
 *   - Payments
 *   - GL Credits
 *   - GL Debits
 *
 * GL CREDITS / GL DEBITS — proof the general ledger is balanced for the day. Each
 *   is the sum of ALL journal-entry LINES for the business on that entry_date
 *   (non-void): GL Credits = SUM(credit), GL Debits = SUM(debit), across every
 *   account. By the nature of double-entry, these two MUST be equal every day — a
 *   difference would mean an unbalanced posting. This is the "the books tie to
 *   themselves" check.
 *
 * PAYMENTS — all successful payments taken, net of refunds, per business-local
 *   day, EXCLUDING the methods gift_card, other, and account_credit (a gift-card
 *   redemption and an account-credit application are not new cash; 'other' is
 *   excluded by request). Driven by:
 *   (a) completed ORDERS (fin_orders): + total_amount where payment_method is not
 *       in the excluded set, dated by completed_at. (One row per order — the order
 *       carries its own tender method.)
 *   (b) completed NON-ORDER pay_transactions (order_id IS NULL): + amount for
 *       charges, − amount for refunds, same method exclusions, dated by created_at.
 *   Order payments come from fin_orders and non-order payments from
 *   pay_transactions so an order payment is never double-counted. A refund on an
 *   excluded method is likewise excluded (consistent).
 *
 * SALES — everything rung up, per business-local day. No line-type exclusions, so
 *   it matches the Sales by Item report ("what was sold at the till"). Driven by:
 *   (a) ALL completed-order LINE ITEMS — service, product, membership, package,
 *       no_show_fee, AND gift_card. Amount is the line's tax-INCLUSIVE total_price
 *       (unit*qty − discount + tax). Dated by the order's completed_at.
 *   (b) completed MEMBERSHIP RENEWAL charges — enrollment-linked, order-less
 *       pay_transactions charges. A renewal is a sale (another period bought); it
 *       just doesn't create a checkout order. Dated by the charge's created_at.
 *   NOTE: a gift-card sale is included in Sales here, but it posts to the Gift Card
 *   Liability (2600) in the GL, not revenue — so when later columns tie Sales to the
 *   ledger, gift-card sales are "sales, not revenue" and will be a named reconciling
 *   item rather than an exclusion.
 *
 * Money is in cents. Runs on the business clock (dates are business-local).
 */
export const reconciliationReport: ReportDefinition = {
  id: 'reconciliation',
  title: 'Reconciliation',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'sales', header: 'Sales', type: 'currency', total: true },
    { key: 'payments', header: 'Payments', type: 'currency', total: true },
    { key: 'gl_credits', header: 'GL Credits', type: 'currency', total: true },
    { key: 'gl_debits', header: 'GL Debits', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await reportDb.query(
      `
      WITH
      -- SALES: order line items (excluding gift-card lines) + membership renewals.
      sales AS (
        SELECT d, SUM(amount)::int AS amount FROM (
          -- (a) ALL completed-order lines (no exclusions), tax-inclusive
          SELECT o.completed_at::date AS d, oi.total_price AS amount
            FROM fin_order_items oi
            JOIN fin_orders o ON o.id = oi.order_id
           WHERE o.business_id = $1 AND o.status = 'completed'
             AND o.completed_at::date BETWEEN $2::date AND $3::date
          UNION ALL
          -- (b) membership renewal charges (enrollment-linked, order-less)
          SELECT t.created_at::date AS d, t.amount AS amount
            FROM pay_transactions t
           WHERE t.business_id = $1 AND t.status = 'completed' AND t.type = 'charge'
             AND t.order_id IS NULL AND t.enrollment_id IS NOT NULL
             AND t.created_at::date BETWEEN $2::date AND $3::date
        ) s GROUP BY d
      ),
      -- PAYMENTS: order payments + non-order ledger payments, net of refunds,
      -- excluding gift_card / other / account_credit methods.
      payments AS (
        SELECT d, SUM(amount)::int AS amount FROM (
          -- (a) completed order payments (one row per order), excluded methods out
          SELECT o.completed_at::date AS d, o.total_amount AS amount
            FROM fin_orders o
           WHERE o.business_id = $1 AND o.status = 'completed'
             AND o.payment_method NOT IN ('gift_card', 'other', 'account_credit')
             AND o.completed_at::date BETWEEN $2::date AND $3::date
          UNION ALL
          -- (b) completed non-order ledger entries (charges +, refunds −)
          SELECT t.created_at::date AS d,
                 CASE WHEN t.type = 'charge' THEN t.amount ELSE -t.amount END AS amount
            FROM pay_transactions t
           WHERE t.business_id = $1 AND t.status = 'completed'
             AND t.order_id IS NULL
             AND t.payment_method NOT IN ('gift_card', 'other', 'account_credit')
             AND t.created_at::date BETWEEN $2::date AND $3::date
        ) p GROUP BY d
      ),
      -- GL CREDITS / GL DEBITS: sum of every non-void journal LINE for the day,
      -- across all accounts. By double-entry these two totals must be equal — the
      -- proof the ledger is balanced.
      glsides AS (
        SELECT je.entry_date AS d,
               SUM(jel.credit)::int AS credits,
               SUM(jel.debit)::int AS debits
          FROM fin_journal_entries je
          JOIN fin_journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.business_id = $1 AND je.is_void = false
           AND je.entry_date BETWEEN $2::date AND $3::date
         GROUP BY je.entry_date
      ),
      -- The date spine: every business-local day with any financial activity.
      activity_dates AS (
        SELECT o.completed_at::date AS d
          FROM fin_orders o
         WHERE o.business_id = $1 AND o.status = 'completed'
           AND o.completed_at::date BETWEEN $2::date AND $3::date
        UNION
        SELECT t.created_at::date AS d
          FROM pay_transactions t
         WHERE t.business_id = $1 AND t.status = 'completed'
           AND t.created_at::date BETWEEN $2::date AND $3::date
        UNION
        SELECT je.entry_date AS d
          FROM fin_journal_entries je
         WHERE je.business_id = $1 AND je.is_void = false
           AND je.entry_date BETWEEN $2::date AND $3::date
      )
      SELECT DISTINCT days.d AS entry_date,
             COALESCE(s.amount, 0) AS sales,
             COALESCE(p.amount, 0) AS payments,
             COALESCE(gl.credits, 0) AS gl_credits,
             COALESCE(gl.debits, 0) AS gl_debits
        FROM activity_dates days
        LEFT JOIN sales s ON s.d = days.d
        LEFT JOIN payments p ON p.d = days.d
        LEFT JOIN glsides gl ON gl.d = days.d
       ORDER BY entry_date DESC
      `,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
