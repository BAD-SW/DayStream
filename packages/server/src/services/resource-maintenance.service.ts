import { adminPool } from '../db/pool';

/**
 * List maintenance schedules for a resource.
 */
export async function getMaintenanceSchedules(resourceId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM resource_maintenance WHERE resource_id = $1 ORDER BY maintenance_type, day_of_week, specific_date`,
    [resourceId]);
  return rows;
}

/**
 * Create a maintenance window.
 */
export async function createMaintenance(resourceId: string, input: {
  maintenanceType: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  specificDate?: string;
  description?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO resource_maintenance (resource_id, maintenance_type, day_of_week, start_time, end_time, specific_date, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [resourceId, input.maintenanceType, input.dayOfWeek ?? null, input.startTime || null,
     input.endTime || null, input.specificDate || null, input.description || null]);
  return rows[0];
}

/**
 * Delete a maintenance window.
 */
export async function deleteMaintenance(id: string, resourceId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM resource_maintenance WHERE id = $1 AND resource_id = $2`, [id, resourceId]);
  return (rowCount ?? 0) > 0;
}
