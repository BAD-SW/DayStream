import { adminPool } from '../db/pool';

// --- Interfaces ---

interface CreatePlanInput {
  businessId: string;
  name: string;
  description?: string;
  shortDescription?: string;
  billingFrequency: string;
  price: number;
  trialDays?: number;
  discountServicesPct?: number;
  discountMerchandisePct?: number;
  displayOrder?: number;
}

interface PlanFilters {
  businessId: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface PlanItemInput {
  planId: string;
  itemType: 'service' | 'merchandise';
  serviceId?: string;
  merchandiseId?: string;
  variantId?: string;
  quantityPerPeriod: number;
}

interface EnrollInput {
  planId: string;
  businessId: string;
  customerId: string;
  startDate: string;
}

// --- Plan CRUD ---

export async function createPlan(input: CreatePlanInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO mbr_plans (business_id, name, description, short_description, billing_frequency, price, trial_days, discount_services_pct, discount_merchandise_pct, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.businessId, input.name, input.description || null, input.shortDescription || null,
      input.billingFrequency, input.price, input.trialDays ?? 0,
      input.discountServicesPct ?? 0, input.discountMerchandisePct ?? 0,
      input.displayOrder ?? 0,
    ],
  );
  return rows[0];
}

export async function getPlans(filters: PlanFilters) {
  const conditions = ['p.business_id = $1'];
  const params: any[] = [filters.businessId];
  let idx = 2;

  if (filters.status && filters.status !== 'all') {
    conditions.push(`p.status = $${idx++}`);
    params.push(filters.status);
  }

  if (filters.search) {
    conditions.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT p.*, (SELECT COUNT(*)::int FROM mbr_enrollments e WHERE e.plan_id = p.id AND e.status = 'active') AS active_enrollments
       FROM mbr_plans p
       WHERE ${where}
       ORDER BY p.display_order, p.name
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM mbr_plans p WHERE ${where}`, params),
  ]);

  return {
    plans: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

export async function getPlanById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT p.*, (SELECT COUNT(*)::int FROM mbr_enrollments e WHERE e.plan_id = p.id AND e.status = 'active') AS active_enrollments
     FROM mbr_plans p
     WHERE p.id = $1 AND p.business_id = $2`,
    [id, businessId],
  );
  return rows[0] || null;
}

export async function updatePlan(id: string, businessId: string, updates: Record<string, any>) {
  const allowedFields = ['name', 'description', 'short_description', 'billing_frequency', 'price', 'status', 'trial_days', 'discount_services_pct', 'discount_merchandise_pct', 'display_order', 'is_taxable', 'tax_category_id'];
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      let finalValue = value;
      if (key === 'tax_category_id' && value === '') finalValue = null;
      fields.push(`${key} = $${idx++}`);
      values.push(finalValue);
    }
  }

  if (fields.length === 0) return getPlanById(id, businessId);

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  await adminPool.query(
    `UPDATE mbr_plans SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}`,
    values,
  );

  return getPlanById(id, businessId);
}

export async function archivePlan(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE mbr_plans SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status != 'archived'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function activatePlan(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE mbr_plans SET status = 'active', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status IN ('draft', 'paused', 'archived')",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function pausePlan(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE mbr_plans SET status = 'paused', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

// --- Plan Items ---

export async function getPlanItems(planId: string) {
  const { rows } = await adminPool.query(
    `SELECT pi.*, 
            s.name AS service_name, 
            m.name AS merchandise_name
     FROM mbr_plan_items pi
     LEFT JOIN svc_services s ON s.id = pi.service_id
     LEFT JOIN prd_merchandise m ON m.id = pi.merchandise_id
     WHERE pi.plan_id = $1
     ORDER BY pi.created_at`,
    [planId],
  );
  return rows;
}

export async function addPlanItem(input: PlanItemInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO mbr_plan_items (plan_id, item_type, service_id, merchandise_id, variant_id, quantity_per_period)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.planId, input.itemType,
      input.serviceId || null, input.merchandiseId || null,
      input.variantId || null, input.quantityPerPeriod,
    ],
  );
  return rows[0];
}

export async function updatePlanItem(itemId: string, updates: { quantityPerPeriod?: number; variantId?: string | null }) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.quantityPerPeriod !== undefined) {
    fields.push(`quantity_per_period = $${idx++}`);
    values.push(updates.quantityPerPeriod);
  }
  if (updates.variantId !== undefined) {
    fields.push(`variant_id = $${idx++}`);
    values.push(updates.variantId || null);
  }

  if (fields.length === 0) return null;

  values.push(itemId);
  const { rows } = await adminPool.query(
    `UPDATE mbr_plan_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function removePlanItem(itemId: string) {
  const { rowCount } = await adminPool.query('DELETE FROM mbr_plan_items WHERE id = $1', [itemId]);
  return (rowCount ?? 0) > 0;
}

// --- Enrollments ---

function calculatePeriodEnd(startDate: string, frequency: string): string {
  const start = new Date(startDate);
  switch (frequency) {
    case 'weekly': start.setDate(start.getDate() + 7); break;
    case 'biweekly': start.setDate(start.getDate() + 14); break;
    case 'monthly': start.setMonth(start.getMonth() + 1); break;
    case 'quarterly': start.setMonth(start.getMonth() + 3); break;
    case 'annually': start.setFullYear(start.getFullYear() + 1); break;
    default: start.setMonth(start.getMonth() + 1);
  }
  return start.toISOString().split('T')[0];
}

export async function enrollCustomer(input: EnrollInput) {
  // Get plan to determine billing frequency
  const plan = await getPlanById(input.planId, input.businessId);
  if (!plan) throw new Error('Plan not found');

  const periodEnd = calculatePeriodEnd(input.startDate, plan.billing_frequency);
  const nextBillingDate = periodEnd;

  const { rows } = await adminPool.query(
    `INSERT INTO mbr_enrollments (plan_id, business_id, customer_id, status, start_date, current_period_start, current_period_end, next_billing_date)
     VALUES ($1, $2, $3, 'active', $4, $4, $5, $6)
     RETURNING *`,
    [input.planId, input.businessId, input.customerId, input.startDate, periodEnd, nextBillingDate],
  );

  const enrollment = rows[0];

  // Initialize usage records for this period
  const items = await getPlanItems(input.planId);
  for (const item of items) {
    await adminPool.query(
      `INSERT INTO mbr_usage (enrollment_id, plan_item_id, period_start, period_end, quantity_used, quantity_allowed)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [enrollment.id, item.id, input.startDate, periodEnd, item.quantity_per_period],
    );
  }

  return enrollment;
}

export async function getEnrollments(businessId: string, filters?: { customerId?: string; planId?: string; status?: string }) {
  const conditions = ['e.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;

  if (filters?.customerId) { conditions.push(`e.customer_id = $${idx++}`); params.push(filters.customerId); }
  if (filters?.planId) { conditions.push(`e.plan_id = $${idx++}`); params.push(filters.planId); }
  if (filters?.status) { conditions.push(`e.status = $${idx++}`); params.push(filters.status); }

  const where = conditions.join(' AND ');

  const { rows } = await adminPool.query(
    `SELECT e.*, p.name AS plan_name, p.billing_frequency, p.price AS plan_price,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email
     FROM mbr_enrollments e
     JOIN mbr_plans p ON p.id = e.plan_id
     JOIN cus_customers c ON c.id = e.customer_id
     WHERE ${where}
     ORDER BY e.created_at DESC`,
    params,
  );
  return rows;
}

export async function getEnrollmentById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT e.*, p.name AS plan_name, p.billing_frequency, p.price AS plan_price,
            c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.email AS customer_email
     FROM mbr_enrollments e
     JOIN mbr_plans p ON p.id = e.plan_id
     JOIN cus_customers c ON c.id = e.customer_id
     WHERE e.id = $1 AND e.business_id = $2`,
    [id, businessId],
  );
  return rows[0] || null;
}

export async function pauseEnrollment(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE mbr_enrollments SET status = 'paused', paused_at = NOW(), updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function resumeEnrollment(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE mbr_enrollments SET status = 'active', paused_at = NULL, updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'paused'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function cancelEnrollment(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE mbr_enrollments SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status IN ('active', 'paused')",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

// --- Usage ---

export async function getUsage(enrollmentId: string) {
  const { rows } = await adminPool.query(
    `SELECT u.*, pi.item_type, pi.service_id, pi.merchandise_id,
            s.name AS service_name, m.name AS merchandise_name
     FROM mbr_usage u
     JOIN mbr_plan_items pi ON pi.id = u.plan_item_id
     LEFT JOIN svc_services s ON s.id = pi.service_id
     LEFT JOIN prd_merchandise m ON m.id = pi.merchandise_id
     WHERE u.enrollment_id = $1
     ORDER BY u.period_start DESC, pi.item_type`,
    [enrollmentId],
  );
  return rows;
}

export async function recordUsage(enrollmentId: string, planItemId: string, quantity: number = 1) {
  // Get current period usage record
  const { rows } = await adminPool.query(
    `SELECT u.* FROM mbr_usage u
     JOIN mbr_enrollments e ON e.id = u.enrollment_id
     WHERE u.enrollment_id = $1 AND u.plan_item_id = $2
       AND u.period_start = e.current_period_start`,
    [enrollmentId, planItemId],
  );

  if (rows.length === 0) throw new Error('No usage record found for current period');

  const usage = rows[0];
  const newUsed = usage.quantity_used + quantity;

  if (newUsed > usage.quantity_allowed) {
    throw new Error(`Usage would exceed allowed quantity. Used: ${usage.quantity_used}, Allowed: ${usage.quantity_allowed}, Requested: ${quantity}`);
  }

  const { rows: updated } = await adminPool.query(
    'UPDATE mbr_usage SET quantity_used = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [newUsed, usage.id],
  );

  return updated[0];
}
