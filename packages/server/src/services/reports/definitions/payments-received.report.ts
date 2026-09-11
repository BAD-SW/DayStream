import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Payments Received report — all money in/out for a business in a date range.
 *
 * Unions two disjoint payment sources (they never cross-populate):
 *   - Completed checkout/POS orders (fin_orders + customer)
 *   - Manually-recorded payment ledger entries (pay_transactions + customer)
 *
 * Refunds are shown as separate rows with negative amounts so they net
 * into the total. Credits from pay_transactions are included and also negate.
 *
 * When recurring membership billing (Phase 10) goes live, those charges will
 * land in one of these two tables and appear automatically.
 *
 * Uses adminPool scoped explicitly by business_id, matching the other
 * financial report definitions.
 */
export const paymentsReceivedReport: ReportDefinition = {
  id: 'payments-received',
  title: 'Payments Received',
  columns: [
    { key: 'received_date', header: 'Date', type: 'date', filterable: true },
    { key: 'source', header: 'Source', type: 'text', filterable: true, groupable: true },
    { key: 'method', header: 'Method', type: 'text', filterable: true, groupable: true },
    { key: 'customer', header: 'Customer', type: 'text', filterable: true },
    { key: 'reference', header: 'Reference', type: 'text', filterable: true },
    { key: 'payment_type', header: 'Type', type: 'text', filterable: true, groupable: true },
    { key: 'amount', header: 'Amount', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `
      -- Checkout / POS completed orders
      SELECT
        o.completed_at::date AS received_date,
        'Checkout' AS source,
        INITCAP(REPLACE(o.payment_method, '_', ' ')) AS method,
        CASE
          WHEN c.id IS NULL THEN '—'
          ELSE TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
               || ' (' || c.reference_number || ')'
        END AS customer,
        o.order_number AS reference,
        'Payment' AS payment_type,
        o.total_amount::int AS amount,
        o.completed_at AS sort_ts

      FROM fin_orders o
      LEFT JOIN cus_customers c ON c.id = o.customer_id
      WHERE o.business_id = $1
        AND o.status = 'completed'
        AND o.completed_at::date BETWEEN $2::date AND $3::date

      UNION ALL

      -- Manual / recorded payment ledger entries (charges, refunds, credits)
      SELECT
        t.created_at::date AS received_date,
        'Recorded' AS source,
        INITCAP(REPLACE(t.payment_method, '_', ' ')) AS method,
        TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
          || ' (' || c.reference_number || ')' AS customer,
        COALESCE(t.reference_number, '') AS reference,
        CASE t.type
          WHEN 'charge' THEN 'Payment'
          WHEN 'refund' THEN 'Refund'
          WHEN 'credit' THEN 'Credit'
        END AS payment_type,
        CASE WHEN t.type = 'charge' THEN t.amount ELSE -(t.amount) END::int AS amount,
        t.created_at AS sort_ts

      FROM pay_transactions t
      JOIN cus_customers c ON c.id = t.customer_id
      WHERE t.business_id = $1
        AND t.status = 'completed'
        AND t.created_at::date BETWEEN $2::date AND $3::date

      ORDER BY sort_ts DESC
      `,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows.map(({ sort_ts, ...rest }) => rest);
  },
};
