-- Migration 122: Tenant receiving/billing bank account (spec phase 10, Section B).
--
-- The tenant-level mirror of DayStream's "Platform Receiving Account" (stored in
-- sys_system_configurations category 'platform-billing'). This is the TENANT's own
-- bank account where its businesses' payments are deposited — entered by the tenant
-- itself in the tenant Configuration area. One record per tenant.
--
-- Separate from the ENCRYPTED processor credentials (pay_processor_connections /
-- processor-config.service): this is plain bank-account display detail, the same
-- shape as the platform receiving account, not provider secrets.
--
-- App-level tenant isolation (see db/pool.ts) — no Postgres RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS pay_tenant_billing_accounts (
  tenant_id UUID PRIMARY KEY REFERENCES sys_tenants(id) ON DELETE CASCADE,
  bank_name VARCHAR(255),
  account_holder VARCHAR(255),
  account_number VARCHAR(255),
  routing_number VARCHAR(255),
  iban VARCHAR(255),
  swift VARCHAR(255),
  updated_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
