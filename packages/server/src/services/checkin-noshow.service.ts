import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { getConfig } from './checkin-config.service';

/**
 * Detect no-shows: finds overdue bookings past grace period, marks as no_show, creates no_show_records.
 */
export async function detectNoShows(tenantId: string) {
  const config = await getConfig(tenantId);
  const gracePeriodMs = config.grace_period_minutes * 60 * 1000;
  const cutoff = new Date(Date.now() - gracePeriodMs);

  // Find confirmed bookings whose start_time + grace_period has passed with no check-in
  const { rows: overdueBookings } = await adminPool.query(
    `SELECT b.id, b.customer_id, b.start_time
     FROM apt_bookings b
     JOIN sys_businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'confirmed'
       AND b.start_time < $2
       AND NOT EXISTS (
         SELECT 1 FROM apt_check_in_records cr
         WHERE cr.booking_id = b.id AND cr.status != 'cancelled'
       )
       AND NOT EXISTS (
         SELECT 1 FROM apt_no_show_records ns
         WHERE ns.booking_id = b.id
       )`,
    [tenantId, cutoff.toISOString()],
  );

  const records = [];

  for (const booking of overdueBookings) {
    // Mark booking as no_show
    await adminPool.query(
      `UPDATE apt_bookings SET status = 'no_show' WHERE id = $1`,
      [booking.id],
    );

    // Create no_show_record
    const { rows } = await adminPool.query(
      `INSERT INTO apt_no_show_records (tenant_id, booking_id, customer_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [tenantId, booking.id, booking.customer_id],
    );

    records.push(rows[0]);
  }

  if (records.length > 0) {
    await logAudit({
      tenantId,
      action: 'checkin.noshow_detected',
      resourceType: 'no_show_records',
      details: { count: records.length, booking_ids: overdueBookings.map(b => b.id) },
    });
  }

  return records;
}

/**
 * List no-show records with optional filters.
 */
export async function getNoShows(
  tenantId: string,
  filters: { startDate?: string; endDate?: string; customerId?: string } = {},
) {
  const conditions = ['ns.tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters.customerId) {
    conditions.push(`ns.customer_id = $${idx++}`);
    params.push(filters.customerId);
  }
  if (filters.startDate) {
    conditions.push(`ns.detected_at >= $${idx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`ns.detected_at <= $${idx++}`);
    params.push(filters.endDate);
  }

  const { rows } = await adminPool.query(
    `SELECT ns.*, b.start_time AS booking_start_time, b.service_id,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name
     FROM apt_no_show_records ns
     JOIN apt_bookings b ON b.id = ns.booking_id
     JOIN cus_customers c ON c.id = ns.customer_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ns.detected_at DESC`,
    params,
  );

  return rows;
}

/**
 * Waive a no-show record with a reason.
 */
export async function waiveNoShow(id: string, tenantId: string, waivedBy: string, reason: string) {
  const { rows } = await adminPool.query(
    `UPDATE apt_no_show_records
     SET waived = true, waived_by = $1, waive_reason = $2
     WHERE id = $3 AND tenant_id = $4
     RETURNING *`,
    [waivedBy, reason, id, tenantId],
  );

  if (rows.length === 0) throw new Error('No-show record not found');

  await logAudit({
    tenantId,
    userId: waivedBy,
    action: 'checkin.noshow_waived',
    resourceType: 'no_show_record',
    resourceId: id,
    details: { reason },
  });

  return rows[0];
}

/**
 * Get the count of non-waived no-shows for a customer (used for threshold checks).
 */
export async function getCustomerNoShowCount(customerId: string, tenantId: string): Promise<number> {
  const { rows } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM apt_no_show_records
     WHERE customer_id = $1 AND tenant_id = $2 AND waived = false`,
    [customerId, tenantId],
  );
  return rows[0].count;
}

/**
 * Get detailed no-show history for a customer.
 */
export async function getCustomerNoShowHistory(customerId: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT ns.*, b.start_time AS booking_start_time, s.name AS service_name
     FROM apt_no_show_records ns
     JOIN apt_bookings b ON b.id = ns.booking_id
     LEFT JOIN svc_services s ON s.id = b.service_id
     WHERE ns.customer_id = $1 AND ns.tenant_id = $2
     ORDER BY ns.detected_at DESC`,
    [customerId, tenantId],
  );
  return rows;
}
