-- Migration 116: Provider configuration storage on processor connections
-- (spec phase 10, Phase 1 UI correction).
--
-- Each connection (platform/tenant/business) stores the selected provider's
-- configuration. Non-secret fields live in config_json; secret fields (API keys,
-- webhook signing secrets) are encrypted as a single AES-256-GCM blob via
-- utils/encryption.ts (ENCRYPTION_KEY) and never returned to clients in the clear.

BEGIN;

ALTER TABLE pay_processor_connections
  ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{}',   -- non-secret provider config (e.g. mode, publishable key)
  ADD COLUMN IF NOT EXISTS secrets_encrypted TEXT,                    -- AES-256-GCM blob of the secret fields (iv:authTag:ciphertext)
  ADD COLUMN IF NOT EXISTS config_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS config_updated_by UUID REFERENCES usr_users(id);

COMMIT;
