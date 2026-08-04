-- Add default credited_to at the order level
-- Line items inherit this unless overridden individually

BEGIN;

ALTER TABLE fin_orders ADD COLUMN IF NOT EXISTS credited_to UUID REFERENCES usr_users(id);

COMMIT;
