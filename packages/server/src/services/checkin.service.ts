import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { validateQrCode } from './checkin-qr.service';
import { validateSession } from './checkin-validation.service';

/**
 * Check in by QR code (staff or self-service scanner).
 */
export async function checkInByQr(
  code: string,
  tenantId: string,
  processedBy?: string,
  method: 'qr_staff' | 'qr_self' = 'qr_staff',
) {
  // Validate QR code
  const qrRecord = await validateQrCode(code);
  if (!qrRecord) throw new Error('Invalid or expired QR code');

  let bookingId: string;
  let customerId: string;

  if (qrRecord.code_type === 'booking') {
    bookingId = qrRecord.booking_id;
    // Look up customer from booking
    const { rows } = await adminPool.query(
      `SELECT b.customer_id FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
       WHERE b.id = $1 AND bus.tenant_id = $2`,
      [bookingId, tenantId],
    );
    if (rows.length === 0) throw new Error('Booking not found');
    customerId = rows[0].customer_id;
  } else {
    // Customer QR — find their next confirmed booking for today
    customerId = qrRecord.customer_id;
    const { rows } = await adminPool.query(
      `SELECT b.id FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
       WHERE b.customer_id = $1 AND bus.tenant_id = $2
         AND b.status = 'confirmed'
         AND b.start_time::date = CURRENT_DATE
       ORDER BY b.start_time ASC
       LIMIT 1`,
      [customerId, tenantId],
    );
    if (rows.length === 0) throw new Error('No confirmed booking found for today');
    bookingId = rows[0].id;
  }

  // Validate session
  const validation = await validateSession(bookingId, customerId, tenantId);

  // Create check-in record
  const record = await createCheckInRecord({
    tenantId,
    bookingId,
    customerId,
    method,
    validated: validation.pass,
    validationWarnings: validation.warnings,
    processedBy,
  });

  // Update booking status
  if (validation.pass) {
    await adminPool.query(
      `UPDATE apt_bookings SET status = 'checked_in' WHERE id = $1`,
      [bookingId],
    );
  }

  await logAudit({
    tenantId,
    userId: processedBy,
    action: 'checkin.qr',
    resourceType: 'check_in_record',
    resourceId: record.id,
    details: { booking_id: bookingId, method, validated: validation.pass },
  });

  return { record, validation };
}

/**
 * Check in by booking ID (reception/manual check-in).
 */
export async function checkInByBookingId(
  bookingId: string,
  tenantId: string,
  processedBy: string,
) {
  // Look up booking
  const { rows } = await adminPool.query(
    `SELECT b.customer_id FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
     WHERE b.id = $1 AND bus.tenant_id = $2`,
    [bookingId, tenantId],
  );
  if (rows.length === 0) throw new Error('Booking not found');

  const customerId = rows[0].customer_id;

  // Validate session
  const validation = await validateSession(bookingId, customerId, tenantId);

  // Create check-in record
  const record = await createCheckInRecord({
    tenantId,
    bookingId,
    customerId,
    method: 'reception',
    validated: validation.pass,
    validationWarnings: validation.warnings,
    processedBy,
  });

  // Update booking status
  if (validation.pass) {
    await adminPool.query(
      `UPDATE apt_bookings SET status = 'checked_in' WHERE id = $1`,
      [bookingId],
    );
  }

  await logAudit({
    tenantId,
    userId: processedBy,
    action: 'checkin.reception',
    resourceType: 'check_in_record',
    resourceId: record.id,
    details: { booking_id: bookingId, validated: validation.pass },
  });

  return { record, validation };
}

/**
 * Kiosk check-in — tries QR code first, then booking reference, then name search.
 */
export async function checkInKiosk(
  input: { code?: string; reference?: string; name?: string; phone?: string },
  tenantId: string,
  locationId: string,
) {
  let bookingId: string | null = null;
  let customerId: string | null = null;

  // Try QR code first
  if (input.code) {
    const qrRecord = await validateQrCode(input.code);
    if (qrRecord) {
      if (qrRecord.code_type === 'booking') {
        bookingId = qrRecord.booking_id;
      } else {
        customerId = qrRecord.customer_id;
      }
    }
  }

  // Try booking reference
  if (!bookingId && !customerId && input.reference) {
    const { rows } = await adminPool.query(
      `SELECT b.id, b.customer_id FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
       WHERE b.booking_reference = $1 AND bus.tenant_id = $2
         AND b.status = 'confirmed' AND b.start_time::date = CURRENT_DATE
       LIMIT 1`,
      [input.reference, tenantId],
    );
    if (rows.length > 0) {
      bookingId = rows[0].id;
      customerId = rows[0].customer_id;
    }
  }

  // Try name/phone search
  if (!bookingId && !customerId && (input.name || input.phone)) {
    const conditions = ['c.tenant_id = $1'];
    const params: any[] = [tenantId];
    let idx = 2;

    if (input.name) {
      conditions.push(`(c.first_name || ' ' || c.last_name) ILIKE $${idx++}`);
      params.push(`%${input.name}%`);
    }
    if (input.phone) {
      conditions.push(`c.phone = $${idx++}`);
      params.push(input.phone);
    }

    const { rows: customers } = await adminPool.query(
      `SELECT c.id FROM cus_customers c WHERE ${conditions.join(' AND ')} LIMIT 1`,
      params,
    );

    if (customers.length > 0) {
      customerId = customers[0].id;
    }
  }

  // Resolve booking from customer if we only have customerId
  if (!bookingId && customerId) {
    const { rows } = await adminPool.query(
      `SELECT b.id FROM apt_bookings b JOIN sys_businesses bus ON bus.id = b.business_id
       WHERE b.customer_id = $1 AND bus.tenant_id = $2
         AND b.status = 'confirmed' AND b.start_time::date = CURRENT_DATE
       ORDER BY b.start_time ASC
       LIMIT 1`,
      [customerId, tenantId],
    );
    if (rows.length > 0) {
      bookingId = rows[0].id;
    }
  }

  if (!bookingId || !customerId) {
    throw new Error('Unable to find a matching booking for today');
  }

  // Validate session
  const validation = await validateSession(bookingId, customerId, tenantId);

  // Create check-in record
  const record = await createCheckInRecord({
    tenantId,
    bookingId,
    customerId,
    method: 'kiosk',
    validated: validation.pass,
    validationWarnings: validation.warnings,
    locationId,
  });

  // Update booking status
  if (validation.pass) {
    await adminPool.query(
      `UPDATE apt_bookings SET status = 'checked_in' WHERE id = $1`,
      [bookingId],
    );
  }

  await logAudit({
    tenantId,
    action: 'checkin.kiosk',
    resourceType: 'check_in_record',
    resourceId: record.id,
    details: { booking_id: bookingId, location_id: locationId, validated: validation.pass },
  });

  return { record, validation };
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

async function createCheckInRecord(input: {
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
  return rows[0];
}
