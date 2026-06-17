import { adminPool } from '../db/pool';

/**
 * Get comprehensive revenue report for a tenant within a date range.
 */
export async function getRevenueReport(tenantId: string, startDate: string, endDate: string) {
  // Total revenue
  const { rows: totalRows } = await adminPool.query(
    `SELECT COALESCE(SUM(b.price), 0) AS total_revenue, COUNT(*)::int AS total_bookings
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')`,
    [tenantId, startDate, endDate],
  );

  const { total_revenue, total_bookings } = totalRows[0];
  const avgPerBooking = total_bookings > 0 ? parseFloat(total_revenue) / total_bookings : 0;

  // Breakdown by service
  const { rows: byService } = await adminPool.query(
    `SELECT b.service_id, COALESCE(SUM(b.price), 0) AS revenue, COUNT(*)::int AS bookings
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')
     GROUP BY b.service_id
     ORDER BY revenue DESC`,
    [tenantId, startDate, endDate],
  );

  // Trend over time (daily)
  const { rows: trend } = await adminPool.query(
    `SELECT b.start_time::date AS date, COALESCE(SUM(b.price), 0) AS revenue, COUNT(*)::int AS bookings
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')
     GROUP BY b.start_time::date
     ORDER BY date`,
    [tenantId, startDate, endDate],
  );

  // Previous period comparison
  const daysDiff = `($2::date - $3::date)`;
  const { rows: prevRows } = await adminPool.query(
    `SELECT COALESCE(SUM(b.price), 0) AS prev_revenue, COUNT(*)::int AS prev_bookings
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.start_time >= ($2::date - ($3::date - $2::date + 1))
       AND b.start_time < $2::date`,
    [tenantId, startDate, endDate],
  );

  const prevRevenue = parseFloat(prevRows[0].prev_revenue);
  const currentRevenue = parseFloat(total_revenue);
  const changePercent = prevRevenue > 0
    ? ((currentRevenue - prevRevenue) / prevRevenue * 100).toFixed(1)
    : null;

  return {
    totalRevenue: currentRevenue,
    totalBookings: total_bookings,
    avgPerBooking: parseFloat(avgPerBooking.toFixed(2)),
    byService,
    trend,
    comparison: {
      previousPeriodRevenue: prevRevenue,
      changePercent: changePercent ? parseFloat(changePercent) : null,
    },
  };
}
