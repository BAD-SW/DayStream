import { adminPool } from '../db/pool';

interface ConflictCheckInput {
  staffId?: string;
  resourceId?: string;
  customerId?: string;
  startTime: Date;
  endTime: Date;
  bufferBefore?: number;
  bufferAfter?: number;
  excludeBookingId?: string;  // for reschedule: exclude the booking being moved
}

interface ConflictResult {
  hasConflict: boolean;
  conflicts: Array<{
    type: 'staff' | 'resource' | 'customer';
    booking_id: string;
    booking_reference: string;
    start_time: string;
    end_time: string;
  }>;
  suggestedAlternatives?: string[];
}

/**
 * Comprehensive conflict detection. Checks staff, resource, and customer.
 * Uses FOR UPDATE NOWAIT for database-level locking to prevent race conditions.
 */
export async function detectConflicts(input: ConflictCheckInput): Promise<ConflictResult> {
  const conflicts: ConflictResult['conflicts'] = [];
  const bufferBefore = input.bufferBefore || 0;
  const bufferAfter = input.bufferAfter || 0;

  const blockStart = new Date(input.startTime.getTime() - bufferBefore * 60 * 1000);
  const blockEnd = new Date(input.endTime.getTime() + bufferAfter * 60 * 1000);

  const excludeClause = input.excludeBookingId ? `AND id != '${input.excludeBookingId}'` : '';

  // Staff conflict check with row locking
  if (input.staffId) {
    try {
      const { rows } = await adminPool.query(
        `SELECT id, booking_reference, start_time, end_time FROM apt_bookings
         WHERE staff_id = $1
           AND start_time < $3
           AND end_time > $2
           AND status IN ('pending', 'confirmed', 'in_progress')
           ${excludeClause}
         FOR UPDATE NOWAIT`,
        [input.staffId, blockStart.toISOString(), blockEnd.toISOString()],
      );

      for (const row of rows) {
        conflicts.push({
          type: 'staff',
          booking_id: row.id,
          booking_reference: row.booking_reference,
          start_time: row.start_time,
          end_time: row.end_time,
        });
      }
    } catch (err: any) {
      // NOWAIT throws if rows are locked by another transaction
      if (err.code === '55P03') {
        conflicts.push({
          type: 'staff',
          booking_id: 'locked',
          booking_reference: 'LOCKED',
          start_time: input.startTime.toISOString(),
          end_time: input.endTime.toISOString(),
        });
      } else {
        throw err;
      }
    }
  }

  // Resource conflict check
  if (input.resourceId) {
    const { rows } = await adminPool.query(
      `SELECT id, booking_reference, start_time, end_time FROM apt_bookings
       WHERE resource_id = $1
         AND start_time < $3
         AND end_time > $2
         AND status IN ('pending', 'confirmed', 'in_progress')
         ${excludeClause}`,
      [input.resourceId, blockStart.toISOString(), blockEnd.toISOString()],
    );

    for (const row of rows) {
      conflicts.push({
        type: 'resource',
        booking_id: row.id,
        booking_reference: row.booking_reference,
        start_time: row.start_time,
        end_time: row.end_time,
      });
    }
  }

  // Customer conflict check
  if (input.customerId) {
    const { rows } = await adminPool.query(
      `SELECT id, booking_reference, start_time, end_time FROM apt_bookings
       WHERE customer_id = $1
         AND start_time < $3
         AND end_time > $2
         AND status IN ('pending', 'confirmed', 'in_progress')
         ${excludeClause}`,
      [input.customerId, input.startTime.toISOString(), input.endTime.toISOString()],
    );

    for (const row of rows) {
      conflicts.push({
        type: 'customer',
        booking_id: row.id,
        booking_reference: row.booking_reference,
        start_time: row.start_time,
        end_time: row.end_time,
      });
    }
  }

  // Also check slot holds for staff
  if (input.staffId && conflicts.length === 0) {
    const { rows: holds } = await adminPool.query(
      `SELECT id, start_time, end_time FROM apt_slot_holds
       WHERE staff_id = $1
         AND start_time < $3
         AND end_time > $2
         AND expires_at > NOW()`,
      [input.staffId, blockStart.toISOString(), blockEnd.toISOString()],
    );

    for (const hold of holds) {
      conflicts.push({
        type: 'staff',
        booking_id: hold.id,
        booking_reference: 'SLOT_HOLD',
        start_time: hold.start_time,
        end_time: hold.end_time,
      });
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
  };
}

/**
 * Suggest alternative slots near a conflicting time.
 * Looks 2 hours before and after the requested time for the same staff.
 */
export async function suggestAlternatives(
  staffId: string,
  businessId: string,
  requestedStart: Date,
  duration: number,
  bufferBefore: number,
  bufferAfter: number,
): Promise<string[]> {
  const alternatives: string[] = [];
  const totalBlock = bufferBefore + duration + bufferAfter;

  // Check slots in 30-minute intervals, 2 hours before and after
  for (let offsetMinutes = -120; offsetMinutes <= 120; offsetMinutes += 30) {
    if (offsetMinutes === 0) continue;

    const candidateStart = new Date(requestedStart.getTime() + offsetMinutes * 60 * 1000);
    const candidateEnd = new Date(candidateStart.getTime() + duration * 60 * 1000);
    const blockStart = new Date(candidateStart.getTime() - bufferBefore * 60 * 1000);
    const blockEnd = new Date(candidateEnd.getTime() + bufferAfter * 60 * 1000);

    // Skip past times
    if (candidateStart <= new Date()) continue;

    const { rows } = await adminPool.query(
      `SELECT id FROM apt_bookings
       WHERE staff_id = $1
         AND start_time < $3
         AND end_time > $2
         AND status IN ('pending', 'confirmed', 'in_progress')
       LIMIT 1`,
      [staffId, blockStart.toISOString(), blockEnd.toISOString()],
    );

    if (rows.length === 0) {
      alternatives.push(candidateStart.toISOString());
      if (alternatives.length >= 3) break; // Suggest up to 3 alternatives
    }
  }

  return alternatives;
}
