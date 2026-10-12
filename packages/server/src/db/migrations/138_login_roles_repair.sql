-- Repair logins whose role assignment (usr_user_roles) does not match who they are.
-- A login token takes its role name and permissions from usr_user_roles, and the screens
-- decide what to show from that role name. Two cases were wrong:
--
--   1. A tenant owner holding the "Business Owner" role: after a page reload they were shown
--      the business menu instead of the tenant one. Seen on tenants created before the
--      "Tenant Owner" role existed, and on the seeded tenant (the seed matched any role whose
--      name contained "owner").
--   2. Staff created from Business Setup, who were given no role at all: their token said
--      "customer" and carried no permissions.
--
-- Every statement is safe to run again.

-- Every tenant has a Tenant Owner role.
INSERT INTO usr_roles (tenant_id, name, permissions, is_system)
SELECT t.id, 'Tenant Owner', '["*:*"]'::jsonb, true
  FROM sys_tenants t
 WHERE NOT EXISTS (SELECT 1 FROM usr_roles r WHERE r.tenant_id = t.id AND r.name = 'Tenant Owner');

-- Tenant owners hold it, and only it.
DELETE FROM usr_user_roles ur
 USING usr_users u, usr_roles r
 WHERE ur.user_id = u.id AND r.id = ur.role_id
   AND u.role = 'tenant_owner' AND r.name <> 'Tenant Owner';

INSERT INTO usr_user_roles (user_id, role_id, tenant_id)
SELECT u.id, r.id, u.tenant_id
  FROM usr_users u
  JOIN usr_roles r ON r.tenant_id = u.tenant_id AND r.name = 'Tenant Owner'
 WHERE u.role = 'tenant_owner'
   AND NOT EXISTS (SELECT 1 FROM usr_user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id);

-- Business logins without any role get the one for their job: the tenant's own role when it
-- has one, otherwise the shared system role (tenant_id NULL) of that name.
INSERT INTO usr_user_roles (user_id, role_id, tenant_id)
SELECT u.id,
       (SELECT r.id FROM usr_roles r
         WHERE r.name = j.role_name AND (r.tenant_id = u.tenant_id OR r.tenant_id IS NULL)
         ORDER BY (r.tenant_id IS NULL), r.created_at LIMIT 1),
       u.tenant_id
  FROM usr_users u
 CROSS JOIN LATERAL (SELECT CASE
         WHEN u.role = 'business_owner' THEN 'Business Owner'
         WHEN u.role IN ('manager', 'business_manager') THEN 'Manager'
         ELSE 'Staff'
       END AS role_name) j
 WHERE u.persona = 'business'
   AND NOT EXISTS (SELECT 1 FROM usr_user_roles ur WHERE ur.user_id = u.id)
   AND EXISTS (SELECT 1 FROM usr_roles r WHERE r.name = j.role_name AND (r.tenant_id = u.tenant_id OR r.tenant_id IS NULL));
