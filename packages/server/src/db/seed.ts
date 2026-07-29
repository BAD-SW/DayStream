import bcrypt from 'bcrypt';
import { adminPool } from './pool';

// Fixed seed UUIDs for idempotent seeding
const SEED_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SEED_BUSINESS_ID = '00000000-0000-0000-0000-000000000002';
const SEED_USERS: Record<string, { id: string; email: string; firstName: string; lastName: string; role: string; persona: string }> = {
  owner: {
    id: '00000000-0000-0000-0000-000000000010',
    email: 'owner@transcend.test',
    firstName: 'Maria',
    lastName: 'García',
    role: 'business_owner',
    persona: 'business',
  },
  manager: {
    id: '00000000-0000-0000-0000-000000000011',
    email: 'manager@transcend.test',
    firstName: 'Carlos',
    lastName: 'López',
    role: 'manager',
    persona: 'business',
  },
  reception: {
    id: '00000000-0000-0000-0000-000000000012',
    email: 'reception@transcend.test',
    firstName: 'Ana',
    lastName: 'Martínez',
    role: 'reception',
    persona: 'business',
  },
  therapist: {
    id: '00000000-0000-0000-0000-000000000013',
    email: 'therapist@transcend.test',
    firstName: 'Javier',
    lastName: 'Ruiz',
    role: 'therapist',
    persona: 'business',
  },
  trainer: {
    id: '00000000-0000-0000-0000-000000000014',
    email: 'trainer@transcend.test',
    firstName: 'Laura',
    lastName: 'Fernández',
    role: 'trainer',
    persona: 'business',
  },
  customer: {
    id: '00000000-0000-0000-0000-000000000015',
    email: 'customer@transcend.test',
    firstName: 'James',
    lastName: 'Wilson',
    role: 'customer',
    persona: 'customer',
  },
  // Persona test accounts
  systemUser: {
    id: '00000000-0000-0000-0000-000000000020',
    email: 'system@daystream.test',
    firstName: 'System',
    lastName: 'Admin',
    role: 'system_admin',
    persona: 'system',
  },
  tenantUser: {
    id: '00000000-0000-0000-0000-000000000021',
    email: 'tenant@daystream.test',
    firstName: 'Tenant',
    lastName: 'Owner',
    role: 'tenant_owner',
    persona: 'tenant',
  },
  businessUser: {
    id: '00000000-0000-0000-0000-000000000022',
    email: 'business@daystream.test',
    firstName: 'Business',
    lastName: 'Owner',
    role: 'business_owner',
    persona: 'business',
  },
  customerUser: {
    id: '00000000-0000-0000-0000-000000000023',
    email: 'customer@daystream.test',
    firstName: 'Customer',
    lastName: 'User',
    role: 'customer',
    persona: 'customer',
  },
};

/**
 * Simple password hashing using Node.js built-in crypto.
 * Phase 02 will introduce bcrypt for production-grade hashing.
 */
function hashPassword(password: string): string {
  const salt = 'daystream_dev_salt';
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

async function seed() {
  const client = await adminPool.connect();

  try {
    await client.query('BEGIN');

    // Clear existing seed data
    await client.query('DELETE FROM usr_login_attempts WHERE tenant_id = $1', [SEED_TENANT_ID]);
    await client.query('DELETE FROM usr_refresh_tokens WHERE user_id IN (SELECT id FROM usr_users WHERE tenant_id = $1)', [SEED_TENANT_ID]);
    await client.query('DELETE FROM usr_password_history WHERE user_id IN (SELECT id FROM usr_users WHERE tenant_id = $1)', [SEED_TENANT_ID]);
    await client.query('DELETE FROM sys_tenant_configurations WHERE tenant_id = $1', [SEED_TENANT_ID]);
    await client.query('DELETE FROM usr_user_roles WHERE tenant_id = $1', [SEED_TENANT_ID]);
    await client.query('DELETE FROM usr_users WHERE tenant_id = $1', [SEED_TENANT_ID]);
    await client.query('DELETE FROM sys_tenants WHERE id = $1', [SEED_TENANT_ID]);

    // Insert platform tenant (DayStream) — required by migration 037
    await client.query(
      `INSERT INTO sys_tenants (id, name, slug, status, default_language, currency, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [SEED_TENANT_ID, 'DayStream', 'daystream', 'active', 'en', 'EUR', 'UTC'],
    );

    // Insert platform business (DayStream) — required as FK for usr_users.business_id
    await client.query(
      `INSERT INTO sys_businesses (id, tenant_id, name, slug, status, default_language, currency, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [SEED_BUSINESS_ID, SEED_TENANT_ID, 'DayStream', 'daystream', 'active', 'en', 'EUR', 'UTC'],
    );

    // Hash password with bcrypt (same as auth service)
    const passwordHash = await bcrypt.hash('password123', 12);
    let userCount = 0;

    // Role mapping to system role IDs from migration 002
    const roleMap: Record<string, string> = {
      system_admin: '00000000-0000-0000-0000-000000000100',
      system_support: '00000000-0000-0000-0000-000000000100',
      tenant_owner: '00000000-0000-0000-0000-000000000101',
      tenant_manager: '00000000-0000-0000-0000-000000000102',
      business_owner: '00000000-0000-0000-0000-000000000101',
      manager: '00000000-0000-0000-0000-000000000102',
      reception: '00000000-0000-0000-0000-000000000103',
      therapist: '00000000-0000-0000-0000-000000000103',
      trainer: '00000000-0000-0000-0000-000000000103',
      customer: '00000000-0000-0000-0000-000000000104',
    };

    for (const [, user] of Object.entries(SEED_USERS)) {
      await client.query(
        `INSERT INTO usr_users (id, tenant_id, business_id, email, first_name, last_name, password_hash, role, persona, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
        [user.id, SEED_TENANT_ID, SEED_BUSINESS_ID, user.email, user.firstName, user.lastName, passwordHash, user.role, user.persona],
      );

      // Assign role in user_roles table
      const roleId = roleMap[user.role];
      if (roleId) {
        await client.query(
          `INSERT INTO usr_user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
          [user.id, roleId, SEED_TENANT_ID],
        );
      }

      userCount++;
    }

    await client.query('COMMIT');
    console.log(`\n  ✓ Seed complete: 1 tenant, ${userCount} users`);
    console.log('  Tenant: Transcend Health Mallorca (transcend)');
    console.log('  Password for all users: password123\n');
  } catch (err: any) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await adminPool.end();
  }
}

console.log('\n🌱 Seeding database...\n');
seed()
  .then(() => {
    console.log('✓ Seed complete.\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗ Seed failed:', err.message);
    process.exit(1);
  });
