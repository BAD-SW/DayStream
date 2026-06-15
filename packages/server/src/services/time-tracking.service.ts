import { adminPool } from '../db/pool';

interface CreateTimeEntryInput {
  businessId: string;
  userId: string;
  entryType: string;
  startTime: string;
  endTime?: string;
  hours?: number;
  description?: string;
  bookingId?: string;
}

/**
 * Create a manual or clock time entry.
 */
export async function createTimeEntry(input: CreateTimeEntryInput) {
  // Calculate hours if start and end provided
  let hours = input.hours;
  if (!hours && input.startTime && input.endTime) {
    const diff = new Date(input.endTime).getTime() - new Date(input.startTime).getTime();
    hours = Math.round((diff / (60 * 60 * 1000)) * 100) / 100; // 2 decimal places
  }

  const { rows } = await adminPool.query(
    `INSERT INTO time_entries (business_id, user_id, entry_type, start_time, end_time, hours, description, booking_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [input.businessId, input.userId, input.entryType, input.startTime, input.endTime || null, hours || null, input.description || null, input.bookingId || null],
  );
  return rows[0];
}

/**
 * List time entries for a business (filtered by user and/or date range).
 */
export async function getTimeEntries(businessId: string, filters?: { userId?: string; dateFrom?: string; dateTo?: string; approved?: boolean; payPeriodId?: string }) {
  const conditions = ['te.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;

  if (filters?.userId) { conditions.push(`te.user_id = $${idx++}`); params.push(filters.userId); }
  if (filters?.dateFrom) { conditions.push(`te.start_time >= $${idx++}`); params.push(filters.dateFrom); }
  if (filters?.dateTo) { conditions.push(`te.start_time <= $${idx++}`); params.push(filters.dateTo); }
  if (filters?.approved !== undefined) { conditions.push(`te.approved = $${idx++}`); params.push(filters.approved); }
  if (filters?.payPeriodId) { conditions.push(`te.pay_period_id = $${idx++}`); params.push(filters.payPeriodId); }

  const where = conditions.join(' AND ');
  const { rows } = await adminPool.query(
    `SELECT te.*, u.first_name, u.last_name FROM time_entries te
     JOIN users u ON u.id = te.user_id
     WHERE ${where} ORDER BY te.start_time DESC`,
    params,
  );
  return rows;
}

/**
 * Approve a time entry.
 */
export async function approveTimeEntry(id: string, businessId: string, approvedBy: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'UPDATE time_entries SET approved = true, approved_by = $3 WHERE id = $1 AND business_id = $2',
    [id, businessId, approvedBy],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Reject (delete) a time entry.
 */
export async function rejectTimeEntry(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM time_entries WHERE id = $1 AND business_id = $2 AND approved = false',
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Auto-generate time entries from completed bookings for a pay period.
 */
export async function generateFromBookings(businessId: string, periodStart: string, periodEnd: string): Promise<number> {
  // Find completed bookings that don't already have a time entry
  const { rows: bookings } = await adminPool.query(
    `SELECT b.id, b.staff_id, b.start_time, b.end_time
     FROM bookings b
     WHERE b.business_id = $1 AND b.status = 'completed'
       AND b.start_time >= $2 AND b.start_time <= $3
       AND b.staff_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.booking_id = b.id)`,
    [businessId, periodStart, periodEnd],
  );

  let created = 0;
  for (const booking of bookings) {
    const diff = new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime();
    const hours = Math.round((diff / (60 * 60 * 1000)) * 100) / 100;

    await adminPool.query(
      `INSERT INTO time_entries (business_id, user_id, entry_type, start_time, end_time, hours, booking_id, approved)
       VALUES ($1, $2, 'booking', $3, $4, $5, $6, true)`,
      [businessId, booking.staff_id, booking.start_time, booking.end_time, hours, booking.id],
    );
    created++;
  }

  return created;
}

/**
 * Get summary of hours and sessions for a user in a date range.
 */
export async function getUserSummary(userId: string, businessId: string, periodStart: string, periodEnd: string) {
  const { rows: hourRows } = await adminPool.query(
    `SELECT COALESCE(SUM(hours), 0)::numeric AS total_hours FROM time_entries
     WHERE user_id = $1 AND business_id = $2 AND start_time >= $3 AND start_time <= $4 AND approved = true`,
    [userId, businessId, periodStart, periodEnd],
  );

  const { rows: sessionRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS total_sessions FROM time_entries
     WHERE user_id = $1 AND business_id = $2 AND entry_type = 'booking' AND start_time >= $3 AND start_time <= $4`,
    [userId, businessId, periodStart, periodEnd],
  );

  const { rows: revenueRows } = await adminPool.query(
    `SELECT COALESCE(SUM(b.price), 0)::int AS total_revenue FROM bookings b
     WHERE b.staff_id = $1 AND b.business_id = $2 AND b.status = 'completed'
       AND b.start_time >= $3 AND b.start_time <= $4`,
    [userId, businessId, periodStart, periodEnd],
  );

  return {
    total_hours: parseFloat(hourRows[0].total_hours) || 0,
    total_sessions: sessionRows[0].total_sessions,
    total_revenue: revenueRows[0].total_revenue,
  };
}
