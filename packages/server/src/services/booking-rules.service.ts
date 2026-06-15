import { adminPool } from '../db/pool';
import { getConfig } from './config.service';
import { calculateCancellationFee } from './cancellation-policies.service';

interface BookingRulesCheck {
  serviceId: string;
  businessId: string;
  customerId: string;
  tenantId: string;
  startTime: Date;
  isStaffOverride?: boolean;
}

interface RulesResult {
  allowed: boolean;
  violations: string[];
}

/**
 * Validate all booking rules for a proposed booking.
 */
export async function validateBookingRules(input: BookingRulesCheck): Promise<RulesResult> {
  const violations: string[] = [];

  if (input.isStaffOverride) {
    return { allowed: true, violations: [] };
  }

  // Load service config
  const { rows: svcRows } = await adminPool.query(
    'SELECT min_advance_booking_hours, max_advance_booking_days FROM services WHERE id = $1',
    [input.serviceId],
  );

  if (svcRows.length === 0) {
    return { allowed: false, violations: ['Service not found'] };
  }

  const service = svcRows[0];

  // 1. Lead time check
  const minAdvanceMs = (service.min_advance_booking_hours || 2) * 60 * 60 * 1000;
  const timeUntilBooking = input.startTime.getTime() - Date.now();
  if (timeUntilBooking < minAdvanceMs) {
    violations.push(`Minimum advance booking time is ${service.min_advance_booking_hours} hours`);
  }

  // 2. Max advance booking check
  const maxAdvanceMs = (service.max_advance_booking_days || 30) * 24 * 60 * 60 * 1000;
  if (timeUntilBooking > maxAdvanceMs) {
    violations.push(`Cannot book more than ${service.max_advance_booking_days} days in advance`);
  }

  // 3. Max active bookings per customer
  const maxActive = await getConfig(input.tenantId, 'booking.max_active_per_customer') as number || 10;
  const { rows: activeCount } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM bookings
     WHERE customer_id = $1 AND business_id = $2
       AND status IN ('pending', 'confirmed')
       AND start_time > NOW()`,
    [input.customerId, input.businessId],
  );

  if (activeCount[0].count >= maxActive) {
    violations.push(`Maximum ${maxActive} active bookings allowed per customer`);
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

/**
 * Calculate the cancellation fee for a booking based on its policy.
 */
export async function calculateBookingCancellationFee(bookingId: string, businessId: string): Promise<{ fee: number; policy_name: string | null }> {
  const { rows } = await adminPool.query(
    `SELECT b.price, b.start_time, s.cancellation_policy_id
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     WHERE b.id = $1 AND b.business_id = $2`,
    [bookingId, businessId],
  );

  if (rows.length === 0) return { fee: 0, policy_name: null };

  const booking = rows[0];
  const hoursBeforeStart = (new Date(booking.start_time).getTime() - Date.now()) / (60 * 60 * 1000);

  // Get policy (service-specific or business default)
  let policyQuery: string;
  let policyParams: any[];

  if (booking.cancellation_policy_id) {
    policyQuery = 'SELECT * FROM cancellation_policies WHERE id = $1';
    policyParams = [booking.cancellation_policy_id];
  } else {
    policyQuery = 'SELECT * FROM cancellation_policies WHERE business_id = $1 AND is_default = true';
    policyParams = [businessId];
  }

  const { rows: polRows } = await adminPool.query(policyQuery, policyParams);
  if (polRows.length === 0) return { fee: 0, policy_name: null };

  const policy = polRows[0];
  const fee = calculateCancellationFee(policy, booking.price, hoursBeforeStart);

  return { fee, policy_name: policy.name };
}

/**
 * Get the booking rules summary for display to customers.
 */
export async function getBookingRulesSummary(serviceId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT s.min_advance_booking_hours, s.max_advance_booking_days, s.cancellation_policy_id,
            cp.name AS policy_name, cp.free_cancellation_hours, cp.late_cancel_fee_type, cp.late_cancel_fee_value
     FROM services s
     LEFT JOIN cancellation_policies cp ON cp.id = s.cancellation_policy_id
     WHERE s.id = $1 AND s.business_id = $2`,
    [serviceId, businessId],
  );

  if (rows.length === 0) return null;

  const service = rows[0];

  // If no service-specific policy, get business default
  let cancellationPolicy = null;
  if (service.policy_name) {
    cancellationPolicy = {
      name: service.policy_name,
      free_cancellation_hours: service.free_cancellation_hours,
      late_cancel_fee_type: service.late_cancel_fee_type,
      late_cancel_fee_value: service.late_cancel_fee_value,
    };
  } else {
    const { rows: defPol } = await adminPool.query(
      'SELECT name, free_cancellation_hours, late_cancel_fee_type, late_cancel_fee_value FROM cancellation_policies WHERE business_id = $1 AND is_default = true',
      [businessId],
    );
    if (defPol.length > 0) cancellationPolicy = defPol[0];
  }

  return {
    min_advance_booking_hours: service.min_advance_booking_hours,
    max_advance_booking_days: service.max_advance_booking_days,
    cancellation_policy: cancellationPolicy,
  };
}
