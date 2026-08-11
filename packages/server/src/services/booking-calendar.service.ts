import { adminPool } from '../db/pool';

interface CalendarQuery {
  businessId: string;
  view: 'day' | 'week' | 'month';
  date: string;           // ISO date (YYYY-MM-DD)
  staffId?: string;
  resourceId?: string;
  serviceIds?: string[];
  status?: string;
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
  const { businessId, view, date, staffId, resourceId, serviceIds, status } = query;

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
  if (status) {
    conditions.push(`b.status = $${paramIndex++}`);
    params.push(status);
  } else {
    conditions.push("b.status NOT IN ('cancelled')");
  }

  const where = conditions.join(' AND ');

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

    return {
      view: 'month',
      date,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      days: rows.map((r: any) => ({
        date: r.day,
        count: r.count,
        statuses: r.statuses,
      })),
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
        `SELECT COUNT(*)::int AS count FROM apt_bookings
         WHERE service_id = b.service_id AND start_time = $1 AND business_id = $2
           AND status IN ('pending', 'confirmed', 'in_progress')`,
        [row.start_time, businessId],
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
  const activeStatuses = ['pending', 'confirmed', 'in_progress'];
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

  return {
    view,
    date,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    bookings,
    resourceTimelines,
    staffTimelines,
    resourceBlocks,
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
    // Start from Sunday of the week
    const dayOfWeek = date.getUTCDay(); // 0=Sun
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
