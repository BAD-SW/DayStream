import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { logger } from '../middleware/logger';

interface CreateCustomerInput {
  businessId: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  preferredLanguage?: string;
  country?: string;
  createdBy: string;
}

interface CustomerFilters {
  search?: string;
  lifecycle_stage?: string;
  tag_ids?: string[];
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  // Per-column filters (customers-page-requirements.md §A3) — all "contains", combine with AND.
  ref?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  created_from?: string;
  created_to?: string;
}

export async function createCustomer(input: CreateCustomerInput) {
  // Check for duplicate email within business
  const { rows: existing } = await adminPool.query(
    'SELECT id FROM cus_customers WHERE business_id = $1 AND email = $2',
    [input.businessId, input.email],
  );

  if (existing.length > 0) {
    return { duplicate: true, existingId: existing[0].id };
  }

  // Generate reference number
  const { rows: refRows } = await adminPool.query(
    'SELECT generate_customer_reference($1) AS ref',
    [input.businessId],
  );
  const referenceNumber = refRows[0].ref;

  // Insert customer
  const { rows } = await adminPool.query(
    `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, phone, date_of_birth, gender, preferred_language, country, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [input.tenantId, input.businessId, referenceNumber, input.email, input.firstName, input.lastName, input.phone || null, input.dateOfBirth || null, input.gender || null, input.preferredLanguage || 'en', input.country || null, input.createdBy],
  );

  const customer = rows[0];

  // Create default preferences (opted out of marketing)
  await adminPool.query(
    'INSERT INTO cus_preferences (customer_id) VALUES ($1)',
    [customer.id],
  );

  // Audit log
  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'customer.created',
    resourceType: 'customer',
    resourceId: customer.id,
    details: { email: input.email, businessId: input.businessId },
  });

  return { duplicate: false, customer };
}

export async function getCustomers(businessId: string, filters: CustomerFilters) {
  const conditions = ['business_id = $1', "status != 'anonymized'"];
  const params: any[] = [businessId];
  let paramIndex = 2;

  if (filters.search) {
    conditions.push(`(first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR COALESCE(phone, '') ILIKE $${paramIndex} OR COALESCE(reference_number, '') ILIKE $${paramIndex})`);
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  if (filters.lifecycle_stage) {
    conditions.push(`lifecycle_stage = $${paramIndex}`);
    params.push(filters.lifecycle_stage);
    paramIndex++;
  }

  const containsFilters: [string | undefined, string][] = [
    [filters.ref, 'reference_number'],
    [filters.first_name, 'first_name'],
    [filters.last_name, 'last_name'],
    [filters.email, 'email'],
    [filters.phone, 'phone'],
  ];
  for (const [value, column] of containsFilters) {
    if (value) {
      conditions.push(`${column} ILIKE $${paramIndex}`);
      params.push(`%${value}%`);
      paramIndex++;
    }
  }

  if (filters.created_from) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(filters.created_from);
    paramIndex++;
  }
  if (filters.created_to) {
    conditions.push(`created_at < ($${paramIndex}::date + INTERVAL '1 day')`);
    params.push(filters.created_to);
    paramIndex++;
  }

  const where = conditions.join(' AND ');
  const sort = ['first_name', 'last_name', 'email', 'phone', 'reference_number', 'created_at', 'lifecycle_stage'].includes(filters.sort || '') ? filters.sort : 'created_at';
  const order = filters.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT * FROM cus_customers WHERE ${where} ORDER BY ${sort} ${order} LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*) AS total FROM cus_customers WHERE ${where}`, params),
  ]);

  return {
    customers: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}

export async function getCustomerById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM cus_customers WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  return rows[0] || null;
}

export async function updateCustomer(id: string, businessId: string, updates: Record<string, any>, userId: string) {
  const customer = await getCustomerById(id, businessId);
  if (!customer) return null;

  const allowedFields = ['email', 'first_name', 'last_name', 'phone', 'date_of_birth', 'gender', 'preferred_language', 'country', 'avatar_url', 'status', 'lifecycle_stage'];
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${idx++}`);
      // Convert empty strings to null for date fields
      values.push(key === 'date_of_birth' && value === '' ? null : value);
    }
  }

  if (fields.length === 0) return customer;

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  await adminPool.query(
    `UPDATE cus_customers SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}`,
    values,
  );

  // Build change descriptions with from → to values
  const changes: { field: string; from: any; to: any }[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!allowedFields.includes(key)) continue;
    const oldVal = customer[key];
    const newVal = value;

    // Normalize for comparison: treat null/undefined/empty string as equivalent
    const normalizeVal = (v: any): string => {
      if (v === null || v === undefined || v === '') return '';
      if (v instanceof Date) return v.toISOString();
      return String(v).trim();
    };

    if (normalizeVal(oldVal) !== normalizeVal(newVal)) {
      changes.push({ field: key, from: oldVal ?? null, to: newVal ?? null });
    }
  }

  // Log activity only if something actually changed
  if (changes.length > 0) {
    const description = changes.map((c) => {
      const label = c.field.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      const fromVal = c.from || '(empty)';
      const toVal = c.to || '(empty)';
      return `${label}: ${fromVal} → ${toVal}`;
    }).join('; ');

    await adminPool.query(
      `INSERT INTO cus_activities (customer_id, business_id, activity_type, description, metadata, created_by)
       VALUES ($1, $2, 'profile_change', $3, $4, $5)`,
      [id, businessId, description, JSON.stringify({ changes }), userId],
    );
  }

  return getCustomerById(id, businessId);
}

export async function archiveCustomer(id: string, businessId: string, userId: string, tenantId: string) {
  const customer = await getCustomerById(id, businessId);
  if (!customer) return null;

  await adminPool.query(
    "UPDATE cus_customers SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );

  await logAudit({ tenantId, userId, action: 'customer.archived', resourceType: 'customer', resourceId: id });

  return { ...customer, status: 'archived' };
}

export async function anonymizeCustomer(id: string, businessId: string, userId: string, tenantId: string) {
  const customer = await getCustomerById(id, businessId);
  if (!customer) return null;

  await adminPool.query(
    `UPDATE cus_customers SET
       first_name = '[deleted]', last_name = '[deleted]', email = $3,
       phone = NULL, date_of_birth = NULL, gender = NULL, country = NULL, avatar_url = NULL,
       status = 'anonymized', anonymized_at = NOW(), anonymized_by = $4, updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [id, businessId, `anonymized-${id}@deleted.local`, userId],
  );

  // Delete notes content
  await adminPool.query('DELETE FROM cus_notes WHERE customer_id = $1', [id]);

  // Log
  await logAudit({ tenantId, userId, action: 'customer.anonymized', resourceType: 'customer', resourceId: id });

  return { id, status: 'anonymized' };
}
