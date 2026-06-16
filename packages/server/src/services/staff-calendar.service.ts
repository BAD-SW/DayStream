import { adminPool } from '../db/pool';
import { getEffectiveAvailabilityRange } from './staff-availability.service';

interface CalendarEntry {
  type: 'booking' | 'available' | 'leave' | 'blocked';
  date: string;
  startTime?: string;
  endTime?: string;
  details?: any;
}

/**
 * Get calendar data for a staff member over a date range.
 * Combines bookings, availability, leave, and overrides.
 */
export async function getStaffCalendar(staffId: string, startDate: string, endDate: string, locationId?: string) {
  // Get bookings in range
  const { rows: bookings } = await adminPool.query(
    `SELECT b.id, b.start_time, b.end_time, b.status, b.service_id,
            s.name AS service_name, c.first_name AS customer_first_name, c.last_name AS customer_last_name
     FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.staff_id = $1
       AND b.start_time::date >= $2::date
       AND b.start_time::date <= $3::date
       AND b.status IN ('confirmed', 'checked_in', 'completed')
     ORDER BY b.start_time`,
    [staffId, startDate, endDate],
  );

  // Get approved leave in range
  const { rows: leaveRequests } = await adminPool.query(
    `SELECT * FROM leave_requests
     WHERE staff_id = $1 AND status = 'approved'
       AND start_date <= $2::date AND end_date >= $3::date
     ORDER BY start_date`,
    [staffId, endDate, startDate],
  );

  // Get availability for date range
  const availability = await getEffectiveAvailabilityRange(staffId, startDate, endDate, locationId);

  // Get overrides (blocked time)
  const { rows: overrides } = await adminPool.query(
    `SELECT * FROM availability_overrides
     WHERE staff_id = $1 AND override_date BETWEEN $2::date AND $3::date
     ORDER BY override_date`,
    [staffId, startDate, endDate],
  );

  return {
    bookings: bookings.map((b) => ({
      type: 'booking' as const,
      id: b.id,
      date: new Date(b.start_time).toISOString().split('T')[0],
      startTime: b.start_time,
      endTime: b.end_time,
      status: b.status,
      serviceName: b.service_name,
      customerName: b.customer_first_name ? `${b.customer_first_name} ${b.customer_last_name}` : null,
    })),
    leave: leaveRequests.map((l) => ({
      type: 'leave' as const,
      id: l.id,
      startDate: l.start_date,
      endDate: l.end_date,
      leaveType: l.leave_type,
      notes: l.notes,
    })),
    availability,
    overrides: overrides.map((o) => ({
      type: 'blocked' as const,
      id: o.id,
      date: o.override_date,
      overrideType: o.override_type,
      startTime: o.start_time,
      endTime: o.end_time,
      reason: o.reason,
    })),
  };
}

/**
 * Get team calendar (all staff for a date range).
 */
export async function getTeamCalendar(tenantId: string, startDate: string, endDate: string, filters?: {
  locationId?: string;
  serviceId?: string;
  staffIds?: string[];
}) {
  // Get applicable staff
  let staffQuery = `SELECT id, first_name, last_name, staff_ref, profile_photo_path FROM staff_profiles WHERE tenant_id = $1 AND status = 'active'`;
  const staffParams: any[] = [tenantId];
  let paramIdx = 2;

  if (filters?.locationId) {
    staffQuery += ` AND id IN (SELECT staff_id FROM staff_location_assignments WHERE location_id = $${paramIdx++})`;
    staffParams.push(filters.locationId);
  }

  if (filters?.serviceId) {
    staffQuery += ` AND id IN (SELECT staff_id FROM staff_service_assignments WHERE service_id = $${paramIdx++})`;
    staffParams.push(filters.serviceId);
  }

  if (filters?.staffIds && filters.staffIds.length > 0) {
    staffQuery += ` AND id = ANY($${paramIdx++})`;
    staffParams.push(filters.staffIds);
  }

  staffQuery += ` ORDER BY last_name, first_name`;

  const { rows: staffMembers } = await adminPool.query(staffQuery, staffParams);

  // For each staff member, get their calendar
  const teamData = await Promise.all(
    staffMembers.map(async (staff) => {
      const calendar = await getStaffCalendar(staff.id, startDate, endDate, filters?.locationId);
      return {
        staff: {
          id: staff.id,
          firstName: staff.first_name,
          lastName: staff.last_name,
          staffRef: staff.staff_ref,
          profilePhotoPath: staff.profile_photo_path,
        },
        ...calendar,
      };
    }),
  );

  return teamData;
}

/**
 * Get staff performance metrics (sessions delivered, revenue).
 */
export async function getStaffMetrics(staffId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT
       COUNT(*)::int AS sessions_delivered,
       COUNT(DISTINCT start_time::date)::int AS days_worked
     FROM bookings
     WHERE staff_id = $1
       AND start_time::date BETWEEN $1 AND $2
       AND status = 'completed'`,
    [staffId, startDate, endDate],
  );

  // Revenue is harder to calculate without payment data — return session count for now
  return {
    sessionsDelivered: rows[0]?.sessions_delivered || 0,
    daysWorked: rows[0]?.days_worked || 0,
  };
}
