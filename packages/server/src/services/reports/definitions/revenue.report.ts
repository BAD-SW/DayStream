import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Revenue report — POSTED (recognized) revenue at transaction grain, presented
 * for a business owner rather than as a raw ledger dump.
 *
 * Recognition rules live in the posting process, not here. This report reflects
 * what has actually been posted as revenue:
 *
 *   - Service and product revenue: one row per posted order line (real date,
 *     item name, and customer from the order).
 *   - Recognized membership/package revenue: one row per enrollment that has
 *     recognized revenue, attributed to its customer and plan. Amount is the
 *     cumulative recognized amount; date is the last recognition date. (Per-day
 *     recognition history is not persisted, so recognized rows are at enrollment
 *     grain, not per-day.)
 *
 * Customer is shown as "First Last (REF)". Money stays in cents. Uses adminPool
 * scoped explicitly by business_id, matching the other financial reports.
 */
export const revenueReport: ReportDefinition = {
  id: 'revenue',
  title: 'Revenue',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'revenue_type', header: 'Revenue Type', type: 'text', filterable: true, groupable: true },
    { key: 'item', header: 'Item', type: 'text', filterable: true },
    { key: 'customer', header: 'Customer', type: 'text', filterable: true },
    { key: 'amount', header: 'Amount', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `
      -- Service & product revenue: posted order line items in range
      SELECT o.completed_at::date AS entry_date,
             CASE oi.item_type
               WHEN 'service' THEN 'Service Revenue'
               WHEN 'product' THEN 'Product Revenue'
               ELSE INITCAP(oi.item_type) || ' Revenue'
             END AS revenue_type,
             oi.item_name AS item,
             CASE
               WHEN c.id IS NULL THEN '—'
               ELSE TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
                    || ' (' || c.reference_number || ')'
             END AS customer,
             (oi.total_price)::int AS amount,
             o.completed_at AS sort_ts
        FROM fin_order_items oi
        JOIN fin_orders o ON o.id = oi.order_id
        LEFT JOIN cus_customers c ON c.id = o.customer_id
       WHERE o.business_id = $1
         AND o.status = 'completed'
         AND oi.item_type IN ('service', 'product')
         AND o.completed_at::date BETWEEN $2::date AND $3::date

      UNION ALL

      -- Recognized membership/package revenue: per enrollment, attributed to customer + plan
      SELECT rr.last_recognized_date AS entry_date,
             'Membership Revenue' AS revenue_type,
             p.name AS item,
             TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
               || ' (' || c.reference_number || ')' AS customer,
             (rr.amount_recognized)::int AS amount,
             rr.last_recognized_date::timestamptz AS sort_ts
        FROM fin_revenue_recognized rr
        JOIN mbr_enrollments e ON e.id = rr.enrollment_id
        JOIN mbr_plans p ON p.id = e.plan_id
        JOIN cus_customers c ON c.id = e.customer_id
       WHERE rr.business_id = $1
         AND rr.amount_recognized > 0
         AND rr.last_recognized_date BETWEEN $2::date AND $3::date

      ORDER BY sort_ts DESC, revenue_type
      `,
      [ctx.businessId, ctx.start, ctx.end],
    );
    // Drop the sort helper before returning report rows.
    return rows.map(({ sort_ts, ...rest }) => rest);
  },
};
