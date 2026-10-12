-- Migration 135: Grant system roles the permissions their business modules require.
--
-- Marketing, Website (CMS), Integrations, Check-In, Events and Community routes each
-- check their own permission resource, but no system role below Tenant Owner held any
-- of them, so a Business Owner got 403 on screens the navigation offers.
-- Additive: existing permissions (including per-tenant customisations) are kept.

BEGIN;

UPDATE usr_roles r
SET permissions = (
  SELECT jsonb_agg(DISTINCT p)
  FROM jsonb_array_elements_text(
    r.permissions || '["resources:*","marketing:*","cms:*","integrations:*","checkin:*","events:*","community:*"]'::jsonb
  ) AS p
)
WHERE r.name = 'Business Owner' AND r.is_system = true;

UPDATE usr_roles r
SET permissions = (
  SELECT jsonb_agg(DISTINCT p)
  FROM jsonb_array_elements_text(r.permissions || '["checkin:*","events:read"]'::jsonb) AS p
)
WHERE r.name = 'Manager' AND r.is_system = true;

UPDATE usr_roles r
SET permissions = (
  SELECT jsonb_agg(DISTINCT p)
  FROM jsonb_array_elements_text(r.permissions || '["checkin:*","events:read"]'::jsonb) AS p
)
WHERE r.name = 'Staff' AND r.is_system = true;

COMMIT;
