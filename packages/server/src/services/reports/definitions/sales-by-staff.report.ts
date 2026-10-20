import { reportDb } from '../lib/report-db';
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
 * Refunds (David, D-44): a sale stays on its own date at full value; each refunded
 * line is its own negative row (Entry "Refund") on the day of the refund, credited
 * to the same staff member, so their Net is what they sold minus what was returned.
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
    { key: 'entry', header: 'Entry', type: 'text', filterable: true, groupable: true },
    { key: 'quantity', header: 'Qty', type: 'number', total: true },
    { key: 'gross', header: 'Gross', type: 'currency', total: true },
    { key: 'discount', header: 'Discount', type: 'currency', total: true },
    { key: 'refunds', header: 'Refunds', type: 'currency', total: true },
    { key: 'net', header: 'Net', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await reportDb.query(
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
              'Sale' AS entry,
              oi.quantity,
              (oi.unit_price * oi.quantity)::int AS gross,
              oi.discount_amount::int AS discount,
              0 AS refunds,
              (oi.unit_price * oi.quantity - oi.discount_amount)::int AS net,
              o.completed_at AS sort_ts
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
         LEFT JOIN usr_users u ON u.id = oi.credited_to
        WHERE o.business_id = $1
          AND o.status IN ('completed', 'partially_refunded', 'refunded')
          AND o.completed_at::date BETWEEN $2::date AND $3::date

        UNION ALL

        -- Refunded lines (pre-tax), on the day of the refund.
        SELECT rl.created_at::date AS entry_date,
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
               'Refund' AS entry,
               -rl.quantity AS quantity,
               0 AS gross,
               0 AS discount,
               -rl.revenue_cents AS refunds,
               -rl.revenue_cents AS net,
               rl.created_at AS sort_ts
          FROM pay_order_refund_lines rl
          JOIN fin_order_items oi ON oi.id = rl.order_item_id
          JOIN fin_orders o ON o.id = rl.order_id
          LEFT JOIN usr_users u ON u.id = oi.credited_to
         WHERE rl.business_id = $1
           AND rl.created_at::date BETWEEN $2::date AND $3::date
        ORDER BY sort_ts DESC, staff, order_number`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows.map(({ sort_ts, ...rest }) => rest);
  },
};
