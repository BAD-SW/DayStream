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
    `INSERT INTO service_availability_rules (service_id, rule_type, days_of_week, start_time, end_time, effective_from, effective_to, blocked_dates, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.serviceId, input.ruleType,
      input.daysOfWeek || null,
      input.startTime || null, input.endTime || null,
      input.effectiveFrom || null, input.effectiveTo || null,
      input.blockedDates || null,
      input.description || null,
    ],
  );

  return rows[0];
}

/**
 * List availability rules for a service.
 */
export async function getRules(serviceId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM service_availability_rules WHERE service_id = $1 ORDER BY rule_type, created_at',
    [serviceId],
  );
  return rows;
}

/**
 * Delete an availability rule.
 */
export async function deleteRule(ruleId: string, serviceId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM service_availability_rules WHERE id = $1 AND service_id = $2',
    [ruleId, serviceId],
  );
  return (rowCount ?? 0) > 0;
}
