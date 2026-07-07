import { pool, adminPool } from '../db/pool';
import { hashPassword } from './auth.service';
import { logAudit } from './audit.service';
import { generateSlug } from '@daystream/shared';
import { logger } from '../middleware/logger';

interface CreateTenantInput {
  name: string;
  slug?: string;
  owner_email: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_password: string;
  default_language?: string;
  currency?: string;
  timezone?: string;
}

export async function createTenant(input: CreateTenantInput, createdBy?: string) {
  const slug = input.slug || generateSlug(input.name);

  // Check slug uniqueness
  const { rows: existing } = await adminPool.query('SELECT id FROM sys_tenants WHERE slug = $1', [slug]);
  if (existing.length > 0) {
    throw new Error('A tenant with this slug already exists');
  }

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // Create tenant
    const { rows: tenantRows } = await client.query(
      `INSERT INTO sys_tenants (name, slug, status, default_language, currency, timezone)
       VALUES ($1, $2, 'active', $3, $4, $5)
       RETURNING *`,
      [input.name, slug, input.default_language || 'en', input.currency || 'EUR', input.timezone || 'UTC'],
    );
    const tenant = tenantRows[0];

    // Create tenant-specific roles (copy system roles for this tenant)
    const roleIds: Record<string, string> = {};
    const systemRoles = [
      { name: 'Business Owner', permissions: '["services:*","bookings:*","staff:*","reports:*","settings:*","customers:*"]' },
      { name: 'Manager', permissions: '["services:read","bookings:*","staff:read","reports:read","customers:*","schedule:*"]' },
      { name: 'Staff', permissions: '["bookings:read","bookings:update","customers:read","schedule:read"]' },
      { name: 'Customer', permissions: '["bookings:create","bookings:read","profile:update"]' },
    ];

    for (const role of systemRoles) {
      const { rows } = await client.query(
        `INSERT INTO usr_roles (tenant_id, name, permissions, is_system)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [tenant.id, role.name, role.permissions],
      );
      roleIds[role.name] = rows[0].id;
    }

    // Create owner user
    const passwordHash = await hashPassword(input.owner_password);
    const { rows: userRows } = await client.query(
      `INSERT INTO usr_users (tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, 'business_owner', 'active')
       RETURNING id, email, first_name, last_name, role`,
      [tenant.id, input.owner_email, input.owner_first_name, input.owner_last_name, passwordHash],
    );
    const owner = userRows[0];

    // Assign Business Owner role
    await client.query(
      'INSERT INTO usr_user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)',
      [owner.id, roleIds['Business Owner'], tenant.id],
    );

    // Create staff profile for the business owner
    const { rows: staffRefRows } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM stf_profiles WHERE tenant_id = $1`,
      [tenant.id],
    );
    const staffRef = `STF-${String((staffRefRows[0].cnt || 0) + 1).padStart(3, '0')}`;
    await client.query(
      `INSERT INTO stf_profiles (tenant_id, user_id, staff_ref, first_name, last_name, email, employment_type, status, show_on_directory, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'full_time', 'active', true, $2)`,
      [tenant.id, owner.id, staffRef, input.owner_first_name, input.owner_last_name, input.owner_email],
    );

    // Apply default configuration values for new tenant
    const { rows: configDefs } = await client.query('SELECT key, default_value FROM sys_configuration_definitions');
    for (const def of configDefs) {
      await client.query(
        'INSERT INTO sys_tenant_configurations (tenant_id, key, value, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [tenant.id, def.key, def.default_value, owner.id],
      );
    }

    await client.query('COMMIT');

    // Audit log
    await logAudit({
      tenantId: tenant.id,
      userId: createdBy || owner.id,
      action: 'tenant.created',
      resourceType: 'tenant',
      resourceId: tenant.id,
      details: { name: tenant.name, slug: tenant.slug, ownerEmail: owner.email },
    });

    logger.info('Tenant provisioned', { tenantId: tenant.id, slug: tenant.slug });

    return { tenant, owner };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getTenants() {
  const { rows } = await adminPool.query(
    'SELECT id, name, slug, status, default_language, currency, timezone, billing_frequency, billing_amount, billing_method, signup_date, next_billing_date, created_at, updated_at FROM sys_tenants ORDER BY created_at DESC',
  );
  return rows;
}

export async function getTenantById(id: string) {
  const { rows } = await adminPool.query('SELECT * FROM sys_tenants WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function updateTenantStatus(id: string, status: 'active' | 'suspended' | 'archived', userId: string) {
  const tenant = await getTenantById(id);
  if (!tenant) throw new Error('Tenant not found');

  // Enforce valid transitions
  const validTransitions: Record<string, string[]> = {
    active: ['suspended'],
    suspended: ['active', 'archived'],
    archived: [],
  };

  if (!validTransitions[tenant.status]?.includes(status)) {
    throw new Error(`Cannot transition from ${tenant.status} to ${status}`);
  }

  await adminPool.query('UPDATE sys_tenants SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);

  await logAudit({
    tenantId: id,
    userId,
    action: `tenant.${status}`,
    resourceType: 'tenant',
    resourceId: id,
    details: { previousStatus: tenant.status, newStatus: status },
  });

  return { ...tenant, status };
}
