import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';
import { computeOrderCommissionLines } from '../../commission.service';

/**
 * Commissions report — order-level detail of commission earned by staff.
 *
 * Commission is earned on COMPLETED-order line items credited to a staff member
 * (locked-in, collected revenue), computed by the shared commission service —
 * the SAME computation payroll uses, so this report reconciles line-for-line
 * with what payroll pays. One row per (order line × matching rule), so a
 * business owner or staff member can trace each commission back to a specific
 * sale.
 *
 *   - Type       : Commission (percentage of the line net) or Flat Rate (a set
 *                  amount per unit sold).
 *   - Base       : the line's pre-tax net (unit_price*qty − discount); the basis
 *                  for a percentage commission (0/— context for flat rate).
 *   - Rate       : the percentage (commission) or per-unit amount (flat rate).
 *   - Commission : the earned amount for that line.
 *   - Status     : Posted when the order falls in a FINALIZED pay period (already
 *                  paid on a payslip); otherwise Projected (earned, not yet run
 *                  through payroll). Voided/refunded orders never appear — they
 *                  earn nothing.
 *
 * Group by Staff (the Staff column is groupable) to roll the detail up into
 * per-staff totals in the runner.
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const commissionsReport: ReportDefinition = {
  id: 'commissions',
  title: 'Commissions',
  columns: [
    { key: 'order_number', header: 'Order', type: 'text', filterable: true, link: { to: 'order', idKey: 'order_id' } },
    { key: 'completed_date', header: 'Date', type: 'date', filterable: true },
    { key: 'staff', header: 'Staff', type: 'text', filterable: true, groupable: true },
    { key: 'customer', header: 'Customer', type: 'text', filterable: true, link: { to: 'customer', idKey: 'customer_id' } },
    { key: 'item', header: 'Item', type: 'text', filterable: true },
    { key: 'type', header: 'Type', type: 'text', filterable: true, groupable: true },
    { key: 'base', header: 'Base', type: 'currency', total: true },
    { key: 'rate', header: 'Rate', type: 'text' },
    { key: 'commission', header: 'Commission', type: 'currency', total: true },
    { key: 'status', header: 'Status', type: 'text', filterable: true, groupable: true },
  ],
  run: async (ctx) => {
    const { businessId, start, end } = ctx;

    const lines = await computeOrderCommissionLines({ businessId, start, end });
    if (lines.length === 0) return [];

    // Finalized pay periods for the business — an order completed within one has
    // had its commission posted to payroll; otherwise it's still projected.
    const { rows: periods } = await adminPool.query(
      `SELECT period_start, period_end
         FROM fin_pay_periods
        WHERE business_id = $1 AND status = 'finalized'`,
      [businessId],
    );
    const toDate = (v: unknown): string | null => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).slice(0, 10);
    };
    const isPosted = (completedAt: unknown): boolean => {
      const d = toDate(completedAt);
      if (!d) return false;
      return periods.some((p) => {
        const ps = (p.period_start instanceof Date ? p.period_start.toISOString() : String(p.period_start)).slice(0, 10);
        const pe = (p.period_end instanceof Date ? p.period_end.toISOString() : String(p.period_end)).slice(0, 10);
        return d >= ps && d <= pe;
      });
    };

    // Resolve staff + customer display names in a single lookup each.
    const staffIds = [...new Set(lines.map((l) => l.staff_id))];
    const customerIds = [...new Set(lines.map((l) => l.customer_id).filter(Boolean))] as string[];

    const staffById = new Map<string, string>();
    if (staffIds.length > 0) {
      const { rows } = await adminPool.query(
        `SELECT id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS name
           FROM usr_users WHERE id = ANY($1)`,
        [staffIds],
      );
      for (const r of rows) staffById.set(r.id, r.name);
    }
    const customerById = new Map<string, string>();
    if (customerIds.length > 0) {
      const { rows } = await adminPool.query(
        `SELECT id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS name
           FROM cus_customers WHERE id = ANY($1)`,
        [customerIds],
      );
      for (const r of rows) customerById.set(r.id, r.name);
    }

    const formatRate = (l: (typeof lines)[number]): string =>
      l.rule_type === 'commission'
        ? `${(l.rate / 100).toFixed(2).replace(/\.?0+$/, '')}%`
        : `${(l.rate / 100).toFixed(2)}/unit`;

    return lines.map((l) => ({
      order_number: l.order_number,
      order_id: l.order_id,
      completed_date: toDate(l.completed_at),
      staff: staffById.get(l.staff_id) || '—',
      customer: l.customer_id ? (customerById.get(l.customer_id) || '—') : 'Walk-in',
      customer_id: l.customer_id,
      item: l.item_name,
      type: l.rule_type === 'commission' ? 'Commission' : 'Flat Rate',
      base: l.line_base,
      rate: formatRate(l),
      commission: l.commission,
      status: isPosted(l.completed_at) ? 'Posted' : 'Projected',
    }));
  },
};
