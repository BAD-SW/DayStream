import { adminPool } from '../db/pool';

interface CreateRuleInput {
  serviceId: string;
  ruleType: 'recurring' | 'seasonal' | 'block';
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  blockedDates?: string[];
  description?: string;
  locationIds?: string[];
  staffIds?: string[];
  variantIds?: string[];
}

/**
 * Create an availability rule for a service.
 */
export async function createRule(input: CreateRuleInput) {
  // Validate rule type fields
  if (input.ruleType === 'recurring') {
    if (!input.daysOfWeek || input.daysOfWeek.length === 0) {
      throw new Error('Recurring rules require days_of_week');
    }
    if (!input.startTime || !input.endTime) {
      throw new Error('Recurring rules require start_time and end_time');
    }
  }

  if (input.ruleType === 'seasonal') {
    if (!input.effectiveFrom || !input.effectiveTo) {
      throw new Error('Seasonal rules require effective_from and effective_to');
    }
  }

  if (input.ruleType === 'block') {
    if ((!input.blockedDates || input.blockedDates.length === 0) && !input.effectiveFrom) {
      throw new Error('Block rules require blocked_dates or an effective date range');
    }
  }

  const { rows } = await adminPool.query(
    `INSERT INTO svc_availability_rules (service_id, rule_type, days_of_week, start_time, end_time, effective_from, effective_to, blocked_dates, description, location_ids, staff_ids, variant_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.serviceId, input.ruleType,
      input.daysOfWeek || null,
      input.startTime || null, input.endTime || null,
      input.effectiveFrom || null, input.effectiveTo || null,
      input.blockedDates || null,
      input.description || null,
      input.locationIds || null,
      input.staffIds || null,
      input.variantIds || null,
    ],
  );

  return rows[0];
}

/**
 * List availability rules for a service.
 */
export async function getRules(serviceId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM svc_availability_rules WHERE service_id = $1 ORDER BY rule_type, created_at',
    [serviceId],
  );
  return rows;
}

/**
 * Delete an availability rule.
 */
export async function deleteRule(ruleId: string, serviceId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM svc_availability_rules WHERE id = $1 AND service_id = $2',
    [ruleId, serviceId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Update an availability rule.
 */
export async function updateRule(ruleId: string, serviceId: string, updates: Partial<CreateRuleInput>) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM svc_availability_rules WHERE id = $1 AND service_id = $2',
    [ruleId, serviceId],
  );
  if (existing.length === 0) return null;

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.ruleType !== undefined) { fields.push(`rule_type = $${idx++}`); values.push(updates.ruleType); }
  if (updates.daysOfWeek !== undefined) { fields.push(`days_of_week = $${idx++}`); values.push(updates.daysOfWeek); }
  if (updates.startTime !== undefined) { fields.push(`start_time = $${idx++}`); values.push(updates.startTime); }
  if (updates.endTime !== undefined) { fields.push(`end_time = $${idx++}`); values.push(updates.endTime); }
  if (updates.effectiveFrom !== undefined) { fields.push(`effective_from = $${idx++}`); values.push(updates.effectiveFrom || null); }
  if (updates.effectiveTo !== undefined) { fields.push(`effective_to = $${idx++}`); values.push(updates.effectiveTo || null); }
  if (updates.blockedDates !== undefined) { fields.push(`blocked_dates = $${idx++}`); values.push(updates.blockedDates || null); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description || null); }
  if (updates.locationIds !== undefined) { fields.push(`location_ids = $${idx++}`); values.push(updates.locationIds || null); }
  if (updates.staffIds !== undefined) { fields.push(`staff_ids = $${idx++}`); values.push(updates.staffIds || null); }
  if (updates.variantIds !== undefined) { fields.push(`variant_ids = $${idx++}`); values.push(updates.variantIds || null); }

  if (fields.length === 0) return existing[0];

  values.push(ruleId, serviceId);
  const { rows } = await adminPool.query(
    `UPDATE svc_availability_rules SET ${fields.join(', ')} WHERE id = $${idx++} AND service_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}
