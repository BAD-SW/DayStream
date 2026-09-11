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
 */
export const taxSummaryReport: ReportDefinition = {
  id: 'tax-summary',
  title: 'Tax Summary',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'order_number', header: 'Order', type: 'text', filterable: true },
    { key: 'item', header: 'Item', type: 'text', filterable: true },
    { key: 'tax_category', header: 'Tax Category', type: 'text', filterable: true, groupable: true },
    { key: 'rate', header: 'Rate', type: 'percent', filterable: true },
    { key: 'taxable_amount', header: 'Taxable Amount', type: 'currency', total: true },
    { key: 'tax_collected', header: 'Tax Collected', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT o.completed_at::date AS entry_date,
              o.order_number,
              oi.item_name AS item,
              COALESCE(tc.name, '—') AS tax_category,
              -- basis points -> percent for display (percent column type expects a percent number)
              ROUND(oi.tax_rate / 100.0, 2) AS rate,
              (oi.total_price - oi.tax_amount)::int AS taxable_amount,
              oi.tax_amount::int AS tax_collected
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
         LEFT JOIN svc_tax_categories tc ON tc.id = oi.tax_category_id
        WHERE o.business_id = $1
          AND o.status = 'completed'
          AND oi.tax_amount > 0
          AND o.completed_at::date BETWEEN $2::date AND $3::date
        ORDER BY o.completed_at DESC, o.order_number`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
