import { adminPool } from '../db/pool';
import { isResourceAvailable } from './resource-availability.service';

/**
 * List bookings for a resource within a date range.
 */
export async function getResourceBookings(resourceId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT rb.*, b.service_id, s.name AS service_name,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name
     FROM res_bookings rb
     LEFT JOIN apt_bookings b ON b.id = rb.booking_id
     LEFT JOIN svc_services s ON s.id = b.service_id
     LEFT JOIN cus_customers c ON c.id = b.customer_id
     WHERE rb.resource_id = $1
       AND rb.start_time::date >= $2::date AND rb.start_time::date <= $3::date
       AND rb.status = 'confirmed'
     ORDER BY rb.start_time`,
    [resourceId, startDate, endDate]);
  return rows;
}

/**
 * Create a resource booking with conflict checking (uses FOR UPDATE NOWAIT).
 */
export async function createResourceBooking(input: {
  resourceId: string;
  bookingId?: string;
  startTime: string;
  endTime: string;
  bookingType: string;
  notes?: string;
}) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // Lock overlapping bookings to prevent race conditions
    try {
      await client.query(
        `SELECT id FROM res_bookings
         WHERE resource_id = $1 AND status = 'confirmed'
           AND start_time < $3::timestamptz AND end_time > $2::timestamptz
         FOR UPDATE NOWAIT`,
        [input.resourceId, input.startTime, input.endTime]);
    } catch (err: any) {
      if (err.code === '55P03') { // lock_not_available
        await client.query('ROLLBACK');
        throw new Error('Resource is being booked by another request, please retry');
      }
      throw err;
    }

    // Check availability (capacity check)
    const { rows: resRows } = await client.query(
      `SELECT capacity FROM res_resources WHERE id = $1`, [input.resourceId]);
    if (resRows.length === 0) { await client.query('ROLLBACK'); throw new Error('Resource not found'); }

    const { rows: overlap } = await client.query(
      `SELECT COUNT(*)::int AS count FROM res_bookings
       WHERE resource_id = $1 AND status = 'confirmed'
         AND start_time < $3::timestamptz AND end_time > $2::timestamptz`,
      [input.resourceId, input.startTime, input.endTime]);

    if (overlap[0].count >= resRows[0].capacity) {
      await client.query('ROLLBACK');
      throw new Error('Resource at capacity for this time slot');
    }

    // Insert booking
    const { rows } = await client.query(
      `INSERT INTO res_bookings (resource_id, booking_id, start_time, end_time, booking_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.resourceId, input.bookingId || null, input.startTime, input.endTime, input.bookingType, input.notes || null]);

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancel a resource booking.
 */
export async function cancelResourceBooking(id: string, resourceId: string) {
  const { rows } = await adminPool.query(
    `UPDATE res_bookings SET status = 'cancelled'
     WHERE id = $1 AND resource_id = $2 AND status = 'confirmed' RETURNING *`,
    [id, resourceId]);
  return rows[0] || null;
}

/**
 * Cancel all resource bookings linked to a service booking.
 */
export async function cancelResourceBookingsByBookingId(bookingId: string) {
  const { rowCount } = await adminPool.query(
    `UPDATE res_bookings SET status = 'cancelled'
     WHERE booking_id = $1 AND status = 'confirmed'`, [bookingId]);
  return rowCount ?? 0;
}

/**
 * Reserve resources for a service booking (with dependency resolution).
 */
export async function reserveResourcesForBooking(
  resources: Array<{ id: string }>, bookingId: string, startTime: string, endTime: string
) {
  const reserved: any[] = [];

  for (const resource of resources) {
    // Reserve primary resource
    const rb = await createResourceBooking({
      resourceId: resource.id, bookingId, startTime, endTime, bookingType: 'service',
    });
    reserved.push(rb);

    // Resolve and reserve dependencies
    const { rows: deps } = await adminPool.query(
      `SELECT * FROM res_dependencies WHERE resource_id = $1`, [resource.id]);

    for (const dep of deps) {
      const depStart = new Date(new Date(startTime).getTime() + dep.offset_minutes * 60000).toISOString();
      const depDuration = dep.duration_minutes
        ? dep.duration_minutes * 60000
        : (new Date(endTime).getTime() - new Date(startTime).getTime());
      const depEnd = new Date(new Date(depStart).getTime() + depDuration).toISOString();

      const depRb = await createResourceBooking({
        resourceId: dep.depends_on_id, bookingId, startTime: depStart, endTime: depEnd, bookingType: 'service',
        notes: `Dependency of resource ${resource.id}`,
      });
      reserved.push(depRb);
    }
  }

  return reserved;
}
