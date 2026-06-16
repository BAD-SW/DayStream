import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Get capacity configuration for a staff member.
 */
export async function getCapacityConfig(staffId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM staff_capacity_config WHERE staff_id = $1`,
    [staffId],
  );
  return rows[0] || null;
}

/**
 * Set/update capacity configuration for a staff member.
 */
export async function setCapacityConfig(staffId: string, config: {
  maxBookingsPerDay?: number | null;
  maxBookingsPerWeek?: number | null;
  maxConsecutiveHours?: number | null;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO staff_capacity_config (staff_id, max_bookings_per_day, max_bookings_per_week, max_consecutive_hours)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (staff_id)
     DO UPDATE SET
       max_bookings_per_day = $2,
       max_bookings_per_week = $3,
       max_consecutive_hours = $4,
       updated_at = NOW()
     RETURNING *`,
    [staffId, config.maxBookingsPerDay ?? null, config.maxBookingsPerWeek ?? null, config.maxConsecutiveHours ?? null],
  );
  return rows[0];
}

/**
 * Create a capacity override for a specific date (manager action).
 */
export async function createCapacityOverride(staffId: string, input: {
  overrideDate: string;
  maxBookings: number;
  reason: string;
  createdBy: string;
  tenantId: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO staff_capacity_overrides (staff_id, override_date, max_bookings, reason, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [staffId, input.overrideDate, input.maxBookings, input.reason, input.createdBy],
  );

  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'staff.capacity_override',
    resourceType: 'staff_profile',
    resourceId: staffId,
    details: { date: input.overrideDate, maxBookings: input.maxBookings, reason: input.reason },
  });

  return rows[0];
}

/**
 * Check if a staff member has capacity for another booking on a given date.
 * Returns { hasCapacity: boolean, current: number, max: number | null }
 */
export async function checkDailyCapacity(staffId: string, date: string): Promise<{
  hasCapacity: boolean;
  current: number;
  max: number | null;
}> {
  // Check for date-specific override first
  const { rows: overrideRows } = await adminPool.query(
    `SELECT max_bookings FROM staff_capacity_overrides WHERE staff_id = $1 AND override_date = $2::date`,
    [staffId, date],
  );

  // Get base config
  const { rows: configRows } = await adminPool.query(
    `SELECT max_bookings_per_day FROM staff_capacity_config WHERE staff_id = $1`,
    [staffId],
  );

  const max = overrideRows.length > 0
    ? overrideRows[0].max_bookings
    : (configRows.length > 0 ? configRows[0].max_bookings_per_day : null);

  if (max === null) return { hasCapacity: true, current: 0, max: null };

  // Count current bookings for this date
  const { rows: countRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM bookings
     WHERE staff_id = $1
       AND start_time::date = $2::date
       AND status IN ('confirmed', 'checked_in')`,
    [staffId, date],
  );

  const current = countRows[0].count;
  return { hasCapacity: current < max, current, max };
}

/**
 * Check weekly capacity for a staff member.
 */
export async function checkWeeklyCapacity(staffId: string, date: string): Promise<{
  hasCapacity: boolean;
  current: number;
  max: number | null;
}> {
  const { rows: configRows } = await adminPool.query(
    `SELECT max_bookings_per_week FROM staff_capacity_config WHERE staff_id = $1`,
    [staffId],
  );

  const max = configRows.length > 0 ? configRows[0].max_bookings_per_week : null;
  if (max === null) return { hasCapacity: true, current: 0, max: null };

  // Get the week boundaries (Monday to Sunday)
  const { rows: countRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM bookings
     WHERE staff_id = $1
       AND start_time::date >= date_trunc('week', $2::date)
       AND start_time::date < date_trunc('week', $2::date) + INTERVAL '7 days'
       AND status IN ('confirmed', 'checked_in')`,
    [staffId, date],
  );

  const current = countRows[0].count;
  return { hasCapacity: current < max, current, max };
}

/**
 * Get current utilization for a staff member (for dashboard).
 */
export async function getUtilization(staffId: string, date: string) {
  const daily = await checkDailyCapacity(staffId, date);
  const weekly = await checkWeeklyCapacity(staffId, date);

  return { daily, weekly };
}
