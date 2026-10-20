import { reportDb } from '../lib/report-db';
import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Tax Summary report — sales tax collected on completed orders, in a date range.
 *
 * Reads the tax category and rate AS CHARGED, stored on each order line at
 * checkout time (fin_order_items.tax_category_id / tax_rate), rather than
 * re-deriving from the item's current category. This makes the report accurate
 * for audit: it reflects what was actually charged on each sale, even if the
 * item's category later changed or the item was deleted.
 *
 * Taxable amount is the net the tax was applied to (total_price − tax_amount).
 * Rate is stored in basis points; shown as a percent. Only lines with tax
 * collected appear. Uses adminPool scoped by business_id, matching the other
 * financial reports.
 *
 * Refunds (David, D-44): a sale keeps its tax on its own date; the tax given back
 * on a refunded line is its own negative row (Entry "Refund") on the day of the
 * refund, the way a correcting invoice (factura rectificativa) is declared in the
 * period of the refund.
 */
export const taxSummaryReport: ReportDefinition = {
  id: 'tax-summary',
  title: 'Tax Summary',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'order_number', header: 'Order', type: 'text', filterable: true, link: { to: 'order', idKey: 'order_id' } },
    { key: 'item', header: 'Item', type: 'text', filterable: true },
    { key: 'entry', header: 'Entry', type: 'text', filterable: true, groupable: true },
    { key: 'tax_category', header: 'Tax Category', type: 'text', filterable: true, groupable: true },
    { key: 'rate', header: 'Rate', type: 'percent', filterable: true },
    { key: 'taxable_amount', header: 'Taxable Amount', type: 'currency', total: true },
    { key: 'tax_collected', header: 'Tax Collected', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await reportDb.query(
      `SELECT o.completed_at::date AS entry_date,
              o.order_number,
              o.id AS order_id,
              oi.item_name AS item,
              'Sale' AS entry,
              COALESCE(tc.name, '—') AS tax_category,
              -- basis points -> percent for display (percent column type expects a percent number)
              ROUND(oi.tax_rate / 100.0, 2) AS rate,
              (oi.total_price - oi.tax_amount)::int AS taxable_amount,
              oi.tax_amount::int AS tax_collected,
              o.completed_at AS sort_ts
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
         LEFT JOIN svc_tax_categories tc ON tc.id = oi.tax_category_id
        WHERE o.business_id = $1
          AND o.status IN ('completed', 'partially_refunded', 'refunded')
          AND oi.tax_amount > 0
          AND o.completed_at::date BETWEEN $2::date AND $3::date

        UNION ALL

        -- Tax given back on refunded lines, on the day of the refund.
        SELECT rl.created_at::date AS entry_date,
               o.order_number,
               o.id AS order_id,
               oi.item_name AS item,
               'Refund' AS entry,
               COALESCE(tc.name, '—') AS tax_category,
               ROUND(oi.tax_rate / 100.0, 2) AS rate,
               -rl.revenue_cents AS taxable_amount,
               -rl.tax_cents AS tax_collected,
               rl.created_at AS sort_ts
          FROM pay_order_refund_lines rl
          JOIN fin_order_items oi ON oi.id = rl.order_item_id
          JOIN fin_orders o ON o.id = rl.order_id
          LEFT JOIN svc_tax_categories tc ON tc.id = oi.tax_category_id
         WHERE rl.business_id = $1
           AND rl.tax_cents > 0
           AND rl.created_at::date BETWEEN $2::date AND $3::date
        ORDER BY sort_ts DESC, order_number`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows.map(({ sort_ts, ...rest }) => rest);
  },
};
