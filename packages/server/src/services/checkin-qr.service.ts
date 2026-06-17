import crypto from 'crypto';
import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Generate a unique QR code string with a given prefix.
 */
function generateCode(prefix: string): string {
  const hex = crypto.randomBytes(3).toString('hex');
  return `${prefix}-${hex}`;
}

/**
 * Generate a QR code for a specific booking.
 * Code expires at end of the booking day.
 */
export async function generateBookingQrCode(tenantId: string, bookingId: string) {
  const code = generateCode('DSCI');

  // Get booking date to set expiry at end of day
  const { rows: bookingRows } = await adminPool.query(
    `SELECT b.start_time FROM bookings b JOIN businesses bus ON bus.id = b.business_id
     WHERE b.id = $1 AND bus.tenant_id = $2`,
    [bookingId, tenantId],
  );
  if (bookingRows.length === 0) throw new Error('Booking not found');

  const bookingDate = new Date(bookingRows[0].start_time);
  const expiresAt = new Date(bookingDate);
  expiresAt.setHours(23, 59, 59, 999);

  const { rows } = await adminPool.query(
    `INSERT INTO check_in_qr_codes (tenant_id, booking_id, code, code_type, expires_at)
     VALUES ($1, $2, $3, 'booking', $4)
     RETURNING *`,
    [tenantId, bookingId, code, expiresAt.toISOString()],
  );

  return rows[0];
}

/**
 * Generate a persistent QR code for a customer (no expiry).
 */
export async function generateCustomerQrCode(tenantId: string, customerId: string) {
  const code = generateCode('DSCC');

  const { rows } = await adminPool.query(
    `INSERT INTO check_in_qr_codes (tenant_id, customer_id, code, code_type)
     VALUES ($1, $2, $3, 'customer')
     RETURNING *`,
    [tenantId, customerId, code],
  );

  return rows[0];
}

/**
 * Regenerate a customer QR code: deactivates the old one, creates a new one.
 */
export async function regenerateCustomerQrCode(tenantId: string, customerId: string) {
  // Deactivate existing codes
  await adminPool.query(
    `UPDATE check_in_qr_codes SET is_active = false
     WHERE tenant_id = $1 AND customer_id = $2 AND code_type = 'customer' AND is_active = true`,
    [tenantId, customerId],
  );

  const newCode = await generateCustomerQrCode(tenantId, customerId);

  await logAudit({
    tenantId,
    action: 'checkin.qr_regenerated',
    resourceType: 'customer',
    resourceId: customerId,
    details: { new_code_id: newCode.id },
  });

  return newCode;
}

/**
 * Validate a QR code: checks is_active, not expired, returns the record with type info.
 */
export async function validateQrCode(code: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM check_in_qr_codes
     WHERE code = $1 AND is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [code],
  );

  if (rows.length === 0) return null;
  return rows[0];
}

/**
 * Get existing active QR code for a booking, or generate one.
 */
export async function getBookingQrCode(tenantId: string, bookingId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM check_in_qr_codes
     WHERE tenant_id = $1 AND booking_id = $2 AND code_type = 'booking'
       AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [tenantId, bookingId],
  );

  if (rows.length > 0) return rows[0];
  return generateBookingQrCode(tenantId, bookingId);
}

/**
 * Get existing active QR code for a customer, or generate one.
 */
export async function getCustomerQrCode(tenantId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM check_in_qr_codes
     WHERE tenant_id = $1 AND customer_id = $2 AND code_type = 'customer'
       AND is_active = true
     LIMIT 1`,
    [tenantId, customerId],
  );

  if (rows.length > 0) return rows[0];
  return generateCustomerQrCode(tenantId, customerId);
}
