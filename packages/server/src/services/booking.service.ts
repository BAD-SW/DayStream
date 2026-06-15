import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { logger } from '../middleware/logger';

interface CreateBookingInput {
  businessId: string;
  customerId: string;
  serviceId: string;
  variantId: string;
  staffId?: string;
  resourceId?: string;
  startTime: string;     // ISO 8601
  notes?: string;
  createdBy: string;
  tenantId: string;
  overrideRules?: boolean;  // staff can override lead time etc.
}

interface BookingFilters {
  businessId: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  customerId?: string;
  staffId?: string;
  serviceId?: string;
  page?: number;
  limit?: number;
}

/**
 * Create a booking.
 */
export async function createBooking(input: CreateBookingInput) {
  // Load service + variant
  const { rows: svcRows } = await adminPool.query(
    `SELECT s.*, sv.duration, sv.price, sv.pricing_model
     FROM services s
     JOIN service_variants sv ON sv.service_id = s.id AND sv.id = $2
     WHERE s.id = $1 AND s.business_id = $3`,
    [input.serviceId, input.variantId, input.businessId],
  );

  if (svcRows.length === 0) throw new Error('Service or variant not found');

  const service = svcRows[0];
  const duration = service.duration;
  const price = service.price;
  const bookingType = service.booking_type;
  const bufferBefore = service.buffer_before || 0;
  const bufferAfter = service.buffer_after || 0;

  const startTime = new Date(input.startTime);
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

  // Enforce lead time (unless staff override)
  if (!input.overrideRules) {
    const minAdvanceMs = (service.min_advance_booking_hours || 2) * 60 * 60 * 1000;
    if (startTime.getTime() - Date.now() < minAdvanceMs) {
      throw new Error('Booking is within the minimum advance booking window');
    }
  }

  // Resolve staff (auto-assign if not provided for individual bookings)
  let staffId = input.staffId || null;
  if (!staffId && bookingType === 'individual') {
    staffId = await autoAssignStaff(input.serviceId, input.businessId, startTime, endTime, bufferBefore, bufferAfter);
    if (!staffId) throw new Error('No staff available for the selected time');
  }

  // Conflict detection (skip staff conflict for shared/group — staff facilitates multiple customers)
  if (staffId && bookingType === 'individual') {
    const staffConflict = await checkStaffConflict(staffId, startTime, endTime, bufferBefore, bufferAfter);
    if (staffConflict) throw new Error('Staff member has a conflicting booking at this time');
  }

  if (input.resourceId) {
    const resourceConflict = await checkResourceConflict(input.resourceId, startTime, endTime);
    if (resourceConflict) throw new Error('Resource has a conflicting booking at this time');
  }

  // For shared/group: check capacity
  if (bookingType === 'shared' || bookingType === 'group') {
    const capacity = service.max_capacity || 1;
    const { rows: countRows } = await adminPool.query(
      `SELECT COUNT(*)::int AS count FROM bookings
       WHERE service_id = $1 AND business_id = $2
         AND start_time = $3 AND status IN ('pending', 'confirmed', 'in_progress')`,
      [input.serviceId, input.businessId, startTime.toISOString()],
    );
    if (countRows[0].count >= capacity) {
      throw new Error('Session is at full capacity');
    }
  }

  // Customer conflict check
  const customerConflict = await checkCustomerConflict(input.customerId, startTime, endTime);
  if (customerConflict) throw new Error('Customer has a conflicting booking at this time');

  // Generate booking reference
  const { rows: refRows } = await adminPool.query(
    'SELECT generate_booking_reference($1) AS ref',
    [input.businessId],
  );
  const bookingReference = refRows[0].ref;

  // Determine initial status (auto-confirm if configured)
  const status = 'confirmed'; // For now, auto-confirm

  // Insert booking
  const { rows } = await adminPool.query(
    `INSERT INTO bookings (business_id, customer_id, service_id, variant_id, staff_id, resource_id,
       start_time, end_time, buffer_before, buffer_after, status, booking_reference, booking_type, price, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      input.businessId, input.customerId, input.serviceId, input.variantId,
      staffId, input.resourceId || null,
      startTime.toISOString(), endTime.toISOString(),
      bufferBefore, bufferAfter, status, bookingReference, bookingType, price,
      input.notes || null, input.createdBy,
    ],
  );

  const booking = rows[0];

  // Record status history
  await adminPool.query(
    `INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by)
     VALUES ($1, NULL, $2, $3)`,
    [booking.id, status, input.createdBy],
  );

  // Log in customer activity timeline
  await createActivity({
    customerId: input.customerId,
    businessId: input.businessId,
    activityType: 'booking',
    description: `Booked: ${service.name} (${bookingReference})`,
    metadata: { booking_id: booking.id, service_id: input.serviceId, start_time: startTime.toISOString() },
    createdBy: input.createdBy,
  });

  // Audit
  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'booking.created',
    resourceType: 'booking',
    resourceId: booking.id,
    details: { reference: bookingReference, service: service.name, customer_id: input.customerId },
  });

  // Remove any slot hold for this time
  await adminPool.query(
    `DELETE FROM slot_holds WHERE business_id = $1 AND service_id = $2 AND start_time = $3 AND held_by = $4`,
    [input.businessId, input.serviceId, startTime.toISOString(), input.createdBy],
  );

  logger.info('Booking created', { bookingId: booking.id, reference: bookingReference });

  return booking;
}

/**
 * List bookings with filters.
 */
export async function getBookings(filters: BookingFilters) {
  const conditions = ['b.business_id = $1'];
  const params: any[] = [filters.businessId];
  let paramIndex = 2;

  if (filters.status) {
    conditions.push(`b.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.customerId) {
    conditions.push(`b.customer_id = $${paramIndex++}`);
    params.push(filters.customerId);
  }

  if (filters.staffId) {
    conditions.push(`b.staff_id = $${paramIndex++}`);
    params.push(filters.staffId);
  }

  if (filters.serviceId) {
    conditions.push(`b.service_id = $${paramIndex++}`);
    params.push(filters.serviceId);
  }

  if (filters.dateFrom) {
    conditions.push(`b.start_time >= $${paramIndex++}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push(`b.start_time <= $${paramIndex++}`);
    params.push(filters.dateTo);
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT b.*, s.name AS service_name, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
              u.first_name AS staff_first_name, u.last_name AS staff_last_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN customers c ON c.id = b.customer_id
       LEFT JOIN users u ON u.id = b.staff_id
       WHERE ${where}
       ORDER BY b.start_time DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM bookings b WHERE ${where}`, params),
  ]);

  return {
    bookings: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

/**
 * Get a single booking by ID.
 */
export async function getBookingById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT b.*, s.name AS service_name, sv.name AS variant_name,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email,
            u.first_name AS staff_first_name, u.last_name AS staff_last_name
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN service_variants sv ON sv.id = b.variant_id
     JOIN customers c ON c.id = b.customer_id
     LEFT JOIN users u ON u.id = b.staff_id
     WHERE b.id = $1 AND b.business_id = $2`,
    [id, businessId],
  );

  if (rows.length === 0) return null;

  // Load status history
  const { rows: history } = await adminPool.query(
    'SELECT * FROM booking_status_history WHERE booking_id = $1 ORDER BY created_at',
    [id],
  );

  return { ...rows[0], status_history: history };
}

// --- Helpers ---

async function autoAssignStaff(
  serviceId: string, businessId: string, startTime: Date, endTime: Date, bufferBefore: number, bufferAfter: number,
): Promise<string | null> {
  // Get all assigned staff, pick the one with the fewest bookings on that day (round-robin-ish)
  const { rows: staff } = await adminPool.query(
    `SELECT ss.user_id FROM service_staff ss WHERE ss.service_id = $1`,
    [serviceId],
  );

  for (const s of staff) {
    const conflict = await checkStaffConflict(s.user_id, startTime, endTime, bufferBefore, bufferAfter);
    if (!conflict) return s.user_id;
  }

  return null;
}

async function checkStaffConflict(staffId: string, startTime: Date, endTime: Date, bufferBefore: number, bufferAfter: number): Promise<boolean> {
  const blockStart = new Date(startTime.getTime() - bufferBefore * 60 * 1000);
  const blockEnd = new Date(endTime.getTime() + bufferAfter * 60 * 1000);

  const { rows } = await adminPool.query(
    `SELECT id FROM bookings
     WHERE staff_id = $1
       AND start_time < $3
       AND end_time > $2
       AND status IN ('pending', 'confirmed', 'in_progress')
     LIMIT 1`,
    [staffId, blockStart.toISOString(), blockEnd.toISOString()],
  );

  if (rows.length > 0) return true;

  // Also check slot holds
  const { rows: holds } = await adminPool.query(
    `SELECT id FROM slot_holds
     WHERE staff_id = $1
       AND start_time < $3
       AND end_time > $2
       AND expires_at > NOW()
     LIMIT 1`,
    [staffId, blockStart.toISOString(), blockEnd.toISOString()],
  );

  return holds.length > 0;
}

async function checkResourceConflict(resourceId: string, startTime: Date, endTime: Date): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT id FROM bookings
     WHERE resource_id = $1
       AND start_time < $3
       AND end_time > $2
       AND status IN ('pending', 'confirmed', 'in_progress')
     LIMIT 1`,
    [resourceId, startTime.toISOString(), endTime.toISOString()],
  );
  return rows.length > 0;
}

async function checkCustomerConflict(customerId: string, startTime: Date, endTime: Date): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT id FROM bookings
     WHERE customer_id = $1
       AND start_time < $3
       AND end_time > $2
       AND status IN ('pending', 'confirmed', 'in_progress')
     LIMIT 1`,
    [customerId, startTime.toISOString(), endTime.toISOString()],
  );
  return rows.length > 0;
}
