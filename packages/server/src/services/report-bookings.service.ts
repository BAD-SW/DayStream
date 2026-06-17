import { adminPool } from '../db/pool';

/**
 * Get comprehensive bookings report for a tenant within a date range.
 */
export async function getBookingsReport(tenantId: string, startDate: string, endDate: string) {
  // Total by status
  const { rows: byStatus } = await adminPool.query(
    `SELECT b.status, COUNT(*)::int AS count
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')
     GROUP BY b.status`,
    [tenantId, startDate, endDate],
  );

  const totalBookings = byStatus.reduce((sum, r) => sum + r.count, 0);
  const cancelled = byStatus.find(r => r.status === 'cancelled')?.count || 0;
  const noShow = byStatus.find(r => r.status === 'no_show')?.count || 0;
  const cancellationRate = totalBookings > 0 ? (cancelled / totalBookings * 100).toFixed(1) : '0';
  const noShowRate = totalBookings > 0 ? (noShow / totalBookings * 100).toFixed(1) : '0';

  // Utilization (completed / total)
  const completed = byStatus.find(r => r.status === 'completed')?.count || 0;
  const utilization = totalBookings > 0 ? (completed / totalBookings * 100).toFixed(1) : '0';

  // Peak times heatmap (day_of_week × hour)
  const { rows: peakTimes } = await adminPool.query(
    `SELECT EXTRACT(DOW FROM b.start_time)::int AS day_of_week,
            EXTRACT(HOUR FROM b.start_time)::int AS hour,
            COUNT(*)::int AS count
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')
     GROUP BY day_of_week, hour
     ORDER BY day_of_week, hour`,
    [tenantId, startDate, endDate],
  );

  // Lead time (avg hours between created_at and start_time)
  const { rows: leadTimeRows } = await adminPool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (b.start_time - b.created_at)) / 3600)::numeric(10,1) AS avg_lead_hours
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')
       AND b.created_at IS NOT NULL`,
    [tenantId, startDate, endDate],
  );

  return {
    totalBookings,
    byStatus,
    cancellationRate: parseFloat(cancellationRate),
    noShowRate: parseFloat(noShowRate),
    utilization: parseFloat(utilization),
    peakTimes,
    avgLeadTimeHours: leadTimeRows[0]?.avg_lead_hours ? parseFloat(leadTimeRows[0].avg_lead_hours) : null,
  };
}
