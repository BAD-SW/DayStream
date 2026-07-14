import { adminPool } from '../db/pool';

interface CreateMerchandiseInput {
  businessId: string;
  categoryId?: string;
  name: string;
  description?: string;
  shortDescription?: string;
  sku?: string;
  price: number;
  imageUrl?: string;
  displayOrder?: number;
  taxCategoryId?: string;
  isTaxable?: boolean;
  createdBy: string;
}

interface MerchandiseFilters {
  businessId: string;
  categoryId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function createMerchandise(input: CreateMerchandiseInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO prd_merchandise (business_id, category_id, name, description, short_description, sku, price, image_url, display_order, tax_category_id, is_taxable, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.businessId,
      input.categoryId || null,
      input.name,
      input.description || null,
      input.shortDescription || null,
      input.sku || null,
      input.price,
      input.imageUrl || null,
      input.displayOrder ?? 0,
      input.taxCategoryId || null,
      input.isTaxable ?? false,
      input.createdBy,
    ],
  );
  return rows[0];
}

export async function getMerchandise(filters: MerchandiseFilters) {
  const conditions = ['m.business_id = $1'];
  const params: any[] = [filters.businessId];
  let idx = 2;

  if (filters.categoryId) {
    conditions.push(`m.category_id = $${idx++}`);
    params.push(filters.categoryId);
  }

  if (filters.status && filters.status !== 'all') {
    conditions.push(`m.status = $${idx++}`);
    params.push(filters.status);
  }

  if (filters.search) {
    conditions.push(`(m.name ILIKE $${idx} OR m.sku ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT m.*, c.name AS category_name
       FROM prd_merchandise m
       LEFT JOIN svc_categories c ON c.id = m.category_id
       WHERE ${where}
       ORDER BY m.display_order, m.name
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM prd_merchandise m WHERE ${where}`, params),
  ]);

  return {
    items: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

export async function getMerchandiseById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT m.*, c.name AS category_name
     FROM prd_merchandise m
     LEFT JOIN svc_categories c ON c.id = m.category_id
     WHERE m.id = $1 AND m.business_id = $2`,
    [id, businessId],
  );
  return rows[0] || null;
}

export async function updateMerchandise(id: string, businessId: string, updates: Record<string, any>) {
  const allowedFields = ['category_id', 'name', 'description', 'short_description', 'sku', 'price', 'status', 'image_url', 'display_order', 'tax_category_id', 'is_taxable'];
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getMerchandiseById(id, businessId);

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  await adminPool.query(
    `UPDATE prd_merchandise SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}`,
    values,
  );

  return getMerchandiseById(id, businessId);
}

export async function archiveMerchandise(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE prd_merchandise SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status != 'archived'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function restoreMerchandise(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE prd_merchandise SET status = 'active', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'archived'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}


export async function pauseMerchandise(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE prd_merchandise SET status = 'paused', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

export async function activateMerchandise(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE prd_merchandise SET status = 'active', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status IN ('paused', 'draft')",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

// --- Merchandise Variants ---

export async function getVariants(merchandiseId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM prd_merchandise_variants WHERE merchandise_id = $1 ORDER BY display_order, name',
    [merchandiseId],
  );
  return rows;
}

export async function createVariant(merchandiseId: string, data: { name: string; sku?: string; price: number; displayOrder?: number }) {
  const { rows } = await adminPool.query(
    `INSERT INTO prd_merchandise_variants (merchandise_id, name, sku, price, display_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [merchandiseId, data.name, data.sku || null, data.price, data.displayOrder ?? 0],
  );
  return rows[0];
}

export async function updateVariant(variantId: string, data: { name?: string; sku?: string; price?: number; status?: string; displayOrder?: number }) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.sku !== undefined) { fields.push(`sku = $${idx++}`); values.push(data.sku || null); }
  if (data.price !== undefined) { fields.push(`price = $${idx++}`); values.push(data.price); }
  if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
  if (data.displayOrder !== undefined) { fields.push(`display_order = $${idx++}`); values.push(data.displayOrder); }

  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  values.push(variantId);

  const { rows } = await adminPool.query(
    `UPDATE prd_merchandise_variants SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteVariant(variantId: string) {
  const { rowCount } = await adminPool.query('DELETE FROM prd_merchandise_variants WHERE id = $1', [variantId]);
  return (rowCount ?? 0) > 0;
}
