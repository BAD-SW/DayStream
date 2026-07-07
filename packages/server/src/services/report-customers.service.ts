import { adminPool } from '../db/pool';

/**
 * Get customers report for a tenant within a date range.
 */
export async function getCustomersReport(tenantId: string, startDate: string, endDate: string) {
  // Active customers (had a booking in period)
  const { rows: activeRows } = await adminPool.query(
    `SELECT COUNT(DISTINCT b.customer_id)::int AS active_count
     FROM apt_bookings b
     JOIN sys_businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')`,
    [tenantId, startDate, endDate],
  );

  // New customers (created in period)
  const { rows: newRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS new_count
     FROM cus_customers
     WHERE tenant_id = $1
       AND created_at >= $2::date
       AND created_at < ($3::date + INTERVAL '1 day')`,
    [tenantId, startDate, endDate],
  );

  // Churned customers (were active in previous period but not in current)
  const { rows: churnedRows } = await adminPool.query(
    `SELECT COUNT(DISTINCT prev.customer_id)::int AS churned_count
     FROM (
       SELECT DISTINCT b.customer_id
       FROM apt_bookings b
       JOIN sys_businesses bus ON bus.id = b.business_id
       WHERE bus.tenant_id = $1
         AND b.start_time >= ($2::date - ($3::date - $2::date + 1))
         AND b.start_time < $2::date
     ) prev
     WHERE prev.customer_id NOT IN (
       SELECT DISTINCT b.customer_id
       FROM apt_bookings b
       JOIN sys_businesses bus ON bus.id = b.business_id
       WHERE bus.tenant_id = $1
         AND b.start_time >= $2::date
         AND b.start_time < ($3::date + INTERVAL '1 day')
     )`,
    [tenantId, startDate, endDate],
  );

  // Lifecycle distribution (by customer status)
  const { rows: lifecycle } = await adminPool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM cus_customers
     WHERE tenant_id = $1
     GROUP BY status`,
    [tenantId],
  );

  // Top customers by revenue
  const { rows: topCustomers } = await adminPool.query(
    `SELECT b.customer_id, COALESCE(SUM(b.price), 0) AS total_revenue, COUNT(*)::int AS bookings
     FROM apt_bookings b
     JOIN sys_businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')
     GROUP BY b.customer_id
     ORDER BY total_revenue DESC
     LIMIT 20`,
    [tenantId, startDate, endDate],
  );

  return {
    activeCount: activeRows[0].active_count,
    newCount: newRows[0].new_count,
    churnedCount: churnedRows[0].churned_count,
    lifecycle,
    topCustomers: topCustomers.map(r => ({ ...r, total_revenue: parseFloat(r.total_revenue) })),
  };
}
