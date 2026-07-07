import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

export interface Location {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  status: string;
  is_primary: boolean;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  description?: string;
  photo_url?: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface CreateLocationInput {
  businessId: string;
  name: string;
  isPrimary?: boolean;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  description?: string;
  displayOrder?: number;
  createdBy: string;
  tenantId: string;
}

interface LocationFilters {
  status?: string;
  search?: string;
}

async function generateSlug(name: string, businessId: string, existingId?: string): Promise<string> {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  if (!slug) slug = 'location';

  let candidate = slug;
  let counter = 1;
  while (true) {
    const query = existingId
      ? 'SELECT id FROM sys_locations WHERE business_id = $1 AND slug = $2 AND id != $3'
      : 'SELECT id FROM sys_locations WHERE business_id = $1 AND slug = $2';
    const params = existingId ? [businessId, candidate, existingId] : [businessId, candidate];
    const { rows } = await adminPool.query(query, params);
    if (rows.length === 0) break;
    candidate = `${slug}-${counter++}`;
  }

  return candidate;
}

/**
 * Create a location for a business.
 */
export async function createLocation(input: CreateLocationInput): Promise<Location> {
  const slug = await generateSlug(input.name, input.businessId);

  // If this is marked as primary, unset any existing primary
  if (input.isPrimary) {
    await adminPool.query(
      'UPDATE sys_locations SET is_primary = false WHERE business_id = $1 AND is_primary = true',
      [input.businessId],
    );
  }

  // If this is the first location for the business, make it primary
  const { rows: existing } = await adminPool.query(
    'SELECT COUNT(*)::int AS cnt FROM sys_locations WHERE business_id = $1',
    [input.businessId],
  );
  const isPrimary = input.isPrimary || existing[0].cnt === 0;

  const { rows } = await adminPool.query(
    `INSERT INTO sys_locations (
       business_id, name, slug, is_primary,
       address_line1, address_line2, city, state_province, postal_code, country,
       phone, email, latitude, longitude, timezone,
       description, display_order, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      input.businessId, input.name, slug, isPrimary,
      input.addressLine1 || null, input.addressLine2 || null,
      input.city || null, input.stateProvince || null, input.postalCode || null, input.country || null,
      input.phone || null, input.email || null,
      input.latitude || null, input.longitude || null, input.timezone || null,
      input.description || null, input.displayOrder ?? 0, input.createdBy,
    ],
  );

  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'location.created',
    resourceType: 'location',
    resourceId: rows[0].id,
    details: { name: input.name, businessId: input.businessId },
  });

  return rows[0];
}

/**
 * List locations for a business.
 */
export async function getLocations(businessId: string, filters: LocationFilters = {}): Promise<Location[]> {
  const conditions = ['business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }

  if (filters.search) {
    conditions.push(`(name ILIKE $${idx} OR city ILIKE $${idx} OR address_line1 ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const { rows } = await adminPool.query(
    `SELECT * FROM sys_locations WHERE ${where} ORDER BY is_primary DESC, display_order, name`,
    params,
  );

  return rows;
}

/**
 * Get a single location by ID.
 */
export async function getLocationById(id: string, businessId: string): Promise<Location | null> {
  const { rows } = await adminPool.query(
    'SELECT * FROM sys_locations WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  return rows[0] || null;
}

/**
 * Update a location.
 */
export async function updateLocation(
  id: string,
  businessId: string,
  updates: Record<string, any>,
  userId: string,
  tenantId: string,
): Promise<Location | null> {
  const allowedFields: Record<string, string> = {
    name: 'name',
    status: 'status',
    is_primary: 'is_primary',
    address_line1: 'address_line1',
    address_line2: 'address_line2',
    city: 'city',
    state_province: 'state_province',
    postal_code: 'postal_code',
    country: 'country',
    phone: 'phone',
    email: 'email',
    latitude: 'latitude',
    longitude: 'longitude',
    timezone: 'timezone',
    description: 'description',
    photo_url: 'photo_url',
    display_order: 'display_order',
  };

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields[key] !== undefined) {
      fields.push(`${allowedFields[key]} = $${idx++}`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getLocationById(id, businessId);

  // If setting as primary, unset others
  if (updates.is_primary === true) {
    await adminPool.query(
      'UPDATE sys_locations SET is_primary = false WHERE business_id = $1 AND id != $2',
      [businessId, id],
    );
  }

  // Regenerate slug if name changed
  if (updates.name) {
    const newSlug = await generateSlug(updates.name, businessId, id);
    fields.push(`slug = $${idx++}`);
    values.push(newSlug);
  }

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE sys_locations SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}
     RETURNING *`,
    values,
  );

  if (rows.length === 0) return null;

  await logAudit({
    tenantId,
    userId,
    action: 'location.updated',
    resourceType: 'location',
    resourceId: id,
    details: { fields: Object.keys(updates) },
  });

  return rows[0];
}

/**
 * Deactivate a location.
 */
export async function deactivateLocation(id: string, businessId: string, userId: string, tenantId: string): Promise<boolean> {
  // Don't allow deactivating the primary location if it's the only active one
  const { rows: activeLocations } = await adminPool.query(
    "SELECT id, is_primary FROM sys_locations WHERE business_id = $1 AND status = 'active'",
    [businessId],
  );

  const target = activeLocations.find((l) => l.id === id);
  if (!target) return false;

  if (target.is_primary && activeLocations.length <= 1) {
    throw new Error('Cannot deactivate the only active location');
  }

  const { rowCount } = await adminPool.query(
    "UPDATE sys_locations SET status = 'inactive', updated_at = NOW() WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );

  if ((rowCount ?? 0) === 0) return false;

  await logAudit({ tenantId, userId, action: 'location.deactivated', resourceType: 'location', resourceId: id });
  return true;
}

/**
 * Get location counts for summary (staff, services, resources assigned).
 */
export async function getLocationSummary(locationId: string): Promise<{ staff_count: number; service_count: number; resource_count: number }> {
  const [staffResult, serviceResult, resourceResult] = await Promise.all([
    adminPool.query('SELECT COUNT(*)::int AS cnt FROM stf_location_assignments WHERE location_id = $1', [locationId]),
    adminPool.query('SELECT COUNT(*)::int AS cnt FROM svc_locations WHERE location_id = $1', [locationId]),
    adminPool.query("SELECT COUNT(*)::int AS cnt FROM res_resources WHERE location_id = $1 AND status = 'active'", [locationId]),
  ]);

  return {
    staff_count: staffResult.rows[0].cnt,
    service_count: serviceResult.rows[0].cnt,
    resource_count: resourceResult.rows[0].cnt,
  };
}
