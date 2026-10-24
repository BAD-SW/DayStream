-- Data Migration foundation (spec 50-data-migration, Wave 1).
--
-- Two additions:
--   1. cus_customers.legacy_customer_id — the id a customer held in the business's
--      previous system, captured during customer import. It is the preferred,
--      exact key for matching every other imported entity (payment methods,
--      memberships, appointments, …) back to its customer (Requirement 1.4 / 11).
--      Nullable: not every export provides it, in which case matching falls back
--      to the identity service (email, then unique phone).
--   2. mig_import_runs — one row per executed import (trial or commit), so the
--      Data Migration page can show a history of migration activity and a tenant
--      owner can see what was already done.
--
-- App-level tenant isolation (no RLS), consistent with the rest of the platform
-- (see spec 10 Phase 7.1 and db/pool.ts).

BEGIN;

-- 1. Legacy customer id (per business; a legacy id is only unique within the
--    source system, so scope uniqueness to the business).
ALTER TABLE cus_customers
  ADD COLUMN IF NOT EXISTS legacy_customer_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_cus_customers_legacy
  ON cus_customers(business_id, legacy_customer_id)
  WHERE legacy_customer_id IS NOT NULL;

-- 2. Import run history.
CREATE TABLE IF NOT EXISTS mig_import_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES sys_tenants(id)    ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  entity        VARCHAR(32) NOT NULL,   -- customers | payment_methods | memberships | packages | appointments | account_balances | transactions
  file_name     TEXT,
  total_rows    INTEGER NOT NULL DEFAULT 0,
  imported      INTEGER NOT NULL DEFAULT 0,
  matched       INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('running', 'completed', 'failed')),
  is_trial      BOOLEAN NOT NULL DEFAULT false,
  performed_by  UUID REFERENCES usr_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mig_import_runs_business
  ON mig_import_runs(business_id, created_at DESC);

COMMIT;
