-- Migration 121: Section B — Tenant Billing (Tenant → Business).
-- (spec phase 10, Section B: Requirements B1–B6.)
--
-- The direct mirror of Section A (migration 118) one level down: what a TENANT
-- charges each of its BUSINESSES, on a per-business negotiated plan (flat and/or
-- % of the business's net collections, optional per-cycle cap, intro period),
-- billed monthly in arrears and settled automatically against the business's
-- stored payment method. The "charging party owns the vault" model one level
-- down: tenant → business, so the charge routes through the TENANT's processor
-- connection (owner_level='tenant').
--
-- Tenant isolation is application-level (see db/pool.ts) — no Postgres RLS here.
-- Monetary values are integer cents. Percentage rates are stored as NUMERIC with
-- enough precision to express values like 1% or 2.5% (B1.10).
--
-- Suspension reuses the existing sys_businesses.status = 'suspended' state (B3.15):
-- a suspended business's charges are not retried. No new suspend column needed.
--
-- Reuses the scope-aware tables added in Section A:
--   pay_billing_charge_attempts (scope_level='tenant', business_id) — per-attempt audit
--   pay_customer_refs           (owner_level='business')            — Stripe Customer attach

BEGIN;

-- ------------------------------------------------------------
-- Business billing plans — VERSIONED (mirror of pay_tenant_billing_plans). A new
-- version is written on each change so historical charges remain explainable
-- after a plan changes (B1.15). The row with ended_at IS NULL is the current plan.
-- Keyed on business_id; tenant_id carried for isolation / fast tenant-wide reads.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_business_billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,

  -- Components (either MAY be zero; any combination allowed — B1.2–B1.4)
  flat_amount_cents INTEGER NOT NULL DEFAULT 0,          -- fixed amount per cycle
  percentage_rate NUMERIC(7,4) NOT NULL DEFAULT 0,       -- e.g. 2.5000 = 2.5% of net collections

  -- Optional per-cycle cap (B1.5–B1.6)
  cap_amount_cents INTEGER,                              -- NULL = no cap
  cap_applies_to VARCHAR(10) NOT NULL DEFAULT 'combined' -- cap the % alone or the flat+% total
    CHECK (cap_applies_to IN ('percentage', 'combined')),

  -- Intro period (B1.7): first N whole months use intro_flat_amount_cents / intro_percentage_rate
  intro_period_months INTEGER NOT NULL DEFAULT 0,
  intro_flat_amount_cents INTEGER NOT NULL DEFAULT 0,
  intro_percentage_rate NUMERIC(7,4) NOT NULL DEFAULT 0,

  billing_day INTEGER NOT NULL DEFAULT 1                 -- day-of-month the charge runs (B1.8); clamps to month end
    CHECK (billing_day BETWEEN 1 AND 31),
  plan_start_date DATE NOT NULL DEFAULT CURRENT_DATE,    -- anchors the intro-period count

  -- Version lifecycle: current version has ended_at NULL.
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,

  -- Audit (B1.14)
  created_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_business_billing_plans_business ON pay_business_billing_plans(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_business_billing_plans_tenant ON pay_business_billing_plans(tenant_id);
-- One current (un-ended) plan per business.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_business_billing_plans_current
  ON pay_business_billing_plans(business_id) WHERE ended_at IS NULL;

-- ------------------------------------------------------------
-- Business credits (B4) — tenant-issued, reduce current/future charges, carry
-- forward, never pay out. remaining_cents is drawn down as credits are applied.
-- (Mirror of pay_tenant_credits.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_business_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  remaining_cents INTEGER NOT NULL CHECK (remaining_cents >= 0),
  reason TEXT NOT NULL,                                  -- required (B4.1)
  status VARCHAR(10) NOT NULL DEFAULT 'active'           -- 'active' | 'exhausted'
    CHECK (status IN ('active', 'exhausted')),
  issued_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_business_credits_business ON pay_business_credits(business_id, status);

-- ------------------------------------------------------------
-- Per-business net collections summary per cycle (B2). Section B's percentage
-- component reads this for a single business (Section A's version sums across a
-- tenant's businesses). STUBBED until Section C (customer payments) populates it
-- — rows may be absent (treated as zero) for now.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_business_net_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  cycle_year INTEGER NOT NULL,
  cycle_month INTEGER NOT NULL CHECK (cycle_month BETWEEN 1 AND 12),
  net_amount_cents INTEGER NOT NULL DEFAULT 0,           -- net actually collected (never negative — B2.5)
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, cycle_year, cycle_month)
);

CREATE INDEX IF NOT EXISTS idx_pay_business_net_collections_cycle
  ON pay_business_net_collections(business_id, cycle_year, cycle_month);

-- ------------------------------------------------------------
-- Business billing charges (B5) — the per-business, per-cycle charge ledger.
-- Itemized and idempotent per (business, cycle). This is a charge RECORD, not a
-- receivable: it is settled automatically against the business's payment method.
-- (Mirror of pay_platform_billing_charges.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_business_billing_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES pay_business_billing_plans(id), -- the plan VERSION used (explainability)

  -- Billing cycle this charge is for (a calendar month, billed in arrears).
  cycle_year INTEGER NOT NULL,
  cycle_month INTEGER NOT NULL CHECK (cycle_month BETWEEN 1 AND 12),

  reference_number BIGINT NOT NULL,                      -- sequential, tenant-wide (B5.2)

  -- Itemization (B5.1)
  flat_component_cents INTEGER NOT NULL DEFAULT 0,
  net_collections_cents INTEGER NOT NULL DEFAULT 0,      -- the % basis for this cycle
  percentage_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  percentage_component_cents INTEGER NOT NULL DEFAULT 0,
  cap_applied_cents INTEGER,                             -- the cap value if one bound the charge
  credit_applied_cents INTEGER NOT NULL DEFAULT 0,
  amount_charged_cents INTEGER NOT NULL DEFAULT 0,       -- after cap + credits, floored at 0
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  credit_carried_forward_cents INTEGER NOT NULL DEFAULT 0,

  -- Settlement
  status VARCHAR(12) NOT NULL DEFAULT 'pending'          -- lifecycle below
    CHECK (status IN ('zero', 'pending', 'settled', 'failed', 'retrying')),
  provider_reference VARCHAR(255),                       -- adapter charge reference (card/bank)
  payment_method_id UUID REFERENCES pay_payment_methods(id),
  failure_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency: one charge per business per cycle (B3.11). Re-running the billing
  -- run never creates a duplicate; it finds and retries the existing row.
  UNIQUE (business_id, cycle_year, cycle_month)
);

CREATE INDEX IF NOT EXISTS idx_pay_business_charges_business ON pay_business_billing_charges(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_business_charges_tenant ON pay_business_billing_charges(tenant_id, created_at DESC);
-- Fast lookup of charges needing a retry (open failures) for the daily run.
CREATE INDEX IF NOT EXISTS idx_pay_business_charges_open
  ON pay_business_billing_charges(status) WHERE status IN ('failed', 'retrying', 'pending');
-- Resolve async settlement webhooks back to the originating charge.
CREATE INDEX IF NOT EXISTS idx_pay_business_charges_provider_ref
  ON pay_business_billing_charges(provider_reference) WHERE provider_reference IS NOT NULL;

-- Tenant-wide sequential reference numbers for business charge records (B5.2).
-- Separate sequence from the platform one so business charge references are their
-- own series.
CREATE SEQUENCE IF NOT EXISTS pay_business_billing_charge_ref_seq START 1000;

COMMIT;
