import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

interface AvailabilityQuery {
  serviceId: string;
  businessId: string;
  dateFrom: string;      // ISO date (YYYY-MM-DD)
  dateTo: string;        // ISO date
  staffId?: string;      // optional: filter to specific staff
  variantId?: string;    // optional: override duration from variant
}

interface AvailableSlot {
  start_time: string;    // ISO 8601 UTC
  end_time: string;
  duration: number;      // minutes
  available_staff: Array<{ id: string; first_name: string; last_name: string }>;
  capacity_remaining?: number;
}

interface TimeWindow {
  start: number; // minutes from midnight
  end: number;
}

/**
 * Get available booking slots for a service over a date range.
 */
export async function getAvailableSlots(query: AvailabilityQuery): Promise<AvailableSlot[]> {
  const { serviceId, businessId, dateFrom, dateTo, staffId, variantId } = query;

  // 1. Load service config
  const { rows: svcRows } = await adminPool.query(
    `SELECT s.*, sv.duration AS variant_duration
     FROM services s
     LEFT JOIN service_variants sv ON sv.id = $2
     WHERE s.id = $1 AND s.business_id = $3 AND s.status = 'active'`,
    [serviceId, variantId || serviceId, businessId], // if no variantId, join won't match but service loads
  );

  if (svcRows.length === 0) return [];

  const service = svcRows[0];
  const duration = service.variant_duration || service.default_duration;
  const bufferBefore = service.buffer_before || 0;
  const bufferAfter = service.buffer_after || 0;
  const totalBlock = bufferBefore + duration + bufferAfter;
  const capacity = service.max_capacity || 1;
  const bookingType = service.booking_type;
  const minAdvanceHours = service.min_advance_booking_hours || 2;
  const maxAdvanceDays = service.max_advance_booking_days || 30;

  // 2. Load service availability rules
  const { rows: availRules } = await adminPool.query(
    'SELECT * FROM service_availability_rules WHERE service_id = $1',
    [serviceId],
  );

  // 3. Load assigned staff
  const staffCondition = staffId
    ? 'AND ss.user_id = $2'
    : '';
  const staffParams = staffId ? [serviceId, staffId] : [serviceId];
  const { rows: assignedStaff } = await adminPool.query(
    `SELECT DISTINCT ss.user_id, u.first_name, u.last_name
     FROM service_staff ss
     JOIN users u ON u.id = ss.user_id
     WHERE ss.service_id = $1 ${staffCondition}`,
    staffParams,
  );

  // For resource-only bookings, staff is not required
  const needsStaff = bookingType !== 'resource';

  if (needsStaff && assignedStaff.length === 0) return [];

  // Calculate date boundaries
  const now = new Date();
  const earliestSlot = new Date(now.getTime() + minAdvanceHours * 60 * 60 * 1000);
  const latestDate = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);

  const startDate = new Date(dateFrom);
  const endDate = new Date(dateTo);

  // Clamp to allowed range
  const effectiveStart = startDate < earliestSlot ? earliestSlot : startDate;
  const effectiveEnd = endDate > latestDate ? latestDate : endDate;

  if (effectiveStart >= effectiveEnd) return [];

  // 4. Load existing bookings for the date range (for all relevant staff)
  const staffIds = assignedStaff.map((s: any) => s.user_id);
  const { rows: existingBookings } = await adminPool.query(
    `SELECT staff_id, start_time, end_time, buffer_before, buffer_after, status
     FROM bookings
     WHERE business_id = $1
       AND start_time < $3
       AND end_time > $2
       AND status IN ('pending', 'confirmed', 'in_progress')
       AND ($4::uuid[] IS NULL OR staff_id = ANY($4))`,
    [businessId, effectiveStart.toISOString(), effectiveEnd.toISOString(), staffIds.length > 0 ? staffIds : null],
  );

  // 5. Load active slot holds
  const { rows: activeHolds } = await adminPool.query(
    `SELECT staff_id, start_time, end_time
     FROM slot_holds
     WHERE business_id = $1
       AND expires_at > NOW()
       AND start_time < $3
       AND end_time > $2
       AND ($4::uuid[] IS NULL OR staff_id = ANY($4))`,
    [businessId, effectiveStart.toISOString(), effectiveEnd.toISOString(), staffIds.length > 0 ? staffIds : null],
  );

  // 6. Load staff schedules
  const { rows: staffSchedules } = await adminPool.query(
    `SELECT user_id, day_of_week, start_time, end_time, effective_from, effective_to
     FROM staff_schedules
     WHERE business_id = $1 AND is_available = true
       AND ($2::uuid[] IS NULL OR user_id = ANY($2))`,
    [businessId, staffIds.length > 0 ? staffIds : null],
  );

  // 7. Load staff time off
  const { rows: timeOff } = await adminPool.query(
    `SELECT user_id, start_time, end_time
     FROM staff_time_off
     WHERE business_id = $1
       AND start_time < $3
       AND end_time > $2
       AND ($4::uuid[] IS NULL OR user_id = ANY($4))`,
    [businessId, effectiveStart.toISOString(), effectiveEnd.toISOString(), staffIds.length > 0 ? staffIds : null],
  );

  // 8. For shared/group: load existing bookings count per slot
  let sharedBookingCounts: Map<string, number> | undefined;
  if (bookingType === 'shared' || bookingType === 'group') {
    const { rows: counts } = await adminPool.query(
      `SELECT start_time, COUNT(*)::int AS count
       FROM bookings
       WHERE service_id = $1 AND business_id = $2
         AND start_time >= $3 AND start_time < $4
         AND status IN ('pending', 'confirmed', 'in_progress')
       GROUP BY start_time`,
      [serviceId, businessId, effectiveStart.toISOString(), effectiveEnd.toISOString()],
    );
    sharedBookingCounts = new Map(counts.map((r: any) => [new Date(r.start_time).toISOString(), r.count]));
  }

  // Generate slots day by day
  const slots: AvailableSlot[] = [];
  const slotInterval = 15; // generate slots every 15 minutes

  let currentDay = new Date(effectiveStart);
  currentDay.setUTCHours(0, 0, 0, 0);

  const endDay = new Date(effectiveEnd);

  while (currentDay <= endDay) {
    const dayOfWeek = currentDay.getUTCDay();
    const dateStr = currentDay.toISOString().slice(0, 10);

    // Check service availability rules for this day
    const serviceHours = getServiceHoursForDay(availRules, dayOfWeek, dateStr);
    if (serviceHours.length === 0) {
      currentDay.setUTCDate(currentDay.getUTCDate() + 1);
      continue;
    }

    // For each time window the service is available
    for (const window of serviceHours) {
      // Generate candidate slots within this window
      for (let mins = window.start; mins + duration <= window.end; mins += slotInterval) {
        const slotStart = new Date(currentDay);
        slotStart.setUTCHours(0, 0, 0, 0);
        slotStart.setUTCMinutes(mins);

        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

        // Enforce lead time
        if (slotStart <= earliestSlot) continue;

        // For shared/group: check capacity
        if (sharedBookingCounts) {
          const key = slotStart.toISOString();
          const currentCount = sharedBookingCounts.get(key) || 0;
          if (currentCount >= capacity) continue;

          // Shared/group slots don't need per-staff validation the same way
          slots.push({
            start_time: slotStart.toISOString(),
            end_time: slotEnd.toISOString(),
            duration,
            available_staff: assignedStaff.map((s: any) => ({ id: s.user_id, first_name: s.first_name, last_name: s.last_name })),
            capacity_remaining: capacity - currentCount,
          });
          continue;
        }

        // For individual/resource: find at least one available staff member
        const availableStaffForSlot = needsStaff
          ? getAvailableStaffForSlot(
              assignedStaff, slotStart, slotEnd, bufferBefore, bufferAfter,
              staffSchedules, timeOff, existingBookings, activeHolds, dayOfWeek, dateStr,
            )
          : assignedStaff;

        if (availableStaffForSlot.length === 0 && needsStaff) continue;

        slots.push({
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
          duration,
          available_staff: availableStaffForSlot.map((s: any) => ({ id: s.user_id, first_name: s.first_name, last_name: s.last_name })),
        });
      }
    }

    currentDay.setUTCDate(currentDay.getUTCDate() + 1);
  }

  return slots;
}

/**
 * Get service available hours for a specific day based on availability rules.
 * Returns time windows as minutes from midnight.
 */
function getServiceHoursForDay(rules: any[], dayOfWeek: number, dateStr: string): TimeWindow[] {
  // Check for blocks
  for (const rule of rules) {
    if (rule.rule_type === 'block') {
      if (rule.blocked_dates && rule.blocked_dates.includes(dateStr)) {
        return []; // day is blocked
      }
      if (rule.effective_from && rule.effective_to) {
        if (dateStr >= rule.effective_from && dateStr <= rule.effective_to) {
          return []; // within block range
        }
      }
    }
  }

  // Check seasonal rules
  for (const rule of rules) {
    if (rule.rule_type === 'seasonal') {
      if (rule.effective_from && rule.effective_to) {
        if (dateStr < rule.effective_from || dateStr > rule.effective_to) {
          return []; // outside seasonal window
        }
      }
    }
  }

  // Get recurring rules for this day
  const windows: TimeWindow[] = [];
  const recurringRules = rules.filter((r) => r.rule_type === 'recurring');

  if (recurringRules.length === 0) {
    // No recurring rules = available all day (default business hours assumption: 8:00-20:00)
    return [{ start: 8 * 60, end: 20 * 60 }];
  }

  for (const rule of recurringRules) {
    if (rule.days_of_week && rule.days_of_week.includes(dayOfWeek)) {
      // Check effective dates
      if (rule.effective_from && dateStr < rule.effective_from) continue;
      if (rule.effective_to && dateStr > rule.effective_to) continue;

      const start = timeToMinutes(rule.start_time);
      const end = timeToMinutes(rule.end_time);
      if (start < end) {
        windows.push({ start, end });
      }
    }
  }

  return windows;
}

/**
 * Check which staff members are available for a specific slot.
 */
function getAvailableStaffForSlot(
  assignedStaff: any[],
  slotStart: Date,
  slotEnd: Date,
  bufferBefore: number,
  bufferAfter: number,
  staffSchedules: any[],
  timeOff: any[],
  existingBookings: any[],
  activeHolds: any[],
  dayOfWeek: number,
  dateStr: string,
): any[] {
  const blockStart = new Date(slotStart.getTime() - bufferBefore * 60 * 1000);
  const blockEnd = new Date(slotEnd.getTime() + bufferAfter * 60 * 1000);

  return assignedStaff.filter((staff: any) => {
    const userId = staff.user_id;

    // Check staff schedule (must be working this day/time)
    const schedules = staffSchedules.filter((s: any) => s.user_id === userId && s.day_of_week === dayOfWeek);
    if (schedules.length > 0) {
      const slotMinutes = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
      const slotEndMinutes = slotEnd.getUTCHours() * 60 + slotEnd.getUTCMinutes();
      const isScheduled = schedules.some((s: any) => {
        const schedStart = timeToMinutes(s.start_time);
        const schedEnd = timeToMinutes(s.end_time);
        // Check effective dates
        if (s.effective_from && dateStr < s.effective_from) return false;
        if (s.effective_to && dateStr > s.effective_to) return false;
        return slotMinutes >= schedStart && slotEndMinutes <= schedEnd;
      });
      if (!isScheduled) return false;
    }
    // If no schedule defined for this staff, assume available (Phase 12 will fill this in)

    // Check time off
    const hasTimeOff = timeOff.some((to: any) =>
      to.user_id === userId &&
      new Date(to.start_time) < blockEnd &&
      new Date(to.end_time) > blockStart,
    );
    if (hasTimeOff) return false;

    // Check existing bookings (no overlap including buffer)
    const hasConflict = existingBookings.some((bk: any) => {
      if (bk.staff_id !== userId) return false;
      const bkStart = new Date(new Date(bk.start_time).getTime() - (bk.buffer_before || 0) * 60 * 1000);
      const bkEnd = new Date(new Date(bk.end_time).getTime() + (bk.buffer_after || 0) * 60 * 1000);
      return bkStart < blockEnd && bkEnd > blockStart;
    });
    if (hasConflict) return false;

    // Check slot holds
    const hasHold = activeHolds.some((h: any) =>
      h.staff_id === userId &&
      new Date(h.start_time) < blockEnd &&
      new Date(h.end_time) > blockStart,
    );
    if (hasHold) return false;

    return true;
  });
}

/**
 * Convert a time string (HH:MM:SS or HH:MM) to minutes from midnight.
 */
function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}
