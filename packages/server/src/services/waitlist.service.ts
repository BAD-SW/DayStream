import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

const DEFAULT_MAX_WAITLIST = 5;
const DEFAULT_CONFIRM_HOURS = 2;

/**
 * Join the waitlist for a session that is at capacity.
 */
export async function joinWaitlist(
  businessId: string,
  serviceId: string,
  customerId: string,
  slotStartTime: string,
  slotEndTime: string,
): Promise<any> {
  // Check if already on waitlist
  const { rows: existing } = await adminPool.query(
    `SELECT id FROM apt_waitlist_entries
     WHERE service_id = $1 AND slot_start_time = $2 AND customer_id = $3 AND status = 'waiting'`,
    [serviceId, slotStartTime, customerId],
  );
  if (existing.length > 0) {
    throw new Error('Already on the waitlist for this session');
  }

  // Check waitlist size
  const { rows: countRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM apt_waitlist_entries
     WHERE service_id = $1 AND slot_start_time = $2 AND status IN ('waiting', 'notified')`,
    [serviceId, slotStartTime],
  );

  const maxSize = DEFAULT_MAX_WAITLIST;
  if (countRows[0].count >= maxSize) {
    throw new Error('Waitlist is full for this session');
  }

  // Assign position
  const position = countRows[0].count + 1;

  const { rows } = await adminPool.query(
    `INSERT INTO apt_waitlist_entries (business_id, service_id, slot_start_time, slot_end_time, customer_id, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [businessId, serviceId, slotStartTime, slotEndTime, customerId, position],
  );

  return rows[0];
}

/**
 * Leave the waitlist.
 */
export async function leaveWaitlist(serviceId: string, slotStartTime: string, customerId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    `UPDATE apt_waitlist_entries SET status = 'removed'
     WHERE service_id = $1 AND slot_start_time = $2 AND customer_id = $3 AND status = 'waiting'`,
    [serviceId, slotStartTime, customerId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get waitlist for a session.
 */
export async function getWaitlist(serviceId: string, slotStartTime: string) {
  const { rows } = await adminPool.query(
    `SELECT we.*, c.first_name, c.last_name, c.email
     FROM apt_waitlist_entries we
     JOIN cus_customers c ON c.id = we.customer_id
     WHERE we.service_id = $1 AND we.slot_start_time = $2 AND we.status IN ('waiting', 'notified')
     ORDER BY we.position`,
    [serviceId, slotStartTime],
  );
  return rows;
}

/**
 * Promote the next waitlist entry when a spot opens up.
 * Called after a booking cancellation.
 */
export async function promoteNext(serviceId: string, slotStartTime: string): Promise<any | null> {
  // Find next waiting entry
  const { rows } = await adminPool.query(
    `SELECT * FROM apt_waitlist_entries
     WHERE service_id = $1 AND slot_start_time = $2 AND status = 'waiting'
     ORDER BY position
     LIMIT 1`,
    [serviceId, slotStartTime],
  );

  if (rows.length === 0) return null;

  const entry = rows[0];
  const confirmHours = DEFAULT_CONFIRM_HOURS;
  const expiresAt = new Date(Date.now() + confirmHours * 60 * 60 * 1000);

  // Update to notified
  await adminPool.query(
    `UPDATE apt_waitlist_entries SET status = 'notified', notified_at = NOW(), expires_at = $2
     WHERE id = $1`,
    [entry.id, expiresAt.toISOString()],
  );

  logger.info('Waitlist entry promoted', { entryId: entry.id, customerId: entry.customer_id });

  // TODO: Send notification email to customer

  return { ...entry, status: 'notified', expires_at: expiresAt.toISOString() };
}

/**
 * Confirm a waitlist promotion (customer accepts the spot).
 */
export async function confirmPromotion(entryId: string, customerId: string): Promise<{ confirmed: boolean; error?: string }> {
  const { rows } = await adminPool.query(
    `SELECT * FROM apt_waitlist_entries WHERE id = $1 AND customer_id = $2 AND status = 'notified'`,
    [entryId, customerId],
  );

  if (rows.length === 0) {
    return { confirmed: false, error: 'Waitlist entry not found or not in notified status' };
  }

  const entry = rows[0];

  // Check if expired
  if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
    await adminPool.query(
      "UPDATE apt_waitlist_entries SET status = 'expired' WHERE id = $1",
      [entryId],
    );
    return { confirmed: false, error: 'Confirmation window has expired' };
  }

  // Mark as confirmed
  await adminPool.query(
    "UPDATE apt_waitlist_entries SET status = 'confirmed' WHERE id = $1",
    [entryId],
  );

  return { confirmed: true };
}

/**
 * Process expired waitlist notifications. Moves to next in line.
 */
export async function processExpiredNotifications(): Promise<number> {
  const { rows: expired } = await adminPool.query(
    `SELECT * FROM apt_waitlist_entries
     WHERE status = 'notified' AND expires_at <= NOW()`,
  );

  let processed = 0;
  for (const entry of expired) {
    await adminPool.query(
      "UPDATE apt_waitlist_entries SET status = 'expired' WHERE id = $1",
      [entry.id],
    );

    // Promote next
    await promoteNext(entry.service_id, entry.slot_start_time);
    processed++;
  }

  if (processed > 0) {
    logger.info('Processed expired waitlist notifications', { count: processed });
  }

  return processed;
}
