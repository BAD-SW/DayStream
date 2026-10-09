-- Migration 118: Section A — Platform Billing (DayStream → Tenant).
-- (spec phase 10, Section A: Requirements A1–A6.)
--
-- What DayStream charges each tenant for the platform, on a per-tenant negotiated
-- plan (flat and/or % of net collections, optional per-cycle cap, intro period),
-- billed monthly in arrears and settled automatically against the tenant's stored
-- payment method (the "charging party owns the vault" model: tenant → platform).
--
-- Tenant isolation is application-level (see db/pool.ts) — no Postgres RLS here.
-- Monetary values are integer cents. Percentage rates are stored as NUMERIC with
-- enough precision to express values like 1% or 2.5% (A1.10).
--
-- Suspension reuses the existing sys_tenants.status = 'suspended' state (A3.15):
-- a suspended tenant's charges are not retried. No new suspend column needed.

BEGIN;

-- ------------------------------------------------------------
-- Tenant billing plans — VERSIONED. A new version is written on each change so
-- historical charges remain explainable after a plan changes (A1.15). The row
-- with ended_at IS NULL is the current plan for a tenant.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_tenant_billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,

  -- Components (either MAY be zero; any combination allowed — A1.2–A1.4)
  flat_amount_cents INTEGER NOT NULL DEFAULT 0,          -- fixed amount per cycle
  percentage_rate NUMERIC(7,4) NOT NULL DEFAULT 0,       -- e.g. 2.5000 = 2.5% of net collections

  -- Optional per-cycle cap (A1.5–A1.6)
  cap_amount_cents INTEGER,                              -- NULL = no cap
  cap_applies_to VARCHAR(10) NOT NULL DEFAULT 'combined' -- cap the % alone or the flat+% total
    CHECK (cap_applies_to IN ('percentage', 'combined')),

  -- Intro period (A1.7): first N whole months use intro_flat_amount_cents / intro_percentage_rate
  intro_period_months INTEGER NOT NULL DEFAULT 0,
  intro_flat_amount_cents INTEGER NOT NULL DEFAULT 0,
  intro_percentage_rate NUMERIC(7,4) NOT NULL DEFAULT 0,

  billing_day INTEGER NOT NULL DEFAULT 1                 -- day-of-month the charge runs (A1.8); clamps to month end
    CHECK (billing_day BETWEEN 1 AND 31),
  plan_start_date DATE NOT NULL DEFAULT CURRENT_DATE,    -- anchors the intro-period count

  -- Version lifecycle: current version has ended_at NULL.
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,

  -- Audit (A1.14)
  created_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_tenant_billing_plans_tenant ON pay_tenant_billing_plans(tenant_id);
-- One current (un-ended) plan per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_tenant_billing_plans_current
  ON pay_tenant_billing_plans(tenant_id) WHERE ended_at IS NULL;

-- ------------------------------------------------------------
-- Tenant credits (A4) — admin-issued, reduce current/future charges, carry
-- forward, never pay out. remaining_cents is drawn down as credits are applied.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_tenant_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  remaining_cents INTEGER NOT NULL CHECK (remaining_cents >= 0),
  reason TEXT NOT NULL,                                  -- required (A4.1)
  status VARCHAR(10) NOT NULL DEFAULT 'active'           -- 'active' | 'exhausted'
    CHECK (status IN ('active', 'exhausted')),
  issued_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_tenant_credits_tenant ON pay_tenant_credits(tenant_id, status);

-- ------------------------------------------------------------
-- Per-business net collections summary per cycle (A2). Section A's percentage
-- component sums these across a tenant's businesses. STUBBED until Section B
-- populates it — rows may be absent (treated as zero) for now.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_tenant_net_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  cycle_year INTEGER NOT NULL,
  cycle_month INTEGER NOT NULL CHECK (cycle_month BETWEEN 1 AND 12),
  net_amount_cents INTEGER NOT NULL DEFAULT 0,           -- net actually collected (never negative — A2.5)
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, business_id, cycle_year, cycle_month)
);

CREATE INDEX IF NOT EXISTS idx_pay_tenant_net_collections_cycle
  ON pay_tenant_net_collections(tenant_id, cycle_year, cycle_month);

-- ------------------------------------------------------------
-- Platform billing charges (A5) — the per-tenant, per-cycle charge ledger.
-- Itemized and idempotent per (tenant, cycle). This is a charge RECORD, not a
-- receivable: it is settled automatically against the tenant's payment method.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_platform_billing_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES pay_tenant_billing_plans(id),  -- the plan VERSION used (explainability)

  -- Billing cycle this charge is for (a calendar month, billed in arrears).
  cycle_year INTEGER NOT NULL,
  cycle_month INTEGER NOT NULL CHECK (cycle_month BETWEEN 1 AND 12),

  reference_number BIGINT NOT NULL,                      -- sequential, platform-wide (A5.2)

  -- Itemization (A5.1)
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

  -- Idempotency: one charge per tenant per cycle (A3.11). Re-running the billing
  -- run never creates a duplicate; it finds and retries the existing row.
  UNIQUE (tenant_id, cycle_year, cycle_month)
);

CREATE INDEX IF NOT EXISTS idx_pay_platform_charges_tenant ON pay_platform_billing_charges(tenant_id, created_at DESC);
-- Fast lookup of charges needing a retry (open failures) for the daily run.
CREATE INDEX IF NOT EXISTS idx_pay_platform_charges_open
  ON pay_platform_billing_charges(status) WHERE status IN ('failed', 'retrying', 'pending');
-- Resolve async settlement webhooks back to the originating charge.
CREATE INDEX IF NOT EXISTS idx_pay_platform_charges_provider_ref
  ON pay_platform_billing_charges(provider_reference) WHERE provider_reference IS NOT NULL;

-- Platform-wide sequential reference numbers for charge records (A5.2).
CREATE SEQUENCE IF NOT EXISTS pay_platform_billing_charge_ref_seq START 1000;

COMMIT;
