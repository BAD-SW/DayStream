import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Sales by Staff report — order line items attributed to the staff member
 * credited with the sale (fin_order_items.credited_to). One row per line item.
 *
 * Lines with no credited staff (e.g. an unattributed walk-in sale) are labeled
 * "Unattributed" so they still appear and count toward totals. Amounts are
 * pre-tax (gross − discount), consistent with Sales by Item; tax has its own
 * report. Group by Staff for the "who sold how much" view.
 *
 * Uses adminPool scoped by business_id, matching the other financial reports.
 */
export const salesByStaffReport: ReportDefinition = {
  id: 'sales-by-staff',
  title: 'Sales by Staff',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'staff', header: 'Staff', type: 'text', filterable: true, groupable: true },
    { key: 'order_number', header: 'Order', type: 'text', filterable: true, link: { to: 'order', idKey: 'order_id' } },
    { key: 'item', header: 'Item', type: 'text', filterable: true },
    { key: 'quantity', header: 'Qty', type: 'number', total: true },
    { key: 'gross', header: 'Gross', type: 'currency', total: true },
    { key: 'discount', header: 'Discount', type: 'currency', total: true },
    { key: 'net', header: 'Net', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT o.completed_at::date AS entry_date,
              COALESCE(
                NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                'Unattributed'
              ) AS staff,
              o.order_number,
              o.id AS order_id,
              CASE
                WHEN oi.variant_name IS NOT NULL AND oi.variant_name <> ''
                  THEN oi.item_name || ' — ' || oi.variant_name
                ELSE oi.item_name
              END AS item,
              oi.quantity,
              (oi.unit_price * oi.quantity)::int AS gross,
              oi.discount_amount::int AS discount,
              (oi.unit_price * oi.quantity - oi.discount_amount)::int AS net
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
         LEFT JOIN usr_users u ON u.id = oi.credited_to
        WHERE o.business_id = $1
          AND o.status = 'completed'
          AND o.completed_at::date BETWEEN $2::date AND $3::date
        ORDER BY o.completed_at DESC, staff, o.order_number`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
