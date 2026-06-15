import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { calculateCancellationFee } from './cancellation-policies.service';
import { logger } from '../middleware/logger';

// Valid state transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed'],
  // Terminal states: completed, cancelled, no_show — no transitions out
};

interface TransitionResult {
  success: boolean;
  booking?: any;
  error?: string;
  cancellation_fee?: number;
}

/**
 * Validate and execute a booking status transition.
 */
async function transitionStatus(
  bookingId: string,
  businessId: string,
  newStatus: string,
  userId: string,
  tenantId: string,
  options?: { reason?: string },
): Promise<TransitionResult> {
  const { rows } = await adminPool.query(
    'SELECT * FROM bookings WHERE id = $1 AND business_id = $2',
    [bookingId, businessId],
  );

  if (rows.length === 0) return { success: false, error: 'Booking not found' };

  const booking = rows[0];
  const currentStatus = booking.status;

  // Validate transition
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    return { success: false, error: `Cannot transition from '${currentStatus}' to '${newStatus}'` };
  }

  // Update status
  const updateFields: string[] = ['status = $3', 'updated_at = NOW()'];
  const updateParams: any[] = [bookingId, businessId, newStatus];
  let paramIdx = 4;

  if (newStatus === 'cancelled') {
    updateFields.push(`cancelled_by = $${paramIdx++}`);
    updateParams.push(userId);
    updateFields.push(`cancelled_at = NOW()`);
    if (options?.reason) {
      updateFields.push(`cancellation_reason = $${paramIdx++}`);
      updateParams.push(options.reason);
    }
  }

  await adminPool.query(
    `UPDATE bookings SET ${updateFields.join(', ')} WHERE id = $1 AND business_id = $2`,
    updateParams,
  );

  // Record in status history
  await adminPool.query(
    `INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [bookingId, currentStatus, newStatus, userId, options?.reason || null],
  );

  // Log in audit trail
  await logAudit({
    tenantId,
    userId,
    action: `booking.${newStatus}`,
    resourceType: 'booking',
    resourceId: bookingId,
    details: { from: currentStatus, to: newStatus, reason: options?.reason },
  });

  // Log in customer timeline
  await createActivity({
    customerId: booking.customer_id,
    businessId,
    activityType: 'booking',
    description: `Booking ${booking.booking_reference}: ${currentStatus} → ${newStatus}`,
    metadata: { booking_id: bookingId, from: currentStatus, to: newStatus },
    createdBy: userId,
  });

  // Return updated booking
  const { rows: updated } = await adminPool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  return { success: true, booking: updated[0] };
}

/**
 * Confirm a pending booking.
 */
export async function confirmBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  return transitionStatus(bookingId, businessId, 'confirmed', userId, tenantId);
}

/**
 * Cancel a booking. Calculates cancellation fee if applicable.
 */
export async function cancelBooking(
  bookingId: string, businessId: string, userId: string, tenantId: string, reason?: string,
): Promise<TransitionResult> {
  // Load booking to calculate fee
  const { rows } = await adminPool.query(
    `SELECT b.*, s.cancellation_policy_id FROM bookings b
     JOIN services s ON s.id = b.service_id
     WHERE b.id = $1 AND b.business_id = $2`,
    [bookingId, businessId],
  );

  if (rows.length === 0) return { success: false, error: 'Booking not found' };

  const booking = rows[0];
  let cancellationFee = 0;

  // Calculate fee if applicable
  const policyId = booking.cancellation_policy_id;
  if (policyId) {
    const { rows: polRows } = await adminPool.query(
      'SELECT * FROM cancellation_policies WHERE id = $1',
      [policyId],
    );
    if (polRows.length > 0) {
      const hoursBeforeStart = (new Date(booking.start_time).getTime() - Date.now()) / (60 * 60 * 1000);
      cancellationFee = calculateCancellationFee(polRows[0], booking.price, hoursBeforeStart);
    }
  } else {
    // Check business default policy
    const { rows: defPol } = await adminPool.query(
      'SELECT * FROM cancellation_policies WHERE business_id = $1 AND is_default = true',
      [businessId],
    );
    if (defPol.length > 0) {
      const hoursBeforeStart = (new Date(booking.start_time).getTime() - Date.now()) / (60 * 60 * 1000);
      cancellationFee = calculateCancellationFee(defPol[0], booking.price, hoursBeforeStart);
    }
  }

  const result = await transitionStatus(bookingId, businessId, 'cancelled', userId, tenantId, { reason });
  return { ...result, cancellation_fee: cancellationFee };
}

/**
 * Check in a customer (Confirmed → In Progress).
 */
export async function checkInBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  return transitionStatus(bookingId, businessId, 'in_progress', userId, tenantId);
}

/**
 * Mark a booking as completed.
 */
export async function completeBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  return transitionStatus(bookingId, businessId, 'completed', userId, tenantId);
}

/**
 * Mark a booking as no-show.
 */
export async function noShowBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  return transitionStatus(bookingId, businessId, 'no_show', userId, tenantId);
}

/**
 * Reschedule a booking to a new time (and optionally new staff).
 */
export async function rescheduleBooking(
  bookingId: string, businessId: string,
  newStartTime: string, newStaffId?: string,
  userId?: string, tenantId?: string,
): Promise<TransitionResult> {
  const { rows } = await adminPool.query(
    `SELECT b.*, sv.duration FROM bookings b
     JOIN service_variants sv ON sv.id = b.variant_id
     WHERE b.id = $1 AND b.business_id = $2`,
    [bookingId, businessId],
  );

  if (rows.length === 0) return { success: false, error: 'Booking not found' };

  const booking = rows[0];

  if (!['pending', 'confirmed'].includes(booking.status)) {
    return { success: false, error: 'Can only reschedule pending or confirmed bookings' };
  }

  const startTime = new Date(newStartTime);
  const endTime = new Date(startTime.getTime() + booking.duration * 60 * 1000);
  const staffId = newStaffId || booking.staff_id;

  // Conflict check for new time
  if (staffId) {
    const { rows: conflicts } = await adminPool.query(
      `SELECT id FROM bookings
       WHERE staff_id = $1 AND id != $4
         AND start_time < $3 AND end_time > $2
         AND status IN ('pending', 'confirmed', 'in_progress')
       LIMIT 1`,
      [staffId, startTime.toISOString(), endTime.toISOString(), bookingId],
    );
    if (conflicts.length > 0) {
      return { success: false, error: 'Staff has a conflict at the new time' };
    }
  }

  // Customer conflict check
  const { rows: custConflicts } = await adminPool.query(
    `SELECT id FROM bookings
     WHERE customer_id = $1 AND id != $4
       AND start_time < $3 AND end_time > $2
       AND status IN ('pending', 'confirmed', 'in_progress')
     LIMIT 1`,
    [booking.customer_id, startTime.toISOString(), endTime.toISOString(), bookingId],
  );
  if (custConflicts.length > 0) {
    return { success: false, error: 'Customer has a conflict at the new time' };
  }

  // Update booking
  await adminPool.query(
    `UPDATE bookings SET start_time = $3, end_time = $4, staff_id = $5, updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [bookingId, businessId, startTime.toISOString(), endTime.toISOString(), staffId],
  );

  // Log
  await adminPool.query(
    `INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, $2, $3, 'Rescheduled')`,
    [bookingId, booking.status, userId],
  );

  if (tenantId && userId) {
    await logAudit({
      tenantId,
      userId,
      action: 'booking.rescheduled',
      resourceType: 'booking',
      resourceId: bookingId,
      details: { old_start: booking.start_time, new_start: newStartTime, staff_id: staffId },
    });

    await createActivity({
      customerId: booking.customer_id,
      businessId,
      activityType: 'booking',
      description: `Booking ${booking.booking_reference} rescheduled`,
      metadata: { booking_id: bookingId, old_start: booking.start_time, new_start: newStartTime },
      createdBy: userId,
    });
  }

  const { rows: updated } = await adminPool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  return { success: true, booking: updated[0] };
}

/**
 * Scheduled job: Mark no-shows for confirmed bookings past their start time + window.
 */
export async function evaluateNoShows(windowMinutes = 15): Promise<{ processed: number }> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);

  const { rows } = await adminPool.query(
    `SELECT b.id, b.business_id, b.customer_id, b.booking_reference
     FROM bookings b
     JOIN businesses biz ON biz.id = b.business_id
     WHERE b.status = 'confirmed'
       AND b.start_time < $1`,
    [cutoff.toISOString()],
  );

  let processed = 0;
  for (const booking of rows) {
    await adminPool.query(
      "UPDATE bookings SET status = 'no_show', updated_at = NOW() WHERE id = $1",
      [booking.id],
    );

    await adminPool.query(
      `INSERT INTO booking_status_history (booking_id, from_status, to_status, reason)
       VALUES ($1, 'confirmed', 'no_show', 'Auto no-show: not checked in within window')`,
      [booking.id],
    );

    await createActivity({
      customerId: booking.customer_id,
      businessId: booking.business_id,
      activityType: 'booking',
      description: `Booking ${booking.booking_reference}: No-show (auto)`,
      metadata: { booking_id: booking.id },
    });

    processed++;
  }

  if (processed > 0) {
    logger.info('Auto no-show evaluation', { processed });
  }

  return { processed };
}
