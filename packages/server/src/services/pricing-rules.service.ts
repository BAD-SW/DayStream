import { adminPool } from '../db/pool';

interface CreateRuleInput {
  businessId: string;
  name: string;
  description?: string;
  ruleType: string;
  discountType: string;
  discountValue: number;
  priority?: number;
  stackingMode?: string;
  appliesToAllServices?: boolean;
  serviceIds?: string[];
  categoryIds?: string[];
  variantIds?: string[];
  appliesToAllCustomers?: boolean;
  customerSegment?: string;
  membershipPlanIds?: string[];
  corporateAccountId?: string;
  minPurchaseAmount?: number;
  maxRedemptions?: number;
  firstTimeBookingLimit?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  timeFrom?: string;
  timeTo?: string;
  daysOfWeek?: number[];
}

/**
 * Create a pricing rule.
 */
export async function createRule(input: CreateRuleInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO pricing_rules (business_id, name, description, rule_type, discount_type, discount_value,
       priority, stacking_mode, applies_to_all_services, service_ids, category_ids, variant_ids,
       applies_to_all_customers, customer_segment, membership_plan_ids, corporate_account_id,
       min_purchase_amount, max_redemptions, first_time_booking_limit,
       effective_from, effective_to, time_from, time_to, days_of_week)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      input.businessId, input.name, input.description || null, input.ruleType,
      input.discountType, input.discountValue,
      input.priority ?? 100, input.stackingMode || 'stackable',
      input.appliesToAllServices ?? true, input.serviceIds || null, input.categoryIds || null, input.variantIds || null,
      input.appliesToAllCustomers ?? true, input.customerSegment || null, input.membershipPlanIds || null, input.corporateAccountId || null,
      input.minPurchaseAmount ?? null, input.maxRedemptions ?? null, input.firstTimeBookingLimit ?? null,
      input.effectiveFrom || null, input.effectiveTo || null, input.timeFrom || null, input.timeTo || null, input.daysOfWeek || null,
    ],
  );
  return rows[0];
}

/**
 * List pricing rules for a business.
 */
export async function getRules(businessId: string, ruleType?: string) {
  const typeFilter = ruleType ? `AND rule_type = '${ruleType}'` : '';
  const { rows } = await adminPool.query(
    `SELECT * FROM pricing_rules WHERE business_id = $1 ${typeFilter} ORDER BY priority, name`,
    [businessId],
  );
  return rows;
}

/**
 * Update a pricing rule.
 */
export async function updateRule(id: string, businessId: string, updates: Record<string, any>) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM pricing_rules WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  if (existing.length === 0) return null;

  const allowedFields: Record<string, string> = {
    name: 'name', description: 'description', discount_type: 'discount_type', discount_value: 'discount_value',
    priority: 'priority', stacking_mode: 'stacking_mode', status: 'status',
    applies_to_all_services: 'applies_to_all_services', service_ids: 'service_ids', category_ids: 'category_ids', variant_ids: 'variant_ids',
    applies_to_all_customers: 'applies_to_all_customers', customer_segment: 'customer_segment', membership_plan_ids: 'membership_plan_ids',
    min_purchase_amount: 'min_purchase_amount', max_redemptions: 'max_redemptions',
    effective_from: 'effective_from', effective_to: 'effective_to',
    time_from: 'time_from', time_to: 'time_to', days_of_week: 'days_of_week',
  };

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields[key]) { fields.push(`${allowedFields[key]} = $${idx++}`); values.push(value); }
  }

  if (fields.length === 0) return existing[0];
  fields.push('updated_at = NOW()');
  values.push(id); values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE pricing_rules SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}

/**
 * Delete a pricing rule.
 */
export async function deleteRule(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM pricing_rules WHERE id = $1 AND business_id = $2', [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}
