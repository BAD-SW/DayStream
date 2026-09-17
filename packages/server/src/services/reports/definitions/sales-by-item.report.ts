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
 *   Net      = gross - discount  (equals total_price - tax_amount)
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
    { key: 'net', header: 'Net', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
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
              (oi.unit_price * oi.quantity - oi.discount_amount)::int AS net
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
        WHERE o.business_id = $1
          AND o.status = 'completed'
          AND o.completed_at::date BETWEEN $2::date AND $3::date
        ORDER BY o.completed_at DESC, o.order_number, oi.item_name`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
