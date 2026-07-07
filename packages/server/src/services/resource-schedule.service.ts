import { adminPool } from '../db/pool';

interface ScheduleSlotInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * Get schedules for a resource.
 */
export async function getSchedules(resourceId: string) {
  const { rows: schedules } = await adminPool.query(
    `SELECT * FROM res_schedules WHERE resource_id = $1 ORDER BY effective_from DESC`, [resourceId]);

  for (const s of schedules) {
    const { rows: slots } = await adminPool.query(
      `SELECT * FROM res_schedule_slots WHERE schedule_id = $1 ORDER BY day_of_week, start_time`, [s.id]);
    s.slots = slots;
  }
  return schedules;
}

/**
 * Create a schedule with slots.
 */
export async function createSchedule(resourceId: string, input: {
  name?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  slots: ScheduleSlotInput[];
}) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO res_schedules (resource_id, name, effective_from, effective_to)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [resourceId, input.name || 'Default', input.effectiveFrom, input.effectiveTo || null]);
    const schedule = rows[0];

    for (const slot of input.slots) {
      await client.query(
        `INSERT INTO res_schedule_slots (schedule_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4)`, [schedule.id, slot.dayOfWeek, slot.startTime, slot.endTime]);
    }
    await client.query('COMMIT');

    const { rows: slots } = await adminPool.query(
      `SELECT * FROM res_schedule_slots WHERE schedule_id = $1 ORDER BY day_of_week, start_time`, [schedule.id]);
    schedule.slots = slots;
    return schedule;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update a schedule (replaces slots).
 */
export async function updateSchedule(id: string, resourceId: string, updates: {
  name?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  slots?: ScheduleSlotInput[];
}) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
    if (updates.effectiveFrom !== undefined) { fields.push(`effective_from = $${idx++}`); values.push(updates.effectiveFrom); }
    if (updates.effectiveTo !== undefined) { fields.push(`effective_to = $${idx++}`); values.push(updates.effectiveTo); }

    if (fields.length > 0) {
      values.push(id, resourceId);
      await client.query(
        `UPDATE res_schedules SET ${fields.join(', ')} WHERE id = $${idx++} AND resource_id = $${idx}`, values);
    }

    if (updates.slots !== undefined) {
      await client.query(`DELETE FROM res_schedule_slots WHERE schedule_id = $1`, [id]);
      for (const slot of updates.slots) {
        await client.query(
          `INSERT INTO res_schedule_slots (schedule_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4)`, [id, slot.dayOfWeek, slot.startTime, slot.endTime]);
      }
    }
    await client.query('COMMIT');

    const { rows } = await adminPool.query(`SELECT * FROM res_schedules WHERE id = $1`, [id]);
    if (rows.length === 0) return null;
    const { rows: slots } = await adminPool.query(
      `SELECT * FROM res_schedule_slots WHERE schedule_id = $1 ORDER BY day_of_week, start_time`, [id]);
    rows[0].slots = slots;
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get schedule blocks (holidays/closures) for a resource.
 */
export async function getScheduleBlocks(resourceId: string, startDate?: string, endDate?: string) {
  let query = `SELECT * FROM res_schedule_blocks WHERE resource_id = $1`;
  const params: any[] = [resourceId];
  if (startDate) { query += ` AND block_date >= $2`; params.push(startDate); }
  if (endDate) { query += ` AND block_date <= $${params.length + 1}`; params.push(endDate); }
  query += ` ORDER BY block_date`;
  const { rows } = await adminPool.query(query, params);
  return rows;
}

/**
 * Add a schedule block.
 */
export async function addScheduleBlock(resourceId: string, input: {
  blockDate: string; startTime?: string; endTime?: string; reason?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO res_schedule_blocks (resource_id, block_date, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [resourceId, input.blockDate, input.startTime || null, input.endTime || null, input.reason || null]);
  return rows[0];
}

/**
 * Delete a schedule block.
 */
export async function deleteScheduleBlock(id: string, resourceId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM res_schedule_blocks WHERE id = $1 AND resource_id = $2`, [id, resourceId]);
  return (rowCount ?? 0) > 0;
}

/**
 * Resolve effective operating hours for a resource on a given date.
 */
export async function getEffectiveSchedule(resourceId: string, date: string): Promise<Array<{ start_time: string; end_time: string }>> {
  // Check if resource is 24/7
  const { rows: resRows } = await adminPool.query(`SELECT is_24_7 FROM res_resources WHERE id = $1`, [resourceId]);
  if (resRows.length === 0) return [];
  if (resRows[0].is_24_7) return [{ start_time: '00:00:00', end_time: '23:59:59' }];

  // Find active schedule
  const { rows: schedules } = await adminPool.query(
    `SELECT id FROM res_schedules
     WHERE resource_id = $1 AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
     ORDER BY effective_from DESC LIMIT 1`, [resourceId, date]);
  if (schedules.length === 0) return [];

  // Get slots for day of week
  const [year, month, day] = date.split('-').map(Number);
  const dayOfWeek = new Date(year, month - 1, day).getDay();

  const { rows: slots } = await adminPool.query(
    `SELECT start_time, end_time FROM res_schedule_slots
     WHERE schedule_id = $1 AND day_of_week = $2 ORDER BY start_time`, [schedules[0].id, dayOfWeek]);
  return slots;
}
