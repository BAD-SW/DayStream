import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { validateSession } from './checkin-validation.service';

interface WalkInInput {
  customerId: string;
  serviceId: string;
  locationId: string;
}

/**
 * Walk-in check-in: checks availability, creates an instant booking, validates, and creates a check-in record.
 */
export async function walkInCheckIn(tenantId: string, input: WalkInInput) {
  const { customerId, serviceId, locationId } = input;

  // Check walk-in is enabled
  const { rows: configRows } = await adminPool.query(
    `SELECT walk_in_enabled FROM apt_check_in_config WHERE tenant_id = $1`,
    [tenantId],
  );

  if (configRows.length > 0 && !configRows[0].walk_in_enabled) {
    throw new Error('Walk-in check-ins are disabled');
  }

  // Check service exists and get duration
  const { rows: serviceRows } = await adminPool.query(
    `SELECT s.id, s.name, sv.duration, sv.price, sv.id AS variant_id
     FROM svc_services s
     JOIN svc_variants sv ON sv.service_id = s.id AND sv.is_default = true
     WHERE s.id = $1 AND s.tenant_id = $2 AND s.is_active = true
     LIMIT 1`,
    [serviceId, tenantId],
  );

  if (serviceRows.length === 0) throw new Error('Service not found or inactive');

  const service = serviceRows[0];
  const now = new Date();
  const endTime = new Date(now.getTime() + service.duration * 60 * 1000);

  // Check customer doesn't already have an active check-in
  const { rows: activeCheckins } = await adminPool.query(
    `SELECT id FROM apt_check_in_records
     WHERE customer_id = $1 AND tenant_id = $2
       AND status IN ('checked_in', 'in_progress')
       AND check_in_time::date = CURRENT_DATE
     LIMIT 1`,
    [customerId, tenantId],
  );

  if (activeCheckins.length > 0) {
    throw new Error('Customer already has an active check-in today');
  }

  // Create instant booking
  const { rows: bookingRows } = await adminPool.query(
    `INSERT INTO apt_bookings
       (tenant_id, customer_id, service_id, variant_id, start_time, end_time, status, booking_type, price, notes)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'individual', $7, 'Walk-in')
     RETURNING *`,
    [tenantId, customerId, serviceId, service.variant_id, now.toISOString(), endTime.toISOString(), service.price],
  );

  const booking = bookingRows[0];

  // Validate session (should pass for a just-created confirmed booking)
  const validation = await validateSession(booking.id, customerId, tenantId);

  // Create check-in record
  const { rows: checkinRows } = await adminPool.query(
    `INSERT INTO apt_check_in_records
       (tenant_id, booking_id, customer_id, check_in_method, validated, validation_warnings, location_id)
     VALUES ($1, $2, $3, 'walk_in', $4, $5, $6)
     RETURNING *`,
    [
      tenantId,
      booking.id,
      customerId,
      validation.pass,
      JSON.stringify(validation.warnings),
      locationId,
    ],
  );

  const record = checkinRows[0];

  // Update booking status to checked_in
  if (validation.pass) {
    await adminPool.query(
      `UPDATE apt_bookings SET status = 'checked_in' WHERE id = $1`,
      [booking.id],
    );
  }

  await logAudit({
    tenantId,
    action: 'checkin.walk_in',
    resourceType: 'check_in_record',
    resourceId: record.id,
    details: { booking_id: booking.id, customer_id: customerId, service_id: serviceId, location_id: locationId },
  });

  return { record, booking, validation };
}
