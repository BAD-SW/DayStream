import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { logger } from '../middleware/logger';

interface CreateServiceInput {
  businessId: string;
  categoryId: string;
  name: string;
  description?: string;
  shortDescription?: string;
  bookingType?: string;
  defaultDuration?: number;
  bufferBefore?: number;
  bufferAfter?: number;
  maxCapacity?: number;
  minAdvanceBookingHours?: number;
  maxAdvanceBookingDays?: number;
  onlineBookingEnabled?: boolean;
  preparationNotes?: string;
  displayOrder?: number;
  taxCategoryId?: string;
  cancellationPolicyId?: string;
  createdBy: string;
  tenantId: string;
}

interface ServiceFilters {
  categoryId?: string;
  status?: string;
  bookingType?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

/**
 * Generate a URL-friendly slug from a name, ensuring uniqueness within business.
 */
async function generateSlug(name: string, businessId: string, existingId?: string): Promise<string> {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  if (!slug) slug = 'service';

  // Check uniqueness
  let candidate = slug;
  let counter = 1;
  while (true) {
    const query = existingId
      ? 'SELECT id FROM svc_services WHERE business_id = $1 AND slug = $2 AND id != $3'
      : 'SELECT id FROM svc_services WHERE business_id = $1 AND slug = $2';
    const params = existingId ? [businessId, candidate, existingId] : [businessId, candidate];
    const { rows } = await adminPool.query(query, params);
    if (rows.length === 0) break;
    candidate = `${slug}-${counter++}`;
  }

  return candidate;
}

/**
 * Create a service.
 */
export async function createService(input: CreateServiceInput) {
  // Validate category belongs to business
  const { rows: catRows } = await adminPool.query(
    'SELECT id FROM svc_categories WHERE id = $1 AND business_id = $2',
    [input.categoryId, input.businessId],
  );
  if (catRows.length === 0) {
    throw new Error('Category not found');
  }

  // Check name uniqueness within category
  const { rows: nameRows } = await adminPool.query(
    "SELECT id FROM svc_services WHERE business_id = $1 AND category_id = $2 AND name = $3 AND status != 'archived'",
    [input.businessId, input.categoryId, input.name],
  );
  if (nameRows.length > 0) {
    throw new Error('A service with this name already exists in this category');
  }

  const slug = await generateSlug(input.name, input.businessId);

  const { rows } = await adminPool.query(
    `INSERT INTO svc_services (
       business_id, category_id, name, slug, description, short_description,
       booking_type, default_duration, buffer_before, buffer_after,
       max_capacity, min_advance_booking_hours, max_advance_booking_days,
       online_booking_enabled, preparation_notes, display_order,
       tax_category_id, cancellation_policy_id, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING *`,
    [
      input.businessId, input.categoryId, input.name, slug,
      input.description || null, input.shortDescription || null,
      input.bookingType || 'individual',
      input.defaultDuration ?? 60,
      input.bufferBefore ?? 0, input.bufferAfter ?? 0,
      input.maxCapacity ?? 1,
      input.minAdvanceBookingHours ?? 2, input.maxAdvanceBookingDays ?? 30,
      input.onlineBookingEnabled ?? true,
      input.preparationNotes || null,
      input.displayOrder ?? 0,
      input.taxCategoryId || null, input.cancellationPolicyId || null,
      input.createdBy,
    ],
  );

  const service = rows[0];

  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'service.created',
    resourceType: 'service',
    resourceId: service.id,
    details: { name: input.name, businessId: input.businessId },
  });

  return service;
}

/**
 * List services with filtering and pagination.
 */
export async function getServices(businessId: string, filters: ServiceFilters) {
  const conditions = ['s.business_id = $1'];
  const params: any[] = [businessId];
  let paramIndex = 2;

  if (filters.categoryId) {
    conditions.push(`s.category_id = $${paramIndex++}`);
    params.push(filters.categoryId);
  }

  if (filters.status && filters.status !== 'all') {
    conditions.push(`s.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.bookingType) {
    conditions.push(`s.booking_type = $${paramIndex++}`);
    params.push(filters.bookingType);
  }

  if (filters.search) {
    conditions.push(`to_tsvector('english', s.name || ' ' || COALESCE(s.description, '') || ' ' || COALESCE(s.short_description, '')) @@ plainto_tsquery('english', $${paramIndex++})`);
    params.push(filters.search);
  }

  const where = conditions.join(' AND ');
  const allowedSort = ['name', 'created_at', 'display_order', 'default_duration'];
  const sort = allowedSort.includes(filters.sort || '') ? filters.sort : 'display_order';
  const order = filters.order === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT s.*, sc.name AS category_name
       FROM svc_services s
       JOIN svc_categories sc ON sc.id = s.category_id
       WHERE ${where}
       ORDER BY s.${sort} ${order}
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM svc_services s WHERE ${where}`, params),
  ]);

  return {
    services: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

/**
 * Get a single service by ID with related data.
 */
export async function getServiceById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT s.*, sc.name AS category_name
     FROM svc_services s
     JOIN svc_categories sc ON sc.id = s.category_id
     WHERE s.id = $1 AND s.business_id = $2`,
    [id, businessId],
  );

  if (rows.length === 0) return null;

  const service = rows[0];

  // Load variants
  const { rows: variants } = await adminPool.query(
    'SELECT * FROM svc_variants WHERE service_id = $1 ORDER BY display_order',
    [id],
  );

  // Load images
  const { rows: images } = await adminPool.query(
    'SELECT * FROM svc_images WHERE service_id = $1 ORDER BY display_order',
    [id],
  );

  // Load staff
  const { rows: staff } = await adminPool.query(
    `SELECT ss.*, u.first_name, u.last_name, u.email
     FROM svc_staff ss
     JOIN usr_users u ON u.id = ss.user_id
     WHERE ss.service_id = $1`,
    [id],
  );

  // Load availability rules
  const { rows: availability } = await adminPool.query(
    'SELECT * FROM svc_availability_rules WHERE service_id = $1',
    [id],
  );

  return { ...service, variants, images, staff, availability };
}

/**
 * Update a service.
 */
export async function updateService(id: string, businessId: string, updates: Record<string, any>, userId: string, tenantId: string) {
  const service = await getServiceById(id, businessId);
  if (!service) return null;

  const allowedFields: Record<string, string> = {
    category_id: 'category_id',
    name: 'name',
    description: 'description',
    short_description: 'short_description',
    booking_type: 'booking_type',
    default_duration: 'default_duration',
    buffer_before: 'buffer_before',
    buffer_after: 'buffer_after',
    max_capacity: 'max_capacity',
    min_advance_booking_hours: 'min_advance_booking_hours',
    max_advance_booking_days: 'max_advance_booking_days',
    online_booking_enabled: 'online_booking_enabled',
    preparation_notes: 'preparation_notes',
    display_order: 'display_order',
    tax_category_id: 'tax_category_id',
    cancellation_policy_id: 'cancellation_policy_id',
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

  if (fields.length === 0) return service;

  // Validate capacity for shared/group
  if (updates.booking_type && ['shared', 'group'].includes(updates.booking_type)) {
    const capacity = updates.max_capacity ?? service.max_capacity;
    if (capacity < 2) {
      throw new Error('Shared/group services require capacity of at least 2');
    }
  }

  // Regenerate slug if name changed
  if (updates.name && updates.name !== service.name) {
    const newSlug = await generateSlug(updates.name, businessId, id);
    fields.push(`slug = $${idx++}`);
    values.push(newSlug);
  }

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE svc_services SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}
     RETURNING *`,
    values,
  );

  return rows[0];
}

/**
 * Archive a service.
 */
export async function archiveService(id: string, businessId: string, userId: string, tenantId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE svc_services SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );

  if ((rowCount ?? 0) === 0) return false;

  await logAudit({ tenantId, userId, action: 'service.archived', resourceType: 'service', resourceId: id });
  return true;
}

/**
 * Restore an archived service to draft.
 */
export async function restoreService(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE svc_services SET status = 'draft', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'archived'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Pause a service (temporarily remove from booking without archiving).
 */
export async function pauseService(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    "UPDATE svc_services SET status = 'paused', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Activate a service (requires at least one active variant).
 */
export async function activateService(id: string, businessId: string) {
  // Check for active variants
  const { rows: variants } = await adminPool.query(
    "SELECT id FROM svc_variants WHERE service_id = $1 AND status = 'active'",
    [id],
  );

  if (variants.length === 0) {
    throw new Error('Service must have at least one active variant before activating');
  }

  const { rowCount } = await adminPool.query(
    "UPDATE svc_services SET status = 'active', updated_at = NOW() WHERE id = $1 AND business_id = $2 AND status IN ('draft', 'paused')",
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}
