import { adminPool } from '../db/pool';

interface DashboardFilters {
  staffId?: string;
  serviceId?: string;
}

/**
 * Get today's real-time dashboard: bookings categorized by status.
 * Returns: upcoming, awaiting (in check-in window), checked_in, in_progress, completed, no_show.
 */
export async function getDashboard(
  tenantId: string,
  locationId?: string,
  filters: DashboardFilters = {},
) {
  const conditions = ['bus.tenant_id = $1', "b.start_time::date = CURRENT_DATE"];
  const params: any[] = [tenantId];
  let idx = 2;

  if (locationId) {
    conditions.push(`cr.location_id = $${idx++}`);
    params.push(locationId);
  }
  if (filters.staffId) {
    conditions.push(`b.staff_id = $${idx++}`);
    params.push(filters.staffId);
  }
  if (filters.serviceId) {
    conditions.push(`b.service_id = $${idx++}`);
    params.push(filters.serviceId);
  }

  const where = conditions.join(' AND ');

  const { rows } = await adminPool.query(
    `SELECT b.id, b.status, b.start_time, b.end_time, b.service_id, b.staff_id,
            b.customer_id, b.booking_reference,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            s.name AS service_name,
            u.first_name AS staff_first_name, u.last_name AS staff_last_name,
            cr.id AS checkin_id, cr.check_in_time, cr.status AS checkin_status
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     JOIN customers c ON c.id = b.customer_id
     JOIN services s ON s.id = b.service_id
     LEFT JOIN users u ON u.id = b.staff_id
     LEFT JOIN check_in_records cr ON cr.booking_id = b.id AND cr.status != 'cancelled'
     WHERE ${where}
     ORDER BY b.start_time ASC`,
    params,
  );

  const now = new Date();

  const dashboard = {
    upcoming: [] as any[],
    awaiting: [] as any[],
    checked_in: [] as any[],
    in_progress: [] as any[],
    completed: [] as any[],
    no_show: [] as any[],
  };

  for (const row of rows) {
    const entry = {
      id: row.id,
      booking_reference: row.booking_reference,
      start_time: row.start_time,
      end_time: row.end_time,
      customer_name: `${row.customer_first_name} ${row.customer_last_name}`,
      service_name: row.service_name,
      staff_name: row.staff_first_name ? `${row.staff_first_name} ${row.staff_last_name}` : null,
      checkin_time: row.check_in_time,
    };

    if (row.status === 'no_show') {
      dashboard.no_show.push(entry);
    } else if (row.status === 'completed') {
      dashboard.completed.push(entry);
    } else if (row.checkin_status === 'in_progress') {
      dashboard.in_progress.push(entry);
    } else if (row.checkin_status === 'checked_in') {
      dashboard.checked_in.push(entry);
    } else if (row.status === 'confirmed' && new Date(row.start_time) <= now) {
      dashboard.awaiting.push(entry);
    } else if (row.status === 'confirmed') {
      dashboard.upcoming.push(entry);
    }
  }

  return dashboard;
}

/**
 * Get next N upcoming bookings for today.
 */
export async function getUpcoming(tenantId: string, limit = 10) {
  const { rows } = await adminPool.query(
    `SELECT b.id, b.start_time, b.end_time, b.booking_reference,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            s.name AS service_name,
            u.first_name AS staff_first_name, u.last_name AS staff_last_name
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     JOIN customers c ON c.id = b.customer_id
     JOIN services s ON s.id = b.service_id
     LEFT JOIN users u ON u.id = b.staff_id
     WHERE bus.tenant_id = $1
       AND b.status = 'confirmed'
       AND b.start_time::date = CURRENT_DATE
       AND b.start_time > NOW()
     ORDER BY b.start_time ASC
     LIMIT $2`,
    [tenantId, limit],
  );

  return rows.map(row => ({
    id: row.id,
    booking_reference: row.booking_reference,
    start_time: row.start_time,
    end_time: row.end_time,
    customer_name: `${row.customer_first_name} ${row.customer_last_name}`,
    service_name: row.service_name,
    staff_name: row.staff_first_name ? `${row.staff_first_name} ${row.staff_last_name}` : null,
  }));
}
