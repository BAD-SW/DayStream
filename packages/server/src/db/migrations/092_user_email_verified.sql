-- Migration 092: Add email_verified to usr_users.
-- Referenced by seed-config.sql / export-config.ts (added upstream without a matching migration).

ALTER TABLE usr_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN usr_users.email_verified IS 'Whether the user has verified their email address';
