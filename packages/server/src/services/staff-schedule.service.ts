import { adminPool } from '../db/pool';

// --- Schedule Entries ---

export interface ScheduleEntry {
  id: string;
  business_id: string;
  staff_id: string;
  schedule_date: string;
  start_time: string;
  end_time: string;
  location_id: string | null;
  entry_type: string;
  notes: string | null;
  // Joined fields
  staff_first_name?: string;
  staff_last_name?: string;
}

/**
 * Get schedule entries for a business within a date range.
 */
export async function getScheduleEntries(businessId: string, dateFrom: string, dateTo: string, staffId?: string): Promise<ScheduleEntry[]> {
  let query = `
    SELECT e.*, sp.first_name AS staff_first_name, sp.last_name AS staff_last_name
    FROM stf_schedule_entries e
    JOIN stf_profiles sp ON sp.id = e.staff_id
    WHERE e.business_id = $1 AND e.schedule_date >= $2 AND e.schedule_date <= $3
  `;
  const params: any[] = [businessId, dateFrom, dateTo];

  if (staffId) {
    query += ' AND e.staff_id = $4';
    params.push(staffId);
  }

  query += ' ORDER BY e.schedule_date, e.start_time, sp.first_name';
  const { rows } = await adminPool.query(query, params);
  return rows;
}

/**
 * Create a schedule entry (ad hoc shift).
 */
export async function createScheduleEntry(input: {
  businessId: string;
  staffId: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  locationId?: string;
  entryType?: string;
  notes?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO stf_schedule_entries (business_id, staff_id, schedule_date, start_time, end_time, location_id, entry_type, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [input.businessId, input.staffId, input.scheduleDate, input.startTime, input.endTime, input.locationId || null, input.entryType || 'shift', input.notes || null],
  );
  return rows[0];
}

/**
 * Update a schedule entry.
 */
export async function updateScheduleEntry(entryId: string, businessId: string, updates: {
  scheduleDate?: string;
  startTime?: string;
  endTime?: string;
  locationId?: string | null;
  entryType?: string;
  notes?: string | null;
}) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.scheduleDate !== undefined) { fields.push(`schedule_date = $${idx++}`); values.push(updates.scheduleDate); }
  if (updates.startTime !== undefined) { fields.push(`start_time = $${idx++}`); values.push(updates.startTime); }
  if (updates.endTime !== undefined) { fields.push(`end_time = $${idx++}`); values.push(updates.endTime); }
  if (updates.locationId !== undefined) { fields.push(`location_id = $${idx++}`); values.push(updates.locationId); }
  if (updates.entryType !== undefined) { fields.push(`entry_type = $${idx++}`); values.push(updates.entryType); }
  if (updates.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(updates.notes); }

  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  values.push(entryId, businessId);

  const { rows } = await adminPool.query(
    `UPDATE stf_schedule_entries SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Delete a schedule entry.
 */
export async function deleteScheduleEntry(entryId: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM stf_schedule_entries WHERE id = $1 AND business_id = $2',
    [entryId, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get all staff for a business (for the schedule view).
 */
export async function getScheduleStaff(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT sp.id, sp.first_name, sp.last_name, sp.staff_ref
     FROM stf_profiles sp
     JOIN usr_users u ON u.id = sp.user_id
     WHERE u.business_id = $1 AND sp.status = 'active'
     ORDER BY sp.first_name, sp.last_name`,
    [businessId],
  );
  return rows;
}
