import { reportDb } from '../lib/report-db';
import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Sales by Item report — one row per order line item sold (gross sales view).
 *
 * A checkout with three items produces three rows. Shows what was sold at point
 * of sale (all item types at their full sale price), NOT recognized revenue —
 * that's the Revenue report. Amounts are pre-tax; tax has its own report.
 *
 * For items with a variant, the variant is folded into the Item label
 * ("Essence — 50ml"). Since there is no inventory module, variant-level sales
 * lets an owner reconcile stock/purchase orders against units sold; grouping by
 * Item keeps each variant as its own group.
 *
 *   Gross    = unit_price * quantity
 *   Discount = discount_amount (surcharges appear as negative discounts)
 *   Tax      = tax_amount (as charged on the line)
 *   Net      = gross - discount + tax  (equals total_price, i.e. tax-INCLUSIVE)
 *
 * Net is the full as-charged line total (tax included), so it ties to the order
 * total and to the Reconciliation report's tax-inclusive Sales. The separate Tax
 * column lets an owner derive the pre-tax figure (Net − Tax) if they want it.
 *
 * Uses adminPool scoped by business_id, matching the other financial reports.
 */
export const salesByItemReport: ReportDefinition = {
  id: 'sales-by-item',
  title: 'Sales by Item',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'order_number', header: 'Order', type: 'text', filterable: true, link: { to: 'order', idKey: 'order_id' } },
    { key: 'item', header: 'Item', type: 'text', filterable: true, groupable: true },
    { key: 'item_type', header: 'Type', type: 'text', filterable: true, groupable: true },
    { key: 'quantity', header: 'Qty', type: 'number', total: true },
    { key: 'gross', header: 'Gross', type: 'currency', total: true },
    { key: 'discount', header: 'Discount', type: 'currency', total: true },
    { key: 'tax', header: 'Tax', type: 'currency', total: true },
    { key: 'net', header: 'Net', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await reportDb.query(
      `SELECT o.completed_at::date AS entry_date,
              o.order_number,
              o.id AS order_id,
              CASE
                WHEN oi.variant_name IS NOT NULL AND oi.variant_name <> ''
                  THEN oi.item_name || ' — ' || oi.variant_name
                ELSE oi.item_name
              END AS item,
              INITCAP(oi.item_type) AS item_type,
              oi.quantity,
              (oi.unit_price * oi.quantity)::int AS gross,
              oi.discount_amount::int AS discount,
              oi.tax_amount::int AS tax,
              (oi.unit_price * oi.quantity - oi.discount_amount + oi.tax_amount)::int AS net,
              o.completed_at AS sort_ts
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
        WHERE o.business_id = $1
          AND o.status = 'completed'
          AND o.completed_at::date BETWEEN $2::date AND $3::date

        UNION ALL

        -- Membership renewals: a sale collected automatically, with no checkout
        -- order/line. Synthesize one row per completed renewal charge so renewals
        -- count as sales here too (and this report's Net total ties to the
        -- Reconciliation report's Sales). No order link, so Order is blank.
        SELECT t.created_at::date AS entry_date,
               '' AS order_number,
               NULL::uuid AS order_id,
               COALESCE(NULLIF(t.description, ''), 'Membership renewal') AS item,
               'Membership' AS item_type,
               1 AS quantity,
               t.amount::int AS gross,
               0 AS discount,
               0 AS tax,
               t.amount::int AS net,
               t.created_at AS sort_ts
          FROM pay_transactions t
         WHERE t.business_id = $1 AND t.status = 'completed' AND t.type = 'charge'
           AND t.order_id IS NULL AND t.enrollment_id IS NOT NULL
           AND t.created_at::date BETWEEN $2::date AND $3::date

        ORDER BY sort_ts DESC, order_number, item`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows.map(({ sort_ts, ...rest }) => rest);
  },
};
