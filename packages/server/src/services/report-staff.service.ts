import { adminPool } from '../db/pool';

/**
 * Get staff performance report for a tenant within a date range.
 */
export async function getStaffReport(tenantId: string, startDate: string, endDate: string) {
  // Per-staff: sessions delivered, revenue, ranking
  const { rows: staffMetrics } = await adminPool.query(
    `SELECT b.staff_id,
            COUNT(*)::int AS sessions_delivered,
            COALESCE(SUM(b.price), 0) AS revenue
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.start_time >= $2::date
       AND b.start_time < ($3::date + INTERVAL '1 day')
       AND b.staff_id IS NOT NULL
     GROUP BY b.staff_id
     ORDER BY revenue DESC`,
    [tenantId, startDate, endDate],
  );

  // Add ranking
  const ranked = staffMetrics.map((row, index) => ({
    ...row,
    rank: index + 1,
    revenue: parseFloat(row.revenue),
  }));

  // Summary totals
  const totalSessions = ranked.reduce((sum, r) => sum + r.sessions_delivered, 0);
  const totalRevenue = ranked.reduce((sum, r) => sum + r.revenue, 0);
  const avgSessionsPerStaff = ranked.length > 0 ? Math.round(totalSessions / ranked.length) : 0;

  return {
    staff: ranked,
    summary: {
      totalStaff: ranked.length,
      totalSessions,
      totalRevenue,
      avgSessionsPerStaff,
    },
  };
}
