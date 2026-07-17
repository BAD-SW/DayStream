-- Migration 062: Add business_id to res_resources and res_types for business-level isolation.
-- Resources belong to a specific business, not shared across all businesses in a tenant.

BEGIN;

-- Add business_id column to resources
ALTER TABLE res_resources ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE;

-- Add business_id column to resource types
ALTER TABLE res_types ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE;

-- Backfill: assign existing resources to the first business in their tenant
UPDATE res_resources r
SET business_id = (
  SELECT b.id FROM sys_businesses b WHERE b.tenant_id = r.tenant_id LIMIT 1
)
WHERE r.business_id IS NULL;

UPDATE res_types rt
SET business_id = (
  SELECT b.id FROM sys_businesses b WHERE b.tenant_id = rt.tenant_id LIMIT 1
)
WHERE rt.business_id IS NULL;

-- Make business_id NOT NULL after backfill
ALTER TABLE res_resources ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE res_types ALTER COLUMN business_id SET NOT NULL;

-- Add indexes for business-scoped queries
CREATE INDEX IF NOT EXISTS idx_resources_business ON res_resources(business_id);
CREATE INDEX IF NOT EXISTS idx_resources_business_status ON res_resources(business_id, status);
CREATE INDEX IF NOT EXISTS idx_resource_types_business ON res_types(business_id);

COMMIT;
