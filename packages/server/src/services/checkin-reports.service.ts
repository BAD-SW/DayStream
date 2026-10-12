import { adminPool } from '../db/pool';

/*
 * Every report takes the tenant and, when given, one business. Dates are calendar days in the
 * business's own time zone, both ends included (start and end may be 'YYYY-MM-DD' or a full
 * timestamp, of which the day is used).
 */

const BOOKING_IN_RANGE = `(b.start_time AT TIME ZONE bus.timezone)::date BETWEEN $2::date AND $3::date`;
const CHECKIN_IN_RANGE = `(cr.check_in_time AT TIME ZONE bus.timezone)::date BETWEEN $2::date AND $3::date`;
const SCOPE = `bus.tenant_id = $1 AND ($4::uuid IS NULL OR b.business_id = $4)`;
const CHECKINS = `apt_check_in_records cr
     JOIN apt_bookings b ON b.id = cr.booking_id
     JOIN sys_businesses bus ON bus.id = b.business_id`;

const TOTAL_BOOKINGS = `(SELECT COUNT(*)::int FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
        WHERE ${SCOPE} AND ${BOOKING_IN_RANGE}
          AND b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'no_show')
       )`;

function rateOf(count: number, total: number) {
  const rate = total > 0 ? count / total : 0;
  return { rate: Math.round(rate * 10000) / 10000, percentage: Math.round(rate * 100 * 100) / 100 };
}

/**
 * Get attendance rate: checked-in bookings / total bookings in the date range.
 */
export async function getAttendanceRate(tenantId: string, startDate: string, endDate: string, businessId?: string) {
  const { rows } = await adminPool.query(
    `SELECT
       (SELECT COUNT(DISTINCT cr.booking_id)::int FROM ${CHECKINS}
         WHERE ${SCOPE} AND ${CHECKIN_IN_RANGE} AND cr.status != 'cancelled') AS checked_in_count,
       ${TOTAL_BOOKINGS} AS total_bookings`,
    [tenantId, startDate, endDate, businessId || null],
  );
  const { checked_in_count, total_bookings } = rows[0];
  return { checked_in_count, total_bookings, ...rateOf(checked_in_count, total_bookings) };
}

/**
 * Get no-show rate: no-show bookings / total bookings in the date range.
 */
export async function getNoShowRate(tenantId: string, startDate: string, endDate: string, businessId?: string) {
  const { rows } = await adminPool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM apt_no_show_records ns
          JOIN apt_bookings b ON b.id = ns.booking_id
          JOIN sys_businesses bus ON bus.id = b.business_id
         WHERE ${SCOPE} AND ${BOOKING_IN_RANGE}) AS no_show_count,
       ${TOTAL_BOOKINGS} AS total_bookings`,
    [tenantId, startDate, endDate, businessId || null],
  );
  const { no_show_count, total_bookings } = rows[0];
  return { no_show_count, total_bookings, ...rateOf(no_show_count, total_bookings) };
}

/**
 * Get walk-in volume in the date range.
 */
export async function getWalkInVolume(tenantId: string, startDate: string, endDate: string, businessId?: string) {
  const { rows } = await adminPool.query(
    `SELECT COUNT(*)::int AS walk_in_count
     FROM ${CHECKINS}
     WHERE ${SCOPE} AND ${CHECKIN_IN_RANGE}
       AND cr.check_in_method = 'walk_in' AND cr.status != 'cancelled'`,
    [tenantId, startDate, endDate, businessId || null],
  );
  return { walk_in_count: rows[0].walk_in_count };
}

/**
 * Get peak check-in times: busiest hours (business time) in the date range.
 */
export async function getPeakTimes(tenantId: string, startDate: string, endDate: string, businessId?: string) {
  const { rows } = await adminPool.query(
    `SELECT
       EXTRACT(HOUR FROM cr.check_in_time AT TIME ZONE bus.timezone)::int AS hour,
       COUNT(*)::int AS count
     FROM ${CHECKINS}
     WHERE ${SCOPE} AND ${CHECKIN_IN_RANGE}
       AND cr.status != 'cancelled'
     GROUP BY 1
     ORDER BY count DESC`,
    [tenantId, startDate, endDate, businessId || null],
  );
  return rows;
}

/**
 * Get check-in method breakdown: count per check_in_method in the date range.
 */
export async function getMethodBreakdown(tenantId: string, startDate: string, endDate: string, businessId?: string) {
  const { rows } = await adminPool.query(
    `SELECT
       cr.check_in_method AS method,
       COUNT(*)::int AS count
     FROM ${CHECKINS}
     WHERE ${SCOPE} AND ${CHECKIN_IN_RANGE}
       AND cr.status != 'cancelled'
     GROUP BY cr.check_in_method
     ORDER BY count DESC`,
    [tenantId, startDate, endDate, businessId || null],
  );
  return rows;
}

/**
 * Get customers with most no-shows (non-waived).
 */
export async function getHighNoShowCustomers(tenantId: string, limit = 10, businessId?: string) {
  const { rows } = await adminPool.query(
    `SELECT
       ns.customer_id,
       c.first_name, c.last_name, c.email,
       COUNT(*)::int AS no_show_count,
       MAX(ns.detected_at) AS last_no_show
     FROM apt_no_show_records ns
     JOIN cus_customers c ON c.id = ns.customer_id
     WHERE ns.tenant_id = $1 AND ns.waived = false AND ($3::uuid IS NULL OR c.business_id = $3)
     GROUP BY ns.customer_id, c.first_name, c.last_name, c.email
     ORDER BY no_show_count DESC
     LIMIT $2`,
    [tenantId, limit, businessId || null],
  );
  return rows;
}
