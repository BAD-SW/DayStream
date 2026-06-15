import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

interface CreateCategoryInput {
  businessId: string;
  name: string;
  description?: string;
  icon?: string;
  parentId?: string;
  displayOrder?: number;
}

interface UpdateCategoryInput {
  name?: string;
  description?: string;
  icon?: string;
  parentId?: string | null;
  displayOrder?: number;
  status?: string;
}

/**
 * Create a service category.
 */
export async function createCategory(input: CreateCategoryInput) {
  // Validate parent exists and belongs to same business (if provided)
  if (input.parentId) {
    const { rows: parentRows } = await adminPool.query(
      'SELECT id, parent_id FROM service_categories WHERE id = $1 AND business_id = $2',
      [input.parentId, input.businessId],
    );
    if (parentRows.length === 0) {
      throw new Error('Parent category not found');
    }
    // Max 2 levels: parent cannot itself have a parent
    if (parentRows[0].parent_id) {
      throw new Error('Maximum category depth is 2 levels');
    }
  }

  // Check for duplicate name within same business + parent
  const dupQuery = input.parentId
    ? 'SELECT id FROM service_categories WHERE business_id = $1 AND name = $2 AND parent_id = $3 AND status = \'active\''
    : 'SELECT id FROM service_categories WHERE business_id = $1 AND name = $2 AND parent_id IS NULL AND status = \'active\'';
  const dupParams = input.parentId
    ? [input.businessId, input.name, input.parentId]
    : [input.businessId, input.name];
  const { rows: dupRows } = await adminPool.query(dupQuery, dupParams);
  if (dupRows.length > 0) {
    throw new Error('A category with this name already exists');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO service_categories (business_id, parent_id, name, description, icon, display_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.businessId,
      input.parentId || null,
      input.name,
      input.description || null,
      input.icon || null,
      input.displayOrder ?? 0,
    ],
  );

  return rows[0];
}

/**
 * List categories for a business with service counts.
 */
export async function getCategories(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT sc.*,
       (SELECT COUNT(*)::int FROM services s WHERE s.category_id = sc.id AND s.status != 'archived') AS service_count
     FROM service_categories sc
     WHERE sc.business_id = $1 AND sc.status = 'active'
     ORDER BY sc.display_order, sc.name`,
    [businessId],
  );
  return rows;
}

/**
 * Get a single category by ID.
 */
export async function getCategoryById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM service_categories WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  return rows[0] || null;
}

/**
 * Update a category.
 */
export async function updateCategory(id: string, businessId: string, updates: UpdateCategoryInput) {
  const category = await getCategoryById(id, businessId);
  if (!category) return null;

  // Validate parent change
  if (updates.parentId !== undefined && updates.parentId !== null) {
    const { rows: parentRows } = await adminPool.query(
      'SELECT id, parent_id FROM service_categories WHERE id = $1 AND business_id = $2',
      [updates.parentId, businessId],
    );
    if (parentRows.length === 0) {
      throw new Error('Parent category not found');
    }
    if (parentRows[0].parent_id) {
      throw new Error('Maximum category depth is 2 levels');
    }
    // Cannot be its own parent
    if (updates.parentId === id) {
      throw new Error('Category cannot be its own parent');
    }
  }

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }
  if (updates.icon !== undefined) { fields.push(`icon = $${idx++}`); values.push(updates.icon); }
  if (updates.parentId !== undefined) { fields.push(`parent_id = $${idx++}`); values.push(updates.parentId); }
  if (updates.displayOrder !== undefined) { fields.push(`display_order = $${idx++}`); values.push(updates.displayOrder); }
  if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }

  if (fields.length === 0) return category;

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE service_categories SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}
     RETURNING *`,
    values,
  );

  return rows[0];
}

/**
 * Archive a category (soft delete).
 * Services in this category are NOT automatically moved.
 */
export async function archiveCategory(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE service_categories SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}
