import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';

/**
 * New Customers report — customers acquired in the date range, by created_at
 * (their sign-up date). One row per customer.
 *
 * Anonymized customers are excluded (their PII is scrubbed and they don't
 * represent a meaningful acquisition row). Lifecycle stage and country are shown
 * for context and are groupable. Uses adminPool scoped by business_id.
 */
export const newCustomersReport: ReportDefinition = {
  id: 'new-customers',
  title: 'New Customers',
  columns: [
    { key: 'joined', header: 'Creation Date', type: 'date', filterable: true },
    { key: 'customer', header: 'Customer', type: 'text', filterable: true, link: { to: 'customer', idKey: 'customer_id' } },
    { key: 'email', header: 'Email', type: 'text', filterable: true },
    { key: 'phone', header: 'Phone', type: 'text', filterable: true },
    { key: 'lifecycle_stage', header: 'Lifecycle Stage', type: 'text', filterable: true, groupable: true },
    { key: 'country', header: 'Country', type: 'text', filterable: true, groupable: true },
  ],
  run: async (ctx) => {
    const { rows } = await adminPool.query(
      `SELECT c.created_at::date AS joined,
              c.id AS customer_id,
              TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
                || ' (' || c.reference_number || ')' AS customer,
              c.email,
              COALESCE(c.phone, '—') AS phone,
              INITCAP(REPLACE(c.lifecycle_stage, '_', ' ')) AS lifecycle_stage,
              COALESCE(NULLIF(TRIM(c.country), ''), '—') AS country
         FROM cus_customers c
        WHERE c.business_id = $1
          AND c.status <> 'anonymized'
          AND c.created_at::date BETWEEN $2::date AND $3::date
        ORDER BY c.created_at DESC`,
      [ctx.businessId, ctx.start, ctx.end],
    );
    return rows;
  },
};
