import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Add a customer to the waitlist for an event.
 */
export async function addToWaitlist(eventId: string, customerId: string, ticketTierId?: string) {
  // Determine position (next in line)
  const { rows: posRows } = await adminPool.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next_position
     FROM evt_waitlist WHERE event_id = $1 AND status = 'waiting'`,
    [eventId],
  );
  const position = posRows[0].next_position;

  const { rows } = await adminPool.query(
    `INSERT INTO evt_waitlist (event_id, customer_id, ticket_tier_id, position, status)
     VALUES ($1, $2, $3, $4, 'waiting')
     RETURNING *`,
    [eventId, customerId, ticketTierId || null, position],
  );

  return rows[0];
}

/**
 * Get the waitlist for an event.
 */
export async function getWaitlist(eventId: string) {
  const { rows } = await adminPool.query(
    `SELECT ew.*,
            c.first_name, c.last_name, c.email
     FROM evt_waitlist ew
     LEFT JOIN cus_customers c ON c.id = ew.customer_id
     WHERE ew.event_id = $1
     ORDER BY ew.position ASC`,
    [eventId],
  );
  return rows;
}

/**
 * Promote the next person from the waitlist.
 * Sets a 4-hour expiry for them to confirm.
 */
export async function promoteFromWaitlist(eventId: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_waitlist
     SET status = 'notified', notified_at = NOW(),
         expires_at = NOW() + INTERVAL '4 hours'
     WHERE id = (
       SELECT id FROM evt_waitlist
       WHERE event_id = $1 AND status = 'waiting'
       ORDER BY position ASC LIMIT 1
     )
     RETURNING *`,
    [eventId],
  );

  if (!rows[0]) return null;
  return rows[0];
}

/**
 * Confirm a waitlist spot (customer accepts the offered spot).
 */
export async function confirmWaitlistSpot(waitlistId: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_waitlist
     SET status = 'confirmed'
     WHERE id = $1 AND status = 'notified' AND (expires_at IS NULL OR expires_at > NOW())
     RETURNING *`,
    [waitlistId],
  );
  if (!rows[0]) throw new Error('Waitlist entry not found, not offered, or expired');
  return rows[0];
}

/**
 * Expire a waitlist entry (customer did not confirm in time).
 */
export async function expireWaitlistEntry(waitlistId: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_waitlist
     SET status = 'expired'
     WHERE id = $1 AND status = 'notified'
     RETURNING *`,
    [waitlistId],
  );
  if (!rows[0]) throw new Error('Waitlist entry not found or not in offered status');
  return rows[0];
}

/**
 * Get a customer's position on the waitlist for an event.
 */
export async function getWaitlistPosition(eventId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT position, status FROM evt_waitlist
     WHERE event_id = $1 AND customer_id = $2 AND status IN ('waiting','notified')`,
    [eventId, customerId],
  );
  if (rows.length === 0) return null;
  return { position: rows[0].position, status: rows[0].status };
}
