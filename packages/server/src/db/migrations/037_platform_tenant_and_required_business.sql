-- Migration 037: Platform tenant/business/admin + enforce business_id NOT NULL on usr_users
--
-- Design decisions:
--   1. Every user MUST belong to a tenant AND a business.
--   2. A platform tenant + business "DayStream" houses system users.
--   3. When a new tenant is created, a default business with the same name is auto-created (application code).
--   4. System admin is seeded here so the platform is always bootstrapped.

BEGIN;

-- ============================================================
-- 1. Create the platform tenant "DayStream"
-- ============================================================
INSERT INTO sys_tenants (id, name, slug, status, default_language, currency, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'DayStream',
  'daystream',
  'active',
  'en',
  'EUR',
  'UTC'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Create the platform business "DayStream"
-- ============================================================
INSERT INTO sys_businesses (id, tenant_id, name, slug, status, default_language, currency, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'DayStream',
  'daystream',
  'active',
  'en',
  'EUR',
  'UTC'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. Create system admin role and user
--    Email: admin@daystream.app
--    Password: DayStream2026!
-- ============================================================

-- Ensure Super Admin role exists (originally from migration 002, but may have been cleared)
INSERT INTO usr_roles (id, tenant_id, name, permissions, is_system)
VALUES (
  '00000000-0000-0000-0000-000000000100',
  NULL,
  'Super Admin',
  '["*:*"]',
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO usr_users (id, tenant_id, business_id, email, first_name, last_name, password_hash, role, persona, status)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'admin@daystream.app',
  'System',
  'Admin',
  '$2b$12$x0zSkqP7EEq2j1FLLl7b2OGHat1nNP6XvOVtDQu6g4.4tIJ.4cfSy',
  'system_admin',
  'system',
  'active'
) ON CONFLICT (id) DO NOTHING;

-- Assign Super Admin role
INSERT INTO usr_user_roles (user_id, role_id, tenant_id)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000001'
) ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Backfill any existing users that have NULL business_id
-- ============================================================
UPDATE usr_users u
SET business_id = COALESCE(
  (SELECT b.id FROM sys_businesses b WHERE b.tenant_id = u.tenant_id AND b.status = 'active' ORDER BY b.created_at LIMIT 1),
  '00000000-0000-0000-0000-000000000002'
)
WHERE u.business_id IS NULL;

-- ============================================================
-- 5. Make business_id NOT NULL
-- ============================================================
ALTER TABLE usr_users ALTER COLUMN business_id SET NOT NULL;

COMMIT;
