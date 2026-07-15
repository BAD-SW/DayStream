-- Migration 050: Add category column to resources table and make resource_type_id optional.
-- Resources can now be created with just a category (room, equipment, facility) without requiring a type definition.

BEGIN;

-- Add category column
ALTER TABLE res_resources ADD COLUMN IF NOT EXISTS category VARCHAR(20);

-- Make resource_type_id nullable
ALTER TABLE res_resources ALTER COLUMN resource_type_id DROP NOT NULL;

-- Backfill category from resource_types for existing resources
UPDATE res_resources r
SET category = rt.category
FROM res_types rt
WHERE r.resource_type_id = rt.id AND r.category IS NULL;

COMMIT;
