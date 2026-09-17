import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Discounts & Promotions report — order line items that carried a discount,
 * showing which promotion drove it and how much was given up.
 *
 * A line's discount comes from fin_order_items.discount_amount (positive =
 * discount; negative = surcharge/premium, shown so it's visible). The driving
 * promotion is attributed from the order's promotion (prm_promotions.name /
 * promo_code); lines discounted without a promotion on the order are labeled
 * "Manual". Group by Promotion to see the cost of each promo.
 *
 * Amounts are pre-tax. Uses adminPool scoped by business_id, matching the other
 * financial reports.
 */
export const discountsPromotionsReport: ReportDefinition = {
  id: 'discounts-promotions',
  title: 'Discounts & Promotions',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'order_number', header: 'Order', type: 'text', filterable: true, link: { to: 'order', idKey: 'order_id' } },
    { key: 'promotion', header: 'Promotion', type: 'text', filterable: true, groupable: true },
    { key: 'item', header: 'Item', type: 'text', filterable: true },
    { key: 'gross', header: 'Gross', type: 'currency', total: true },
    { key: 'discount', header: 'Discount', type: 'currency', total: true },
    { key: 'net', header: 'Net', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT o.completed_at::date AS entry_date,
              o.order_number,
              o.id AS order_id,
              COALESCE(p.name, o.promo_code, 'Manual') AS promotion,
              CASE
                WHEN oi.variant_name IS NOT NULL AND oi.variant_name <> ''
                  THEN oi.item_name || ' — ' || oi.variant_name
                ELSE oi.item_name
              END AS item,
              (oi.unit_price * oi.quantity)::int AS gross,
              oi.discount_amount::int AS discount,
              (oi.unit_price * oi.quantity - oi.discount_amount)::int AS net
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
         LEFT JOIN prm_promotions p ON p.id = o.promotion_id
        WHERE o.business_id = $1
          AND o.status = 'completed'
          AND oi.discount_amount <> 0
          AND o.completed_at::date BETWEEN $2::date AND $3::date
        ORDER BY o.completed_at DESC, o.order_number`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
