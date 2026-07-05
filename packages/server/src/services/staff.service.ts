import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { hashPassword } from './auth.service';

interface CreateStaffInput {
  tenantId: string;
  userId?: string;
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  mobilePhone?: string;
  dateOfBirth?: string;
  hireDate?: string;
  employmentType?: string;
  role?: string;
  bio?: string;
  languages?: string;
  showOnDirectory?: boolean;
  primaryLocationId?: string;
  createdBy: string;
  businessId?: string;
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
 * Create a staff profile and their user account.
 * Staff always get a user account so they can log in and be assigned to services.
 */
export async function createStaff(input: CreateStaffInput) {
  const staffRef = await generateStaffRef(input.tenantId);

  let userId = input.userId || null;

  // Create or link user account
  if (!userId) {
    if (!input.email) {
      throw new Error('Email is required to create a staff member');
    }

    // Check if a user with this email already exists in this tenant
    const { rows: existingUsers } = await adminPool.query(
      'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
      [input.email, input.tenantId],
    );

    if (existingUsers.length > 0) {
      // Link to existing user
      userId = existingUsers[0].id;
    } else {
      // Create a new user account
      if (!input.password) {
        throw new Error('Password is required when creating a new staff member');
      }
      const passwordHash = await hashPassword(input.password);
      const role = input.role || 'business_staff';

      const { rows: userRows } = await adminPool.query(
        `INSERT INTO users (tenant_id, business_id, email, first_name, last_name, password_hash, role, persona, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'business', 'active')
         RETURNING id`,
        [input.tenantId, input.businessId || null, input.email, input.firstName, input.lastName, passwordHash, role],
      );
      userId = userRows[0].id;
    }
  }

  const { rows } = await adminPool.query(
    `INSERT INTO staff_profiles (
       tenant_id, user_id, staff_ref, first_name, last_name, email,
       mobile_phone, date_of_birth, hire_date, employment_type,
       bio, languages, show_on_directory, primary_location_id, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      input.tenantId,
      userId,
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
    details: { staffRef, name: `${input.firstName} ${input.lastName}`, userCreated: !!userId },
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
      `SELECT sp.*, u.role AS user_role, u.id AS linked_user_id
       FROM staff_profiles sp
       LEFT JOIN users u ON u.id = sp.user_id
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
    `SELECT sp.*, u.role AS user_role, u.email AS user_email, u.status AS user_status
     FROM staff_profiles sp
     LEFT JOIN users u ON u.id = sp.user_id
     WHERE sp.id = $1 AND sp.tenant_id = $2`,
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

/**
 * Create/link a user account for a staff profile that doesn't have one.
 * Used to retroactively give login access to staff created without email.
 */
export async function linkUserAccount(staffId: string, tenantId: string, email: string, role: string, password: string, businessId?: string): Promise<any> {
  const staff = await getStaffById(staffId, tenantId);
  if (!staff) throw new Error('Staff not found');
  if (staff.user_id) throw new Error('Staff already has a linked user account');

  if (!password) throw new Error('Password is required');

  // Check email uniqueness within tenant
  const { rows: existing } = await adminPool.query(
    'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
    [email, tenantId],
  );
  if (existing.length > 0) {
    throw new Error('A user with this email already exists');
  }

  // Create user
  const passwordHash = await hashPassword(password);

  const { rows: userRows } = await adminPool.query(
    `INSERT INTO users (tenant_id, business_id, email, first_name, last_name, password_hash, role, persona, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'business', 'active')
     RETURNING id`,
    [tenantId, businessId || null, email, staff.first_name, staff.last_name, passwordHash, role],
  );

  // Link to staff profile
  await adminPool.query(
    'UPDATE staff_profiles SET user_id = $1, email = $2, updated_at = NOW() WHERE id = $3',
    [userRows[0].id, email, staffId],
  );

  return { user_id: userRows[0].id, email, role };
}

/**
 * Reset password for a staff member's user account.
 */
export async function resetStaffPassword(staffId: string, tenantId: string, newPassword: string): Promise<boolean> {
  const staff = await getStaffById(staffId, tenantId);
  if (!staff || !staff.user_id) throw new Error('Staff not found or has no user account');

  const passwordHash = await hashPassword(newPassword);
  const { rowCount } = await adminPool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3',
    [passwordHash, staff.user_id, tenantId],
  );

  return (rowCount ?? 0) > 0;
}
