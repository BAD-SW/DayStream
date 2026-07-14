-- Migration 047: Create merchandise (physical products) table.
-- Part of Phase 28: Products & Services consolidation.

BEGIN;

CREATE TABLE IF NOT EXISTS prd_merchandise (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  category_id UUID REFERENCES svc_categories(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  short_description VARCHAR(500),
  sku VARCHAR(50),
  price INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  image_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  tax_category_id UUID REFERENCES svc_tax_categories(id) ON DELETE SET NULL,
  created_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, sku)
);

-- Index for listing by business
CREATE INDEX IF NOT EXISTS idx_prd_merchandise_business ON prd_merchandise(business_id, status);

COMMIT;
