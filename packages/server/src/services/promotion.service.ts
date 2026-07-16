import { adminPool } from '../db/pool';

interface CreatePromotionInput {
  businessId: string;
  name: string;
  description?: string;
  type: string;
  value: number;
  promoCode?: string;
  dateFrom?: string;
  dateTo?: string;
  daysOfWeek?: number[];
  timeFrom?: string;
  timeTo?: string;
  appliesTo?: string;
  serviceIds?: string[];
  merchandiseIds?: string[];
  categoryIds?: string[];
  variantIds?: string[];
  locationIds?: string[];
  maxRedemptions?: number;
  maxPerCustomer?: number;
  priority?: number;
  stackable?: boolean;
}

interface PromotionFilters {
  businessId: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function createPromotion(input: CreatePromotionInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO prm_promotions (business_id, name, description, type, value, promo_code, date_from, date_to, days_of_week, time_from, time_to, applies_to, service_ids, merchandise_ids, category_ids, max_redemptions, max_per_customer, priority, stackable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING *`,
    [
      input.businessId, input.name, input.description || null,
      input.type, input.value, input.promoCode || null,
      input.dateFrom || null, input.dateTo || null,
      input.daysOfWeek && input.daysOfWeek.length > 0 ? input.daysOfWeek : null,
      input.timeFrom || null, input.timeTo || null,
      input.appliesTo || 'all',
      input.serviceIds && input.serviceIds.length > 0 ? input.serviceIds : null,
      input.merchandiseIds && input.merchandiseIds.length > 0 ? input.merchandiseIds : null,
      input.categoryIds && input.categoryIds.length > 0 ? input.categoryIds : null,
      input.maxRedemptions || null, input.maxPerCustomer || null,
      input.priority ?? 0, input.stackable ?? false,
    ],
  );
  return rows[0];
}

export async function getPromotions(filters: PromotionFilters) {
  const conditions = ['p.business_id = $1'];
  const params: any[] = [filters.businessId];
  let idx = 2;

  if (filters.status && filters.status !== 'all') {
    conditions.push(`p.status = $${idx++}`);
    params.push(filters.status);
  }

  if (filters.search) {
    conditions.push(`(p.name ILIKE $${idx} OR p.promo_code ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT p.* FROM prm_promotions p WHERE ${where} ORDER BY p.priority DESC, p.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM prm_promotions p WHERE ${where}`, params),
  ]);

  return {
    promotions: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

export async function getPromotionById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM prm_promotions WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  return rows[0] || null;
}

export async function updatePromotion(id: string, businessId: string, updates: Record<string, any>) {
  const allowedFields = ['name', 'description', 'status', 'type', 'value', 'promo_code', 'date_from', 'date_to', 'days_of_week', 'time_from', 'time_to', 'applies_to', 'service_ids', 'merchandise_ids', 'category_ids', 'variant_ids', 'location_ids', 'max_redemptions', 'max_per_customer', 'priority', 'stackable'];
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      let finalValue = value;
      if ((key === 'promo_code' || key === 'date_from' || key === 'date_to' || key === 'time_from' || key === 'time_to') && value === '') finalValue = null;
      if ((key === 'days_of_week' || key === 'service_ids' || key === 'merchandise_ids' || key === 'category_ids' || key === 'variant_ids' || key === 'location_ids') && Array.isArray(value) && value.length === 0) finalValue = null;
      fields.push(`${key} = $${idx++}`);
      values.push(finalValue);
    }
  }

  if (fields.length === 0) return getPromotionById(id, businessId);

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  await adminPool.query(
    `UPDATE prm_promotions SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}`,
    values,
  );

  return getPromotionById(id, businessId);
}

export async function archivePromotion(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE prm_promotions SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status != 'archived'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function activatePromotion(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE prm_promotions SET status = 'active', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status IN ('paused', 'expired', 'archived')",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function pausePromotion(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE prm_promotions SET status = 'paused', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}
