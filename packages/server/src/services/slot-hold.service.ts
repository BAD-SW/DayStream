import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

const DEFAULT_HOLD_SECONDS = 300; // 5 minutes

interface CreateHoldInput {
  businessId: string;
  serviceId: string;
  variantId: string;
  staffId?: string;
  resourceId?: string;
  startTime: string;
  endTime: string;
  heldBy: string;
}

/**
 * Create a slot hold (temporary reservation while customer completes booking).
 */
export async function createHold(input: CreateHoldInput) {
  const holdDuration = parseInt(process.env.BOOKING_HOLD_SECONDS || '', 10) || DEFAULT_HOLD_SECONDS;
  const expiresAt = new Date(Date.now() + holdDuration * 1000);

  // Check if slot is already held
  const { rows: existing } = await adminPool.query(
    `SELECT id FROM apt_slot_holds
     WHERE business_id = $1 AND service_id = $2 AND start_time = $3 AND expires_at > NOW()
       AND ($4::uuid IS NULL OR staff_id = $4)`,
    [input.businessId, input.serviceId, input.startTime, input.staffId || null],
  );

  if (existing.length > 0) {
    throw new Error('This slot is already being held by another user');
  }

  // Check if staff has a conflict (booking or hold)
  if (input.staffId) {
    const { rows: conflicts } = await adminPool.query(
      `SELECT id FROM apt_bookings
       WHERE staff_id = $1 AND start_time < $3 AND end_time > $2
         AND status IN ('pending', 'confirmed', 'in_progress')
       LIMIT 1`,
      [input.staffId, input.startTime, input.endTime],
    );
    if (conflicts.length > 0) {
      throw new Error('Staff has a conflicting booking at this time');
    }
  }

  const { rows } = await adminPool.query(
    `INSERT INTO apt_slot_holds (business_id, service_id, variant_id, staff_id, resource_id, start_time, end_time, held_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.businessId, input.serviceId, input.variantId,
      input.staffId || null, input.resourceId || null,
      input.startTime, input.endTime, input.heldBy, expiresAt.toISOString(),
    ],
  );

  return rows[0];
}

/**
 * Release a slot hold.
 */
export async function releaseHold(holdId: string, userId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM apt_slot_holds WHERE id = $1 AND held_by = $2',
    [holdId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Cleanup expired holds. Should run every 60 seconds.
 */
export async function cleanupExpiredHolds(): Promise<number> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM apt_slot_holds WHERE expires_at <= NOW()',
  );
  const count = rowCount ?? 0;
  if (count > 0) {
    logger.info('Cleaned up expired slot holds', { count });
  }
  return count;
}

/**
 * Get active holds for a user.
 */
export async function getUserHolds(userId: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM apt_slot_holds WHERE held_by = $1 AND business_id = $2 AND expires_at > NOW()',
    [userId, businessId],
  );
  return rows;
}
