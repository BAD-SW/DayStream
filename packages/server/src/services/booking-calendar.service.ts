import { adminPool } from '../db/pool';
import { getAvailabilityCombinations } from './availability.service';
import { staffWorkingOnDay } from './staff-working.service';

interface CalendarQuery {
  businessId: string;
  view: 'day' | 'week' | 'month';
  date: string;           // ISO date (YYYY-MM-DD)
  staffId?: string;
  resourceId?: string;
  serviceIds?: string[];
  status?: string;
  /** one location at a time (hub); bookings, opening hours and staff of that location */
  locationId?: string;
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

interface CalendarBooking {
  id: string;
  service_id: string;
  service_name: string;
  customer_name: string;
  staff_id: string | null;
  staff_name: string;
  start_time: string;
  end_time: string;
  status: string;
  booking_type: string;
  booking_reference: string;
  resource_id: string | null;
  resource_capacity: number | null;
  service_max_capacity: number | null;
  participant_count: number;
  participants?: number;
  payment_status: PaymentStatus;
}

/**
 * A booking's payment status is derived, not stored: net paid = completed charges minus
 * completed refunds/credits, compared against the booking's own price. A booking with no
 * transactions at all (payment tracking is a newer feature — plenty of older bookings predate it)
 * reads as unpaid, same as one with an explicit outstanding balance.
 */
export function derivePaymentStatus(price: number, netPaid: number): PaymentStatus {
  if (price <= 0) return 'paid';
  if (netPaid >= price) return 'paid';
  if (netPaid > 0) return 'partial';
  return 'unpaid';
}

export interface CapacitySegment {
  start_time: string;
  end_time: string;
  booked: number;
  capacity: number;
}

/**
 * Split a set of active bookings (all sharing one resource, or one staff member) for a window
 * into contiguous time segments, each carrying the true concurrent headcount during that segment
 * (a checkpoint sweep, not a per-booking sum — two bookings that don't overlap *each other* must
 * never be added together just because both happen to overlap some third booking). Segments with
 * zero concurrent bookings are omitted; adjacent segments with the same headcount/capacity are
 * merged so the timeline doesn't fragment at every booking boundary that doesn't actually change
 * who's in the room.
 *
 * Capacity is carried per-booking, not as one fixed number: a resource has a single consistent
 * capacity, but a staff member's timeline can mix bookings from different services with different
 * capacities (a 1:1 massage vs. a 4-person class), so each segment's capacity is the max ceiling
 * of whichever bookings are actually active during it.
 */
export function computeCapacitySegments(
  bookings: Array<{ start_time: string; end_time: string; participant_count: number; capacity: number }>,
): CapacitySegment[] {
  const parsed = bookings
    .filter((b) => b.capacity > 0)
    .map((b) => ({
      start: new Date(b.start_time).getTime(),
      end: new Date(b.end_time).getTime(),
      count: b.participant_count || 1,
      capacity: b.capacity,
    }));
  if (parsed.length === 0) return [];

  const breakpoints = [...new Set(parsed.flatMap((b) => [b.start, b.end]))].sort((a, b) => a - b);

  const segments: CapacitySegment[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const segStart = breakpoints[i];
    const segEnd = breakpoints[i + 1];
    if (segStart >= segEnd) continue;

    const mid = (segStart + segEnd) / 2;
    const covering = parsed.filter((b) => b.start <= mid && b.end > mid);
    if (covering.length === 0) continue;

    const booked = covering.reduce((sum, b) => sum + b.count, 0);
    const capacity = Math.max(...covering.map((b) => b.capacity));

    const prev = segments[segments.length - 1];
    if (prev && prev.booked === booked && prev.capacity === capacity && prev.end_time === new Date(segStart).toISOString()) {
      prev.end_time = new Date(segEnd).toISOString();
    } else {
      segments.push({ start_time: new Date(segStart).toISOString(), end_time: new Date(segEnd).toISOString(), booked, capacity });
    }
  }
  return segments;
}

/**
 * Get calendar data for a given view.
 */
export async function getCalendar(query: CalendarQuery) {
  const { businessId, view, date, staffId, resourceId, serviceIds, status, locationId } = query;

  const { rows: bizRows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]);
  const timezone: string = bizRows[0]?.timezone || 'UTC';

  // `date` (and the week/month range derived from it) is a plain calendar date meant in the
  // business's own local time — the query window must be the UTC instants bounding that local
  // range, not the UTC calendar day of the same numbers, or bookings near local midnight land on
  // the wrong day (see item: month view showing an Aug 17 booking under Aug 16).
  const { startDate: startYMD, endDate: endYMD } = getDateRangeYMD(date, view);
  const startDate = zonedMidnightToUtc(startYMD, timezone);
  const endDate = zonedMidnightToUtc(endYMD, timezone);

  const conditions = ['b.business_id = $1', 'b.start_time < $3', 'b.end_time > $2'];
  const params: any[] = [businessId, startDate.toISOString(), endDate.toISOString()];
  let paramIndex = 4;

  if (staffId) {
    conditions.push(`b.staff_id = $${paramIndex++}`);
    params.push(staffId);
  }
  if (resourceId) {
    conditions.push(`b.resource_id = $${paramIndex++}`);
    params.push(resourceId);
  }
  if (serviceIds && serviceIds.length > 0) {
    conditions.push(`b.service_id = ANY($${paramIndex++}::uuid[])`);
    params.push(serviceIds);
  }
  if (locationId) {
    conditions.push(`b.location_id = $${paramIndex++}`);
    params.push(locationId);
  }
  if (status) {
    conditions.push(`b.status = $${paramIndex++}`);
    params.push(status);
  } else {
    conditions.push("b.status NOT IN ('cancelled')");
  }

  const where = conditions.join(' AND ');

  // White / grey in the calendar follows the primary location's opening hours, closing days and
  // holidays (CAL-hours, 11 Nov 2026). Not set up: hours_set_up false and the calendar stays white.
  const opening = await loadOpeningHours(businessId, startYMD, endYMD, locationId);

  if (view === 'month') {
    // Month view: return daily counts, bucketed by the business's own timezone — a booking at
    // 11pm local time must land on that local day, not shift to the next UTC day. Cast to text in
    // SQL rather than returning a `date` value: node-postgres's default type parser turns a `date`
    // column into a JS Date constructed in the *server process's own* local timezone, which then
    // silently shifts the day again on JSON serialization whenever that host isn't UTC.
    const { rows } = await adminPool.query(
      `SELECT DATE(b.start_time AT TIME ZONE $${paramIndex})::text AS day, COUNT(*)::int AS count,
              json_agg(json_build_object('status', b.status)) AS statuses
       FROM apt_bookings b
       WHERE ${where}
       GROUP BY DATE(b.start_time AT TIME ZONE $${paramIndex})
       ORDER BY day`,
      [...params, timezone],
    );

    // Per service and day: booked against the day's capacity (CAL-15 / CAL-16, 11 Nov 2026).
    const perService = await monthServiceCapacity(businessId, startYMD, endYMD, where, params, paramIndex, timezone, serviceIds, locationId);
    return {
      view: 'month',
      date,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      services: perService.services,
      days: rows.map((r: any) => ({
        date: r.day,
        count: r.count,
        statuses: r.statuses,
        services: perService.byDay.get(r.day) || [],
      })),
      capacity_days: Object.fromEntries(perService.byDay),
      hours_set_up: opening.setUp,
      day_hours: opening.days,
    };
  }

  // Day/Week view: return individual bookings
  const { rows } = await adminPool.query(
    `SELECT b.id, b.service_id, b.start_time, b.end_time, b.status, b.booking_type, b.booking_reference,
            b.resource_id, b.staff_id, b.participant_count, b.price,
            s.name AS service_name, s.max_capacity AS service_max_capacity,
            COALESCE(c.first_name || ' ' || c.last_name, b.walk_in_name, 'Walk-in') AS customer_name,
            COALESCE(u.first_name || ' ' || u.last_name, '') AS staff_name,
            r.capacity AS resource_capacity
     FROM apt_bookings b
     JOIN svc_services s ON s.id = b.service_id
     LEFT JOIN cus_customers c ON c.id = b.customer_id
     LEFT JOIN usr_users u ON u.id = b.staff_id
     LEFT JOIN res_resources r ON r.id = b.resource_id
     WHERE ${where}
     ORDER BY b.start_time`,
    params,
  );

  // Payment status per booking (item 3c-b): derived from the payment ledger, not stored — net
  // paid = completed charges minus completed refunds/credits, compared to the booking's price.
  const bookingIds = rows.map((r: any) => r.id);
  const netPaidByBooking = new Map<string, number>();
  if (bookingIds.length > 0) {
    const { rows: paymentRows } = await adminPool.query(
      `SELECT booking_id,
              SUM(CASE WHEN type = 'charge' AND status = 'completed' THEN amount ELSE 0 END)
              - SUM(CASE WHEN type IN ('refund', 'credit') AND status = 'completed' THEN amount ELSE 0 END) AS net_paid
       FROM pay_transactions
       WHERE booking_id = ANY($1::uuid[])
       GROUP BY booking_id`,
      [bookingIds],
    );
    for (const row of paymentRows) netPaidByBooking.set(row.booking_id, parseInt(row.net_paid, 10) || 0);
  }

  // For shared/group, add participant count
  const bookings: CalendarBooking[] = [];
  for (const row of rows) {
    const entry: CalendarBooking = {
      id: row.id,
      service_id: row.service_id,
      service_name: row.service_name,
      customer_name: row.customer_name,
      staff_id: row.staff_id ?? null,
      staff_name: row.staff_name,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
      booking_type: row.booking_type,
      booking_reference: row.booking_reference,
      resource_id: row.resource_id ?? null,
      resource_capacity: row.resource_capacity ?? null,
      service_max_capacity: row.service_max_capacity ?? null,
      participant_count: row.participant_count ?? 1,
      payment_status: derivePaymentStatus(row.price ?? 0, netPaidByBooking.get(row.id) ?? 0),
    };

    if (row.booking_type === 'shared' || row.booking_type === 'group') {
      const { rows: countRows } = await adminPool.query(
        `SELECT COALESCE(SUM(COALESCE(participant_count, 1)), 0)::int AS count FROM apt_bookings
         WHERE service_id = $3 AND start_time = $1 AND business_id = $2
           AND status IN ('pending', 'confirmed', 'checked_in', 'in_progress')`,
        [row.start_time, businessId, row.service_id],
      );
      entry.participants = countRows[0]?.count || 1;
    }

    bookings.push(entry);
  }

  // Capacity timelines: real concurrent-headcount segments, independent of any one booking block
  // — this is what actually answers "how full is this resource/staff member right now." Resources
  // have one consistent capacity; a staff member's capacity ceiling is taken from whichever
  // service(s) they're actively running (a 1:1 service caps at 1, a staff-led group class at its
  // own max_capacity).
  const activeStatuses = ['pending', 'confirmed', 'checked_in', 'in_progress'];
  const byResource = new Map<string, Array<{ start_time: string; end_time: string; participant_count: number; capacity: number }>>();
  const byStaff = new Map<string, Array<{ start_time: string; end_time: string; participant_count: number; capacity: number }>>();
  for (const row of rows) {
    if (!activeStatuses.includes(row.status)) continue;
    if (row.resource_id) {
      if (!byResource.has(row.resource_id)) byResource.set(row.resource_id, []);
      byResource.get(row.resource_id)!.push({
        start_time: row.start_time, end_time: row.end_time, participant_count: row.participant_count ?? 1,
        capacity: row.resource_capacity ?? 1,
      });
    }
    if (row.staff_id) {
      if (!byStaff.has(row.staff_id)) byStaff.set(row.staff_id, []);
      byStaff.get(row.staff_id)!.push({
        start_time: row.start_time, end_time: row.end_time, participant_count: row.participant_count ?? 1,
        capacity: row.service_max_capacity ?? 1,
      });
    }
  }
  const resourceTimelines: Record<string, CapacitySegment[]> = {};
  for (const [resId, resBookings] of byResource) resourceTimelines[resId] = computeCapacitySegments(resBookings);
  const staffTimelines: Record<string, CapacitySegment[]> = {};
  for (const [stId, stBookings] of byStaff) staffTimelines[stId] = computeCapacitySegments(stBookings);

  // Resource blocks (item 1: a business owner can block out part of an otherwise-open day —
  // e.g. a plumber visiting a specific pool 8-10am — via the resource's own schedule; the
  // calendar should show that block, not just the resource's regular booking activity).
  const blockedResourceIds = [...new Set(rows.map((r: any) => r.resource_id).filter(Boolean))] as string[];
  const resourceBlocks: Record<string, Array<{ start_time: string; end_time: string; reason: string | null }>> = {};
  if (blockedResourceIds.length > 0) {
    const { rows: blockRows } = await adminPool.query(
      `SELECT resource_id, block_date::text AS block_date, start_time, end_time, reason
       FROM res_schedule_blocks
       WHERE resource_id = ANY($1::uuid[]) AND block_date >= $2::date AND block_date < $3::date
       ORDER BY block_date, start_time`,
      [blockedResourceIds, startYMD, endYMD],
    );
    for (const row of blockRows) {
      const blockStart = zonedDateTimeToUtc(row.block_date, row.start_time || '00:00:00', timezone);
      const blockEnd = zonedDateTimeToUtc(row.block_date, row.end_time || '23:59:59', timezone);
      if (!resourceBlocks[row.resource_id]) resourceBlocks[row.resource_id] = [];
      resourceBlocks[row.resource_id].push({ start_time: blockStart.toISOString(), end_time: blockEnd.toISOString(), reason: row.reason ?? null });
    }
  }

  // Day view: what each service can still take, per 30 minutes, and the staff working (CAL-7 b, CAL-8)
  const dayExtra = view === 'day' ? await daySlotCapacity(businessId, date, timezone, rows, serviceIds, !!opening.days[date] && 'closed' in opening.days[date], locationId) : null;
  // Week with exactly one service filtered: its numbers per 30 minutes on every day too (THE-23 4.3)
  let weekSlots: Record<string, Record<string, SlotCapacity>> | null = null;
  if (view === 'week' && serviceIds && serviceIds.length === 1) {
    weekSlots = {};
    // every booking of the week (staff busy with another service count as not free)
    const { rows: allWeek } = await adminPool.query(
      `SELECT b.id, b.service_id, b.staff_id, b.start_time, b.end_time, b.status, b.participant_count, COALESCE(u.first_name || ' ' || u.last_name, '') AS staff_name
         FROM apt_bookings b LEFT JOIN usr_users u ON u.id = b.staff_id
        WHERE b.business_id = $1 AND b.start_time < $3 AND b.end_time > $2 AND b.status NOT IN ('cancelled') ${locationId ? 'AND b.location_id = $4' : ''}`,
      locationId ? [businessId, startDate.toISOString(), endDate.toISOString(), locationId] : [businessId, startDate.toISOString(), endDate.toISOString()],
    );
    for (let d = new Date(startYMD + 'T12:00:00Z'); d.toISOString().slice(0, 10) < endYMD; d.setUTCDate(d.getUTCDate() + 1)) {
      const ymd = d.toISOString().slice(0, 10);
      const dayStart = zonedMidnightToUtc(ymd, timezone).getTime(); const dayEnd = dayStart + 864e5;
      const dayRows = allWeek.filter((r: any) => new Date(r.start_time).getTime() < dayEnd && new Date(r.end_time).getTime() > dayStart);
      const x = await daySlotCapacity(businessId, ymd, timezone, dayRows, serviceIds, !!opening.days[ymd] && 'closed' in opening.days[ymd], locationId);
      weekSlots[ymd] = x.slots[serviceIds[0]] || {};
    }
  }


  return {
    view,
    date,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    bookings,
    resourceTimelines,
    staffTimelines,
    resourceBlocks,
    hours_set_up: opening.setUp,
    day_hours: opening.days,
    ...(dayExtra ? { day_services: dayExtra.services, slot_capacity: dayExtra.slots, day_staff: dayExtra.staff } : {}),
    ...(weekSlots ? { week_slot_capacity: weekSlots } : {}),
  };
}

export type DayHours = { open: string; close: string } | { closed: true; reason: string };
const WEEKDAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/**
 * Opening hours per day of [startYMD, endYMD) from the primary location: its weekly hours, then its
 * date overrides (holidays, special hours). With no weekly hours set up, only override days get an
 * entry and setUp is false (the calendar stays white everywhere else).
 */
export async function loadOpeningHours(businessId: string, startYMD: string, endYMD: string, locationId?: string): Promise<{ setUp: boolean; days: Record<string, DayHours> }> {
  const { rows: locs } = await adminPool.query(
    `SELECT id FROM sys_locations WHERE business_id = $1 AND status = 'active' ${locationId ? 'AND id = $2' : ''} ORDER BY is_primary DESC, created_at LIMIT 1`, locationId ? [businessId, locationId] : [businessId],
  );
  const loc = locs[0]?.id;
  if (!loc) return { setUp: false, days: {} };
  const weekly = (await adminPool.query('SELECT day_of_week, is_closed, open_time, close_time FROM sys_location_hours WHERE location_id = $1', [loc])).rows;
  const overrides = (await adminPool.query(
    `SELECT override_date::text AS d, label, is_closed, open_time, close_time FROM sys_location_hour_overrides
      WHERE location_id = $1 AND override_date >= $2::date AND override_date < $3::date`, [loc, startYMD, endYMD],
  )).rows;
  const hm = (t: any) => String(t || '').slice(0, 5);
  const setUp = weekly.some((w: any) => !w.is_closed && w.open_time && w.close_time);
  const days: Record<string, DayHours> = {};
  for (let d = new Date(startYMD + 'T12:00:00Z'); d.toISOString().slice(0, 10) < endYMD; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const o = overrides.find((x: any) => x.d === day);
    if (o) {
      days[day] = o.is_closed || !o.open_time || !o.close_time
        ? { closed: true, reason: o.label ? `Closed: ${o.label}` : 'Closed' }
        : { open: hm(o.open_time), close: hm(o.close_time) };
      continue;
    }
    if (!setUp) continue;
    const dow = d.getUTCDay();
    const w = weekly.find((x: any) => x.day_of_week === dow);
    days[day] = !w || w.is_closed || !w.open_time || !w.close_time
      ? { closed: true, reason: `Closed on ${WEEKDAY_NAMES[dow]}` }
      : { open: hm(w.open_time), close: hm(w.close_time) };
  }
  return { setUp, days };
}

export interface SlotCapacity { booked: number; left: number; free_staff?: string[]; busy_other?: string[] }

/** Local "HH:MM" of the 30-minute cell an instant falls in. */
function cellOf(iso: string | Date, timezone: string): { day: string; cell: string } {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  const h = g('hour') === '24' ? '00' : g('hour');
  const m = Number(g('minute')) < 30 ? '00' : '30';
  return { day: `${g('year')}-${g('month')}-${g('day')}`, cell: `${h}:${m}` };
}

/**
 * Day view, per active service and 30-minute cell (CAL-7 b, 11 Nov 2026):
 * - booked: bookings running at the start of the cell (people for shared rooms and group sessions);
 * - left: what can still be booked starting in that cell = free places (shared / group), staff who
 *   do the service, work then and are free (staff services), or 1 when the room / device is free.
 * Taken from the same availability engine as New Appointment, so it already counts shifts, time
 * off, opening hours, holidays and other services using the same staff. Cells nobody can take and
 * nobody booked are left out. day_staff: the staff working that day (free at some time, or booked).
 */
async function daySlotCapacity(businessId: string, date: string, timezone: string, rows: any[], serviceIds?: string[], closedDay = false, locationId?: string) {
  const filtered = serviceIds && serviceIds.length > 0;
  const { rows: svcs } = await adminPool.query(
    `SELECT s.id, s.name, s.booking_type, s.max_capacity,
            (SELECT v.id FROM svc_variants v WHERE v.service_id = s.id AND v.status = 'active' ORDER BY v.display_order, v.duration, v.created_at LIMIT 1) AS variant_id,
            CASE WHEN s.booking_type = 'resource' THEN 0 ELSE COALESCE(NULLIF((SELECT COUNT(*)::int FROM svc_staff ss WHERE ss.service_id = s.id), 0), (SELECT COUNT(DISTINCT sp.user_id)::int FROM stf_profiles sp JOIN usr_users u2 ON u2.id = sp.user_id WHERE u2.business_id = s.business_id AND sp.status = 'active' AND sp.user_id IS NOT NULL)) END AS staff_count
       FROM svc_services s
      WHERE s.business_id = $1 AND s.status = 'active' ${filtered ? 'AND s.id = ANY($2::uuid[])' : ''}
      ORDER BY s.name`,
    filtered ? [businessId, serviceIds] : [businessId],
  );
  const active = ['pending', 'confirmed', 'checked_in', 'in_progress'];
  const live = rows.filter((r: any) => active.includes(r.status));
  const slots: Record<string, Record<string, SlotCapacity>> = {};
  const staffSeen = new Map<string, string>();
  for (const r of live) if (r.staff_id && r.staff_name) staffSeen.set(r.staff_id, r.staff_name);

  const working: Record<string, number> = {};
  const onDay = await staffWorkingOnDay(businessId, date, svcs.map((x: any) => x.id), locationId);
  // What each time can take now, as in the hub (capNow, 11 Nov 2026), for every 30-minute cell of the day:
  // - staff services: booked = bookings running then; left = staff working that day who do it and are not busy
  //   then with any service (THE-23 4.2: 2/15 on every row of a booking, not 2/14 at its start);
  // - shared rooms: people in the room then (CAL-17); group sessions: the people of the latest session running;
  //   left = places minus those;
  // - a room or device for one: free or not (never shown as 1/1).
  const at = (cell: string) => zonedDateTimeToUtc(date, cell + ':00', timezone).getTime();
  const runningAt = (list: any[], t: number) => list.filter((r: any) => new Date(r.start_time).getTime() <= t && new Date(r.end_time).getTime() > t);
  const cellsOfDay = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  for (const s of svcs) {
    const places = s.booking_type === 'shared' || s.booking_type === 'group';
    const mine = live.filter((r: any) => r.service_id === s.id);
    const workingIds = new Set<string>(closedDay ? [] : onDay.byService[s.id] || []);
    for (const r of mine) if (r.staff_id) workingIds.add(r.staff_id);
    const byCell: Record<string, SlotCapacity> = {};
    for (const cell of cellsOfDay) {
      const t = at(cell);
      const run = runningAt(mine, t);
      if (places) {
        let ppl = run.reduce((x: number, r: any) => x + (r.participant_count ?? 1), 0);
        if (s.booking_type === 'group' && run.length) {
          const latest = run.reduce((m: number, r: any) => Math.max(m, new Date(r.start_time).getTime()), 0);
          ppl = run.filter((r: any) => new Date(r.start_time).getTime() === latest).reduce((x: number, r: any) => x + (r.participant_count ?? 1), 0);
        }
        byCell[cell] = { booked: ppl, left: closedDay ? 0 : Math.max(0, (s.max_capacity || 1) - ppl) };
      } else if (s.booking_type === 'resource') {
        byCell[cell] = { booked: run.length, left: closedDay || run.length ? 0 : 1 };
      } else {
        const busy = new Set(runningAt(live, t).map((r: any) => r.staff_id).filter(Boolean));
        const free = [...workingIds].filter((id) => !busy.has(id));
        const mineBusy = new Set(run.map((r: any) => r.staff_id));
        const other = [...workingIds].filter((id) => busy.has(id) && !mineBusy.has(id));
        byCell[cell] = { booked: run.length, left: free.length, free_staff: free.map((id) => onDay.names.get(id) || staffSeen.get(id) || ''), busy_other: other.map((id) => onDay.names.get(id) || staffSeen.get(id) || '') };
      }
    }
    slots[s.id] = byCell;
    working[s.id] = s.booking_type === 'resource' ? 0 : workingIds.size;
    for (const id of workingIds) staffSeen.set(id, onDay.names.get(id) || staffSeen.get(id) || '');
  }

  return {
    services: svcs.map((s: any) => ({ id: s.id, name: s.name, booking_type: s.booking_type, max_capacity: s.max_capacity, variant_id: s.variant_id, staff_count: s.staff_count, staff_working: working[s.id] ?? 0 })),
    slots,
    // with the services each staff member does (the popup from a staff column shows only those, as in the hub)
    staff: [...staffSeen.entries()].map(([id, name]) => ({ id, name, service_ids: svcs.filter((x: any) => (onDay.byService[x.id] || []).includes(id) || live.some((r: any) => r.staff_id === id && r.service_id === x.id)).map((x: any) => x.id) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Calculate the calendar-date range (YYYY-MM-DD, end exclusive) for a view. Pure calendar-date
 * arithmetic — day-of-week/month-length math doesn't depend on timezone, only the later
 * conversion of these dates to actual UTC query instants does (see zonedMidnightToUtc).
 */
function getDateRangeYMD(dateStr: string, view: 'day' | 'week' | 'month'): { startDate: string; endDate: string } {
  const date = new Date(dateStr + 'T00:00:00Z');

  if (view === 'day') {
    const endDate = new Date(date);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    return { startDate: dateStr, endDate: endDate.toISOString().slice(0, 10) };
  }

  if (view === 'week') {
    // Weeks run Monday to Sunday (calendar design, 11 Nov 2026)
    const dayOfWeek = (date.getUTCDay() + 6) % 7; // 0=Mon
    const startDate = new Date(date);
    startDate.setUTCDate(startDate.getUTCDate() - dayOfWeek);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 7);
    return { startDate: startDate.toISOString().slice(0, 10), endDate: endDate.toISOString().slice(0, 10) };
  }

  // Month
  const startDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { startDate: startDate.toISOString().slice(0, 10), endDate: endDate.toISOString().slice(0, 10) };
}

/** UTC instant corresponding to local wall-clock `timeStr` (HH:MM:SS) of `dateStr` (YYYY-MM-DD) in `timeZone`. */
function zonedDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T${timeStr}Z`);
  // Both conversions below apply the same (server-local) parsing bias to a locale string, which
  // cancels out in the subtraction, leaving exactly the offset between `timeZone` and UTC.
  const inTz = new Date(guess.toLocaleString('en-US', { timeZone }));
  const inUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = inUtc.getTime() - inTz.getTime();
  return new Date(guess.getTime() + offsetMs);
}

/** UTC instant corresponding to local midnight (00:00:00) of `dateStr` (YYYY-MM-DD) in `timeZone`. */
function zonedMidnightToUtc(dateStr: string, timeZone: string): Date {
  return zonedDateTimeToUtc(dateStr, '00:00:00', timeZone);
}

/**
 * Month view, per service and day: booked against the day's capacity (CAL-15 / CAL-16, 11 Nov 2026).
 * - Shared room or group session: places. Booked = people; capacity = places × sessions of the
 *   default length that fit in the opening hours (shared rooms: sessions can start at any time,
 *   CAL-17, so this is the room's place-time for the day).
 * - Resource only (a float tank): sessions; capacity = sessions that fit.
 * - With staff: sessions; capacity = active staff who do the service × sessions that fit
 *   (staff shifts are not taken into account yet: this is the most they could do).
 * Opening hours: the primary location's weekly hours and its date overrides (holidays). With no
 * hours set up, capacity is null (shown as booked only).
 */
async function monthServiceCapacity(
  businessId: string, startYMD: string, endYMD: string, where: string, params: any[], paramIndex: number, timezone: string, serviceIds?: string[], locationId?: string,
): Promise<{ services: any[]; byDay: Map<string, Array<{ service_id: string; booked: number; capacity: number | null }>> }> {
  const { rows: booked } = await adminPool.query(
    `SELECT DATE(b.start_time AT TIME ZONE $${paramIndex})::text AS day, b.service_id,
            COUNT(*)::int AS bookings, COALESCE(SUM(COALESCE(b.participant_count, 1)), 0)::int AS people
       FROM apt_bookings b WHERE ${where} GROUP BY 1, 2`,
    [...params, timezone],
  );
  const filtered = serviceIds && serviceIds.length > 0;
  const { rows: services } = await adminPool.query(
    `SELECT s.id, s.name, s.booking_type, s.max_capacity, s.default_duration,
            -- no staff assigned = every active staff member can do it (same rule as availability)
            COALESCE(NULLIF((SELECT COUNT(*)::int FROM svc_staff ss JOIN usr_users u ON u.id = ss.user_id
              WHERE ss.service_id = s.id AND u.status = 'active'), 0), (SELECT COUNT(DISTINCT sp.user_id)::int FROM stf_profiles sp JOIN usr_users u2 ON u2.id = sp.user_id WHERE u2.business_id = s.business_id AND sp.status = 'active' AND sp.user_id IS NOT NULL)) AS staff_count
       FROM svc_services s
      WHERE s.business_id = $1 AND s.status = 'active' ${filtered ? 'AND s.id = ANY($2::uuid[])' : ''}
      ORDER BY s.name`,
    filtered ? [businessId, serviceIds] : [businessId],
  );
  const { rows: locs } = await adminPool.query(
    `SELECT id FROM sys_locations WHERE business_id = $1 AND status = 'active' ${locationId ? 'AND id = $2' : ''} ORDER BY is_primary DESC, created_at LIMIT 1`, locationId ? [businessId, locationId] : [businessId],
  );
  const loc = locs[0]?.id;
  const weekly = loc ? (await adminPool.query('SELECT day_of_week, is_closed, open_time, close_time FROM sys_location_hours WHERE location_id = $1', [loc])).rows : [];
  const overrides = loc ? (await adminPool.query(
    `SELECT override_date::text AS d, is_closed, open_time, close_time FROM sys_location_hour_overrides
      WHERE location_id = $1 AND override_date >= $2::date AND override_date < $3::date`, [loc, startYMD, endYMD],
  )).rows : [];
  const mins = (t: string | null) => { if (!t) return 0; const [hh, mm] = String(t).split(':').map(Number); return hh * 60 + (mm || 0); };
  const openMinutes = (day: string): number | null => {
    const o = overrides.find((x: any) => x.d === day);
    if (o) return o.is_closed ? 0 : Math.max(0, mins(o.close_time) - mins(o.open_time));
    if (!weekly.length) return 13 * 60; // not set up: open 08:00–21:00, as in the hub
    const w = weekly.find((x: any) => x.day_of_week === new Date(day + 'T12:00:00Z').getUTCDay());
    if (!w || w.is_closed) return 0;
    return Math.max(0, mins(w.close_time) - mins(w.open_time));
  };
  const byDay = new Map<string, Array<{ service_id: string; booked: number; capacity: number | null }>>();
  for (let d = new Date(startYMD + 'T12:00:00Z'); d.toISOString().slice(0, 10) < endYMD; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10); const open = openMinutes(day);
    const list = services.map((s: any) => {
      const places = s.booking_type === 'shared' || s.booking_type === 'group';
      const b = booked.find((x: any) => x.day === day && x.service_id === s.id);
      const n = b ? (places ? b.people : b.bookings) : 0;
      const units = places ? (s.max_capacity || 1) : s.booking_type === 'resource' ? 1 : (s.staff_count || 0);
      const fit = open === null ? null : Math.floor(open / Math.max(5, s.default_duration || 60));
      return { service_id: s.id, booked: n, capacity: fit === null ? null : units * fit };
    }).filter((x: any) => x.booked > 0 || (x.capacity ?? 0) > 0);
    byDay.set(day, list);
  }
  return { services: services.map((s: any) => ({ id: s.id, name: s.name, booking_type: s.booking_type, unit: s.booking_type === 'shared' || s.booking_type === 'group' ? 'places' : 'sessions' })), byDay };
}
