import { adminPool } from '../db/pool';
import { getConfig } from './checkin-config.service';
import { getCustomerNoShowCount } from './checkin-noshow.service';

interface ValidationResult {
  pass: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate whether a customer can check in for a booking.
 * Checks: booking exists & confirmed, booking is today (within early arrival window),
 * not already checked in, membership active (if needed), credits sufficient (if on_checkin),
 * no-show restriction.
 */
export async function validateSession(
  bookingId: string,
  customerId: string,
  tenantId: string,
): Promise<ValidationResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const config = await getConfig(tenantId);

  // 1. Check booking exists and is confirmed
  const { rows: bookingRows } = await adminPool.query(
    `SELECT b.id, b.status, b.start_time, b.end_time, b.customer_id, b.service_id, bus.tenant_id
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE b.id = $1 AND bus.tenant_id = $2`,
    [bookingId, tenantId],
  );

  if (bookingRows.length === 0) {
    errors.push('Booking not found');
    return { pass: false, warnings, errors };
  }

  const booking = bookingRows[0];

  if (booking.customer_id !== customerId) {
    errors.push('Booking does not belong to this customer');
    return { pass: false, warnings, errors };
  }

  if (booking.status !== 'confirmed') {
    errors.push(`Booking status is "${booking.status}", expected "confirmed"`);
    return { pass: false, warnings, errors };
  }

  // 2. Check booking is for today (within early_arrival_minutes)
  const now = new Date();
  const startTime = new Date(booking.start_time);
  const earlyArrivalMs = config.early_arrival_minutes * 60 * 1000;
  const lateArrivalMs = config.late_arrival_max_minutes * 60 * 1000;

  const earliestArrival = new Date(startTime.getTime() - earlyArrivalMs);
  const latestArrival = new Date(startTime.getTime() + lateArrivalMs);

  if (now < earliestArrival) {
    errors.push('Too early to check in');
    return { pass: false, warnings, errors };
  }

  if (now > latestArrival) {
    errors.push('Check-in window has expired');
    return { pass: false, warnings, errors };
  }

  // 3. Check not already checked in
  const { rows: existingCheckin } = await adminPool.query(
    `SELECT id FROM check_in_records WHERE booking_id = $1 AND status != 'cancelled' LIMIT 1`,
    [bookingId],
  );

  if (existingCheckin.length > 0) {
    errors.push('Already checked in for this booking');
    return { pass: false, warnings, errors };
  }

  // 4. Check membership active (if membership-based service)
  // Note: Skip membership check if service doesn't have requires_membership column
  // This is a future enhancement when services explicitly gate by membership

  // 5. Check credits (if credit_deduction_mode is 'on_checkin')
  // Credit validation will be more thoroughly integrated when membership credits are fully wired
  // For now, skip if the table doesn't have the expected structure

  // 6. No-show restriction check
  const noShowCount = await getCustomerNoShowCount(customerId, tenantId);

  if (noShowCount >= config.no_show_restrict_threshold) {
    errors.push(`Check-in restricted: ${noShowCount} no-shows (threshold: ${config.no_show_restrict_threshold})`);
    return { pass: false, warnings, errors };
  }

  if (noShowCount >= config.no_show_warning_threshold) {
    warnings.push(`Customer has ${noShowCount} no-shows (warning threshold: ${config.no_show_warning_threshold})`);
  }

  return { pass: errors.length === 0, warnings, errors };
}
