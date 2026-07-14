-- Migration 049: Add is_taxable flag to merchandise and services.
-- Products/services must explicitly declare if they are taxable.

BEGIN;

ALTER TABLE prd_merchandise ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE svc_services ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT false;

COMMIT;
