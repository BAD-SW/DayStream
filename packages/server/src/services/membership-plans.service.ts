import { adminPool } from '../db/pool';

interface CreatePlanInput {
  businessId: string;
  name: string;
  description?: string;
  planType: string;
  billingCycle: string;
  price: number;
  creditsPerCycle?: number;
  creditValidityDays?: number;
  rolloverPolicy?: string;
  maxRolloverCredits?: number;
  totalSessions?: number;
  expirationDays?: number;
  isIntroOnly?: boolean;
  maxFrequencyPerDay?: number;
  trialDays?: number;
  maxPauseDaysPerYear?: number;
  maxPausesPerYear?: number;
  maxAdditionalMembers?: number;
  sharedCredits?: boolean;
  displayOrder?: number;
}

/**
 * Create a membership plan.
 */
export async function createPlan(input: CreatePlanInput) {
  // Validate type + billing consistency
  if (['punch_card', 'intro_package'].includes(input.planType) && input.billingCycle !== 'one_time') {
    throw new Error('Punch cards and intro packages must have one_time billing cycle');
  }
  if (['unlimited', 'credit', 'hybrid'].includes(input.planType) && input.billingCycle === 'one_time') {
    throw new Error('Recurring plan types require a recurring billing cycle');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO membership_plans (business_id, name, description, plan_type, billing_cycle, price,
       credits_per_cycle, credit_validity_days, rollover_policy, max_rollover_credits,
       total_sessions, expiration_days, is_intro_only, max_frequency_per_day,
       trial_days, max_pause_days_per_year, max_pauses_per_year,
       max_additional_members, shared_credits, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      input.businessId, input.name, input.description || null,
      input.planType, input.billingCycle, input.price,
      input.creditsPerCycle ?? null, input.creditValidityDays ?? null,
      input.rolloverPolicy || 'none', input.maxRolloverCredits ?? null,
      input.totalSessions ?? null, input.expirationDays ?? null,
      input.isIntroOnly ?? false, input.maxFrequencyPerDay ?? null,
      input.trialDays ?? 0, input.maxPauseDaysPerYear ?? 30, input.maxPausesPerYear ?? 2,
      input.maxAdditionalMembers ?? 0, input.sharedCredits ?? false,
      input.displayOrder ?? 0,
    ],
  );
  return rows[0];
}

/**
 * List membership plans for a business.
 */
export async function getPlans(businessId: string, includeArchived = false) {
  const statusFilter = includeArchived ? '' : "AND status = 'active'";
  const { rows } = await adminPool.query(
    `SELECT * FROM membership_plans WHERE business_id = $1 ${statusFilter} ORDER BY display_order, name`,
    [businessId],
  );
  return rows;
}

/**
 * Get a plan by ID with benefits and service access.
 */
export async function getPlanById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM membership_plans WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  if (rows.length === 0) return null;

  const plan = rows[0];

  const { rows: access } = await adminPool.query(
    `SELECT psa.*, s.name AS service_name, sc.name AS category_name
     FROM plan_service_access psa
     LEFT JOIN services s ON s.id = psa.service_id
     LEFT JOIN service_categories sc ON sc.id = psa.category_id
     WHERE psa.plan_id = $1`,
    [id],
  );

  const { rows: benefits } = await adminPool.query(
    'SELECT * FROM plan_benefits WHERE plan_id = $1',
    [id],
  );

  const { rows: upgradePaths } = await adminPool.query(
    `SELECT pup.*, mp.name AS to_plan_name
     FROM plan_upgrade_paths pup
     JOIN membership_plans mp ON mp.id = pup.to_plan_id
     WHERE pup.from_plan_id = $1`,
    [id],
  );

  return { ...plan, service_access: access, benefits, upgrade_paths: upgradePaths };
}

/**
 * Update a plan.
 */
export async function updatePlan(id: string, businessId: string, updates: Record<string, any>) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM membership_plans WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  if (existing.length === 0) return null;

  const allowedFields: Record<string, string> = {
    name: 'name', description: 'description', price: 'price',
    credits_per_cycle: 'credits_per_cycle', credit_validity_days: 'credit_validity_days',
    rollover_policy: 'rollover_policy', max_rollover_credits: 'max_rollover_credits',
    total_sessions: 'total_sessions', expiration_days: 'expiration_days',
    max_frequency_per_day: 'max_frequency_per_day', trial_days: 'trial_days',
    max_pause_days_per_year: 'max_pause_days_per_year', max_pauses_per_year: 'max_pauses_per_year',
    max_additional_members: 'max_additional_members', shared_credits: 'shared_credits',
    display_order: 'display_order',
  };

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields[key]) {
      fields.push(`${allowedFields[key]} = $${idx++}`);
      values.push(value);
    }
  }

  if (fields.length === 0) return existing[0];
  fields.push('updated_at = NOW()');
  values.push(id); values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE membership_plans SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}

/**
 * Archive a plan.
 */
export async function archivePlan(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE membership_plans SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

// --- Plan Service Access ---

export async function addServiceAccess(planId: string, data: { service_id?: string; category_id?: string; credit_cost?: number; access_type?: string; discount_percentage?: number }) {
  const { rows } = await adminPool.query(
    `INSERT INTO plan_service_access (plan_id, service_id, category_id, credit_cost, access_type, discount_percentage)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [planId, data.service_id || null, data.category_id || null, data.credit_cost ?? 1, data.access_type || 'included', data.discount_percentage ?? null],
  );
  return rows[0];
}

export async function getServiceAccess(planId: string) {
  const { rows } = await adminPool.query(
    `SELECT psa.*, s.name AS service_name, sc.name AS category_name
     FROM plan_service_access psa
     LEFT JOIN services s ON s.id = psa.service_id
     LEFT JOIN service_categories sc ON sc.id = psa.category_id
     WHERE psa.plan_id = $1`,
    [planId],
  );
  return rows;
}

export async function removeServiceAccess(accessId: string, planId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM plan_service_access WHERE id = $1 AND plan_id = $2',
    [accessId, planId],
  );
  return (rowCount ?? 0) > 0;
}

// --- Plan Benefits ---

export async function addBenefit(planId: string, data: { benefit_type: string; value?: number; description?: string; per_cycle?: boolean }) {
  const { rows } = await adminPool.query(
    `INSERT INTO plan_benefits (plan_id, benefit_type, value, description, per_cycle)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [planId, data.benefit_type, data.value ?? null, data.description || null, data.per_cycle ?? true],
  );
  return rows[0];
}

export async function getBenefits(planId: string) {
  const { rows } = await adminPool.query('SELECT * FROM plan_benefits WHERE plan_id = $1', [planId]);
  return rows;
}

export async function removeBenefit(benefitId: string, planId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM plan_benefits WHERE id = $1 AND plan_id = $2',
    [benefitId, planId],
  );
  return (rowCount ?? 0) > 0;
}
