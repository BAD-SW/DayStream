import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

interface CreateStaffInput {
  tenantId: string;
  userId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  mobilePhone?: string;
  dateOfBirth?: string;
  hireDate?: string;
  employmentType?: string;
  bio?: string;
  languages?: string;
  showOnDirectory?: boolean;
  primaryLocationId?: string;
  createdBy: string;
}

interface StaffFilters {
  status?: string;
  employmentType?: string;
  locationId?: string;
  serviceId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Generate a unique staff reference per tenant (STF-001, STF-002, etc.)
 */
async function generateStaffRef(tenantId: string): Promise<string> {
  const { rows } = await adminPool.query(
    `SELECT staff_ref FROM staff_profiles WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  );

  let nextNum = 1;
  if (rows.length > 0) {
    const match = rows[0].staff_ref.match(/STF-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }

  return `STF-${String(nextNum).padStart(3, '0')}`;
}

/**
 * Create a staff profile.
 */
export async function createStaff(input: CreateStaffInput) {
  const staffRef = await generateStaffRef(input.tenantId);

  const { rows } = await adminPool.query(
    `INSERT INTO staff_profiles (
       tenant_id, user_id, staff_ref, first_name, last_name, email,
       mobile_phone, date_of_birth, hire_date, employment_type,
       bio, languages, show_on_directory, primary_location_id, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      input.tenantId,
      input.userId || null,
      staffRef,
      input.firstName,
      input.lastName,
      input.email || null,
      input.mobilePhone || null,
      input.dateOfBirth || null,
      input.hireDate || null,
      input.employmentType || 'full_time',
      input.bio || null,
      input.languages || null,
      input.showOnDirectory ?? true,
      input.primaryLocationId || null,
      input.createdBy,
    ],
  );

  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'staff.created',
    resourceType: 'staff_profile',
    resourceId: rows[0].id,
    details: { staffRef, name: `${input.firstName} ${input.lastName}` },
  });

  return rows[0];
}

/**
 * List staff profiles with filtering and pagination.
 */
export async function getStaffList(tenantId: string, filters: StaffFilters) {
  const conditions = ['sp.tenant_id = $1'];
  const params: any[] = [tenantId];
  let paramIndex = 2;

  if (filters.status) {
    conditions.push(`sp.status = $${paramIndex++}`);
    params.push(filters.status);
  } else {
    conditions.push("sp.status != 'terminated'");
  }

  if (filters.employmentType) {
    conditions.push(`sp.employment_type = $${paramIndex++}`);
    params.push(filters.employmentType);
  }

  if (filters.locationId) {
    conditions.push(`sp.id IN (SELECT staff_id FROM staff_location_assignments WHERE location_id = $${paramIndex++})`);
    params.push(filters.locationId);
  }

  if (filters.serviceId) {
    conditions.push(`sp.id IN (SELECT staff_id FROM staff_service_assignments WHERE service_id = $${paramIndex++})`);
    params.push(filters.serviceId);
  }

  if (filters.search) {
    conditions.push(`(sp.first_name ILIKE $${paramIndex} OR sp.last_name ILIKE $${paramIndex} OR sp.email ILIKE $${paramIndex} OR CONCAT(sp.first_name, ' ', sp.last_name) ILIKE $${paramIndex})`);
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT sp.*
       FROM staff_profiles sp
       WHERE ${where}
       ORDER BY sp.last_name ASC, sp.first_name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM staff_profiles sp WHERE ${where}`, params),
  ]);

  return {
    staff: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

/**
 * Get a single staff profile by ID.
 */
export async function getStaffById(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM staff_profiles WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return rows[0] || null;
}

/**
 * Get staff profile by user_id (for self-service).
 */
export async function getStaffByUserId(userId: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM staff_profiles WHERE user_id = $1 AND tenant_id = $2`,
    [userId, tenantId],
  );
  return rows[0] || null;
}

/**
 * Update a staff profile.
 */
export async function updateStaff(id: string, tenantId: string, updates: Record<string, any>, userId: string) {
  const allowedFields: Record<string, string> = {
    first_name: 'first_name',
    last_name: 'last_name',
    email: 'email',
    mobile_phone: 'mobile_phone',
    date_of_birth: 'date_of_birth',
    hire_date: 'hire_date',
    employment_type: 'employment_type',
    bio: 'bio',
    languages: 'languages',
    show_on_directory: 'show_on_directory',
    primary_location_id: 'primary_location_id',
    user_id: 'user_id',
    profile_photo_path: 'profile_photo_path',
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

  if (fields.length === 0) return null;

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(tenantId);

  const { rows } = await adminPool.query(
    `UPDATE staff_profiles SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}
     RETURNING *`,
    values,
  );

  if (rows.length === 0) return null;

  await logAudit({
    tenantId,
    userId,
    action: 'staff.updated',
    resourceType: 'staff_profile',
    resourceId: id,
    details: { fields: Object.keys(updates) },
  });

  return rows[0];
}

/**
 * Deactivate a staff member (soft-delete).
 */
export async function deactivateStaff(id: string, tenantId: string, userId: string) {
  const { rows } = await adminPool.query(
    `UPDATE staff_profiles SET status = 'inactive', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status != 'inactive'
     RETURNING *`,
    [id, tenantId],
  );

  if (rows.length === 0) return null;

  await logAudit({
    tenantId,
    userId,
    action: 'staff.deactivated',
    resourceType: 'staff_profile',
    resourceId: id,
  });

  return rows[0];
}

/**
 * Upload/update profile photo path.
 */
export async function updateProfilePhoto(id: string, tenantId: string, photoPath: string) {
  const { rows } = await adminPool.query(
    `UPDATE staff_profiles SET profile_photo_path = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3
     RETURNING *`,
    [photoPath, id, tenantId],
  );
  return rows[0] || null;
}
