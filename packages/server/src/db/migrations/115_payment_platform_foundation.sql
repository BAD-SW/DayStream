-- Migration 115: Payment Platform foundation (spec phase 10, tasks 1.1).
-- Provider abstraction support + tokenized payment-method vault.
--
-- Tenant isolation is application-level (see db/pool.ts), so no Postgres RLS policies
-- are added here; every table carries tenant_id (and business_id where business-scoped)
-- and callers scope queries accordingly. Monetary values are integer cents elsewhere;
-- no raw card/bank credentials are ever stored here — only provider vault tokens.

BEGIN;

-- ------------------------------------------------------------
-- Processor connections: a connected provider account held at the
-- platform (DayStream), tenant, or business level. Starts with Stripe.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_processor_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES sys_tenants(id) ON DELETE CASCADE,       -- NULL for platform-level
  business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,  -- set for business-level
  owner_level VARCHAR(10) NOT NULL CHECK (owner_level IN ('platform', 'tenant', 'business')),
  provider VARCHAR(30) NOT NULL DEFAULT 'stripe',
  provider_account_ref VARCHAR(255),        -- provider-side account id; never secrets
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_processor_connections_tenant ON pay_processor_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pay_processor_connections_business ON pay_processor_connections(business_id);
-- Exactly one connection per owning entity at each level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_processor_connections_owner
  ON pay_processor_connections(owner_level, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ------------------------------------------------------------
-- Payment methods: tokenized instruments stored for each layer.
-- Used as Tenant_Payment_Account (A), Business_Payment_Account (B),
-- and customer stored methods (C). NO raw credentials — only vault tokens.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES sys_tenants(id) ON DELETE CASCADE,       -- NULL for platform-level
  owner_level VARCHAR(10) NOT NULL CHECK (owner_level IN ('platform', 'tenant', 'business', 'customer')),
  business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,  -- set for business/customer scope
  customer_id UUID REFERENCES cus_customers(id) ON DELETE CASCADE,   -- set when owner_level = 'customer'
  method_type VARCHAR(20) NOT NULL CHECK (method_type IN ('card', 'bank_draw', 'google_pay', 'apple_pay')),
  provider VARCHAR(30) NOT NULL DEFAULT 'stripe',
  provider_token VARCHAR(255) NOT NULL,     -- vault token, NOT the raw instrument
  display_brand VARCHAR(40),                -- e.g. 'Visa', 'SEPA'
  display_last4 VARCHAR(4),
  exp_month SMALLINT,                        -- card only
  exp_year SMALLINT,                         -- card only
  is_default BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_payment_methods_tenant ON pay_payment_methods(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pay_payment_methods_business ON pay_payment_methods(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_payment_methods_customer ON pay_payment_methods(customer_id) WHERE owner_level = 'customer';
CREATE INDEX IF NOT EXISTS idx_pay_payment_methods_active ON pay_payment_methods(owner_level, status) WHERE status = 'active';

-- ------------------------------------------------------------
-- Extend accepted methods (migration 045) with the new processed
-- pull method 'bank_draw' (ACH/SEPA direct debit). The existing
-- 'bank_transfer' remains the manual/record push method.
-- ------------------------------------------------------------
INSERT INTO pay_accepted_methods (business_id, method, enabled)
SELECT b.id, 'bank_draw', false
FROM sys_businesses b
ON CONFLICT (business_id, method) DO NOTHING;

COMMIT;
