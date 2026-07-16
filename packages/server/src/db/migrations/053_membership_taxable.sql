-- Migration 053: Add taxable fields to membership plans.

BEGIN;

ALTER TABLE mbr_plans ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mbr_plans ADD COLUMN IF NOT EXISTS tax_category_id UUID REFERENCES svc_tax_categories(id) ON DELETE SET NULL;

COMMIT;
