import { adminPool } from '../db/pool';

interface ReportFilters {
  businessId: string;
  planId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Get membership summary report.
 */
export async function getSummaryReport(filters: ReportFilters) {
  const { businessId, planId } = filters;

  // Active count by plan type
  const planCondition = planId ? `AND m.plan_id = '${planId}'` : '';

  const { rows: byType } = await adminPool.query(
    `SELECT mp.plan_type, COUNT(*)::int AS count
     FROM memberships m JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.business_id = $1 AND m.status = 'active' ${planCondition}
     GROUP BY mp.plan_type`,
    [businessId],
  );

  // Active count by plan
  const { rows: byPlan } = await adminPool.query(
    `SELECT mp.name, mp.id AS plan_id, COUNT(*)::int AS count
     FROM memberships m JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.business_id = $1 AND m.status = 'active' ${planCondition}
     GROUP BY mp.id, mp.name ORDER BY count DESC`,
    [businessId],
  );

  // Total active
  const { rows: totalRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS total FROM memberships WHERE business_id = $1 AND status = 'active'`,
    [businessId],
  );

  // New this month
  const { rows: newRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM memberships
     WHERE business_id = $1 AND created_at >= DATE_TRUNC('month', NOW()) ${planCondition}`,
    [businessId],
  );

  // Cancelled this month
  const { rows: cancelledRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM memberships
     WHERE business_id = $1 AND status = 'cancelled' AND cancelled_at >= DATE_TRUNC('month', NOW()) ${planCondition}`,
    [businessId],
  );

  // Renewal rate (renewed / (renewed + cancelled) this month)
  const { rows: renewedRows } = await adminPool.query(
    `SELECT COUNT(DISTINCT ct.membership_id)::int AS count FROM credit_transactions ct
     JOIN memberships m ON m.id = ct.membership_id
     WHERE m.business_id = $1 AND ct.type = 'allocated' AND ct.description LIKE 'Cycle%'
       AND ct.created_at >= DATE_TRUNC('month', NOW())`,
    [businessId],
  );
  const renewedCount = renewedRows[0].count;
  const cancelledCount = cancelledRows[0].count;
  const renewalRate = (renewedCount + cancelledCount) > 0
    ? Math.round((renewedCount / (renewedCount + cancelledCount)) * 100)
    : 100;

  return {
    total_active: totalRows[0].total,
    new_this_month: newRows[0].count,
    cancelled_this_month: cancelledCount,
    renewal_rate: renewalRate,
    by_type: byType,
    by_plan: byPlan,
  };
}

/**
 * Get churn report.
 */
export async function getChurnReport(filters: ReportFilters) {
  const { businessId, dateFrom, dateTo } = filters;

  const dateCondition = dateFrom && dateTo
    ? `AND cancelled_at >= '${dateFrom}' AND cancelled_at <= '${dateTo}'`
    : 'AND cancelled_at >= DATE_TRUNC(\'month\', NOW())';

  const { rows: cancellations } = await adminPool.query(
    `SELECT mp.name AS plan_name, COUNT(*)::int AS count, 
            json_agg(DISTINCT m.cancellation_reason) FILTER (WHERE m.cancellation_reason IS NOT NULL) AS reasons
     FROM memberships m JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.business_id = $1 AND m.status = 'cancelled' ${dateCondition}
     GROUP BY mp.name ORDER BY count DESC`,
    [businessId],
  );

  // Average duration before cancellation
  const { rows: avgDuration } = await adminPool.query(
    `SELECT ROUND(AVG(EXTRACT(DAY FROM (cancelled_at - start_date::timestamp))))::int AS avg_days
     FROM memberships WHERE business_id = $1 AND status = 'cancelled' AND cancelled_at IS NOT NULL`,
    [businessId],
  );

  return {
    cancellations,
    average_duration_days: avgDuration[0]?.avg_days || 0,
    total_churned: cancellations.reduce((sum: number, r: any) => sum + r.count, 0),
  };
}

/**
 * Get credit utilization report.
 */
export async function getCreditReport(filters: ReportFilters) {
  const { businessId, dateFrom, dateTo } = filters;

  const dateCondition = dateFrom && dateTo
    ? `AND ct.created_at >= '${dateFrom}' AND ct.created_at <= '${dateTo}'`
    : 'AND ct.created_at >= DATE_TRUNC(\'month\', NOW())';

  // Total allocated vs deducted
  const { rows: allocated } = await adminPool.query(
    `SELECT COALESCE(SUM(ct.amount), 0)::int AS total
     FROM credit_transactions ct JOIN memberships m ON m.id = ct.membership_id
     WHERE m.business_id = $1 AND ct.type = 'allocated' ${dateCondition}`,
    [businessId],
  );

  const { rows: deducted } = await adminPool.query(
    `SELECT COALESCE(SUM(ABS(ct.amount)), 0)::int AS total
     FROM credit_transactions ct JOIN memberships m ON m.id = ct.membership_id
     WHERE m.business_id = $1 AND ct.type = 'deducted' ${dateCondition}`,
    [businessId],
  );

  const { rows: expired } = await adminPool.query(
    `SELECT COALESCE(SUM(ABS(ct.amount)), 0)::int AS total
     FROM credit_transactions ct JOIN memberships m ON m.id = ct.membership_id
     WHERE m.business_id = $1 AND ct.type = 'expired' ${dateCondition}`,
    [businessId],
  );

  const totalAllocated = allocated[0].total;
  const totalDeducted = deducted[0].total;
  const totalExpired = expired[0].total;
  const utilizationRate = totalAllocated > 0
    ? Math.round((totalDeducted / totalAllocated) * 100)
    : 0;

  return {
    total_allocated: totalAllocated,
    total_deducted: totalDeducted,
    total_expired: totalExpired,
    utilization_rate: utilizationRate,
  };
}
