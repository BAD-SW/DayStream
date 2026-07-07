import { adminPool } from '../db/pool';
import { getEffectiveSchedule } from './resource-schedule.service';

/**
 * Calculate utilization for a single resource over a date range.
 */
export async function getResourceUtilization(resourceId: string, startDate: string, endDate: string) {
  // Calculate available hours
  let totalAvailableMinutes = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const slots = await getEffectiveSchedule(resourceId, dateStr);
    for (const slot of slots) {
      const [sh, sm] = slot.start_time.split(':').map(Number);
      const [eh, em] = slot.end_time.split(':').map(Number);
      totalAvailableMinutes += (eh * 60 + em) - (sh * 60 + sm);
    }
  }

  // Calculate booked hours
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0)::int AS booked_minutes
     FROM res_bookings
     WHERE resource_id = $1 AND status = 'confirmed'
       AND start_time::date >= $2::date AND end_time::date <= $3::date`,
    [resourceId, startDate, endDate]);

  const bookedMinutes = rows[0].booked_minutes;
  const utilizationRate = totalAvailableMinutes > 0
    ? Math.round((bookedMinutes / totalAvailableMinutes) * 10000) / 100
    : 0;

  // Peak hours
  const { rows: peakRows } = await adminPool.query(
    `SELECT EXTRACT(HOUR FROM start_time)::int AS hour, COUNT(*)::int AS booking_count
     FROM res_bookings
     WHERE resource_id = $1 AND status = 'confirmed'
       AND start_time::date >= $2::date AND start_time::date <= $3::date
     GROUP BY hour ORDER BY booking_count DESC LIMIT 5`,
    [resourceId, startDate, endDate]);

  // Booking count
  const { rows: countRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS total_bookings FROM res_bookings
     WHERE resource_id = $1 AND status = 'confirmed'
       AND start_time::date >= $2::date AND start_time::date <= $3::date`,
    [resourceId, startDate, endDate]);

  return {
    resourceId,
    startDate,
    endDate,
    totalAvailableMinutes,
    bookedMinutes,
    utilizationRate,
    totalBookings: countRows[0].total_bookings,
    peakHours: peakRows.map((r) => ({ hour: r.hour, count: r.booking_count })),
  };
}

/**
 * Get utilization summary for all resources in a tenant.
 */
export async function getUtilizationSummary(tenantId: string, startDate: string, endDate: string, filters?: {
  resourceTypeId?: string;
  locationId?: string;
}) {
  let query = `SELECT id, name, resource_type_id FROM res_resources WHERE tenant_id = $1 AND status = 'active'`;
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters?.resourceTypeId) { query += ` AND resource_type_id = $${idx++}`; params.push(filters.resourceTypeId); }
  if (filters?.locationId) { query += ` AND location_id = $${idx++}`; params.push(filters.locationId); }
  query += ` ORDER BY name`;

  const { rows: resources } = await adminPool.query(query, params);

  const results = await Promise.all(resources.map(async (r) => {
    const util = await getResourceUtilization(r.id, startDate, endDate);
    return { ...util, resourceName: r.name };
  }));

  const avgUtilization = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.utilizationRate, 0) / results.length * 100) / 100
    : 0;

  const underutilized = results.filter((r) => r.utilizationRate < 40);
  const overutilized = results.filter((r) => r.utilizationRate > 85);

  return {
    resources: results,
    summary: {
      averageUtilization: avgUtilization,
      underutilizedCount: underutilized.length,
      overutilizedCount: overutilized.length,
      totalResources: results.length,
    },
  };
}
