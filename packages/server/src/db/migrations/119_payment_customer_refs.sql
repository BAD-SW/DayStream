-- Migration 119: Provider customer references (spec phase 10, Section 0 correction).
--
-- To charge a vaulted payment method OFF-SESSION (recurring billing), Stripe
-- requires the payment method be attached to a Stripe Customer. Phase 1 captured
-- methods with bare SetupIntents (no customer), so stored tokens could be vaulted
-- but not charged. This table records the provider-side Customer id for each
-- owner (per charging party / provider), created at capture and reused on charge.
--
-- Keyed by the OWNER whose instrument is stored (tenant / business / customer),
-- matching pay_payment_methods' owner model. One customer per owner per provider.
-- App-level isolation (see db/pool.ts) — no RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS pay_customer_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_level VARCHAR(10) NOT NULL CHECK (owner_level IN ('platform', 'tenant', 'business', 'customer')),
  tenant_id UUID REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES cus_customers(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL DEFAULT 'stripe',
  provider_customer_id VARCHAR(255) NOT NULL,     -- e.g. Stripe 'cus_...'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One provider customer per owner, per provider. COALESCE sentinels handle the
-- NULLs each owner level carries (same pattern as pay_processor_connections).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_customer_refs_owner
  ON pay_customer_refs(
    owner_level, provider,
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

COMMIT;
