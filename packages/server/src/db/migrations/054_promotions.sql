-- Migration 054: Promotions table for time-limited price adjustments.

BEGIN;

CREATE TABLE IF NOT EXISTS prm_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Discount/premium type and value
  type VARCHAR(30) NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  -- Promo code (optional — if null, applies automatically when conditions match)
  promo_code VARCHAR(50),
  -- Date/time conditions
  date_from DATE,
  date_to DATE,
  days_of_week INTEGER[],
  time_from TIME,
  time_to TIME,
  -- Scope: what it applies to (null = all items)
  applies_to VARCHAR(20) NOT NULL DEFAULT 'all',
  service_ids UUID[],
  merchandise_ids UUID[],
  category_ids UUID[],
  -- Limits
  max_redemptions INTEGER,
  max_per_customer INTEGER,
  redemption_count INTEGER NOT NULL DEFAULT 0,
  -- Priority and stacking
  priority INTEGER NOT NULL DEFAULT 0,
  stackable BOOLEAN NOT NULL DEFAULT false,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prm_promotions_business ON prm_promotions(business_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prm_promotions_code ON prm_promotions(business_id, promo_code) WHERE promo_code IS NOT NULL;

COMMIT;
