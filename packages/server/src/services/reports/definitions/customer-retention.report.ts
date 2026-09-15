import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';
import { recognizedRevenueByCustomer } from '../lib/recognized-revenue';

/**
 * Customer Retention report — a per-customer view of retention/churn driven
 * entirely by `cus_customers.lifecycle_stage`.
 *
 * Retention here is NOT re-derived: `lifecycle_stage` is the authoritative
 * signal owned by the Customer Lifecycle Automation process (see
 * customer-lifecycle.service.ts), which moves customers between stages —
 * lead → trial → active, active → at_risk → churned (scheduled inactivity
 * sweep), and churned → winback → active on return. This report simply
 * surfaces and summarizes that state; it applies no thresholds of its own.
 *
 * One row per (non-anonymized) customer. Group by Lifecycle Stage to see the
 * retention/churn distribution. "Stage Since" is the date of the customer's
 * most recent logged lifecycle transition (activity_type = 'lifecycle' in
 * cus_activities), falling back to the record's updated_at when no transition
 * has been logged (e.g. a customer still in their initial 'lead' stage).
 *
 * This is a current-state snapshot, so the date range is not applied — a
 * customer's retention status is whatever it is "now", not within a window.
 *
 * LTV = recognized revenue to date for the customer across service, product,
 * and membership (pre-tax, net of discount) — the same figure as the Customer
 * Lifetime Value report, via the shared recognizedRevenueByCustomer helper. It
 * lets you see the value at stake for customers who are slipping (at-risk /
 * churned).
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const customerRetentionReport: ReportDefinition = {
  id: 'customer-retention',
  title: 'Customer Retention',
  columns: [
    { key: 'customer', header: 'Customer', type: 'text', filterable: true },
    { key: 'lifecycle_stage', header: 'Lifecycle Stage', type: 'text', filterable: true, groupable: true },
    { key: 'customer_since', header: 'Customer Since', type: 'date', filterable: true },
    { key: 'stage_since', header: 'Stage Since', type: 'date', filterable: true },
    { key: 'ltv', header: 'LTV', type: 'currency', total: true },
  ],
  run: async (ctx) => {
    const byCustomer = await recognizedRevenueByCustomer(ctx.businessId);

    const { rows } = await adminPool.query(
      `SELECT c.id,
              TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
                || ' (' || c.reference_number || ')' AS customer,
              INITCAP(REPLACE(c.lifecycle_stage, '_', ' ')) AS lifecycle_stage,
              c.created_at::date AS customer_since,
              COALESCE(lt.last_transition, c.updated_at)::date AS stage_since,
              -- Ordering key: attention-needing stages first
              CASE c.lifecycle_stage
                WHEN 'churned' THEN 0
                WHEN 'at_risk' THEN 1
                WHEN 'winback' THEN 2
                WHEN 'trial'   THEN 3
                WHEN 'lead'    THEN 4
                WHEN 'active'  THEN 5
                ELSE 6
              END AS stage_rank
         FROM cus_customers c
         LEFT JOIN LATERAL (
           SELECT MAX(ca.created_at) AS last_transition
             FROM cus_activities ca
            WHERE ca.customer_id = c.id
              AND ca.business_id = c.business_id
              AND ca.activity_type = 'lifecycle'
         ) lt ON TRUE
        WHERE c.business_id = $1
          AND c.status <> 'anonymized'
        ORDER BY stage_rank ASC, stage_since ASC`,
      [ctx.businessId],
    );

    // Attach LTV from the shared helper; drop id + stage_rank (ordering only).
    return rows.map(({ id, stage_rank, ...row }) => {
      const r = byCustomer.get(id);
      const ltv = r ? r.service + r.product + r.membership : 0;
      return { ...row, ltv };
    });
  },
};
