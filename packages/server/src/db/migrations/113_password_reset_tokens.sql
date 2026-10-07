-- Password reset tokens — backs the forgot-password / reset-password flow.
--
-- forgot-password generates a random token, stores only its SHA-256 hash here
-- (never the raw token), and emails the raw token in a link. reset-password
-- hashes the incoming token, looks up an unexpired + unused row, updates the
-- user's password, and marks the token used. Short-lived (15 min) and single-use.
BEGIN;

CREATE TABLE IF NOT EXISTS usr_password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES usr_users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL,          -- sha256 hex of the raw token
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,                   -- set when consumed; NULL = still valid
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookups are by token_hash; the partial expiry index helps the validate query.
CREATE UNIQUE INDEX IF NOT EXISTS usr_password_reset_tokens_hash_idx
  ON usr_password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS usr_password_reset_tokens_user_idx
  ON usr_password_reset_tokens (user_id);

COMMIT;
