-- Phase 44 (Language Support), requirement 2: the language a person chose in the menu bar, saved on
-- their account so it follows them to every device. NULL means not chosen: the device's language is
-- used. Validated against the shared supported list when written (no CHECK constraint, so publishing
-- a language needs no migration). usr_users already has tenant_id and its RLS policy.
BEGIN;

ALTER TABLE usr_users
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10);

COMMIT;
