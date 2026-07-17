import { adminPool } from '../db/pool';

/**
 * List resource types for a business.
 */
export async function getResourceTypes(tenantId: string, businessId?: string) {
  if (businessId) {
    const { rows } = await adminPool.query(
      `SELECT rt.*, (SELECT COUNT(*)::int FROM res_resources WHERE resource_type_id = rt.id AND business_id = $2) AS resource_count
       FROM res_types rt WHERE rt.business_id = $2 ORDER BY rt.category, rt.name`,
      [tenantId, businessId],
    );
    return rows;
  }
  // Fallback for legacy calls without business_id
  const { rows } = await adminPool.query(
    `SELECT rt.*, (SELECT COUNT(*)::int FROM res_resources WHERE resource_type_id = rt.id) AS resource_count
     FROM res_types rt WHERE rt.tenant_id = $1 ORDER BY rt.category, rt.name`,
    [tenantId],
  );
  return rows;
}

/**
 * Create a resource type.
 */
export async function createResourceType(tenantId: string, businessId: string, input: {
  name: string;
  category: string;
  description?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO res_types (tenant_id, business_id, name, category, description)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, businessId, input.name, input.category, input.description || null],
  );
  return rows[0];
}

/**
 * Update a resource type.
 */
export async function updateResourceType(id: string, tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.category !== undefined) { fields.push(`category = $${idx++}`); values.push(updates.category); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }

  if (fields.length === 0) return null;
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE res_types SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Delete a resource type (only if no resources use it).
 */
export async function deleteResourceType(id: string, tenantId: string) {
  const { rows: used } = await adminPool.query(
    `SELECT id FROM res_resources WHERE resource_type_id = $1 LIMIT 1`, [id],
  );
  if (used.length > 0) throw new Error('Cannot delete type with existing resources');

  const { rowCount } = await adminPool.query(
    `DELETE FROM res_types WHERE id = $1 AND tenant_id = $2 AND is_system = false`,
    [id, tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Seed default resource types for a tenant.
 */
export async function seedDefaultTypes(tenantId: string) {
  const defaults = [
    { name: 'Massage Room', category: 'room' },
    { name: 'Treatment Room', category: 'room' },
    { name: 'Float Room', category: 'room' },
    { name: 'Gym Room', category: 'room' },
    { name: 'Sauna', category: 'equipment' },
    { name: 'Cold Bath', category: 'equipment' },
    { name: 'Jacuzzi', category: 'equipment' },
    { name: 'Compression Boots', category: 'equipment' },
    { name: 'Red Light Cabin', category: 'equipment' },
    { name: 'Pool', category: 'facility' },
    { name: 'Courtyard', category: 'facility' },
  ];

  for (const d of defaults) {
    await adminPool.query(
      `INSERT INTO res_types (tenant_id, name, category, is_system)
       VALUES ($1, $2, $3, true) ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, d.name, d.category],
    );
  }
}
