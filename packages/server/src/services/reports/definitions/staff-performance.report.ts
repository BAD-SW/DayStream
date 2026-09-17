import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Staff Performance report — one row per staff member of the business, with
 * their booking activity and the revenue attributed to them over the range.
 *
 * Staff list: driven from usr_users (business persona, active) scoped by
 * business_id, so the WHOLE active team appears — a member with no activity in
 * the range shows zeros, which is itself meaningful for a performance view.
 *
 * Booking metrics come from apt_bookings.staff_id, counted by status within the
 * range (on start_time, the appointment date). Completion Rate = completed ÷
 * booked.
 *
 * Three distinct, non-overlapping revenue figures:
 *   - Service Revenue: pre-tax price of the staff member's COMPLETED bookings.
 *     Booking price is stored tax-inclusive, so tax is backed out (matching the
 *     Cancellations & No-Shows report's treatment).
 *   - Product Revenue: net (unit_price*qty − discount) of service/product order
 *     line items credited to the staff member on completed orders — retail/POS
 *     sales rung up under their name.
 *   - No-Show Fees: net of no_show_fee line items credited to them. A no-show
 *     fee posts as a completed order line credited to the booking's staff, so it
 *     lives in the same order-items stream as product sales; splitting by
 *     item_type keeps Product Revenue clean and no-show fees visible on their
 *     own, with no double-count.
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const staffPerformanceReport: ReportDefinition = {
  id: 'staff-performance',
  title: 'Staff Performance',
  columns: [
    { key: 'staff', header: 'Staff', type: 'text', filterable: true },
    { key: 'role', header: 'Role', type: 'text', filterable: true, groupable: true },
    { key: 'booked', header: 'Booked', type: 'number', total: true },
    { key: 'completed', header: 'Completed', type: 'number', total: true },
    { key: 'cancelled', header: 'Cancelled', type: 'number', total: true },
    { key: 'no_show', header: 'No-Show', type: 'number', total: true },
    { key: 'completion_rate', header: 'Completion Rate', type: 'percent' },
    { key: 'service_revenue', header: 'Service Revenue', type: 'currency', total: true },
    { key: 'product_revenue', header: 'Product Revenue', type: 'currency', total: true },
    { key: 'no_show_fees', header: 'No-Show Fees', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `WITH bookings AS (
         SELECT b.staff_id,
                COUNT(*)::int AS booked,
                COUNT(*) FILTER (WHERE b.status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
                COUNT(*) FILTER (WHERE b.status = 'no_show')::int AS no_show,
                -- Booking price is stored tax-inclusive; back out tax so service
                -- revenue is pre-tax. Rate is in basis points (e.g. 2000 = 20%).
                COALESCE(SUM(
                  CASE WHEN b.status = 'completed'
                       THEN ROUND(b.price / (1 + COALESCE(tc.rate, 0) / 10000.0))
                       ELSE 0 END
                ), 0)::int AS service_revenue
           FROM apt_bookings b
           LEFT JOIN svc_services s ON s.id = b.service_id
           LEFT JOIN svc_tax_categories tc ON tc.id = s.tax_category_id
          WHERE b.business_id = $1
            AND b.staff_id IS NOT NULL
            AND b.start_time::date BETWEEN $2::date AND $3::date
          GROUP BY b.staff_id
       ),
       sales AS (
         SELECT oi.credited_to AS staff_id,
                COALESCE(SUM(
                  CASE WHEN oi.item_type IN ('service', 'product')
                       THEN oi.unit_price * oi.quantity - oi.discount_amount
                       ELSE 0 END
                ), 0)::int AS product_revenue,
                COALESCE(SUM(
                  CASE WHEN oi.item_type = 'no_show_fee'
                       THEN oi.unit_price * oi.quantity - oi.discount_amount
                       ELSE 0 END
                ), 0)::int AS no_show_fees
           FROM fin_order_items oi
           JOIN fin_orders o ON o.id = oi.order_id
          WHERE o.business_id = $1
            AND o.status = 'completed'
            AND oi.credited_to IS NOT NULL
            AND o.completed_at::date BETWEEN $2::date AND $3::date
          GROUP BY oi.credited_to
       )
       SELECT TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS staff,
              INITCAP(REPLACE(u.role, '_', ' ')) AS role,
              COALESCE(bk.booked, 0) AS booked,
              COALESCE(bk.completed, 0) AS completed,
              COALESCE(bk.cancelled, 0) AS cancelled,
              COALESCE(bk.no_show, 0) AS no_show,
              CASE WHEN COALESCE(bk.booked, 0) > 0
                   THEN ROUND(bk.completed::numeric / bk.booked * 100, 1)
                   ELSE 0 END AS completion_rate,
              COALESCE(bk.service_revenue, 0) AS service_revenue,
              COALESCE(sa.product_revenue, 0) AS product_revenue,
              COALESCE(sa.no_show_fees, 0) AS no_show_fees
         FROM usr_users u
         LEFT JOIN bookings bk ON bk.staff_id = u.id
         LEFT JOIN sales sa ON sa.staff_id = u.id
        WHERE u.business_id = $1
          AND u.persona = 'business'
          AND u.status = 'active'
        ORDER BY COALESCE(bk.service_revenue, 0) + COALESCE(sa.product_revenue, 0)
                 + COALESCE(sa.no_show_fees, 0) DESC,
                 u.last_name, u.first_name`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
