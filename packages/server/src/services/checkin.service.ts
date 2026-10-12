import { adminPool } from '../db/pool';
import { touchVisit } from './person-identity.service';
import { logAudit } from './audit.service';
import { validateQrCode } from './checkin-qr.service';
import { validateSession } from './checkin-validation.service';
import { evaluateOnBooking } from './customer-lifecycle.service';

/**
 * A check-in that is not allowed (wrong day, already checked in, cancelled, no booking today...).
 * The message is written for the person at the desk or the kiosk.
 */
export class CheckInRefused extends Error {
  code = 'CHECK_IN_REFUSED';
}

interface BookingRef { id: string; customer_id: string | null; business_id: string; status: string }

/** "Today" is the business's own calendar day, not the database server's. */
const BOOKING_IS_TODAY = `(b.start_time AT TIME ZONE bus.timezone)::date = (NOW() AT TIME ZONE bus.timezone)::date`;

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

/**
 * Check the booking in, or refuse with the reason. Nothing is written for a refused check-in
 * (a record used to be saved even then, which blocked the real check-in later).
 */
async function completeCheckIn(booking: BookingRef, opts: {
  tenantId: string; method: string; processedBy?: string; locationId?: string; auditAction: string;
}) {
  if (!booking.customer_id) {
    throw new CheckInRefused('This booking has no customer on file. Check it in from the bookings screen.');
  }
  const validation = await validateSession(booking.id, booking.customer_id, opts.tenantId);
  if (!validation.pass) throw new CheckInRefused(validation.errors.join('. ') || 'Check-in is not allowed');

  const record = await createCheckInRecord({
    tenantId: opts.tenantId,
    bookingId: booking.id,
    customerId: booking.customer_id,
    method: opts.method,
    validated: true,
    validationWarnings: validation.warnings,
    processedBy: opts.processedBy,
    locationId: opts.locationId,
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
    details: { booking_id: booking.id, method: opts.method, location_id: opts.locationId || null },
  });

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
) {
  const booking = await findBooking(bookingId, tenantId, businessId);
  if (!booking) throw new CheckInRefused('Booking not found');
  return completeCheckIn(booking, { tenantId, method: 'reception', processedBy, auditAction: 'checkin.reception' });
}

/**
 * Kiosk check-in — tries QR code first, then booking reference, then name search.
 */
export async function checkInKiosk(
  input: { code?: string; reference?: string; name?: string; phone?: string },
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

  if (!booking && !customerId && (input.name || input.phone)) {
    // Only people who are expected today can be found this way.
    const conditions = ['bus.tenant_id = $1', '($2::uuid IS NULL OR b.business_id = $2)', "b.status = 'confirmed'", BOOKING_IS_TODAY];
    const params: any[] = [tenantId, businessId || null];
    if (input.name) {
      params.push(`%${String(input.name).trim()}%`);
      conditions.push(`(c.first_name || ' ' || c.last_name) ILIKE $${params.length}`);
    }
    if (input.phone) {
      params.push(String(input.phone).replace(/[^\d+]/g, ''));
      conditions.push(`(REPLACE(COALESCE(c.phone, ''), ' ', '') = $${params.length} OR c.phone_e164 = $${params.length})`);
    }
    const { rows } = await adminPool.query(
      `SELECT DISTINCT c.id
         FROM cus_customers c
         JOIN apt_bookings b ON b.customer_id = c.id
         JOIN sys_businesses bus ON bus.id = b.business_id
        WHERE ${conditions.join(' AND ')}
        LIMIT 2`,
      params,
    );
    // Two different people match: do not guess.
    if (rows.length === 1) customerId = rows[0].id;
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

export async function createCheckInRecord(input: {
  tenantId: string;
  bookingId: string;
  customerId: string;
  method: string;
  validated: boolean;
  validationWarnings: string[];
  processedBy?: string;
  locationId?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO apt_check_in_records
       (tenant_id, booking_id, customer_id, check_in_method, validated, validation_warnings, processed_by, location_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    ],
  );
  // A check-in is a visit: it moves the person's "last visit" and "last activity" (Phase 46).
  if (input.customerId) await touchVisit(input.customerId).catch(() => undefined);
  return rows[0];
}
