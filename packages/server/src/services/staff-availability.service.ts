import { adminPool } from '../db/pool';

interface TimeBlock {
  start_time: string;
  end_time: string;
}

interface PatternSlotInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface CreatePatternInput {
  staffId: string;
  name: string;
  effectiveFrom: string;
  effectiveTo?: string;
  isDefault?: boolean;
  locationId?: string;
  slots: PatternSlotInput[];
}

// ============================================================
// Availability Patterns
// ============================================================

/**
 * List availability patterns for a staff member.
 */
export async function getPatterns(staffId: string) {
  const { rows: patterns } = await adminPool.query(
    `SELECT * FROM stf_availability_patterns WHERE staff_id = $1 ORDER BY effective_from DESC`,
    [staffId],
  );

  // Load slots for each pattern
  for (const pattern of patterns) {
    const { rows: slots } = await adminPool.query(
      `SELECT * FROM stf_availability_pattern_slots WHERE pattern_id = $1 ORDER BY day_of_week, start_time`,
      [pattern.id],
    );
    pattern.slots = slots;
  }

  return patterns;
}

/**
 * Create an availability pattern with slots.
 */
export async function createPattern(input: CreatePatternInput) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO stf_availability_patterns (staff_id, name, effective_from, effective_to, is_default, location_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.staffId,
        input.name,
        input.effectiveFrom,
        input.effectiveTo || null,
        input.isDefault ?? false,
        input.locationId || null,
      ],
    );

    const pattern = rows[0];

    // Insert slots
    for (const slot of input.slots) {
      await client.query(
        `INSERT INTO stf_availability_pattern_slots (pattern_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [pattern.id, slot.dayOfWeek, slot.startTime, slot.endTime],
      );
    }

    await client.query('COMMIT');

    // Load slots
    const { rows: slots } = await adminPool.query(
      `SELECT * FROM stf_availability_pattern_slots WHERE pattern_id = $1 ORDER BY day_of_week, start_time`,
      [pattern.id],
    );
    pattern.slots = slots;

    return pattern;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update an availability pattern (replaces slots).
 */
export async function updatePattern(id: string, staffId: string, updates: {
  name?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isDefault?: boolean;
  locationId?: string | null;
  slots?: PatternSlotInput[];
}) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // Update pattern fields
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
    if (updates.effectiveFrom !== undefined) { fields.push(`effective_from = $${idx++}`); values.push(updates.effectiveFrom); }
    if (updates.effectiveTo !== undefined) { fields.push(`effective_to = $${idx++}`); values.push(updates.effectiveTo); }
    if (updates.isDefault !== undefined) { fields.push(`is_default = $${idx++}`); values.push(updates.isDefault); }
    if (updates.locationId !== undefined) { fields.push(`location_id = $${idx++}`); values.push(updates.locationId); }

    if (fields.length > 0) {
      values.push(id);
      values.push(staffId);
      const { rowCount } = await client.query(
        `UPDATE stf_availability_patterns SET ${fields.join(', ')} WHERE id = $${idx++} AND staff_id = $${idx}`,
        values,
      );
      if ((rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }
    }

    // Replace slots if provided
    if (updates.slots !== undefined) {
      await client.query(`DELETE FROM stf_availability_pattern_slots WHERE pattern_id = $1`, [id]);
      for (const slot of updates.slots) {
        await client.query(
          `INSERT INTO stf_availability_pattern_slots (pattern_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4)`,
          [id, slot.dayOfWeek, slot.startTime, slot.endTime],
        );
      }
    }

    await client.query('COMMIT');

    // Return updated pattern with slots
    const { rows } = await adminPool.query(
      `SELECT * FROM stf_availability_patterns WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return null;

    const { rows: slots } = await adminPool.query(
      `SELECT * FROM stf_availability_pattern_slots WHERE pattern_id = $1 ORDER BY day_of_week, start_time`,
      [id],
    );
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
 * Delete an availability pattern.
 */
export async function deletePattern(id: string, staffId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM stf_availability_patterns WHERE id = $1 AND staff_id = $2`,
    [id, staffId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Duplicate a pattern.
 */
export async function copyPattern(id: string, staffId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM stf_availability_patterns WHERE id = $1 AND staff_id = $2`,
    [id, staffId],
  );
  if (rows.length === 0) return null;

  const original = rows[0];

  const { rows: slots } = await adminPool.query(
    `SELECT day_of_week, start_time, end_time FROM stf_availability_pattern_slots WHERE pattern_id = $1`,
    [id],
  );

  return createPattern({
    staffId,
    name: `${original.name} (copy)`,
    effectiveFrom: original.effective_from,
    effectiveTo: original.effective_to,
    isDefault: false,
    locationId: original.location_id,
    slots: slots.map((s) => ({
      dayOfWeek: s.day_of_week,
      startTime: s.start_time,
      endTime: s.end_time,
    })),
  });
}

// ============================================================
// Availability Overrides
// ============================================================

/**
 * List overrides for a staff member within a date range.
 */
export async function getOverrides(staffId: string, startDate: string, endDate: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM stf_availability_overrides
     WHERE staff_id = $1 AND override_date BETWEEN $2 AND $3
     ORDER BY override_date`,
    [staffId, startDate, endDate],
  );
  return rows;
}

/**
 * Create an availability override.
 */
export async function createOverride(staffId: string, input: {
  overrideDate: string;
  overrideType: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
  locationId?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO stf_availability_overrides (staff_id, override_date, override_type, start_time, end_time, reason, location_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      staffId,
      input.overrideDate,
      input.overrideType,
      input.startTime || null,
      input.endTime || null,
      input.reason || null,
      input.locationId || null,
    ],
  );
  return rows[0];
}

/**
 * Delete an override.
 */
export async function deleteOverride(id: string, staffId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM stf_availability_overrides WHERE id = $1 AND staff_id = $2`,
    [id, staffId],
  );
  return (rowCount ?? 0) > 0;
}

// ============================================================
// Effective Availability Resolver
// ============================================================

/**
 * Resolve effective availability for a staff member on a given date.
 * Returns time blocks for that day (or empty array if unavailable).
 */
export async function getEffectiveAvailability(staffId: string, date: string, locationId?: string): Promise<TimeBlock[]> {
  // 1. Check for approved leave on this date
  const { rows: leaveRows } = await adminPool.query(
    `SELECT id FROM stf_leave_requests
     WHERE staff_id = $1 AND status = 'approved'
       AND start_date <= $2::date AND end_date >= $2::date`,
    [staffId, date],
  );
  if (leaveRows.length > 0) return [];

  // 2. Check for overrides on this date
  const { rows: overrides } = await adminPool.query(
    `SELECT * FROM stf_availability_overrides
     WHERE staff_id = $1 AND override_date = $2::date
     ORDER BY start_time`,
    [staffId, date],
  );

  // If there's a 'remove' override, staff is unavailable
  const removeOverride = overrides.find((o) => o.override_type === 'remove');
  if (removeOverride) return [];

  // 3. Find active pattern for this date
  let patternQuery = `
    SELECT * FROM stf_availability_patterns
    WHERE staff_id = $1
      AND effective_from <= $2::date
      AND (effective_to IS NULL OR effective_to >= $2::date)
  `;
  const patternParams: any[] = [staffId, date];

  if (locationId) {
    // Prefer location-specific, fallback to general
    patternQuery += ` ORDER BY CASE WHEN location_id = $3 THEN 0 WHEN location_id IS NULL THEN 1 ELSE 2 END, effective_from DESC LIMIT 1`;
    patternParams.push(locationId);
  } else {
    patternQuery += ` ORDER BY CASE WHEN location_id IS NULL THEN 0 ELSE 1 END, effective_from DESC LIMIT 1`;
  }

  const { rows: patterns } = await adminPool.query(patternQuery, patternParams);
  if (patterns.length === 0) return [];

  const pattern = patterns[0];

  // 4. If there's a 'modify' override, use override times instead of pattern
  const modifyOverride = overrides.find((o) => o.override_type === 'modify');
  if (modifyOverride) {
    if (modifyOverride.start_time && modifyOverride.end_time) {
      return [{ start_time: modifyOverride.start_time, end_time: modifyOverride.end_time }];
    }
    return [];
  }

  // 5. Get base slots for the day of week
  // Parse date as local date parts to avoid timezone issues
  const [year, month, day] = date.split('-').map(Number);
  const dayOfWeek = new Date(year, month - 1, day).getDay(); // 0=Sunday
  const { rows: slots } = await adminPool.query(
    `SELECT start_time, end_time FROM stf_availability_pattern_slots
     WHERE pattern_id = $1 AND day_of_week = $2
     ORDER BY start_time`,
    [pattern.id, dayOfWeek],
  );

  const timeBlocks: TimeBlock[] = slots.map((s) => ({
    start_time: s.start_time,
    end_time: s.end_time,
  }));

  // 6. Merge 'add' overrides (additional time blocks)
  const addOverrides = overrides.filter((o) => o.override_type === 'add');
  for (const addOv of addOverrides) {
    if (addOv.start_time && addOv.end_time) {
      timeBlocks.push({ start_time: addOv.start_time, end_time: addOv.end_time });
    }
  }

  // Sort by start time
  timeBlocks.sort((a, b) => a.start_time.localeCompare(b.start_time));

  return timeBlocks;
}

/**
 * Get effective availability for a staff member over a date range.
 */
export async function getEffectiveAvailabilityRange(staffId: string, startDate: string, endDate: string, locationId?: string) {
  const result: Record<string, TimeBlock[]> = {};
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    result[dateStr] = await getEffectiveAvailability(staffId, dateStr, locationId);
  }

  return result;
}
