-- Migration 045: Business-level payment method configuration.
-- Each business defines which payment methods they accept.
-- Google Pay and Apple Pay are integration-only (not manual entry) but valid for refunds.

BEGIN;

CREATE TABLE IF NOT EXISTS pay_accepted_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, method)
);

-- Seed default methods for existing businesses (all enabled except digital wallets)
INSERT INTO pay_accepted_methods (business_id, method, enabled)
SELECT b.id, m.method, m.enabled
FROM sys_businesses b
CROSS JOIN (VALUES
  ('cash', true),
  ('card', true),
  ('bank_transfer', true),
  ('check', true),
  ('gift_card', true),
  ('other', true),
  ('google_pay', false),
  ('apple_pay', false)
) AS m(method, enabled)
ON CONFLICT (business_id, method) DO NOTHING;

COMMIT;
