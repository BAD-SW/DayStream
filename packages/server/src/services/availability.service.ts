import { adminPool } from '../db/pool';

interface AvailabilityQuery {
  serviceId: string;
  businessId: string;
  dateFrom: string;      // ISO date (YYYY-MM-DD)
  dateTo: string;        // ISO date
  staffId?: string;      // optional: pre-filter to specific staff
  locationId?: string;   // optional: pre-filter to specific location
  variantId?: string;    // optional: override duration from variant
}

interface AvailableSlotCombo {
  start_time: string;    // ISO 8601 UTC
  end_time: string;
  duration: number;      // minutes
  location_id: string | null;
  location_name: string | null;
  staff_id: string;
  staff_first_name: string;
  staff_last_name: string;
  capacity_remaining?: number;
}

interface AvailabilityResponse {
  timezone: string;
  slots: AvailableSlotCombo[];
}

interface TimeWindow {
  start: number; // minutes from midnight
  end: number;
  staffIds?: string[];    // if set, only these staff are valid for this window
  locationIds?: string[]; // if set, only these locations are valid for this window
}

// Legacy interface for backward compat (used by BookingFlow customer-facing)
interface AvailableSlot {
  start_time: string;
  end_time: string;
  duration: number;
  available_staff: Array<{ id: string; first_name: string; last_name: string }>;
  capacity_remaining?: number;
}

/**
 * Get available booking slots with full location+staff combinations.
 * Returns all valid (time, location, staff) tuples for client-side filtering.
 */
export async function getAvailableSlots(query: AvailabilityQuery): Promise<AvailableSlot[]> {
  const result = await getAvailabilityCombinations(query);
  // Convert to legacy format for backward compat
  const slotMap = new Map<string, AvailableSlot>();
  for (const combo of result.slots) {
    const key = combo.start_time;
    if (!slotMap.has(key)) {
      slotMap.set(key, {
        start_time: combo.start_time,
        end_time: combo.end_time,
        duration: combo.duration,
        available_staff: [],
        capacity_remaining: combo.capacity_remaining,
      });
    }
    const slot = slotMap.get(key)!;
    if (!slot.available_staff.find(s => s.id === combo.staff_id)) {
      slot.available_staff.push({ id: combo.staff_id, first_name: combo.staff_first_name, last_name: combo.staff_last_name });
    }
  }
  return Array.from(slotMap.values());
}

/**
 * Get full availability combinations (time × location × staff).
 * This is the rich endpoint used by the new multi-filter booking UI.
 */
export async function getAvailabilityCombinations(query: AvailabilityQuery): Promise<AvailabilityResponse> {
  const { serviceId, businessId, dateFrom, dateTo, staffId, locationId, variantId } = query;

  // 1. Load service config and business timezone
  const { rows: svcRows } = await adminPool.query(
    `SELECT s.*, sv.duration AS variant_duration, b.timezone AS business_timezone
     FROM svc_services s
     LEFT JOIN svc_variants sv ON sv.id = $2
     JOIN sys_businesses b ON b.id = s.business_id
     WHERE s.id = $1 AND s.business_id = $3 AND s.status = 'active'`,
    [serviceId, variantId || serviceId, businessId],
  );

  if (svcRows.length === 0) return { timezone: 'UTC', slots: [] };

  const service = svcRows[0];
  const businessTimezone = service.business_timezone || 'UTC';
  const duration = service.variant_duration || service.default_duration;
  const bufferBefore = service.buffer_before || 0;
  const bufferAfter = service.buffer_after || 0;
  const capacity = service.max_capacity || 1;
  const bookingType = service.booking_type;
  const minAdvanceHours = service.min_advance_booking_hours || 2;
  const maxAdvanceDays = service.max_advance_booking_days || 30;

  // 2. Load service availability rules (with scoping)
  const { rows: availRules } = await adminPool.query(
    'SELECT * FROM svc_availability_rules WHERE service_id = $1',
    [serviceId],
  );

  // 3. Load all business locations (location scoping is handled by availability rules)
  const { rows: allLocs } = await adminPool.query(
    "SELECT id, name FROM sys_locations WHERE business_id = $1 AND status = 'active'",
    [businessId],
  );
  let serviceLocations: Array<{ id: string; name: string }> = allLocs;
  // Apply location filter if specified in query
  if (locationId) {
    serviceLocations = serviceLocations.filter(l => l.id === locationId);
  }

  // 4. Load eligible staff
  const staffCondition = staffId ? 'AND ss.user_id = $2' : '';
  const staffParams = staffId ? [serviceId, staffId] : [serviceId];
  const { rows: assignedStaff } = await adminPool.query(
    `SELECT DISTINCT ss.user_id, u.first_name, u.last_name
     FROM svc_staff ss
     JOIN usr_users u ON u.id = ss.user_id
     WHERE ss.service_id = $1 ${staffCondition}`,
    staffParams,
  );

  let eligibleStaff = assignedStaff;
  if (assignedStaff.length === 0 && !staffId) {
    const { rows: allBusinessStaff } = await adminPool.query(
      `SELECT DISTINCT sp.user_id, sp.first_name, sp.last_name
       FROM stf_profiles sp
       JOIN usr_users u ON u.id = sp.user_id
       WHERE u.business_id = $1 AND sp.status = 'active' AND sp.user_id IS NOT NULL`,
      [businessId],
    );
    eligibleStaff = allBusinessStaff;
  }

  const needsStaff = bookingType !== 'resource';
  if (needsStaff && eligibleStaff.length === 0) return { timezone: businessTimezone, slots: [] };

  // 5. Calculate date boundaries
  const now = new Date();
  const earliestSlot = new Date(now.getTime() + minAdvanceHours * 60 * 60 * 1000);
  const latestDate = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);

  // 6. Load existing bookings
  const staffIds = eligibleStaff.map((s: any) => s.user_id);
  const { rows: existingBookings } = await adminPool.query(
    `SELECT staff_id, start_time, end_time, buffer_before, buffer_after
     FROM apt_bookings
     WHERE business_id = $1
       AND start_time < $3::timestamptz
       AND end_time > $2::timestamptz
       AND status IN ('pending', 'confirmed', 'in_progress')
       AND ($4::uuid[] IS NULL OR staff_id = ANY($4))`,
    [businessId, new Date(dateFrom).toISOString(), new Date(dateTo + 'T23:59:59Z').toISOString(), staffIds.length > 0 ? staffIds : null],
  );

  // 7. Load slot holds
  const { rows: activeHolds } = await adminPool.query(
    `SELECT staff_id, start_time, end_time
     FROM apt_slot_holds
     WHERE business_id = $1
       AND expires_at > NOW()
       AND start_time < $3::timestamptz
       AND end_time > $2::timestamptz
       AND ($4::uuid[] IS NULL OR staff_id = ANY($4))`,
    [businessId, new Date(dateFrom).toISOString(), new Date(dateTo + 'T23:59:59Z').toISOString(), staffIds.length > 0 ? staffIds : null],
  );

  // 8. Load staff schedules
  const { rows: staffSchedules } = await adminPool.query(
    `SELECT user_id, day_of_week, start_time, end_time, effective_from, effective_to
     FROM apt_staff_schedules
     WHERE business_id = $1 AND is_available = true
       AND ($2::uuid[] IS NULL OR user_id = ANY($2))`,
    [businessId, staffIds.length > 0 ? staffIds : null],
  );

  // 9. Load staff time off
  const { rows: timeOff } = await adminPool.query(
    `SELECT user_id, start_time, end_time
     FROM apt_staff_time_off
     WHERE business_id = $1
       AND start_time < $3::timestamptz
       AND end_time > $2::timestamptz
       AND ($4::uuid[] IS NULL OR user_id = ANY($4))`,
    [businessId, new Date(dateFrom).toISOString(), new Date(dateTo + 'T23:59:59Z').toISOString(), staffIds.length > 0 ? staffIds : null],
  );

  // 10. Load staff location assignments
  const { rows: staffLocationAssignments } = await adminPool.query(
    `SELECT staff_id, location_id FROM stf_location_assignments WHERE staff_id IN (
       SELECT id FROM stf_profiles WHERE user_id = ANY($1)
     )`,
    [staffIds.length > 0 ? staffIds : ['00000000-0000-0000-0000-000000000000']],
  );

  // Build a map: user_id -> location_ids they work at
  // First need staff profile IDs mapped to user IDs
  const { rows: staffProfileMap } = await adminPool.query(
    'SELECT id, user_id FROM stf_profiles WHERE user_id = ANY($1)',
    [staffIds.length > 0 ? staffIds : ['00000000-0000-0000-0000-000000000000']],
  );
  const profileToUser = new Map(staffProfileMap.map((r: any) => [r.id, r.user_id]));
  const staffLocations = new Map<string, string[]>(); // user_id -> location_ids
  for (const sla of staffLocationAssignments) {
    const userId = profileToUser.get(sla.staff_id);
    if (!userId) continue;
    if (!staffLocations.has(userId)) staffLocations.set(userId, []);
    staffLocations.get(userId)!.push(sla.location_id);
  }

  // Generate slots
  const slots: AvailableSlotCombo[] = [];
  const slotInterval = 15;

  let currentDateStr = dateFrom;
  while (currentDateStr <= dateTo) {
    const dayOfWeek = getDayOfWeekInBusinessTz(currentDateStr, businessTimezone);

    // Get service hours for this day, considering rule scoping
    const serviceHours = getServiceHoursForDay(availRules, dayOfWeek, currentDateStr);
    if (serviceHours.length === 0) {
      currentDateStr = nextDate(currentDateStr);
      continue;
    }

    for (const window of serviceHours) {
      for (let mins = window.start; mins + duration <= window.end; mins += slotInterval) {
        const slotHours = Math.floor(mins / 60);
        const slotMins = mins % 60;
        const slotStart = createDateInBusinessTz(currentDateStr, slotHours, slotMins, businessTimezone);
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

        // Enforce lead time and max advance
        if (slotStart <= earliestSlot) continue;
        if (slotStart > latestDate) continue;

        // Determine which staff are eligible for this window
        const windowEligibleStaff = window.staffIds
          ? eligibleStaff.filter((s: any) => window.staffIds!.includes(s.user_id))
          : eligibleStaff;

        // Determine available staff for this slot (check conflicts, time off, etc.)
        const availableStaffForSlot = needsStaff
          ? getAvailableStaffForSlot(
              windowEligibleStaff, slotStart, slotEnd, bufferBefore, bufferAfter,
              staffSchedules, timeOff, existingBookings, activeHolds, dayOfWeek, currentDateStr,
            )
          : windowEligibleStaff;

        if (availableStaffForSlot.length === 0 && needsStaff) continue;

        // Determine which locations are valid for this window
        const windowLocations = window.locationIds
          ? serviceLocations.filter(l => window.locationIds!.includes(l.id))
          : serviceLocations;

        // Generate combos: for each available staff × each valid location
        for (const staff of availableStaffForSlot) {
          const staffLocationIds = staffLocations.get(staff.user_id);

          for (const loc of windowLocations) {
            // If staff has location assignments, only include if they work at this location
            if (staffLocationIds && staffLocationIds.length > 0 && !staffLocationIds.includes(loc.id)) continue;

            slots.push({
              start_time: slotStart.toISOString(),
              end_time: slotEnd.toISOString(),
              duration,
              location_id: loc.id,
              location_name: loc.name,
              staff_id: staff.user_id,
              staff_first_name: staff.first_name,
              staff_last_name: staff.last_name,
            });
          }

          // If no locations defined at all, still include the slot without a location
          if (windowLocations.length === 0) {
            slots.push({
              start_time: slotStart.toISOString(),
              end_time: slotEnd.toISOString(),
              duration,
              location_id: null,
              location_name: null,
              staff_id: staff.user_id,
              staff_first_name: staff.first_name,
              staff_last_name: staff.last_name,
            });
          }
        }
      }
    }

    currentDateStr = nextDate(currentDateStr);
  }

  return { timezone: businessTimezone, slots };
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Get service hours for a day, considering availability rules.
 */
function getServiceHoursForDay(rules: any[], dayOfWeek: number, dateStr: string): TimeWindow[] {
  // Check for blocks
  for (const rule of rules) {
    if (rule.rule_type === 'block') {
      if (rule.blocked_dates && rule.blocked_dates.includes(dateStr)) return [];
      if (rule.effective_from && rule.effective_to) {
        if (dateStr >= rule.effective_from && dateStr <= rule.effective_to) return [];
      }
    }
  }

  // Check seasonal rules
  for (const rule of rules) {
    if (rule.rule_type === 'seasonal') {
      if (rule.effective_from && rule.effective_to) {
        if (dateStr < rule.effective_from || dateStr > rule.effective_to) return [];
      }
    }
  }

  // Get recurring rules for this day
  const windows: TimeWindow[] = [];
  const recurringRules = rules.filter((r) => r.rule_type === 'recurring');

  if (recurringRules.length === 0) {
    return [{ start: 8 * 60, end: 20 * 60 }]; // default: 8:00-20:00
  }

  for (const rule of recurringRules) {
    if (rule.days_of_week && rule.days_of_week.includes(dayOfWeek)) {
      if (rule.effective_from && dateStr < rule.effective_from) continue;
      if (rule.effective_to && dateStr > rule.effective_to) continue;

      const start = timeToMinutes(rule.start_time);
      const end = timeToMinutes(rule.end_time);
      if (start < end) {
        windows.push({
          start,
          end,
          staffIds: rule.staff_ids && rule.staff_ids.length > 0 ? rule.staff_ids : undefined,
          locationIds: rule.location_ids && rule.location_ids.length > 0 ? rule.location_ids : undefined,
        });
      }
    }
  }

  return windows;
}

/**
 * Check which staff members are available for a specific slot.
 */
function getAvailableStaffForSlot(
  eligibleStaff: any[],
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

  return eligibleStaff.filter((staff: any) => {
    const userId = staff.user_id;

    // Check staff schedule
    const schedules = staffSchedules.filter((s: any) => s.user_id === userId && s.day_of_week === dayOfWeek);
    if (schedules.length > 0) {
      const slotMinutes = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
      const slotEndMinutes = slotEnd.getUTCHours() * 60 + slotEnd.getUTCMinutes();
      const isScheduled = schedules.some((s: any) => {
        const schedStart = timeToMinutes(s.start_time);
        const schedEnd = timeToMinutes(s.end_time);
        if (s.effective_from && dateStr < s.effective_from) return false;
        if (s.effective_to && dateStr > s.effective_to) return false;
        return slotMinutes >= schedStart && slotEndMinutes <= schedEnd;
      });
      if (!isScheduled) return false;
    }
    // If no schedule defined, assume available

    // Check time off
    const hasTimeOff = timeOff.some((to: any) =>
      to.user_id === userId &&
      new Date(to.start_time) < blockEnd &&
      new Date(to.end_time) > blockStart,
    );
    if (hasTimeOff) return false;

    // Check existing bookings
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

/**
 * Advance a date string (YYYY-MM-DD) by one day.
 */
function nextDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Create a Date for a specific date + time in a given timezone.
 */
function createDateInBusinessTz(dateStr: string, hours: number, minutes: number, timezone: string): Date {
  const h = String(hours).padStart(2, '0');
  const m = String(minutes).padStart(2, '0');
  const localStr = `${dateStr}T${h}:${m}:00`;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const refDate = new Date(localStr + 'Z');
  const parts = formatter.formatToParts(refDate);
  const refHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const refMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');

  const utcMinutes = hours * 60 + minutes;
  const displayedMinutes = refHour * 60 + refMinute;
  const offsetMinutes = displayedMinutes - utcMinutes;

  return new Date(new Date(localStr + 'Z').getTime() - offsetMinutes * 60 * 1000);
}

/**
 * Get day-of-week in a given timezone for a date string.
 */
function getDayOfWeekInBusinessTz(dateStr: string, timezone: string): number {
  const d = createDateInBusinessTz(dateStr, 12, 0, timezone);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const weekday = formatter.format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? 0;
}
