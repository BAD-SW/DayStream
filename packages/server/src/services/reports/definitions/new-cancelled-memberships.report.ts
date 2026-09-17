import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * New & Cancelled Memberships report — membership churn over the date range.
 *
 * One row per enrollment that had a start and/or a cancellation within the
 * range. The Event column classifies each:
 *   - New              : started in range (cancel date null)
 *   - Cancelled        : cancelled in range (started earlier)
 *   - New & Cancelled  : both start and cancellation fell in the range
 *
 * "New" is detected by start_date in range; "Cancelled" by cancelled_at in
 * range (cancellation sets cancelled_at, NOT status — so status is not used to
 * identify cancellations). Price comes from the plan.
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const newCancelledMembershipsReport: ReportDefinition = {
  id: 'new-cancelled-memberships',
  title: 'New & Cancelled Memberships',
  columns: [
    { key: 'event', header: 'Event', type: 'text', filterable: true, groupable: true },
    { key: 'customer', header: 'Customer', type: 'text', filterable: true, link: { to: 'customer', idKey: 'customer_id' } },
    { key: 'plan', header: 'Plan', type: 'text', filterable: true, groupable: true },
    { key: 'start_date', header: 'Start Date', type: 'date', filterable: true },
    { key: 'cancel_date', header: 'Cancel Date', type: 'date', filterable: true },
    { key: 'price', header: 'Price', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT CASE
                WHEN e.start_date BETWEEN $2::date AND $3::date
                     AND e.cancelled_at::date BETWEEN $2::date AND $3::date THEN 'New & Cancelled'
                WHEN e.start_date BETWEEN $2::date AND $3::date THEN 'New'
                ELSE 'Cancelled'
              END AS event,
              TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
                || ' (' || c.reference_number || ')' AS customer,
              c.id AS customer_id,
              p.name AS plan,
              e.start_date,
              -- Only show a cancel date when the cancellation is what's being reported
              CASE WHEN e.cancelled_at::date BETWEEN $2::date AND $3::date
                   THEN e.cancelled_at::date ELSE NULL END AS cancel_date,
              p.price::int AS price
         FROM mbr_enrollments e
         JOIN mbr_plans p ON p.id = e.plan_id
         JOIN cus_customers c ON c.id = e.customer_id
        WHERE e.business_id = $1
          AND (
            e.start_date BETWEEN $2::date AND $3::date
            OR e.cancelled_at::date BETWEEN $2::date AND $3::date
          )
        ORDER BY COALESCE(e.cancelled_at::date, e.start_date) DESC`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
