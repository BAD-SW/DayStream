import { adminPool } from '../db/pool';

// --- Tag Management ---

export async function getTags(businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM tags WHERE business_id = $1 ORDER BY name',
    [businessId],
  );
  return rows;
}

export async function createTag(businessId: string, name: string, color: string) {
  const { rows } = await adminPool.query(
    'INSERT INTO tags (business_id, name, color) VALUES ($1, $2, $3) RETURNING *',
    [businessId, name, color || '#8A8A8A'],
  );
  return rows[0];
}

export async function updateTag(tagId: string, businessId: string, updates: { name?: string; color?: string }) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.color) { fields.push(`color = $${idx++}`); values.push(updates.color); }

  if (fields.length === 0) return null;

  values.push(tagId, businessId);
  const { rows } = await adminPool.query(
    `UPDATE tags SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteTag(tagId: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    'DELETE FROM tags WHERE id = $1 AND business_id = $2',
    [tagId, businessId],
  );
  return (rowCount ?? 0) > 0;
}

// --- Tag Assignment ---

export async function assignTag(customerId: string, tagId: string, assignedBy: string) {
  await adminPool.query(
    'INSERT INTO customer_tags (customer_id, tag_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [customerId, tagId, assignedBy],
  );
}

export async function removeTag(customerId: string, tagId: string) {
  await adminPool.query(
    'DELETE FROM customer_tags WHERE customer_id = $1 AND tag_id = $2',
    [customerId, tagId],
  );
}

export async function getCustomerTags(customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT t.id, t.name, t.color, ct.assigned_at
     FROM customer_tags ct
     JOIN tags t ON t.id = ct.tag_id
     WHERE ct.customer_id = $1
     ORDER BY t.name`,
    [customerId],
  );
  return rows;
}
