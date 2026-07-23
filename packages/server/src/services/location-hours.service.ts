import { adminPool } from '../db/pool';

export interface LocationHoursEntry {
  id?: string;
  location_id: string;
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

/**
 * Get all hours for a location (7 days).
 */
export async function getLocationHours(locationId: string): Promise<LocationHoursEntry[]> {
  const { rows } = await adminPool.query(
    'SELECT * FROM sys_location_hours WHERE location_id = $1 ORDER BY day_of_week',
    [locationId],
  );
  return rows;
}

/**
 * Set hours for a location. Accepts an array of 7 entries (one per day).
 * Uses upsert to create or update each day.
 */
export async function setLocationHours(locationId: string, hours: Array<{ day_of_week: number; is_closed: boolean; open_time?: string | null; close_time?: string | null }>) {
  for (const entry of hours) {
    await adminPool.query(
      `INSERT INTO sys_location_hours (location_id, day_of_week, is_closed, open_time, close_time, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (location_id, day_of_week) DO UPDATE SET
         is_closed = EXCLUDED.is_closed,
         open_time = EXCLUDED.open_time,
         close_time = EXCLUDED.close_time,
         updated_at = NOW()`,
      [locationId, entry.day_of_week, entry.is_closed, entry.is_closed ? null : (entry.open_time || null), entry.is_closed ? null : (entry.close_time || null)],
    );
  }
  return getLocationHours(locationId);
}


// --- Hour Overrides (Holidays / Special Hours) ---

export interface LocationHourOverride {
  id?: string;
  location_id: string;
  override_date: string;
  label: string | null;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
}

/**
 * Get hour overrides for a location, optionally filtered by year.
 */
export async function getLocationHourOverrides(locationId: string, year?: number): Promise<LocationHourOverride[]> {
  let query = 'SELECT * FROM sys_location_hour_overrides WHERE location_id = $1';
  const params: any[] = [locationId];

  if (year) {
    query += ' AND EXTRACT(YEAR FROM override_date) = $2';
    params.push(year);
  }

  query += ' ORDER BY override_date';
  const { rows } = await adminPool.query(query, params);
  return rows;
}

/**
 * Create or update an hour override.
 */
export async function upsertLocationHourOverride(locationId: string, override: {
  override_date: string;
  label?: string | null;
  is_closed: boolean;
  open_time?: string | null;
  close_time?: string | null;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO sys_location_hour_overrides (location_id, override_date, label, is_closed, open_time, close_time, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (location_id, override_date) DO UPDATE SET
       label = EXCLUDED.label,
       is_closed = EXCLUDED.is_closed,
       open_time = EXCLUDED.open_time,
       close_time = EXCLUDED.close_time,
       updated_at = NOW()
     RETURNING *`,
    [locationId, override.override_date, override.label || null, override.is_closed, override.is_closed ? null : (override.open_time || null), override.is_closed ? null : (override.close_time || null)],
  );
  return rows[0];
}

/**
 * Delete an hour override.
 */
export async function deleteLocationHourOverride(overrideId: string, locationId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM sys_location_hour_overrides WHERE id = $1 AND location_id = $2',
    [overrideId, locationId],
  );
  return (rowCount ?? 0) > 0;
}


/**
 * Get distinct years that have overrides for a location.
 */
export async function getLocationHourOverrideYears(locationId: string): Promise<number[]> {
  const { rows } = await adminPool.query(
    'SELECT DISTINCT EXTRACT(YEAR FROM override_date)::int AS year FROM sys_location_hour_overrides WHERE location_id = $1 ORDER BY year',
    [locationId],
  );
  return rows.map((r) => r.year);
}


// --- Location Staff Assignments ---

/**
 * Get staff assigned to a location.
 */
export async function getLocationStaff(locationId: string) {
  const { rows } = await adminPool.query(
    `SELECT ls.id, ls.staff_id, sp.first_name, sp.last_name, sp.staff_ref
     FROM sys_location_staff ls
     JOIN stf_profiles sp ON sp.id = ls.staff_id
     WHERE ls.location_id = $1
     ORDER BY sp.first_name, sp.last_name`,
    [locationId],
  );
  return rows;
}

/**
 * Assign a staff member to a location.
 */
export async function assignStaffToLocation(locationId: string, staffId: string) {
  const { rows } = await adminPool.query(
    `INSERT INTO sys_location_staff (location_id, staff_id)
     VALUES ($1, $2)
     ON CONFLICT (location_id, staff_id) DO NOTHING
     RETURNING *`,
    [locationId, staffId],
  );
  return rows[0];
}

/**
 * Remove a staff member from a location.
 */
export async function removeStaffFromLocation(locationId: string, staffId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM sys_location_staff WHERE location_id = $1 AND staff_id = $2',
    [locationId, staffId],
  );
  return (rowCount ?? 0) > 0;
}
