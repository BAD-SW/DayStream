import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';
import { recognizedRevenueByCustomer } from '../lib/recognized-revenue';

/**
 * Customer Lifetime Value report — recognized revenue to date per customer,
 * across all sources: service + product (recognized at point of sale) and
 * membership (recognized over time). Pre-tax, net of discount.
 *
 * This is a lifetime snapshot per customer (not date-ranged) — LTV is
 * cumulative-to-date by definition. Customers with no recognized revenue are
 * omitted. Uses adminPool scoped by business_id.
 */
export const customerLifetimeValueReport: ReportDefinition = {
  id: 'customer-lifetime-value',
  title: 'Customer Lifetime Value',
  columns: [
    { key: 'customer', header: 'Customer', type: 'text', filterable: true },
    { key: 'service', header: 'Service Revenue', type: 'currency', total: true },
    { key: 'product', header: 'Product Revenue', type: 'currency', total: true },
    { key: 'membership', header: 'Membership Revenue', type: 'currency', total: true },
    { key: 'total_ltv', header: 'Total LTV', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const byCustomer = await recognizedRevenueByCustomer(ctx.businessId);
    if (byCustomer.size === 0) return [];

    const ids = [...byCustomer.keys()];
    const { rows: customers } = await adminPool.query(
      `SELECT id,
              TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
                || ' (' || reference_number || ')' AS customer
         FROM cus_customers
        WHERE id = ANY($1)`,
      [ids],
    );
    const nameById = new Map<string, string>();
    for (const c of customers) nameById.set(c.id, c.customer);

    const rows = ids.map((id) => {
      const r = byCustomer.get(id)!;
      const total = r.service + r.product + r.membership;
      return {
        customer: nameById.get(id) || '—',
        service: r.service,
        product: r.product,
        membership: r.membership,
        total_ltv: total,
      };
    });

    // Highest-value customers first
    rows.sort((a, b) => b.total_ltv - a.total_ltv);
    return rows;
  },
};
