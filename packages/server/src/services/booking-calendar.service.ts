import { adminPool } from '../db/pool';

interface CalendarQuery {
  businessId: string;
  view: 'day' | 'week' | 'month';
  date: string;           // ISO date (YYYY-MM-DD)
  staffId?: string;
  resourceId?: string;
  serviceId?: string;
  status?: string;
}

interface CalendarBooking {
  id: string;
  service_name: string;
  customer_name: string;
  staff_name: string;
  start_time: string;
  end_time: string;
  status: string;
  booking_type: string;
  booking_reference: string;
  participants?: number;
}

/**
 * Get calendar data for a given view.
 */
export async function getCalendar(query: CalendarQuery) {
  const { businessId, view, date, staffId, resourceId, serviceId, status } = query;

  const { startDate, endDate } = getDateRange(date, view);

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
  if (serviceId) {
    conditions.push(`b.service_id = $${paramIndex++}`);
    params.push(serviceId);
  }
  if (status) {
    conditions.push(`b.status = $${paramIndex++}`);
    params.push(status);
  } else {
    conditions.push("b.status NOT IN ('cancelled')");
  }

  const where = conditions.join(' AND ');

  if (view === 'month') {
    // Month view: return daily counts
    const { rows } = await adminPool.query(
      `SELECT DATE(b.start_time AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS count,
              json_agg(json_build_object('status', b.status)) AS statuses
       FROM bookings b
       WHERE ${where}
       GROUP BY DATE(b.start_time AT TIME ZONE 'UTC')
       ORDER BY day`,
      params,
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
    `SELECT b.id, b.start_time, b.end_time, b.status, b.booking_type, b.booking_reference,
            s.name AS service_name,
            c.first_name || ' ' || c.last_name AS customer_name,
            COALESCE(u.first_name || ' ' || u.last_name, '') AS staff_name
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN customers c ON c.id = b.customer_id
     LEFT JOIN users u ON u.id = b.staff_id
     WHERE ${where}
     ORDER BY b.start_time`,
    params,
  );

  // For shared/group, add participant count
  const bookings: CalendarBooking[] = [];
  for (const row of rows) {
    const entry: CalendarBooking = {
      id: row.id,
      service_name: row.service_name,
      customer_name: row.customer_name,
      staff_name: row.staff_name,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
      booking_type: row.booking_type,
      booking_reference: row.booking_reference,
    };

    if (row.booking_type === 'shared' || row.booking_type === 'group') {
      const { rows: countRows } = await adminPool.query(
        `SELECT COUNT(*)::int AS count FROM bookings
         WHERE service_id = b.service_id AND start_time = $1 AND business_id = $2
           AND status IN ('pending', 'confirmed', 'in_progress')`,
        [row.start_time, businessId],
      );
      entry.participants = countRows[0]?.count || 1;
    }

    bookings.push(entry);
  }

  return {
    view,
    date,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    bookings,
  };
}

/**
 * Calculate date range for a calendar view.
 */
function getDateRange(dateStr: string, view: 'day' | 'week' | 'month'): { startDate: Date; endDate: Date } {
  const date = new Date(dateStr + 'T00:00:00Z');

  if (view === 'day') {
    const endDate = new Date(date);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    return { startDate: date, endDate };
  }

  if (view === 'week') {
    // Start from Monday of the week
    const dayOfWeek = date.getUTCDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday = 1
    const startDate = new Date(date);
    startDate.setUTCDate(startDate.getUTCDate() + diff);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 7);
    return { startDate, endDate };
  }

  // Month
  const startDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { startDate, endDate };
}
