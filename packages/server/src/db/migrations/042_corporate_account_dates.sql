-- Migration 042: Add agreement dates and status to corporate accounts.

BEGIN;

ALTER TABLE pri_corporate_accounts ADD COLUMN IF NOT EXISTS agreement_start DATE;
ALTER TABLE pri_corporate_accounts ADD COLUMN IF NOT EXISTS agreement_end DATE;
ALTER TABLE pri_corporate_accounts ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive'));

COMMIT;
