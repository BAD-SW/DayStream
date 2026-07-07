import { adminPool } from '../db/pool';

/**
 * Get comprehensive memberships report for a tenant within a date range.
 */
export async function getMembershipsReport(tenantId: string, startDate: string, endDate: string) {
  // Active memberships at end of period
  const { rows: activeRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS active_count
     FROM mem_memberships
     WHERE tenant_id = $1
       AND status = 'active'
       AND started_at <= $2::date`,
    [tenantId, endDate],
  );

  // New memberships in period
  const { rows: newRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS new_count
     FROM mem_memberships
     WHERE tenant_id = $1
       AND started_at >= $2::date
       AND started_at < ($3::date + INTERVAL '1 day')`,
    [tenantId, startDate, endDate],
  );

  // Cancelled in period
  const { rows: cancelledRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS cancelled_count
     FROM mem_memberships
     WHERE tenant_id = $1
       AND cancelled_at >= $2::date
       AND cancelled_at < ($3::date + INTERVAL '1 day')`,
    [tenantId, startDate, endDate],
  );

  // Active at start of period (for churn calculation)
  const { rows: startRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS start_count
     FROM mem_memberships
     WHERE tenant_id = $1
       AND status IN ('active', 'cancelled')
       AND started_at < $2::date
       AND (cancelled_at IS NULL OR cancelled_at >= $2::date)`,
    [tenantId, startDate],
  );

  const activeCount = activeRows[0].active_count;
  const newCount = newRows[0].new_count;
  const cancelledCount = cancelledRows[0].cancelled_count;
  const startCount = startRows[0].start_count;

  const churnRate = startCount > 0
    ? parseFloat((cancelledCount / startCount * 100).toFixed(1))
    : 0;

  // MRR calculation (sum of plan prices for active memberships)
  const { rows: mrrRows } = await adminPool.query(
    `SELECT COALESCE(SUM(mp.price), 0) AS mrr
     FROM mem_memberships m
     JOIN mem_plans mp ON mp.id = m.plan_id
     WHERE m.tenant_id = $1
       AND m.status = 'active'`,
    [tenantId],
  );

  return {
    activeCount,
    newCount,
    cancelledCount,
    churnRate,
    mrr: parseFloat(mrrRows[0].mrr),
    startOfPeriodCount: startCount,
  };
}
