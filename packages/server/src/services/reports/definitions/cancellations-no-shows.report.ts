import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Cancellations & No-Shows report — bookings in the date range that were
 * cancelled or marked no-show, with the reason, the lost booking value, and any
 * no-show fee actually charged.
 *
 * Filtered on start_time (the affected appointment date) so both statuses are
 * covered uniformly. "Lost Value" is the booking's pre-tax price (revenue at
 * risk) — tax is backed out of the stored tax-inclusive price so it stays
 * consistent with the non-taxable no-show fee. "Fee Charged" is the no-show fee
 * actually collected (from apt_no_show_records) — 0 for cancellations and for
 * no-shows on variants with no fee. Group by Status or Service.
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const cancellationsNoShowsReport: ReportDefinition = {
  id: 'cancellations-no-shows',
  title: 'Cancellations & No-Shows',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'reference', header: 'Reference', type: 'text', filterable: true },
    { key: 'service', header: 'Service', type: 'text', filterable: true, groupable: true },
    { key: 'staff', header: 'Staff', type: 'text', filterable: true, groupable: true },
    { key: 'customer', header: 'Customer', type: 'text', filterable: true },
    { key: 'status', header: 'Status', type: 'text', filterable: true, groupable: true },
    { key: 'lost_value', header: 'Lost Value', type: 'currency', total: true },
    { key: 'fee_charged', header: 'Fee Charged', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT b.start_time::date AS entry_date,
              b.booking_reference AS reference,
              COALESCE(s.name, '—')
                || CASE WHEN v.name IS NOT NULL AND v.name <> '' THEN ' — ' || v.name ELSE '' END AS service,
              COALESCE(
                NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                'Unassigned'
              ) AS staff,
              COALESCE(
                NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
                '—'
              ) AS customer,
              INITCAP(REPLACE(b.status, '_', ' ')) AS status,
              -- Booking price is stored tax-inclusive; back out tax so Lost Value is
              -- pre-tax, consistent with the (non-taxable) no-show fee.
              ROUND(b.price / (1 + COALESCE(tc.rate, 0) / 10000.0))::int AS lost_value,
              COALESCE(nsr.fee_amount, 0)::int AS fee_charged
         FROM apt_bookings b
         LEFT JOIN svc_services s ON s.id = b.service_id
         LEFT JOIN svc_variants v ON v.id = b.variant_id
         LEFT JOIN svc_tax_categories tc ON tc.id = s.tax_category_id
         LEFT JOIN usr_users u ON u.id = b.staff_id
         LEFT JOIN cus_customers c ON c.id = b.customer_id
         LEFT JOIN apt_no_show_records nsr ON nsr.booking_id = b.id AND nsr.fee_charged = true
        WHERE b.business_id = $1
          AND b.status IN ('cancelled', 'no_show')
          AND b.start_time::date BETWEEN $2::date AND $3::date
        ORDER BY b.start_time DESC`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
