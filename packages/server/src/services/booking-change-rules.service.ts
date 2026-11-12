import { adminPool } from '../db/pool';

/**
 * What staff may change on an existing booking (decisions CAL-19 and CAL-22, 11 Nov 2026;
 * in line with Fresha and Square).
 *
 * - Completed, cancelled or no-show: view only.
 * - Paid and started: view only.
 * - Started, not paid (pending, confirmed, checked in): staff, service, option, headcount and
 *   customer can be corrected until checkout, but it can't be moved to another day or time.
 * - Paid, not started: day, time and staff can change; service, option, headcount and customer
 *   can't (they change the price: cancel with a refund and book again).
 * - Otherwise everything can change.
 * - Notes can always be changed (unchanged behaviour).
 * - No booking can be moved to a time in the past.
 */
export interface ChangeRules {
  read_only: boolean;
  can_move: boolean;
  can_change_staff: boolean;
  can_change_offering: boolean;
  can_change_customer: boolean;
  paid: boolean;
  started: boolean;
  reason: string | null;
}

const TERMINAL = ['completed', 'cancelled', 'no_show'];

export function computeChangeRules(
  booking: { status: string; start_time: string | Date },
  paid: boolean,
  now: Date = new Date(),
): ChangeRules {
  const started = new Date(booking.start_time).getTime() <= now.getTime();
  const base = { paid, started };
  const none = (reason: string): ChangeRules => ({ ...base, read_only: true, can_move: false, can_change_staff: false, can_change_offering: false, can_change_customer: false, reason });
  if (TERMINAL.includes(booking.status)) {
    const label = booking.status === 'no_show' ? 'a no-show' : booking.status;
    return none(`This booking is ${label}: it can be viewed but not changed.`);
  }
  if (paid && started) return none('This booking has been paid and has started: it can be viewed but not changed.');
  if (started) {
    return {
      ...base, read_only: false, can_move: false, can_change_staff: true, can_change_offering: true, can_change_customer: true,
      reason: 'This booking has started: staff, service and customer can be corrected until checkout, but it can\'t be moved to another day or time.',
    };
  }
  if (paid) {
    return {
      ...base, read_only: false, can_move: true, can_change_staff: true, can_change_offering: false, can_change_customer: false,
      reason: 'This booking is paid: day, time and staff can change; service, option, number of people and customer can\'t (cancel with a refund and book again).',
    };
  }
  return { ...base, read_only: false, can_move: true, can_change_staff: true, can_change_offering: true, can_change_customer: true, reason: null };
}

/** Paid = the booking's order was checked out (completed, or completed and later refunded). */
export async function isBookingPaid(bookingId: string, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT 1 FROM fin_orders WHERE booking_id = $1 AND business_id = $2 AND status IN ('completed', 'refunded') LIMIT 1`,
    [bookingId, businessId],
  );
  return rows.length > 0;
}

export async function getChangeRules(booking: { id: string; status: string; start_time: string | Date }, businessId: string): Promise<ChangeRules> {
  return computeChangeRules(booking, await isBookingPaid(booking.id, businessId));
}

/**
 * Check a requested change against the rules. Returns an error message, or null when allowed.
 * `changed` lists the fields that really change.
 */
export function checkChange(rules: ChangeRules, changed: { start_time?: string | null; staff?: boolean; offering?: boolean; customer?: boolean }, now: Date = new Date()): string | null {
  const any = !!changed.start_time || changed.staff || changed.offering || changed.customer;
  if (!any) return null;
  if (rules.read_only) return rules.reason;
  if (changed.start_time) {
    if (!rules.can_move) return rules.reason;
    if (new Date(changed.start_time).getTime() < now.getTime()) return 'A booking can\'t be moved to a time in the past.';
  }
  if (changed.staff && !rules.can_change_staff) return rules.reason;
  if (changed.offering && !rules.can_change_offering) return rules.reason;
  if (changed.customer && !rules.can_change_customer) return rules.reason;
  return null;
}
