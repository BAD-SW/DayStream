import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

interface CreateCompensationRuleInput {
  businessId: string;
  userId: string;
  ruleType: string;
  rate: number;
  thresholdAmount?: number;
  overtimeMultiplier?: number;
  overtimeAfterHours?: number;
  holidayMultiplier?: number;
  effectiveFrom: string;
  effectiveTo?: string;
}

/**
 * Create a compensation rule for a staff member.
 */
export async function createRule(input: CreateCompensationRuleInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO compensation_rules (business_id, user_id, rule_type, rate, threshold_amount, overtime_multiplier, overtime_after_hours, holiday_multiplier, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.businessId, input.userId, input.ruleType, input.rate,
      input.thresholdAmount ?? null, input.overtimeMultiplier ?? 1.5,
      input.overtimeAfterHours ?? 40, input.holidayMultiplier ?? 2.0,
      input.effectiveFrom, input.effectiveTo || null,
    ],
  );
  return rows[0];
}

/**
 * List compensation rules for a business (optionally filter by user).
 */
export async function getRules(businessId: string, userId?: string) {
  const userFilter = userId ? 'AND user_id = $2' : '';
  const params = userId ? [businessId, userId] : [businessId];
  const { rows } = await adminPool.query(
    `SELECT cr.*, u.first_name, u.last_name FROM compensation_rules cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.business_id = $1 ${userFilter}
     ORDER BY cr.user_id, cr.effective_from DESC`,
    params,
  );
  return rows;
}

/**
 * Update a compensation rule.
 */
export async function updateRule(id: string, businessId: string, updates: Record<string, any>) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM compensation_rules WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (existing.length === 0) return null;

  const allowed: Record<string, string> = {
    rate: 'rate', threshold_amount: 'threshold_amount', overtime_multiplier: 'overtime_multiplier',
    overtime_after_hours: 'overtime_after_hours', holiday_multiplier: 'holiday_multiplier',
    effective_from: 'effective_from', effective_to: 'effective_to', status: 'status',
  };

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowed[key]) { fields.push(`${allowed[key]} = $${idx++}`); values.push(value); }
  }

  if (fields.length === 0) return existing[0];
  values.push(id); values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE compensation_rules SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}

/**
 * Get effective compensation rules for a user at a given date.
 */
export async function getEffectiveRules(userId: string, businessId: string, asOfDate?: string) {
  const date = asOfDate || new Date().toISOString().slice(0, 10);
  const { rows } = await adminPool.query(
    `SELECT * FROM compensation_rules
     WHERE user_id = $1 AND business_id = $2 AND status = 'active'
       AND effective_from <= $3
       AND (effective_to IS NULL OR effective_to >= $3)
     ORDER BY rule_type`,
    [userId, businessId, date],
  );
  return rows;
}
