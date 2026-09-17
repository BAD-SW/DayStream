import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Active Memberships report — a point-in-time snapshot of current memberships.
 *
 * "Active" is defined against the live enrollment model (mbr_enrollments):
 * cancelled_at IS NULL and status IN ('active','paused'). NOTE: cancellation
 * sets cancelled_at but does NOT change status, so cancelled memberships are
 * excluded via cancelled_at, not status. Paused memberships are included (still
 * members, just frozen) and distinguished by the Status column.
 *
 * This is a snapshot as of "now" — the date range is not applied (a membership
 * is either currently active or not). Price comes from the plan (enrollments
 * carry no price of their own). Lapsed periods are not auto-expired, so a row
 * whose Current Period End is in the past still appears; the column makes that
 * visible.
 *
 * LTV = recognized membership revenue to date for that CUSTOMER, summed across
 * ALL of their enrollments (so a long-tenured member who paused still shows
 * their accumulated membership value). Pre-tax, from fin_revenue_recognized.
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const activeMembershipsReport: ReportDefinition = {
  id: 'active-memberships',
  title: 'Active Memberships',
  columns: [
    { key: 'customer', header: 'Customer', type: 'text', filterable: true, link: { to: 'customer', idKey: 'customer_id' } },
    { key: 'plan', header: 'Plan', type: 'text', filterable: true, groupable: true },
    { key: 'status', header: 'Status', type: 'text', filterable: true, groupable: true },
    { key: 'billing', header: 'Billing', type: 'text', filterable: true },
    { key: 'start_date', header: 'Start Date', type: 'date', filterable: true },
    { key: 'current_period_end', header: 'Current Period End', type: 'date', filterable: true },
    { key: 'next_billing', header: 'Next Billing', type: 'date', filterable: true },
    { key: 'price', header: 'Price', type: 'currency', total: true },
    { key: 'ltv', header: 'LTV', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
                || ' (' || c.reference_number || ')' AS customer,
              c.id AS customer_id,
              p.name AS plan,
              INITCAP(e.status) AS status,
              INITCAP(p.billing_frequency) AS billing,
              e.start_date,
              e.current_period_end,
              e.next_billing_date AS next_billing,
              p.price::int AS price,
              COALESCE((
                SELECT SUM(rr.amount_recognized)
                  FROM fin_revenue_recognized rr
                  JOIN mbr_enrollments e2 ON e2.id = rr.enrollment_id
                 WHERE e2.customer_id = e.customer_id AND e2.business_id = e.business_id
              ), 0)::int AS ltv
         FROM mbr_enrollments e
         JOIN mbr_plans p ON p.id = e.plan_id
         JOIN cus_customers c ON c.id = e.customer_id
        WHERE e.business_id = $1
          AND e.cancelled_at IS NULL
          AND e.status IN ('active', 'paused')
        ORDER BY c.last_name, c.first_name`,
      [ctx.businessId],
    );
    return rows;
  },
};
