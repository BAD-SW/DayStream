import { adminPool } from '../db/pool';
import { touchVisit } from './person-identity.service';
import { logAudit } from './audit.service';
import { validateQrCode } from './checkin-qr.service';
import { validateSession } from './checkin-validation.service';
import { evaluateOnBooking } from './customer-lifecycle.service';
import { notifyArrival } from './arrival-alert.service';
import { createActivity } from './customer-activity.service';

/**
 * A check-in that is not allowed (wrong day, already checked in, cancelled, no booking today...).
 * The message is written for the person at the desk or the kiosk.
 */
export class CheckInRefused extends Error {
  code = 'CHECK_IN_REFUSED';
}

export interface BookingRef { id: string; customer_id: string | null; business_id: string; status: string }

/** "Today" is the business's own calendar day, not the database server's. */
export const BOOKING_IS_TODAY = `(b.start_time AT TIME ZONE bus.timezone)::date = (NOW() AT TIME ZONE bus.timezone)::date`;

/** A booking of this tenant and, when a business is given, of that business only. */
async function findBooking(bookingId: string, tenantId: string, businessId?: string): Promise<BookingRef | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId || '')) return null;
  const { rows } = await adminPool.query(
    `SELECT b.id, b.customer_id, b.business_id, b.status
       FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
      WHERE b.id = $1 AND bus.tenant_id = $2 AND ($3::uuid IS NULL OR b.business_id = $3)`,
    [bookingId, tenantId, businessId || null],
  );
  return rows[0] || null;
}

/** The person's next confirmed booking today. */
async function todaysBookingFor(customerId: string, tenantId: string, businessId?: string): Promise<BookingRef | null> {
  const { rows } = await adminPool.query(
    `SELECT b.id, b.customer_id, b.business_id, b.status
       FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
      WHERE b.customer_id = $1 AND bus.tenant_id = $2 AND ($3::uuid IS NULL OR b.business_id = $3)
        AND b.status = 'confirmed' AND ${BOOKING_IS_TODAY}
      ORDER BY b.start_time ASC
      LIMIT 1`,
    [customerId, tenantId, businessId || null],
  );
  return rows[0] || null;
}

/** Digits only: "+34 600 111 222" and "600-111-222" can then be compared. */
const digitsOf = (s: string) => String(s || '').replace(/\D/g, '');

/**
 * The SQL condition that matches a customer (alias `c`) by the phone number or email address given,
 * adding its values to `params`. Null when neither is usable. Never matches on a name.
 */
function contactMatch(input: { phone?: string; email?: string }, params: any[]): string | null {
  const phone = digitsOf(input.phone || '');
  const email = String(input.email || '').trim().toLowerCase();
  const hasPhone = phone.length >= 7;
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!hasPhone && !hasEmail) return null;
  const parts: string[] = [];
  if (hasEmail) { params.push(email); parts.push(`LOWER(c.email) = $${params.length}`); }
  if (hasPhone) {
    params.push(phone);
    const p = `$${params.length}`;
    const e164 = `regexp_replace(COALESCE(c.phone_e164, ''), '\\D', '', 'g')`;
    const raw = `regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g')`;
    parts.push(`(${e164} = ${p} OR ${raw} = ${p} OR right(${e164}, length(${p})) = ${p})`);
  }
  return parts.join(' OR ');
}

export interface UpcomingAppointment {
  service_name: string;
  start_time: string;
  timezone: string;
  status: string;
}

/**
 * When nobody is expected today under that phone number or email address: the person's other
 * appointments from today on (the next 60 days), so the kiosk can say "nothing today, but you have
 * these". An appointment may simply have been moved without the calendar being updated. Only the
 * service and time are returned. Two people matching returns nothing: no guessing.
 */
export async function findUpcomingByContact(
  input: { phone?: string; email?: string },
  tenantId: string,
  businessId: string | undefined,
): Promise<UpcomingAppointment[]> {
  const params: any[] = [tenantId, businessId || null];
  const contact = contactMatch(input, params);
  if (!contact) return [];
  const { rows: people } = await adminPool.query(
    `SELECT DISTINCT c.id
       FROM cus_customers c
       JOIN apt_bookings b ON b.customer_id = c.id
       JOIN sys_businesses bus ON bus.id = b.business_id
      WHERE bus.tenant_id = $1 AND ($2::uuid IS NULL OR b.business_id = $2)
        AND (${contact})
      LIMIT 2`,
    params,
  );
  if (people.length !== 1) return [];
  const { rows } = await adminPool.query(
    `SELECT s.name AS service_name, b.start_time, bus.timezone, b.status
       FROM apt_bookings b
       JOIN sys_businesses bus ON bus.id = b.business_id
       JOIN svc_services s ON s.id = b.service_id
      WHERE b.customer_id = $1 AND bus.tenant_id = $2 AND ($3::uuid IS NULL OR b.business_id = $3)
        AND b.status IN ('confirmed', 'pending')
        AND (b.start_time AT TIME ZONE bus.timezone)::date >= (NOW() AT TIME ZONE bus.timezone)::date
        AND b.start_time < NOW() + interval '60 days'
      ORDER BY b.start_time ASC
      LIMIT 5`,
    [people[0].id, tenantId, businessId || null],
  );
  return rows.map((r: any) => ({ service_name: r.service_name, start_time: r.start_time, timezone: r.timezone || 'UTC', status: r.status }));
}

/**
 * Find the person who is expected today by the phone number or email address they gave. Never by
 * name. A phone number matches on its digits, with or without the country code (at least 7 digits);
 * an email address matches exactly, ignoring case. If more than one person matches, nothing is
 * guessed: `ambiguous` is true and the person is sent to the front desk.
 *
 * Returns that person's booking today: the next one still to check in, else one already checked in
 * (only when `includeCheckedIn`, so a customer who checked in can come back for their forms).
 */
export async function findTodaysBookingByContact(
  input: { phone?: string; email?: string },
  tenantId: string,
  businessId: string | undefined,
  opts: { includeCheckedIn?: boolean } = {},
): Promise<{ booking: BookingRef | null; ambiguous: boolean }> {
  const statuses = opts.includeCheckedIn ? ['confirmed', 'checked_in', 'in_progress'] : ['confirmed'];
  const params: any[] = [tenantId, businessId || null, statuses];
  const contact = contactMatch(input, params);
  if (!contact) return { booking: null, ambiguous: false };
  const { rows: people } = await adminPool.query(
    `SELECT DISTINCT c.id
       FROM cus_customers c
       JOIN apt_bookings b ON b.customer_id = c.id
       JOIN sys_businesses bus ON bus.id = b.business_id
      WHERE bus.tenant_id = $1 AND ($2::uuid IS NULL OR b.business_id = $2)
        AND b.status = ANY($3::text[]) AND ${BOOKING_IS_TODAY}
        AND (${contact})
      LIMIT 2`,
    params,
  );
  if (people.length > 1) return { booking: null, ambiguous: true };
  if (people.length === 0) return { booking: null, ambiguous: false };

  const { rows } = await adminPool.query(
    `SELECT b.id, b.customer_id, b.business_id, b.status
       FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
      WHERE b.customer_id = $1 AND bus.tenant_id = $2 AND ($3::uuid IS NULL OR b.business_id = $3)
        AND b.status = ANY($4::text[]) AND ${BOOKING_IS_TODAY}
      ORDER BY (b.status = 'confirmed') DESC, b.start_time ASC
      LIMIT 1`,
    [people[0].id, tenantId, businessId || null, statuses],
  );
  return { booking: rows[0] || null, ambiguous: false };
}

/**
 * Check the booking in, or refuse with the reason. Nothing is written for a refused check-in
 * (a record used to be saved even then, which blocked the real check-in later).
 */
export async function completeCheckIn(booking: BookingRef, opts: {
  tenantId: string; method: string; processedBy?: string; locationId?: string; auditAction: string;
  /** Staff checking in outside the rules (too early or late, a no-show restriction): the reason is kept on the record. */
  override?: { reason: string };
}) {
  if (!booking.customer_id) {
    throw new CheckInRefused('This booking has no customer on file. Check it in from the bookings screen.');
  }
  const validation = await validateSession(booking.id, booking.customer_id, opts.tenantId);
  // An override only lifts the timing and no-show rules. A booking that is not waiting to be checked in
  // (cancelled, already checked in, not confirmed) is refused whatever staff say.
  let overridden = false;
  if (!validation.pass) {
    const stillCheckable = booking.status === 'confirmed' && !(await hasCheckInRecord(booking.id));
    if (!(opts.override && stillCheckable)) throw new CheckInRefused(validation.errors.join('. ') || 'Check-in is not allowed');
    overridden = true;
  }

  const record = await createCheckInRecord({
    tenantId: opts.tenantId,
    bookingId: booking.id,
    customerId: booking.customer_id,
    method: opts.method,
    validated: !overridden,
    validationWarnings: overridden ? [...validation.warnings, ...validation.errors] : validation.warnings,
    processedBy: opts.processedBy,
    locationId: opts.locationId,
    overrideReason: overridden ? opts.override!.reason : undefined,
  });

  await adminPool.query(
    `UPDATE apt_bookings SET status = 'checked_in', checked_in_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [booking.id],
  );
  await adminPool.query(
    `INSERT INTO apt_booking_status_history (booking_id, from_status, to_status, changed_by) VALUES ($1, $2, 'checked_in', $3)`,
    [booking.id, booking.status, opts.processedBy || null],
  ).catch(() => undefined);
  await evaluateOnBooking(booking.customer_id, booking.business_id).catch(() => undefined);

  await logAudit({
    tenantId: opts.tenantId,
    userId: opts.processedBy,
    action: opts.auditAction,
    resourceType: 'check_in_record',
    resourceId: record.id,
    details: { booking_id: booking.id, method: opts.method, location_id: opts.locationId || null, override_reason: overridden ? opts.override!.reason : null },
  });

  await createActivity({
    customerId: booking.customer_id, businessId: booking.business_id, activityType: 'booking',
    description: `Checked in (${opts.method})`,
    metadata: { booking_id: booking.id, from: booking.status, to: 'checked_in' },
    createdBy: opts.processedBy,
  }).catch(() => undefined);
  await notifyArrival(booking.id);
  return { record, validation, booking_id: booking.id };
}

/**
 * Check in by QR code (staff or self-service scanner).
 */
export async function checkInByQr(
  code: string,
  tenantId: string,
  processedBy?: string,
  method: 'qr_staff' | 'qr_self' = 'qr_staff',
  businessId?: string,
) {
  const qrRecord = code ? await validateQrCode(code) : null;
  if (!qrRecord || qrRecord.tenant_id !== tenantId) throw new CheckInRefused('Invalid or expired QR code');

  let booking: BookingRef | null;
  if (qrRecord.code_type === 'booking') {
    booking = await findBooking(qrRecord.booking_id, tenantId, businessId);
    if (!booking) throw new CheckInRefused('Booking not found');
  } else {
    booking = await todaysBookingFor(qrRecord.customer_id, tenantId, businessId);
    if (!booking) throw new CheckInRefused('No confirmed booking found for today');
  }
  return completeCheckIn(booking, { tenantId, method, processedBy, auditAction: 'checkin.qr' });
}

/**
 * Check in by booking ID (reception/manual check-in).
 */
export async function checkInByBookingId(
  bookingId: string,
  tenantId: string,
  processedBy: string,
  businessId?: string,
  override?: { reason: string },
) {
  const booking = await findBooking(bookingId, tenantId, businessId);
  if (!booking) throw new CheckInRefused('Booking not found');
  return completeCheckIn(booking, { tenantId, method: 'reception', processedBy, auditAction: 'checkin.reception', override });
}

/**
 * Kiosk check-in — tries QR code first, then booking reference, then name search.
 */
export async function checkInKiosk(
  input: { code?: string; reference?: string; email?: string; phone?: string },
  tenantId: string,
  locationId: string,
  businessId?: string,
) {
  let booking: BookingRef | null = null;
  let customerId: string | null = null;

  if (input.code) {
    const qrRecord = await validateQrCode(input.code);
    if (qrRecord && qrRecord.tenant_id === tenantId) {
      if (qrRecord.code_type === 'booking') booking = await findBooking(qrRecord.booking_id, tenantId, businessId);
      else customerId = qrRecord.customer_id;
    }
  }

  if (!booking && !customerId && input.reference) {
    const { rows } = await adminPool.query(
      `SELECT b.id, b.customer_id, b.business_id, b.status
         FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
        WHERE UPPER(b.booking_reference) = UPPER($1) AND bus.tenant_id = $2 AND ($3::uuid IS NULL OR b.business_id = $3)
          AND b.status = 'confirmed' AND ${BOOKING_IS_TODAY}
        LIMIT 1`,
      [String(input.reference).trim(), tenantId, businessId || null],
    );
    booking = rows[0] || null;
  }

  // By phone number or email address, never by name. If two people match, nothing is guessed.
  if (!booking && !customerId && (input.phone || input.email)) {
    const found = await findTodaysBookingByContact({ phone: input.phone, email: input.email }, tenantId, businessId);
    if (found.ambiguous) throw new CheckInRefused('More than one person matches. Please see the front desk.');
    booking = found.booking;
  }

  if (!booking && customerId) booking = await todaysBookingFor(customerId, tenantId, businessId);
  if (!booking) throw new CheckInRefused('Unable to find a matching booking for today');

  return completeCheckIn(booking, { tenantId, method: 'kiosk', locationId, auditAction: 'checkin.kiosk' });
}

/**
 * Get existing check-in record for a booking.
 */
export async function getCheckInRecord(bookingId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM apt_check_in_records WHERE booking_id = $1 AND status != 'cancelled' LIMIT 1`,
    [bookingId],
  );
  return rows[0] || null;
}

// --- Helper ---

async function hasCheckInRecord(bookingId: string): Promise<boolean> {
  const { rows } = await adminPool.query(`SELECT 1 FROM apt_check_in_records WHERE booking_id = $1 AND status != 'cancelled' LIMIT 1`, [bookingId]);
  return rows.length > 0;
}

export async function createCheckInRecord(input: {
  tenantId: string;
  bookingId: string;
  customerId: string;
  method: string;
  validated: boolean;
  validationWarnings: string[];
  processedBy?: string;
  locationId?: string;
  overrideReason?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO apt_check_in_records
       (tenant_id, booking_id, customer_id, check_in_method, validated, validation_warnings, processed_by, location_id, override_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.tenantId,
      input.bookingId,
      input.customerId,
      input.method,
      input.validated,
      JSON.stringify(input.validationWarnings),
      input.processedBy || null,
      input.locationId || null,
      input.overrideReason || null,
    ],
  );
  // A check-in is a visit: it moves the person's "last visit" and "last activity" (Phase 46).
  if (input.customerId) await touchVisit(input.customerId).catch(() => undefined);
  return rows[0];
}
