-- Migration 123: Allow tenant/system/customer users to have NO business.
--
-- Migration 037 made usr_users.business_id NOT NULL ("every user must belong to a
-- business") and the app auto-created a default business per tenant to satisfy it.
-- The product model has since changed: a TENANT is created with NO businesses — the
-- tenant owner cultivates and signs up businesses themselves afterward. So a tenant
-- owner must be able to exist with business_id = NULL.
--
-- This restores the persona model documented back in migration 006:
--   system   → business_id NULL (platform admin)
--   tenant   → business_id NULL (manages the tenant and all its businesses)
--   business → business_id SET  (works within a specific business)
--   customer → business_id NULL (can use multiple businesses within the tenant)
--
-- We relax the NOT NULL but keep integrity for business users via a persona-scoped
-- CHECK: a 'business'-persona user still MUST have a business_id. Other personas may
-- have one (legacy rows created under the old auto-business model remain valid) or not.

BEGIN;

-- 1. Allow NULL business_id again.
ALTER TABLE usr_users ALTER COLUMN business_id DROP NOT NULL;

-- 2. Business-persona users must still be anchored to a business. Other personas
--    may be null (the point of this migration) or carry a legacy business_id.
ALTER TABLE usr_users
  ADD CONSTRAINT chk_usr_users_business_persona
  CHECK (persona <> 'business' OR business_id IS NOT NULL);

COMMIT;
