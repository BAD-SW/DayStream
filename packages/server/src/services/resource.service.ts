import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

interface CreateResourceInput {
  tenantId: string;
  resourceTypeId: string;
  locationId?: string;
  name: string;
  description?: string;
  capacity?: number;
  bufferMinutes?: number;
  is247?: boolean;
  photoPath?: string;
  displayOrder?: number;
  customAttributes?: Record<string, any>;
  createdBy: string;
}

interface ResourceFilters {
  resourceTypeId?: string;
  locationId?: string;
  status?: string;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function createResource(input: CreateResourceInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO resources (tenant_id, resource_type_id, location_id, name, description,
       capacity, buffer_minutes, is_24_7, photo_path, display_order, custom_attributes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      input.tenantId, input.resourceTypeId, input.locationId || null,
      input.name, input.description || null,
      input.capacity ?? 1, input.bufferMinutes ?? 0,
      input.is247 ?? false, input.photoPath || null,
      input.displayOrder ?? 0, JSON.stringify(input.customAttributes || {}),
    ],
  );

  await logAudit({
    tenantId: input.tenantId, userId: input.createdBy,
    action: 'resource.created', resourceType: 'resource', resourceId: rows[0].id,
    details: { name: input.name },
  });

  return rows[0];
}

export async function getResources(tenantId: string, filters: ResourceFilters) {
  const conditions = ['r.tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters.resourceTypeId) { conditions.push(`r.resource_type_id = $${idx++}`); params.push(filters.resourceTypeId); }
  if (filters.locationId) { conditions.push(`r.location_id = $${idx++}`); params.push(filters.locationId); }
  if (filters.status) { conditions.push(`r.status = $${idx++}`); params.push(filters.status); }
  else { conditions.push("r.status != 'inactive'"); }
  if (filters.category) { conditions.push(`rt.category = $${idx++}`); params.push(filters.category); }
  if (filters.search) { conditions.push(`(r.name ILIKE $${idx} OR r.description ILIKE $${idx})`); params.push(`%${filters.search}%`); idx++; }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 50, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [data, count] = await Promise.all([
    adminPool.query(
      `SELECT r.*, rt.name AS type_name, rt.category
       FROM resources r JOIN resource_types rt ON rt.id = r.resource_type_id
       WHERE ${where} ORDER BY r.display_order, r.name LIMIT ${limit} OFFSET ${offset}`, params),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM resources r JOIN resource_types rt ON rt.id = r.resource_type_id WHERE ${where}`, params),
  ]);

  return { resources: data.rows, total: count.rows[0].total, page, limit };
}

export async function getResourceById(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT r.*, rt.name AS type_name, rt.category
     FROM resources r JOIN resource_types rt ON rt.id = r.resource_type_id
     WHERE r.id = $1 AND r.tenant_id = $2`, [id, tenantId]);
  return rows[0] || null;
}

export async function updateResource(id: string, tenantId: string, updates: Record<string, any>, userId: string) {
  const allowed: Record<string, string> = {
    name: 'name', description: 'description', resource_type_id: 'resource_type_id',
    location_id: 'location_id', capacity: 'capacity', buffer_minutes: 'buffer_minutes',
    is_24_7: 'is_24_7', display_order: 'display_order', custom_attributes: 'custom_attributes',
    photo_path: 'photo_path',
  };

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowed[key]) {
      fields.push(`${allowed[key]} = $${idx++}`);
      values.push(key === 'custom_attributes' ? JSON.stringify(value) : value);
    }
  }
  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE resources SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`, values);
  return rows[0] || null;
}

export async function deactivateResource(id: string, tenantId: string, userId: string) {
  const { rows } = await adminPool.query(
    `UPDATE resources SET status = 'inactive', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status != 'inactive' RETURNING *`, [id, tenantId]);
  if (rows.length === 0) return null;
  await logAudit({ tenantId, userId, action: 'resource.deactivated', resourceType: 'resource', resourceId: id });
  return rows[0];
}
