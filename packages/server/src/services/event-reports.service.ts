import { adminPool } from '../db/pool';

/**
 * Get a detailed report for a single event.
 */
export async function getEventReport(eventId: string) {
  const { rows: eventRows } = await adminPool.query(
    `SELECT e.*, et.name AS event_type_name
     FROM events e
     LEFT JOIN event_types et ON et.id = e.event_type_id
     WHERE e.id = $1`,
    [eventId],
  );
  if (eventRows.length === 0) throw new Error('Event not found');

  const event = eventRows[0];

  // Registrations breakdown
  const { rows: regStats } = await adminPool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_shows,
       COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS checked_in,
       COUNT(*) FILTER (WHERE status IN ('confirmed','no_show'))::int AS total_registered
     FROM event_registrations WHERE event_id = $1`,
    [eventId],
  );

  // Revenue (sum of tier prices for confirmed registrations)
  const { rows: revenueRows } = await adminPool.query(
    `SELECT COALESCE(SUM(tt.price * er.group_size), 0)::int AS total_revenue
     FROM event_registrations er
     JOIN event_ticket_tiers tt ON tt.id = er.ticket_tier_id
     WHERE er.event_id = $1 AND er.status = 'confirmed'`,
    [eventId],
  );

  // Waitlist size
  const { rows: waitlistRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS waitlist_size
     FROM event_waitlist WHERE event_id = $1 AND status = 'waiting'`,
    [eventId],
  );

  const stats = regStats[0];
  const totalRegistered = stats.total_registered;
  const attendanceRate = totalRegistered > 0
    ? Math.round((stats.checked_in / totalRegistered) * 100)
    : 0;
  const capacityUtilization = event.capacity > 0
    ? Math.round(((stats.confirmed + stats.pending) / event.capacity) * 100)
    : 0;
  const cancellationRate = (stats.confirmed + stats.cancelled) > 0
    ? Math.round((stats.cancelled / (stats.confirmed + stats.cancelled)) * 100)
    : 0;

  return {
    event: {
      id: event.id,
      title: event.title,
      status: event.status,
      startTime: event.start_time,
      endTime: event.end_time,
      capacity: event.capacity,
      eventType: event.event_type_name,
    },
    registrations: {
      confirmed: stats.confirmed,
      pending: stats.pending,
      cancelled: stats.cancelled,
      noShows: stats.no_shows,
      totalRegistered,
    },
    attendanceRate,
    revenue: revenueRows[0].total_revenue, // cents
    capacityUtilization,
    waitlistSize: waitlistRows[0].waitlist_size,
    cancellationRate,
  };
}

/**
 * Get aggregated metrics for events within a date range.
 */
export async function getEventsSummary(tenantId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT
       COUNT(*)::int AS total_events,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_events,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_events,
       COUNT(*) FILTER (WHERE status = 'published')::int AS upcoming_events
     FROM events
     WHERE tenant_id = $1 AND start_time >= $2::timestamptz AND start_time <= $3::timestamptz`,
    [tenantId, startDate, endDate],
  );

  const { rows: regRows } = await adminPool.query(
    `SELECT
       COUNT(*)::int AS total_registrations,
       COUNT(*) FILTER (WHERE er.status = 'confirmed')::int AS confirmed_registrations,
       COUNT(*) FILTER (WHERE er.checked_in_at IS NOT NULL)::int AS total_check_ins
     FROM event_registrations er
     JOIN events e ON e.id = er.event_id
     WHERE e.tenant_id = $1 AND e.start_time >= $2::timestamptz AND e.start_time <= $3::timestamptz`,
    [tenantId, startDate, endDate],
  );

  const { rows: revenueRows } = await adminPool.query(
    `SELECT COALESCE(SUM(tt.price * er.group_size), 0)::int AS total_revenue
     FROM event_registrations er
     JOIN events e ON e.id = er.event_id
     JOIN event_ticket_tiers tt ON tt.id = er.ticket_tier_id
     WHERE e.tenant_id = $1 AND e.start_time >= $2::timestamptz AND e.start_time <= $3::timestamptz
       AND er.status = 'confirmed'`,
    [tenantId, startDate, endDate],
  );

  const regData = regRows[0];
  const overallAttendanceRate = regData.confirmed_registrations > 0
    ? Math.round((regData.total_check_ins / regData.confirmed_registrations) * 100)
    : 0;

  return {
    ...rows[0],
    totalRegistrations: regData.total_registrations,
    confirmedRegistrations: regData.confirmed_registrations,
    totalCheckIns: regData.total_check_ins,
    overallAttendanceRate,
    totalRevenue: revenueRows[0].total_revenue, // cents
  };
}

/**
 * Export attendee list as CSV-ready data.
 */
export async function exportAttendeeList(eventId: string) {
  const { rows: eventRows } = await adminPool.query(
    `SELECT title FROM events WHERE id = $1`, [eventId],
  );
  if (eventRows.length === 0) throw new Error('Event not found');

  const { rows } = await adminPool.query(
    `SELECT
       c.first_name, c.last_name, c.email, c.phone,
       er.reference_number, er.status, er.group_size,
       er.checked_in_at,
       tt.name AS ticket_tier,
       tt.price AS ticket_price
     FROM event_registrations er
     LEFT JOIN customers c ON c.id = er.customer_id
     LEFT JOIN event_ticket_tiers tt ON tt.id = er.ticket_tier_id
     WHERE er.event_id = $1 AND er.status IN ('confirmed','no_show')
     ORDER BY c.last_name ASC, c.first_name ASC`,
    [eventId],
  );

  const headers = [
    'First Name', 'Last Name', 'Email', 'Phone',
    'Reference', 'Status', 'Group Size', 'Checked In',
    'Ticket Tier', 'Ticket Price',
  ];

  const csvRows = rows.map((r) => [
    r.first_name || '',
    r.last_name || '',
    r.email || '',
    r.phone || '',
    r.reference_number,
    r.status,
    r.group_size,
    r.checked_in_at ? new Date(r.checked_in_at).toISOString() : '',
    r.ticket_tier || '',
    r.ticket_price != null ? (r.ticket_price / 100).toFixed(2) : '',
  ]);

  return {
    eventTitle: eventRows[0].title,
    headers,
    rows: csvRows,
    totalRows: csvRows.length,
  };
}
