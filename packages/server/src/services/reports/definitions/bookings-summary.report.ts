import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * Bookings Summary report — one row per booking whose appointment falls in the
 * date range (filtered on start_time, i.e. when the appointment is scheduled,
 * not when it was booked).
 *
 * Shows the key details an owner reviews: when, what, who, for whom, status,
 * and price. Group by Status ("how many completed / cancelled / no-show") or by
 * Service. Price is the booking's price (as recorded on the booking).
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const bookingsSummaryReport: ReportDefinition = {
  id: 'bookings-summary',
  title: 'Bookings Summary',
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date', filterable: true },
    { key: 'start_time', header: 'Time', type: 'text', filterable: true },
    { key: 'reference', header: 'Reference', type: 'text', filterable: true },
    { key: 'service', header: 'Service', type: 'text', filterable: true, groupable: true },
    { key: 'staff', header: 'Staff', type: 'text', filterable: true, groupable: true },
    { key: 'customer', header: 'Customer', type: 'text', filterable: true },
    { key: 'status', header: 'Status', type: 'text', filterable: true, groupable: true },
    { key: 'price', header: 'Price', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT b.start_time::date AS entry_date,
              TO_CHAR(b.start_time, 'HH24:MI') AS start_time,
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
              b.price::int AS price
         FROM apt_bookings b
         LEFT JOIN svc_services s ON s.id = b.service_id
         LEFT JOIN svc_variants v ON v.id = b.variant_id
         LEFT JOIN usr_users u ON u.id = b.staff_id
         LEFT JOIN cus_customers c ON c.id = b.customer_id
        WHERE b.business_id = $1
          AND b.start_time::date BETWEEN $2::date AND $3::date
        ORDER BY b.start_time DESC`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
