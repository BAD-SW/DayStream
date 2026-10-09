-- Migration 120: Per-attempt billing audit (spec phase 10, Section A reporting).
--
-- Each time a billing charge is attempted (by a scheduled run or a manual
-- "charge now"), we record one row here. This gives a true audit trail of
-- retries and lets the reporting UI drill from a run into exactly the charges
-- that run attempted — which the charge row alone can't express (a charge can be
-- touched by several runs: created failed in one, retried/settled in a later one).
--
-- Scope-aware so Section B (tenant → business) reuses the same table: platform
-- charges reference pay_platform_billing_charges; the business-level charge table
-- (Section B) will reference its own rows under scope_level = 'tenant'.
-- App-level isolation (see db/pool.ts) — no RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS pay_billing_charge_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which run attempted it (NULL for a manual "charge now"). FK to the scheduler's
  -- execution log so a run row maps directly to its attempts.
  run_execution_id UUID REFERENCES sys_job_executions(id) ON DELETE SET NULL,
  trigger VARCHAR(10) NOT NULL DEFAULT 'scheduled'   -- 'scheduled' | 'manual'
    CHECK (trigger IN ('scheduled', 'manual')),

  -- Which billing level this attempt belongs to (A = platform, B = tenant).
  scope_level VARCHAR(10) NOT NULL DEFAULT 'platform'
    CHECK (scope_level IN ('platform', 'tenant')),

  -- The charge this attempt is against. For scope_level='platform' this is a
  -- pay_platform_billing_charges.id; for 'tenant' (Section B) it will be that
  -- layer's charge id. Kept as a bare UUID (not a hard FK) so one table serves
  -- both levels; the charge tables themselves enforce their own integrity.
  charge_id UUID NOT NULL,

  -- Denormalized context for fast reporting without re-joining the charge.
  tenant_id UUID REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,  -- Section B
  cycle_year INTEGER NOT NULL,
  cycle_month INTEGER NOT NULL CHECK (cycle_month BETWEEN 1 AND 12),

  outcome VARCHAR(12) NOT NULL                       -- result of THIS attempt
    CHECK (outcome IN ('settled', 'pending', 'failed', 'zero')),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  provider_reference VARCHAR(255),
  failure_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_attempts_run ON pay_billing_charge_attempts(run_execution_id);
CREATE INDEX IF NOT EXISTS idx_billing_attempts_charge ON pay_billing_charge_attempts(charge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_attempts_tenant ON pay_billing_charge_attempts(tenant_id, created_at DESC);

COMMIT;
