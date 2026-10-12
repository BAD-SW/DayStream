import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createBooking } from './booking.service';
import { CheckInRefused, createCheckInRecord } from './checkin.service';
import { evaluateOnBooking } from './customer-lifecycle.service';

interface WalkInInput {
  businessId: string;
  customerId: string;
  serviceId: string;
  locationId?: string;
  variantId?: string;
  staffId?: string;
  userId: string;
}

/**
 * Walk-in: someone arrives without a booking. A booking starting now is created through the
 * normal booking rules (opening hours, provider and resource availability, capacity), only
 * the minimum notice is waived, and it is checked in at once.
 */
export async function walkInCheckIn(tenantId: string, input: WalkInInput) {
  const { rows: configRows } = await adminPool.query(
    `SELECT walk_in_enabled FROM apt_check_in_config WHERE tenant_id = $1`,
    [tenantId],
  );
  if (configRows.length > 0 && !configRows[0].walk_in_enabled) {
    throw new CheckInRefused('Walk-in check-ins are disabled');
  }

  const { rows: serviceRows } = await adminPool.query(
    `SELECT s.id, s.name, s.status
       FROM svc_services s JOIN sys_businesses bus ON bus.id = s.business_id
      WHERE s.id = $1 AND s.business_id = $2 AND bus.tenant_id = $3`,
    [input.serviceId, input.businessId, tenantId],
  );
  if (serviceRows.length === 0) throw new CheckInRefused('Service not found');

  const { rows: variantRows } = await adminPool.query(
    `SELECT id FROM svc_variants
      WHERE service_id = $1 AND status = 'active' AND ($2::uuid IS NULL OR id = $2)
      ORDER BY display_order NULLS LAST, duration, created_at
      LIMIT 1`,
    [input.serviceId, input.variantId || null],
  );
  if (variantRows.length === 0) throw new CheckInRefused('This service has no active variant to book');

  const { rows: personRows } = await adminPool.query(
    'SELECT id FROM cus_customers WHERE id = $1 AND business_id = $2', [input.customerId, input.businessId],
  );
  if (personRows.length === 0) throw new CheckInRefused('Customer not found');

  let booking: any;
  try {
    booking = await createBooking({
      businessId: input.businessId,
      tenantId,
      customerId: input.customerId,
      serviceId: input.serviceId,
      variantId: variantRows[0].id,
      staffId: input.staffId || undefined,
      startTime: new Date().toISOString(),
      notes: 'Walk-in',
      createdBy: input.userId,
      skipLeadTime: true,
    });
  } catch (err: any) {
    if (err?.severity || /^(TypeError|ReferenceError|RangeError|SyntaxError)$/.test(err?.name || '')) throw err;
    throw new CheckInRefused(err.message);
  }

  const record = await createCheckInRecord({
    tenantId,
    bookingId: booking.id,
    customerId: input.customerId,
    method: 'walk_in',
    validated: true,
    validationWarnings: [],
    processedBy: input.userId,
    locationId: input.locationId,
  });

  const { rows: updated } = await adminPool.query(
    `UPDATE apt_bookings SET status = 'checked_in', checked_in_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [booking.id],
  );
  await adminPool.query(
    `INSERT INTO apt_booking_status_history (booking_id, from_status, to_status, changed_by) VALUES ($1, $2, 'checked_in', $3)`,
    [booking.id, booking.status, input.userId],
  ).catch(() => undefined);
  await evaluateOnBooking(input.customerId, input.businessId).catch(() => undefined);

  await logAudit({
    tenantId,
    userId: input.userId,
    action: 'checkin.walk_in',
    resourceType: 'check_in_record',
    resourceId: record.id,
    details: { booking_id: booking.id, service_id: input.serviceId, location_id: input.locationId || null },
  });

  return { booking: updated[0] || booking, record, validation: { pass: true, warnings: [], errors: [] } };
}
