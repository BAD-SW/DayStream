import { adminPool } from '../db/pool';

interface CreateCompensationRuleInput {
  businessId: string;
  userId: string;
  ruleType: string;
  rate: number;
  thresholdAmount?: number;
  referenceType?: string | null;   // 'service' | 'product' | 'membership' | 'package' | null
  referenceIds?: string[] | null;  // specific item IDs, or null = all of that type
  overtimeMultiplier?: number;
  overtimeAfterHours?: number;
  holidayMultiplier?: number;
  effectiveFrom: string;
  effectiveTo?: string;
}

/**
 * Check if there's an overlapping active rule for the same user + type + reference_type
 * with intersecting reference_ids and overlapping date ranges.
 *
 * Overlap logic:
 * - Same user + rule_type + reference_type must have non-overlapping date ranges OR non-overlapping reference_ids.
 * - A rule with reference_ids = NULL means "all items" of that type, so it overlaps with any specific IDs.
 * - Two rules with specific IDs conflict only if their IDs intersect.
 */
async function checkOverlap(
  userId: string, businessId: string, ruleType: string,
  referenceType: string | null, referenceIds: string[] | null,
  effectiveFrom: string, effectiveTo: string | null,
  excludeId?: string,
): Promise<boolean> {
  const params: any[] = [userId, businessId, ruleType, effectiveFrom];
  let idx = 5;

  // Match reference_type (NULL = completely generic)
  let refTypeClause: string;
  if (referenceType) {
    refTypeClause = `AND reference_type = $${idx}`;
    params.push(referenceType);
    idx++;
  } else {
    refTypeClause = 'AND reference_type IS NULL';
  }

  // Date overlap: existing starts before new ends AND existing ends after new starts
  let effectiveToClause = '';
  if (effectiveTo) {
    effectiveToClause = `AND effective_from <= $${idx}`;
    params.push(effectiveTo);
    idx++;
  }

  const excludeClause = excludeId ? `AND id != $${idx}` : '';
  if (excludeId) { params.push(excludeId); idx++; }

  // First find all date-overlapping rules of same user+type+refType
  const { rows } = await adminPool.query(
    `SELECT id, reference_ids FROM fin_compensation_rules
     WHERE user_id = $1 AND business_id = $2 AND rule_type = $3 AND status = 'active'
       ${refTypeClause}
       AND (effective_to IS NULL OR effective_to >= $4)
       ${effectiveToClause}
       ${excludeClause}`,
    params,
  );

  if (rows.length === 0) return false;

  // Check reference_ids intersection
  for (const existing of rows) {
    const existingIds: string[] | null = existing.reference_ids;

    // Both NULL = both cover "all items" → conflict
    if (!existingIds && !referenceIds) return true;

    // One is NULL (all items) and other has specific IDs → this is the override pattern, NOT a conflict
    if (!existingIds || !referenceIds) continue;

    // Both have specific IDs → check intersection
    const intersection = existingIds.filter((id: string) => referenceIds.includes(id));
    if (intersection.length > 0) return true;
  }

  return false;
}

/**
 * Create a compensation rule for a staff member.
 */
export async function createRule(input: CreateCompensationRuleInput) {
  // Check for overlapping active rules
  const hasOverlap = await checkOverlap(
    input.userId, input.businessId, input.ruleType,
    input.referenceType || null, input.referenceIds || null,
    input.effectiveFrom, input.effectiveTo || null,
  );
  if (hasOverlap) {
    throw new Error('An active compensation rule of this type already exists for this offering with overlapping dates');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO fin_compensation_rules (business_id, user_id, rule_type, rate, threshold_amount, reference_type, reference_ids, overtime_multiplier, overtime_after_hours, holiday_multiplier, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.businessId, input.userId, input.ruleType, input.rate,
      input.thresholdAmount ?? null,
      input.referenceType || null,
      input.referenceIds && input.referenceIds.length > 0 ? input.referenceIds : null,
      input.overtimeMultiplier ?? 1.5,
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
  const userFilter = userId ? 'AND cr.user_id = $2' : '';
  const params = userId ? [businessId, userId] : [businessId];
  const { rows } = await adminPool.query(
    `SELECT cr.*, u.first_name, u.last_name
     FROM fin_compensation_rules cr
     JOIN usr_users u ON u.id = cr.user_id
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
    'SELECT * FROM fin_compensation_rules WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (existing.length === 0) return null;

  const rule = existing[0];

  const allowed: Record<string, string> = {
    rate: 'rate', threshold_amount: 'threshold_amount',
    reference_type: 'reference_type', reference_ids: 'reference_ids',
    overtime_multiplier: 'overtime_multiplier',
    overtime_after_hours: 'overtime_after_hours', holiday_multiplier: 'holiday_multiplier',
    effective_from: 'effective_from', effective_to: 'effective_to', status: 'status',
  };

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowed[key]) { fields.push(`${allowed[key]} = $${idx++}`); values.push(value); }
  }

  if (fields.length === 0) return rule;

  // Check for overlap if dates, references, or status are changing and final status is active
  const finalStatus = updates.status ?? rule.status;
  if (finalStatus === 'active') {
    const finalRefType = updates.reference_type !== undefined ? updates.reference_type : rule.reference_type;
    const finalRefIds = updates.reference_ids !== undefined ? updates.reference_ids : rule.reference_ids;
    const finalFrom = updates.effective_from ?? rule.effective_from;
    const finalTo = updates.effective_to !== undefined ? updates.effective_to : rule.effective_to;

    const hasOverlap = await checkOverlap(
      rule.user_id, businessId, rule.rule_type,
      finalRefType || null, finalRefIds || null,
      typeof finalFrom === 'string' ? finalFrom.split('T')[0] : String(finalFrom),
      finalTo ? (typeof finalTo === 'string' ? finalTo.split('T')[0] : String(finalTo)) : null,
      id, // exclude self
    );
    if (hasOverlap) {
      throw new Error('An active compensation rule of this type already exists for this offering with overlapping dates');
    }
  }

  values.push(id); values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE fin_compensation_rules SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}

/**
 * Delete a compensation rule.
 */
export async function deleteRule(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM fin_compensation_rules WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get effective compensation rules for a user at a given date.
 */
export async function getEffectiveRules(userId: string, businessId: string, asOfDate?: string) {
  const date = asOfDate || new Date().toISOString().slice(0, 10);
  const { rows } = await adminPool.query(
    `SELECT * FROM fin_compensation_rules
     WHERE user_id = $1 AND business_id = $2 AND status = 'active'
       AND effective_from <= $3
       AND (effective_to IS NULL OR effective_to >= $3)
     ORDER BY rule_type, reference_type NULLS LAST`,
    [userId, businessId, date],
  );
  return rows;
}
