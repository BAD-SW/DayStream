import { adminPool } from '../db/pool';

/**
 * Get resource requirements for a service.
 */
export async function getServiceRequirements(serviceId: string) {
  const { rows } = await adminPool.query(
    `SELECT srr.*, r.name AS resource_name, rt.name AS type_name
     FROM svc_resource_requirements srr
     LEFT JOIN res_resources r ON r.id = srr.resource_id
     LEFT JOIN res_types rt ON rt.id = srr.resource_type_id
     WHERE srr.service_id = $1 ORDER BY srr.requirement_type, r.name, rt.name`,
    [serviceId]);
  return rows;
}

/**
 * Create a service-resource requirement.
 */
export async function createRequirement(input: {
  serviceId: string;
  variantId?: string;
  resourceId?: string;
  resourceTypeId?: string;
  requirementType?: string;
  bufferMinutes?: number;
}) {
  if (!input.resourceId && !input.resourceTypeId) {
    throw new Error('Either resource_id or resource_type_id is required');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO svc_resource_requirements (service_id, variant_id, resource_id, resource_type_id, requirement_type, buffer_minutes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.serviceId, input.variantId || null, input.resourceId || null,
     input.resourceTypeId || null, input.requirementType || 'required', input.bufferMinutes ?? null]);
  return rows[0];
}

/**
 * Update a requirement.
 */
export async function updateRequirement(id: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.requirement_type !== undefined) { fields.push(`requirement_type = $${idx++}`); values.push(updates.requirement_type); }
  if (updates.buffer_minutes !== undefined) { fields.push(`buffer_minutes = $${idx++}`); values.push(updates.buffer_minutes); }
  if (updates.resource_id !== undefined) { fields.push(`resource_id = $${idx++}`); values.push(updates.resource_id); }
  if (updates.resource_type_id !== undefined) { fields.push(`resource_type_id = $${idx++}`); values.push(updates.resource_type_id); }

  if (fields.length === 0) return null;
  values.push(id);

  const { rows } = await adminPool.query(
    `UPDATE svc_resource_requirements SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
  return rows[0] || null;
}

/**
 * Delete a requirement.
 */
export async function deleteRequirement(id: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM svc_resource_requirements WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
