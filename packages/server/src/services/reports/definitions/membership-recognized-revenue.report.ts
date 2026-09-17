import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Membership Recognized Revenue report — recognized membership revenue per
 * enrollment, attributed to customer and plan.
 *
 * Source is fin_revenue_recognized (the per-enrollment recognition tracking that
 * account 4200 Membership Revenue is posted from). NOTE: amount_recognized is a
 * cumulative running total per enrollment that the recognition process
 * overwrites each run — it is NOT per-period history. So this report shows
 * recognized-to-date per enrollment, filtered by last_recognized_date within the
 * range (the same approximation the main Revenue report makes). A true
 * per-period recognized-revenue report would require the recognition process to
 * persist per-period history.
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const membershipRecognizedRevenueReport: ReportDefinition = {
  id: 'membership-recognized-revenue',
  title: 'Membership Recognized Revenue',
  columns: [
    { key: 'customer', header: 'Customer', type: 'text', filterable: true, link: { to: 'customer', idKey: 'customer_id' } },
    { key: 'plan', header: 'Plan', type: 'text', filterable: true, groupable: true },
    { key: 'recognized_amount', header: 'Recognized Amount', type: 'currency', total: true },
    { key: 'days_recognized', header: 'Days Recognized', type: 'number' },
    { key: 'last_recognized', header: 'Last Recognized', type: 'date', filterable: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
                || ' (' || c.reference_number || ')' AS customer,
              c.id AS customer_id,
              p.name AS plan,
              rr.amount_recognized::int AS recognized_amount,
              rr.days_recognized::int AS days_recognized,
              rr.last_recognized_date AS last_recognized
         FROM fin_revenue_recognized rr
         JOIN mbr_enrollments e ON e.id = rr.enrollment_id
         JOIN mbr_plans p ON p.id = e.plan_id
         JOIN cus_customers c ON c.id = e.customer_id
        WHERE rr.business_id = $1
          AND rr.amount_recognized > 0
          AND rr.last_recognized_date BETWEEN $2::date AND $3::date
        ORDER BY rr.last_recognized_date DESC, c.last_name`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
