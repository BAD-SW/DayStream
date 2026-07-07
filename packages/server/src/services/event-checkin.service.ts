import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Check in an attendee by reference number.
 */
export async function checkInByReference(referenceNumber: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_registrations
     SET checked_in_at = NOW()
     WHERE reference_number = $1 AND status = 'confirmed' AND checked_in_at IS NULL
     RETURNING *`,
    [referenceNumber],
  );
  if (!rows[0]) throw new Error('Registration not found, not confirmed, or already checked in');

  // Get tenant for audit
  const { rows: eventRows } = await adminPool.query(
    `SELECT tenant_id FROM evt_events WHERE id = $1`, [rows[0].event_id],
  );

  if (eventRows[0]) {
    await logAudit({
      tenantId: eventRows[0].tenant_id,
      action: 'event_registration.checked_in',
      resourceType: 'event_registration',
      resourceId: rows[0].id,
      details: { referenceNumber, method: 'reference' },
    });
  }

  return rows[0];
}

/**
 * Manually check in an attendee by registration ID.
 */
export async function checkInManual(registrationId: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_registrations
     SET checked_in_at = NOW()
     WHERE id = $1 AND status = 'confirmed' AND checked_in_at IS NULL
     RETURNING *`,
    [registrationId],
  );
  if (!rows[0]) throw new Error('Registration not found, not confirmed, or already checked in');

  const { rows: eventRows } = await adminPool.query(
    `SELECT tenant_id FROM evt_events WHERE id = $1`, [rows[0].event_id],
  );

  if (eventRows[0]) {
    await logAudit({
      tenantId: eventRows[0].tenant_id,
      action: 'event_registration.checked_in',
      resourceType: 'event_registration',
      resourceId: rows[0].id,
      details: { method: 'manual' },
    });
  }

  return rows[0];
}

/**
 * Mark unchecked registrations as no-shows after the event has ended.
 */
export async function markNoShows(eventId: string) {
  const { rows: eventRows } = await adminPool.query(
    `SELECT end_time, tenant_id FROM evt_events WHERE id = $1`, [eventId],
  );
  if (eventRows.length === 0) throw new Error('Event not found');

  const event = eventRows[0];
  if (new Date(event.end_time) > new Date()) {
    throw new Error('Cannot mark no-shows before event has ended');
  }

  const { rowCount } = await adminPool.query(
    `UPDATE evt_registrations
     SET status = 'no_show'
     WHERE event_id = $1 AND status = 'confirmed' AND checked_in_at IS NULL`,
    [eventId],
  );

  await logAudit({
    tenantId: event.tenant_id,
    action: 'event.no_shows_marked',
    resourceType: 'event',
    resourceId: eventId,
    details: { count: rowCount ?? 0 },
  });

  return rowCount ?? 0;
}

/**
 * Get attendee list with check-in status.
 */
export async function getAttendees(eventId: string) {
  const { rows } = await adminPool.query(
    `SELECT er.id, er.reference_number, er.status, er.group_size,
            er.checked_in_at, er.created_at,
            c.id AS customer_id, c.first_name, c.last_name, c.email, c.phone,
            tt.name AS tier_name
     FROM evt_registrations er
     LEFT JOIN cus_customers c ON c.id = er.customer_id
     LEFT JOIN evt_ticket_tiers tt ON tt.id = er.ticket_tier_id
     WHERE er.event_id = $1 AND er.status IN ('confirmed','no_show')
     ORDER BY c.last_name ASC, c.first_name ASC`,
    [eventId],
  );
  return rows;
}

/**
 * Get the attendance rate for an event.
 */
export async function getAttendanceRate(eventId: string) {
  const { rows } = await adminPool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('confirmed','no_show'))::int AS total_registered,
       COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS checked_in,
       COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_shows
     FROM evt_registrations
     WHERE event_id = $1`,
    [eventId],
  );

  const data = rows[0];
  const rate = data.total_registered > 0
    ? Math.round((data.checked_in / data.total_registered) * 100)
    : 0;

  return {
    totalRegistered: data.total_registered,
    checkedIn: data.checked_in,
    noShows: data.no_shows,
    attendanceRate: rate,
  };
}
