import { adminPool } from '../db/pool';

/**
 * Get attendance rate: checked-in bookings / total confirmed bookings in the date range.
 */
export async function getAttendanceRate(tenantId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT
       COUNT(DISTINCT cr.booking_id)::int AS checked_in_count,
       (SELECT COUNT(*)::int FROM bookings b JOIN businesses bus ON bus.id = b.business_id
        WHERE bus.tenant_id = $1 AND b.start_time >= $2 AND b.start_time <= $3
          AND b.status IN ('confirmed', 'checked_in', 'completed', 'no_show')
       ) AS total_bookings
     FROM check_in_records cr
     WHERE cr.tenant_id = $1 AND cr.check_in_time >= $2 AND cr.check_in_time <= $3
       AND cr.status != 'cancelled'`,
    [tenantId, startDate, endDate],
  );

  const { checked_in_count, total_bookings } = rows[0];
  const rate = total_bookings > 0 ? checked_in_count / total_bookings : 0;

  return {
    checked_in_count,
    total_bookings,
    rate: Math.round(rate * 10000) / 10000,
    percentage: Math.round(rate * 100 * 100) / 100,
  };
}

/**
 * Get no-show rate: no-show bookings / total confirmed bookings in the date range.
 */
export async function getNoShowRate(tenantId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM no_show_records
        WHERE tenant_id = $1 AND detected_at >= $2 AND detected_at <= $3
       ) AS no_show_count,
       (SELECT COUNT(*)::int FROM bookings b JOIN businesses bus ON bus.id = b.business_id
        WHERE bus.tenant_id = $1 AND b.start_time >= $2 AND b.start_time <= $3
          AND b.status IN ('confirmed', 'checked_in', 'completed', 'no_show')
       ) AS total_bookings`,
    [tenantId, startDate, endDate],
  );

  const { no_show_count, total_bookings } = rows[0];
  const rate = total_bookings > 0 ? no_show_count / total_bookings : 0;

  return {
    no_show_count,
    total_bookings,
    rate: Math.round(rate * 10000) / 10000,
    percentage: Math.round(rate * 100 * 100) / 100,
  };
}

/**
 * Get walk-in volume in the date range.
 */
export async function getWalkInVolume(tenantId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT COUNT(*)::int AS walk_in_count
     FROM check_in_records
     WHERE tenant_id = $1 AND check_in_time >= $2 AND check_in_time <= $3
       AND check_in_method = 'walk_in' AND status != 'cancelled'`,
    [tenantId, startDate, endDate],
  );

  return { walk_in_count: rows[0].walk_in_count };
}

/**
 * Get peak check-in times: busiest hours in the date range.
 */
export async function getPeakTimes(tenantId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT
       EXTRACT(HOUR FROM check_in_time)::int AS hour,
       COUNT(*)::int AS count
     FROM check_in_records
     WHERE tenant_id = $1 AND check_in_time >= $2 AND check_in_time <= $3
       AND status != 'cancelled'
     GROUP BY EXTRACT(HOUR FROM check_in_time)
     ORDER BY count DESC`,
    [tenantId, startDate, endDate],
  );

  return rows;
}

/**
 * Get check-in method breakdown: count per check_in_method in the date range.
 */
export async function getMethodBreakdown(tenantId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT
       check_in_method AS method,
       COUNT(*)::int AS count
     FROM check_in_records
     WHERE tenant_id = $1 AND check_in_time >= $2 AND check_in_time <= $3
       AND status != 'cancelled'
     GROUP BY check_in_method
     ORDER BY count DESC`,
    [tenantId, startDate, endDate],
  );

  return rows;
}

/**
 * Get customers with most no-shows (non-waived).
 */
export async function getHighNoShowCustomers(tenantId: string, limit = 10) {
  const { rows } = await adminPool.query(
    `SELECT
       ns.customer_id,
       c.first_name, c.last_name, c.email,
       COUNT(*)::int AS no_show_count,
       MAX(ns.detected_at) AS last_no_show
     FROM no_show_records ns
     JOIN customers c ON c.id = ns.customer_id
     WHERE ns.tenant_id = $1 AND ns.waived = false
     GROUP BY ns.customer_id, c.first_name, c.last_name, c.email
     ORDER BY no_show_count DESC
     LIMIT $2`,
    [tenantId, limit],
  );

  return rows;
}
