-- Migration 048: Add merchandise variants table and pause status support.

BEGIN;

-- Merchandise variants (size, color, etc.)
CREATE TABLE IF NOT EXISTS prd_merchandise_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchandise_id UUID NOT NULL REFERENCES prd_merchandise(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sku VARCHAR(50),
  price INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prd_merchandise_variants_merch ON prd_merchandise_variants(merchandise_id);

-- Allow 'paused' as a valid status for merchandise (already a text field, no constraint change needed)
-- Just documenting that valid statuses are: active, paused, archived

COMMIT;
