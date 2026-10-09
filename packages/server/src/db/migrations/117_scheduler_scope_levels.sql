-- Migration 117: Scope levels for the job scheduler (spec phase 10, Section A).
--
-- The scheduler was built per-business (business_id NOT NULL, one job per
-- business+type). The payment platform needs a SINGLE platform-level schedule
-- that processes all tenants (Section A), and later a per-tenant schedule for
-- businesses (Section B) and the existing per-business schedule for customers
-- (Section C). This adds an explicit scope level so all three fit one mechanism.
--
--   scope_level = 'business' : existing per-business jobs (business_id required)
--   scope_level = 'tenant'   : one job per tenant      (tenant_id required, no business)
--   scope_level = 'platform' : one job for DayStream   (no tenant, no business)

BEGIN;

-- 1. Add the scope level; existing rows are business-scoped.
ALTER TABLE sys_scheduled_jobs
  ADD COLUMN IF NOT EXISTS scope_level VARCHAR(10) NOT NULL DEFAULT 'business'
    CHECK (scope_level IN ('platform', 'tenant', 'business'));

-- 2. Platform/tenant jobs have no business; tenant/platform may have no tenant.
ALTER TABLE sys_scheduled_jobs ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE sys_scheduled_jobs ALTER COLUMN tenant_id DROP NOT NULL;

-- 3. Integrity per scope: required ids present for the level they belong to.
ALTER TABLE sys_scheduled_jobs
  ADD CONSTRAINT chk_sched_jobs_scope_ids CHECK (
    (scope_level = 'business' AND business_id IS NOT NULL AND tenant_id IS NOT NULL)
    OR (scope_level = 'tenant' AND tenant_id IS NOT NULL AND business_id IS NULL)
    OR (scope_level = 'platform' AND tenant_id IS NULL AND business_id IS NULL)
  );

-- 4. Replace the old UNIQUE(business_id, job_type) with scope-aware uniqueness:
--    one job per (type) at the platform level, per (tenant, type) at the tenant
--    level, and per (business, type) at the business level. Partial unique
--    indexes handle the NULLs each scope carries.
DROP INDEX IF EXISTS idx_scheduled_jobs_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_jobs_platform_unique
  ON sys_scheduled_jobs(job_type)
  WHERE scope_level = 'platform';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_jobs_tenant_unique
  ON sys_scheduled_jobs(tenant_id, job_type)
  WHERE scope_level = 'tenant';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_jobs_business_unique
  ON sys_scheduled_jobs(business_id, job_type)
  WHERE scope_level = 'business';

-- 5. Execution history must also accept platform/tenant jobs (no business_id).
ALTER TABLE sys_job_executions ALTER COLUMN business_id DROP NOT NULL;

COMMIT;
