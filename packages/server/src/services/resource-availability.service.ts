import { adminPool } from '../db/pool';
import { getEffectiveSchedule } from './resource-schedule.service';

interface AvailabilityResult {
  available: boolean;
  reason?: string;
  remainingCapacity?: number;
}

/**
 * Check if a resource is available for a given time range.
 */
export async function isResourceAvailable(
  resourceId: string, startTime: string, endTime: string
): Promise<AvailabilityResult> {
  // 1. Check resource status
  const { rows: resRows } = await adminPool.query(
    `SELECT status, capacity, buffer_minutes, is_24_7 FROM resources WHERE id = $1`, [resourceId]);
  if (resRows.length === 0) return { available: false, reason: 'Resource not found' };
  const resource = resRows[0];
  if (resource.status !== 'active') return { available: false, reason: `Resource is ${resource.status}` };

  // 2. Check operating hours (unless 24/7)
  if (!resource.is_24_7) {
    const date = startTime.split('T')[0];
    const slots = await getEffectiveSchedule(resourceId, date);
    if (slots.length === 0) return { available: false, reason: 'Outside operating hours' };

    const reqStart = startTime.includes('T') ? startTime.split('T')[1].slice(0, 8) : startTime;
    const reqEnd = endTime.includes('T') ? endTime.split('T')[1].slice(0, 8) : endTime;

    const withinHours = slots.some((s) => reqStart >= s.start_time && reqEnd <= s.end_time);
    if (!withinHours) return { available: false, reason: 'Outside operating hours' };
  }

  // 3. Check date blocks
  const date = startTime.split('T')[0];
  const { rows: blocks } = await adminPool.query(
    `SELECT * FROM resource_schedule_blocks WHERE resource_id = $1 AND block_date = $2::date`, [resourceId, date]);
  for (const block of blocks) {
    if (!block.start_time) return { available: false, reason: `Blocked: ${block.reason || 'closure'}` };
    const reqStart = startTime.includes('T') ? startTime.split('T')[1].slice(0, 8) : '00:00:00';
    const reqEnd = endTime.includes('T') ? endTime.split('T')[1].slice(0, 8) : '23:59:59';
    if (reqStart < block.end_time && reqEnd > block.start_time) {
      return { available: false, reason: `Blocked: ${block.reason || 'closure'}` };
    }
  }

  // 4. Check maintenance windows
  const [year, month, day] = date.split('-').map(Number);
  const dayOfWeek = new Date(year, month - 1, day).getDay();
  const { rows: maint } = await adminPool.query(
    `SELECT * FROM resource_maintenance WHERE resource_id = $1
     AND ((maintenance_type = 'recurring' AND day_of_week = $2)
       OR (maintenance_type = 'one_time' AND specific_date = $3::date))`,
    [resourceId, dayOfWeek, date]);

  for (const m of maint) {
    if (m.start_time && m.end_time) {
      const reqStart = startTime.includes('T') ? startTime.split('T')[1].slice(0, 8) : '00:00:00';
      const reqEnd = endTime.includes('T') ? endTime.split('T')[1].slice(0, 8) : '23:59:59';
      if (reqStart < m.end_time && reqEnd > m.start_time) {
        return { available: false, reason: `Maintenance: ${m.description || 'scheduled'}` };
      }
    }
  }

  // 5. Check capacity (count overlapping confirmed bookings)
  const { rows: overlapCount } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM resource_bookings
     WHERE resource_id = $1 AND status = 'confirmed'
       AND start_time < $3::timestamptz AND end_time > $2::timestamptz`,
    [resourceId, startTime, endTime]);
  const currentBookings = overlapCount[0].count;
  if (currentBookings >= resource.capacity) {
    return { available: false, reason: 'At capacity', remainingCapacity: 0 };
  }

  // 6. Check buffer time
  if (resource.buffer_minutes > 0) {
    const bufferMs = resource.buffer_minutes * 60 * 1000;
    const bufferStart = new Date(new Date(startTime).getTime() - bufferMs).toISOString();
    const bufferEnd = new Date(new Date(endTime).getTime() + bufferMs).toISOString();

    const { rows: bufferConflicts } = await adminPool.query(
      `SELECT id FROM resource_bookings
       WHERE resource_id = $1 AND status = 'confirmed'
         AND start_time < $3::timestamptz AND end_time > $2::timestamptz
       LIMIT 1`,
      [resourceId, bufferStart, bufferEnd]);

    // Only flag as buffer conflict if there are bookings within buffer zone but NOT within the actual slot
    if (bufferConflicts.length > 0 && currentBookings === 0) {
      return { available: false, reason: 'Buffer time conflict' };
    }
  }

  return { available: true, remainingCapacity: resource.capacity - currentBookings };
}

/**
 * Find an available resource for a service booking.
 */
export async function findAvailableResource(
  serviceId: string, variantId: string | null, startTime: string, endTime: string, locationId?: string
): Promise<{ resources: Array<{ id: string; name: string }>; error?: string }> {
  // Get service resource requirements
  let reqQuery = `SELECT * FROM service_resource_requirements WHERE service_id = $1`;
  const reqParams: any[] = [serviceId];
  if (variantId) {
    reqQuery += ` AND (variant_id = $2 OR variant_id IS NULL)`;
    reqParams.push(variantId);
  } else {
    reqQuery += ` AND variant_id IS NULL`;
  }
  const { rows: requirements } = await adminPool.query(reqQuery, reqParams);

  if (requirements.length === 0) return { resources: [] }; // No resource requirements

  const selectedResources: Array<{ id: string; name: string }> = [];

  for (const req of requirements) {
    if (req.resource_id) {
      // Specific resource required
      const result = await isResourceAvailable(req.resource_id, startTime, endTime);
      if (!result.available && req.requirement_type === 'required') {
        return { resources: [], error: `Required resource unavailable: ${result.reason}` };
      }
      if (result.available) {
        const { rows } = await adminPool.query(`SELECT id, name FROM resources WHERE id = $1`, [req.resource_id]);
        if (rows.length > 0) selectedResources.push(rows[0]);
      }
    } else if (req.resource_type_id) {
      // "Any of type" — find first available
      let query = `SELECT id, name FROM resources WHERE resource_type_id = $1 AND status = 'active'`;
      const params: any[] = [req.resource_type_id];
      if (locationId) { query += ` AND location_id = $2`; params.push(locationId); }
      query += ` ORDER BY display_order, name`;
      const { rows: candidates } = await adminPool.query(query, params);

      let found = false;
      for (const candidate of candidates) {
        const result = await isResourceAvailable(candidate.id, startTime, endTime);
        if (result.available) {
          selectedResources.push(candidate);
          found = true;
          break;
        }
      }
      if (!found && req.requirement_type === 'required') {
        return { resources: [], error: 'No available resource of required type' };
      }
    }
  }

  return { resources: selectedResources };
}

/**
 * Get availability for a resource over a date range (returns available slots per day).
 */
export async function getResourceAvailabilityRange(resourceId: string, startDate: string, endDate: string) {
  const result: Record<string, Array<{ start_time: string; end_time: string }>> = {};
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const slots = await getEffectiveSchedule(resourceId, dateStr);
    result[dateStr] = slots;
  }
  return result;
}
