import { adminPool } from '../db/pool';
import { getResourceAvailabilityRange } from './resource-availability.service';

/**
 * Get calendar data for a single resource.
 */
export async function getResourceCalendar(resourceId: string, startDate: string, endDate: string) {
  // Bookings
  const { rows: bookings } = await adminPool.query(
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

  // Maintenance windows for the range
  const { rows: maintenance } = await adminPool.query(
    `SELECT * FROM res_maintenance WHERE resource_id = $1
     AND ((maintenance_type = 'one_time' AND specific_date BETWEEN $2::date AND $3::date)
       OR maintenance_type = 'recurring')`,
    [resourceId, startDate, endDate]);

  // Schedule blocks
  const { rows: blocks } = await adminPool.query(
    `SELECT * FROM res_schedule_blocks
     WHERE resource_id = $1 AND block_date BETWEEN $2::date AND $3::date`,
    [resourceId, startDate, endDate]);

  // Availability (operating hours)
  const availability = await getResourceAvailabilityRange(resourceId, startDate, endDate);

  return {
    bookings: bookings.map((b) => ({
      id: b.id,
      startTime: b.start_time,
      endTime: b.end_time,
      type: b.booking_type,
      serviceName: b.service_name,
      customerName: b.customer_first_name ? `${b.customer_first_name} ${b.customer_last_name}` : null,
      notes: b.notes,
    })),
    maintenance: maintenance.map((m) => ({
      id: m.id,
      type: m.maintenance_type,
      dayOfWeek: m.day_of_week,
      startTime: m.start_time,
      endTime: m.end_time,
      specificDate: m.specific_date,
      description: m.description,
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      date: b.block_date,
      startTime: b.start_time,
      endTime: b.end_time,
      reason: b.reason,
    })),
    availability,
  };
}

/**
 * Get timeline view (all resources for a date range).
 */
export async function getResourceTimeline(tenantId: string, startDate: string, endDate: string, filters?: {
  resourceTypeId?: string;
  locationId?: string;
}) {
  let query = `SELECT r.id, r.name, r.capacity, r.status, rt.name AS type_name, rt.category
               FROM res_resources r JOIN res_types rt ON rt.id = r.resource_type_id
               WHERE r.tenant_id = $1 AND r.status = 'active'`;
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters?.resourceTypeId) { query += ` AND r.resource_type_id = $${idx++}`; params.push(filters.resourceTypeId); }
  if (filters?.locationId) { query += ` AND r.location_id = $${idx++}`; params.push(filters.locationId); }
  query += ` ORDER BY r.display_order, r.name`;

  const { rows: resources } = await adminPool.query(query, params);

  const timeline = await Promise.all(resources.map(async (resource) => {
    const { rows: bookings } = await adminPool.query(
      `SELECT id, start_time, end_time, booking_type, notes FROM res_bookings
       WHERE resource_id = $1 AND status = 'confirmed'
         AND start_time::date >= $2::date AND start_time::date <= $3::date
       ORDER BY start_time`,
      [resource.id, startDate, endDate]);

    return {
      resource: {
        id: resource.id,
        name: resource.name,
        capacity: resource.capacity,
        typeName: resource.type_name,
        category: resource.category,
      },
      bookings: bookings.map((b) => ({
        id: b.id,
        startTime: b.start_time,
        endTime: b.end_time,
        type: b.booking_type,
        notes: b.notes,
      })),
    };
  }));

  return timeline;
}
