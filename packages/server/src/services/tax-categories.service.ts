import { adminPool } from '../db/pool';

interface CreateTaxCategoryInput {
  businessId: string;
  name: string;
  rate: number;       // basis points (2100 = 21.00%)
  isDefault?: boolean;
}

interface UpdateTaxCategoryInput {
  name?: string;
  rate?: number;
  isDefault?: boolean;
}

/**
 * Create a tax category.
 */
export async function createTaxCategory(input: CreateTaxCategoryInput) {
  if (input.isDefault) {
    await adminPool.query(
      'UPDATE svc_tax_categories SET is_default = false WHERE business_id = $1',
      [input.businessId],
    );
  }

  const { rows } = await adminPool.query(
    `INSERT INTO svc_tax_categories (business_id, name, rate, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.businessId, input.name, input.rate, input.isDefault ?? false],
  );

  return rows[0];
}

/**
 * List tax categories for a business.
 */
export async function getTaxCategories(businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM svc_tax_categories WHERE business_id = $1 ORDER BY is_default DESC, name',
    [businessId],
  );
  return rows;
}

/**
 * Update a tax category.
 */
export async function updateTaxCategory(id: string, businessId: string, updates: UpdateTaxCategoryInput) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM svc_tax_categories WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  if (existing.length === 0) return null;

  if (updates.isDefault) {
    await adminPool.query(
      'UPDATE svc_tax_categories SET is_default = false WHERE business_id = $1',
      [businessId],
    );
  }

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.rate !== undefined) { fields.push(`rate = $${idx++}`); values.push(updates.rate); }
  if (updates.isDefault !== undefined) { fields.push(`is_default = $${idx++}`); values.push(updates.isDefault); }

  if (fields.length === 0) return existing[0];

  values.push(id);
  values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE svc_tax_categories SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}
     RETURNING *`,
    values,
  );

  return rows[0];
}

/**
 * Delete a tax category (only if not in use by any services/products).
 */
export async function deleteTaxCategory(id: string, businessId: string): Promise<boolean> {
  // Check if in use
  const { rows: inUse } = await adminPool.query(
    `SELECT id FROM svc_services WHERE tax_category_id = $1 AND business_id = $2
     UNION ALL
     SELECT id FROM prd_merchandise WHERE tax_category_id = $1 AND business_id = $2
     UNION ALL
     SELECT id FROM mbr_plans WHERE tax_category_id = $1 AND business_id = $2
     UNION ALL
     SELECT id FROM pkg_packages WHERE tax_category_id = $1 AND business_id = $2
     LIMIT 1`,
    [id, businessId],
  );
  if (inUse.length > 0) {
    throw new Error('Cannot delete tax rate that is in use by services or products');
  }

  const { rowCount } = await adminPool.query(
    'DELETE FROM svc_tax_categories WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}
