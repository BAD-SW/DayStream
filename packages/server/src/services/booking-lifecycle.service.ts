import { withBookingLock, planBookingChange } from './booking.service';
import { evaluateOnBooking } from './customer-lifecycle.service';
import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { calculateCancellationFee } from './cancellation-policies.service';
import { logger } from '../middleware/logger';

// Valid state transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['completed', 'confirmed'],
  in_progress: ['completed'],
  // Terminal states: completed, cancelled, no_show — no transitions out
};

interface TransitionResult {
  success: boolean;
  booking?: any;
  error?: string;
  cancellation_fee?: number;
  no_show_fee?: number;
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
    'SELECT * FROM apt_bookings WHERE id = $1 AND business_id = $2',
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

  if (newStatus === 'checked_in') {
    updateFields.push(`checked_in_at = NOW()`);
  }

  if (newStatus === 'confirmed' && currentStatus === 'checked_in') {
    updateFields.push(`checked_in_at = NULL`);
  }

  await adminPool.query(
    `UPDATE apt_bookings SET ${updateFields.join(', ')} WHERE id = $1 AND business_id = $2`,
    updateParams,
  );

  // Record in status history
  await adminPool.query(
    `INSERT INTO apt_booking_status_history (booking_id, from_status, to_status, changed_by, reason)
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

  // Log in customer timeline (skip for walk-ins with no customer)
  if (booking.customer_id) {
    await createActivity({
      customerId: booking.customer_id,
      businessId,
      activityType: 'booking',
      description: `Booking ${booking.booking_reference}: ${currentStatus} → ${newStatus}`,
      metadata: { booking_id: bookingId, from: currentStatus, to: newStatus },
      createdBy: userId,
    });
  }

  // Return updated booking
  const { rows: updated } = await adminPool.query('SELECT * FROM apt_bookings WHERE id = $1', [bookingId]);
  return { success: true, booking: updated[0] };
}

/**
 * Confirm a pending booking.
 *
 * Fires the appointment-confirmation email on a successful pending→confirmed
 * transition (desk/checkout payment, async bank-debit settlement, staff confirm
 * button, widget-paid). The born-confirmed paths notify from checkAndSaveBooking
 * instead, so between the two every confirmation path is covered exactly once.
 * Hydrated via getBookingById so service/staff names populate; skipped when the
 * customer has no email. Non-blocking.
 */
export async function confirmBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  const result = await transitionStatus(bookingId, businessId, 'confirmed', userId, tenantId);
  if (result.success) {
    try {
      const { getBookingById } = await import('./booking.service');
      const { queueBookingConfirmation } = await import('./booking-notifications.service');
      const full = await getBookingById(bookingId, businessId);
      if (full?.customer_email) await queueBookingConfirmation(full, full.customer_email);
    } catch (e: any) {
      logger.warn(`Confirm booking ${bookingId}: confirmation enqueue failed: ${e?.message || e}`);
    }
  }
  return result;
}

/**
 * Cancel a booking. Calculates cancellation fee if applicable.
 */
/** After a visit (check-in or completion) the person's stage is looked at again. */
async function afterVisit(bookingId: string, businessId: string): Promise<void> {
  try {
    const { rows } = await adminPool.query('SELECT customer_id FROM apt_bookings WHERE id = $1', [bookingId]);
    if (rows[0]?.customer_id) await evaluateOnBooking(rows[0].customer_id, businessId);
  } catch (e: any) {
    console.error('[Booking] Lifecycle not evaluated:', e?.message || e);
  }
}

export async function cancelBooking(
  bookingId: string, businessId: string, userId: string, tenantId: string, reason?: string,
): Promise<TransitionResult> {
  // Load booking to calculate fee
  const { rows } = await adminPool.query(
    `SELECT b.*, s.cancellation_policy_id FROM apt_bookings b
     JOIN svc_services s ON s.id = b.service_id
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
      'SELECT * FROM svc_cancellation_policies WHERE id = $1',
      [policyId],
    );
    if (polRows.length > 0) {
      const hoursBeforeStart = (new Date(booking.start_time).getTime() - Date.now()) / (60 * 60 * 1000);
      cancellationFee = calculateCancellationFee(polRows[0], booking.price, hoursBeforeStart);
    }
  } else {
    // Check business default policy
    const { rows: defPol } = await adminPool.query(
      'SELECT * FROM svc_cancellation_policies WHERE business_id = $1 AND is_default = true',
      [businessId],
    );
    if (defPol.length > 0) {
      const hoursBeforeStart = (new Date(booking.start_time).getTime() - Date.now()) / (60 * 60 * 1000);
      cancellationFee = calculateCancellationFee(defPol[0], booking.price, hoursBeforeStart);
    }
  }

  const result = await transitionStatus(bookingId, businessId, 'cancelled', userId, tenantId, { reason });
  if (result.success) {
    try {
      const { promoteNext } = await import('./waitlist.service');
      await promoteNext(booking.service_id, new Date(booking.start_time).toISOString());
    } catch (err: any) {
      logger.error('Waitlist not processed after cancellation', { bookingId, error: err.message });
    }

    // Appointment cancellation email — ONLY for genuine customer/staff cancellations.
    // Internal payment-release cancels (a declined desk charge / a bounced bank debit)
    // pass a system reason; a cheerful "your booking was cancelled" there would be
    // wrong, so suppress those. Hydrate for service name; skip when no customer email.
    const SYSTEM_CANCEL_REASONS = ['Payment failed', 'Bank debit failed to settle'];
    if (!reason || !SYSTEM_CANCEL_REASONS.includes(reason)) {
      try {
        const { getBookingById } = await import('./booking.service');
        const { queueBookingCancellation } = await import('./booking-notifications.service');
        const full = await getBookingById(bookingId, businessId);
        if (full?.customer_email) await queueBookingCancellation(full, full.customer_email, reason);
      } catch (e: any) {
        logger.warn(`Cancel booking ${bookingId}: cancellation notice enqueue failed: ${e?.message || e}`);
      }
    }
  }
  return { ...result, cancellation_fee: cancellationFee };
}

/**
 * Check in a customer (Confirmed → Checked In).
 */
export async function checkInBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  const result = await transitionStatus(bookingId, businessId, 'checked_in', userId, tenantId);
  if (result.success) await afterVisit(bookingId, businessId);
  return result;
}

/**
 * Reset a checked-in booking back to confirmed (Checked In → Confirmed).
 */
export async function resetBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  return transitionStatus(bookingId, businessId, 'confirmed', userId, tenantId);
}

/**
 * Mark a booking as completed.
 */
export async function completeBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  const result = await transitionStatus(bookingId, businessId, 'completed', userId, tenantId);
  if (result.success) await afterVisit(bookingId, businessId);
  return result;
}

/**
 * Mark a booking as no-show. If the booked variant has a no-show fee, charge it:
 * a paid "No-Show Fee" order is created (posting to No-Show Fee Revenue), and the
 * charge is recorded on apt_no_show_records. Bookings whose variant has no fee
 * simply transition to no_show with no charge.
 */
export async function noShowBooking(bookingId: string, businessId: string, userId: string, tenantId: string): Promise<TransitionResult> {
  // Resolve the booked variant's no-show fee before transitioning.
  const { rows: bkRows } = await adminPool.query(
    `SELECT b.customer_id, b.staff_id, sv.no_show_fee
     FROM apt_bookings b
     LEFT JOIN svc_variants sv ON sv.id = b.variant_id
     WHERE b.id = $1 AND b.business_id = $2`,
    [bookingId, businessId],
  );
  const feeAmount: number = bkRows[0]?.no_show_fee ?? 0;

  const result = await transitionStatus(bookingId, businessId, 'no_show', userId, tenantId);
  if (!result.success) return result;

  if (bkRows[0]?.customer_id) {
    await adminPool.query(
      `INSERT INTO apt_no_show_records (tenant_id, booking_id, customer_id) VALUES ($1, $2, $3)
       ON CONFLICT (booking_id) DO NOTHING`,
      [tenantId, bookingId, bkRows[0].customer_id],
    ).catch((err: any) => logger.error('No-show record not written', { bookingId, error: err.message }));
  }

  if (feeAmount > 0) {
    try {
      const { chargeNoShowFee } = await import('./checkout.service');
      const feeOrder = await chargeNoShowFee({
        bookingId,
        businessId,
        customerId: bkRows[0]?.customer_id || null,
        creditedTo: bkRows[0]?.staff_id || null,
        feeAmount,
        checkedOutBy: userId,
      });

      // Record the charge on the no-show record (create if the check-in
      // subsystem hasn't already made one).
      await adminPool.query(
        `INSERT INTO apt_no_show_records (tenant_id, booking_id, customer_id, fee_amount, fee_charged)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (booking_id) DO UPDATE SET fee_amount = $4, fee_charged = $5`,
        [tenantId, bookingId, bkRows[0]?.customer_id || null, feeAmount, feeOrder?.status === 'completed'],
      );
      if (feeOrder?.status !== 'completed') return { ...result, no_show_fee: 0 };
    } catch (err: any) {
      logger.error('No-show fee charge failed', { bookingId, error: err.message });
      // Don't fail the no-show transition if charging fails; report fee unbilled.
      return { ...result, no_show_fee: 0 };
    }
  }

  return { ...result, no_show_fee: feeAmount };
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
    `SELECT b.*, sv.duration FROM apt_bookings b
     JOIN svc_variants sv ON sv.id = b.variant_id
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

  // The new time is checked like a new booking: opening hours, the provider's availability,
  // conflicts, resources and capacity (it used to check only the provider's and customer's
  // other bookings).
  try {
    await withBookingLock(businessId, async () => {
      const plan = await planBookingChange({
        businessId, tenantId: tenantId || '', createdBy: userId || '',
        customerId: booking.customer_id || undefined, walkInName: booking.walk_in_name || undefined,
        serviceId: booking.service_id, variantId: booking.variant_id, staffId: staffId || undefined,
        resourceId: booking.resource_id || undefined, startTime: startTime.toISOString(),
        participantCount: booking.participant_count || 1, excludeBookingId: bookingId,
      });
      await adminPool.query(
        `UPDATE apt_bookings SET start_time = $3, end_time = $4, staff_id = $5, resource_id = COALESCE($6, resource_id), updated_at = NOW()
         WHERE id = $1 AND business_id = $2`,
        [bookingId, businessId, startTime.toISOString(), endTime.toISOString(), plan.staff_id || staffId, plan.resource_id || null],
      );
    });
  } catch (err: any) {
    if (err?.severity || /^(TypeError|ReferenceError|RangeError|SyntaxError)$/.test(err?.name || '')) throw err;
    return { success: false, error: /conflict/i.test(err.message) ? err.message : `Conflict at the new time: ${err.message}` };
  }

  // Log
  await adminPool.query(
    `INSERT INTO apt_booking_status_history (booking_id, from_status, to_status, changed_by, reason)
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

  const { rows: updated } = await adminPool.query('SELECT * FROM apt_bookings WHERE id = $1', [bookingId]);

  // Appointment reschedule email (old → new time). Hydrate for service/staff names;
  // skip when the customer has no email. Non-blocking.
  try {
    const { getBookingById } = await import('./booking.service');
    const { queueBookingReschedule } = await import('./booking-notifications.service');
    const full = await getBookingById(bookingId, businessId);
    if (full?.customer_email) await queueBookingReschedule(full, full.customer_email, booking.start_time);
  } catch (e: any) {
    logger.warn(`Reschedule booking ${bookingId}: reschedule notice enqueue failed: ${e?.message || e}`);
  }

  return { success: true, booking: updated[0] };
}

/**
 * Scheduled job: Mark no-shows for confirmed bookings past their start time + window.
 */
export async function evaluateNoShows(windowMinutes = 15): Promise<{ processed: number }> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);

  const { rows } = await adminPool.query(
    `SELECT b.id, b.business_id, b.customer_id, b.booking_reference
     FROM apt_bookings b
     JOIN sys_businesses biz ON biz.id = b.business_id
     WHERE b.status = 'confirmed'
       AND b.start_time < $1`,
    [cutoff.toISOString()],
  );

  let processed = 0;
  for (const booking of rows) {
    await adminPool.query(
      "UPDATE apt_bookings SET status = 'no_show', updated_at = NOW() WHERE id = $1",
      [booking.id],
    );

    await adminPool.query(
      `INSERT INTO apt_booking_status_history (booking_id, from_status, to_status, reason)
       VALUES ($1, 'confirmed', 'no_show', 'Auto no-show: not checked in within window')`,
      [booking.id],
    );

    if (booking.customer_id) {
      await createActivity({
        customerId: booking.customer_id,
        businessId: booking.business_id,
        activityType: 'booking',
        description: `Booking ${booking.booking_reference}: No-show (auto)`,
        metadata: { booking_id: booking.id },
      });
    }

    processed++;
  }

  if (processed > 0) {
    logger.info('Auto no-show evaluation', { processed });
  }

  return { processed };
}
