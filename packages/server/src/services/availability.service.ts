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

  // 8. Load business scheduling mode
  const { rows: bizSettings } = await adminPool.query(
    'SELECT scheduling_mode FROM sys_businesses WHERE id = $1',
    [businessId],
  );
  const schedulingMode = bizSettings[0]?.scheduling_mode || 'availability';

  // 9. Load staff working hours based on scheduling mode
  let staffWorkingData: any[] = [];
  let staffOverrides: any[] = [];

  if (schedulingMode === 'schedule') {
    // Use staff schedule entries
    const { rows } = await adminPool.query(
      `SELECT e.staff_id, sp.user_id, e.schedule_date, e.start_time, e.end_time
       FROM stf_schedule_entries e
       JOIN stf_profiles sp ON sp.id = e.staff_id
       WHERE e.business_id = $1 AND e.schedule_date >= $2 AND e.schedule_date <= $3 AND e.entry_type = 'shift'`,
      [businessId, dateFrom, dateTo],
    );
    staffWorkingData = rows;
  } else {
    // Use staff availability patterns
    const { rows: patterns } = await adminPool.query(
      `SELECT p.staff_id, sp.user_id, ps.day_of_week, ps.start_time, ps.end_time, p.effective_from, p.effective_to
       FROM stf_availability_patterns p
       JOIN stf_profiles sp ON sp.id = p.staff_id
       JOIN stf_availability_pattern_slots ps ON ps.pattern_id = p.id
       WHERE sp.user_id = ANY($1) AND p.is_default = true`,
      [staffIds.length > 0 ? staffIds : ['00000000-0000-0000-0000-000000000000']],
    );
    staffWorkingData = patterns;

    // Load availability overrides
    const { rows: overrides } = await adminPool.query(
      `SELECT o.staff_id, sp.user_id, o.override_date, o.override_type, o.start_time, o.end_time
       FROM stf_availability_overrides o
       JOIN stf_profiles sp ON sp.id = o.staff_id
       WHERE sp.user_id = ANY($1) AND o.override_date >= $2 AND o.override_date <= $3`,
      [staffIds.length > 0 ? staffIds : ['00000000-0000-0000-0000-000000000000'], dateFrom, dateTo],
    );
    staffOverrides = overrides;
  }

  // 10. Load location business hours
  const primaryLocationId = locationId || (serviceLocations.length > 0 ? serviceLocations[0].id : null);
  let locationHours: any[] = [];
  let locationHourOverrides: any[] = [];
  if (primaryLocationId) {
    const { rows: hours } = await adminPool.query(
      'SELECT * FROM sys_location_hours WHERE location_id = $1',
      [primaryLocationId],
    );
    locationHours = hours;

    const { rows: overrides } = await adminPool.query(
      'SELECT * FROM sys_location_hour_overrides WHERE location_id = $1 AND override_date >= $2 AND override_date <= $3',
      [primaryLocationId, dateFrom, dateTo],
    );
    locationHourOverrides = overrides;
  }

  // 11. Load location-staff assignments for filtering
  let staffLocationMap = new Map<string, string[]>();
  if (primaryLocationId) {
    const { rows: locStaff } = await adminPool.query(
      'SELECT ls.staff_id, sp.user_id FROM sys_location_staff ls JOIN stf_profiles sp ON sp.id = ls.staff_id WHERE ls.location_id = $1',
      [primaryLocationId],
    );
    if (locStaff.length > 0) {
      for (const ls of locStaff) {
        if (!staffLocationMap.has(ls.user_id)) staffLocationMap.set(ls.user_id, []);
        staffLocationMap.get(ls.user_id)!.push(primaryLocationId);
      }
    }
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

        // Determine available staff for this slot (check conflicts, working hours, etc.)
        const availableStaffForSlot = needsStaff
          ? getAvailableStaffForSlot(
              windowEligibleStaff, slotStart, slotEnd, bufferBefore, bufferAfter,
              existingBookings, activeHolds, dayOfWeek, currentDateStr,
              schedulingMode, staffWorkingData, staffOverrides,
              locationHours, locationHourOverrides,
            )
          : windowEligibleStaff;

        if (availableStaffForSlot.length === 0 && needsStaff) continue;

        // Determine which locations are valid for this window
        const windowLocations = window.locationIds
          ? serviceLocations.filter(l => window.locationIds!.includes(l.id))
          : serviceLocations;

        // Generate combos: for each available staff × each valid location
        for (const staff of availableStaffForSlot) {
          const staffLocationIds = staffLocationMap.get(staff.user_id);

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
  existingBookings: any[],
  activeHolds: any[],
  dayOfWeek: number,
  dateStr: string,
  schedulingMode: string,
  staffWorkingData: any[],
  staffOverrides: any[],
  locationHours: any[],
  locationHourOverrides: any[],
): any[] {
  const blockStart = new Date(slotStart.getTime() - bufferBefore * 60 * 1000);
  const blockEnd = new Date(slotEnd.getTime() + bufferAfter * 60 * 1000);

  // Check if slot is within business hours
  if (locationHours.length > 0) {
    // Check for holiday override on this date
    const override = locationHourOverrides.find((o: any) => {
      const oDate = typeof o.override_date === 'string' ? o.override_date.split('T')[0] : o.override_date;
      return oDate === dateStr;
    });
    if (override) {
      if (override.is_closed) return []; // Business closed this day
      if (override.open_time && override.close_time) {
        const slotMinutes = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
        const slotEndMinutes = slotEnd.getUTCHours() * 60 + slotEnd.getUTCMinutes();
        const openMin = timeToMinutes(override.open_time);
        const closeMin = timeToMinutes(override.close_time);
        if (slotMinutes < openMin || slotEndMinutes > closeMin) return [];
      }
    } else {
      // Normal business hours check
      const bh = locationHours.find((h: any) => h.day_of_week === dayOfWeek);
      if (bh) {
        if (bh.is_closed) return [];
        if (bh.open_time && bh.close_time) {
          const slotMinutes = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
          const slotEndMinutes = slotEnd.getUTCHours() * 60 + slotEnd.getUTCMinutes();
          const openMin = timeToMinutes(bh.open_time);
          const closeMin = timeToMinutes(bh.close_time);
          if (slotMinutes < openMin || slotEndMinutes > closeMin) return [];
        }
      }
    }
  }

  return eligibleStaff.filter((staff: any) => {
    const userId = staff.user_id;

    // Check if staff is working at this time based on scheduling mode
    if (schedulingMode === 'schedule') {
      // Check stf_schedule_entries for this date
      const entries = staffWorkingData.filter((e: any) => {
        const eDate = typeof e.schedule_date === 'string' ? e.schedule_date.split('T')[0] : e.schedule_date;
        return e.user_id === userId && eDate === dateStr;
      });
      if (entries.length === 0) return false; // Not scheduled this day
      const slotMinutes = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
      const slotEndMinutes = slotEnd.getUTCHours() * 60 + slotEnd.getUTCMinutes();
      const isWithinShift = entries.some((e: any) => {
        const shiftStart = timeToMinutes(e.start_time);
        const shiftEnd = timeToMinutes(e.end_time);
        return slotMinutes >= shiftStart && slotEndMinutes <= shiftEnd;
      });
      if (!isWithinShift) return false;
    } else {
      // Check stf_availability_patterns
      // First check overrides for this date
      const dateOverride = staffOverrides.find((o: any) => {
        const oDate = typeof o.override_date === 'string' ? o.override_date.split('T')[0] : o.override_date;
        return o.user_id === userId && oDate === dateStr;
      });
      if (dateOverride) {
        if (dateOverride.override_type === 'remove') return false; // Day off
        if (dateOverride.override_type === 'modify' || dateOverride.override_type === 'add') {
          if (dateOverride.start_time && dateOverride.end_time) {
            const slotMinutes = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
            const slotEndMinutes = slotEnd.getUTCHours() * 60 + slotEnd.getUTCMinutes();
            const oStart = timeToMinutes(dateOverride.start_time);
            const oEnd = timeToMinutes(dateOverride.end_time);
            if (slotMinutes < oStart || slotEndMinutes > oEnd) return false;
          }
        }
      } else {
        // Check availability pattern for this day of week
        const allStaffPatterns = staffWorkingData.filter((p: any) => p.user_id === userId);
        const dayPatterns = allStaffPatterns.filter((p: any) => p.day_of_week === dayOfWeek);

        if (allStaffPatterns.length === 0) {
          // No patterns defined at all — assume staff is available (no restrictions set up)
        } else if (dayPatterns.length > 0) {
          const slotMinutes = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
          const slotEndMinutes = slotEnd.getUTCHours() * 60 + slotEnd.getUTCMinutes();
          const isAvailable = dayPatterns.some((p: any) => {
            if (p.effective_from && dateStr < p.effective_from) return false;
            if (p.effective_to && dateStr > p.effective_to) return false;
            const patStart = timeToMinutes(p.start_time);
            const patEnd = timeToMinutes(p.end_time);
            return slotMinutes >= patStart && slotEndMinutes <= patEnd;
          });
          if (!isAvailable) return false;
        } else {
          // Staff has patterns but none for this day — they don't work this day
          return false;
        }
      }
    }

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
