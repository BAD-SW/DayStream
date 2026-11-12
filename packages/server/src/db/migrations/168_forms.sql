-- Migration 168: forms, waivers and e-signature (spec 51, gap 1).
--
-- frm_forms        a form a business builds (one row per language version, shared group_id)
-- frm_requests     a request to complete a form (secure link, or a session on a device)
-- frm_submissions  a completed form: a reference to its PDF and the facts of the signing.
--                  The answers are never stored; only the PDF in file storage.
-- sys_storage_cleanup  files/folders whose deletion failed (storage unreachable); retried by a job.
--
-- Isolation is enforced in the application (tenant_id / business_id on every query).

BEGIN;

CREATE TABLE IF NOT EXISTS frm_forms (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  business_id        UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  group_id           UUID NOT NULL,
  name               VARCHAR(200) NOT NULL,
  language           VARCHAR(10),
  definition         JSONB NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  applies            JSONB NOT NULL DEFAULT '{}',
  renew_after_months INTEGER CHECK (renew_after_months IS NULL OR renew_after_months > 0),
  is_active          BOOLEAN NOT NULL DEFAULT true,
  status             VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by         UUID,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- One version per language within a group; NULL language (the default version) counts as one value.
CREATE UNIQUE INDEX IF NOT EXISTS uq_frm_forms_group_language
  ON frm_forms (group_id, COALESCE(language, ''));
CREATE INDEX IF NOT EXISTS idx_frm_forms_business_status ON frm_forms (business_id, status);

CREATE TABLE IF NOT EXISTS frm_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  business_id  UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  group_id     UUID NOT NULL,
  booking_id   UUID,
  channel      VARCHAR(16) NOT NULL CHECK (channel IN ('device', 'email')),
  token_hash   VARCHAR(64) NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),
  created_by   UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_frm_requests_customer_status ON frm_requests (customer_id, status);

CREATE TABLE IF NOT EXISTS frm_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  business_id       UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  form_id           UUID NOT NULL,
  group_id          UUID NOT NULL,
  form_version      INTEGER NOT NULL,
  form_name         VARCHAR(200) NOT NULL,
  language          VARCHAR(10),
  request_id        UUID,
  booking_id        UUID,
  completed_via     VARCHAR(16) NOT NULL CHECK (completed_via IN ('device', 'link', 'staff')),
  completed_by_user UUID,
  signed            BOOLEAN NOT NULL,
  signed_at         TIMESTAMPTZ,
  ip_address        INET,
  user_agent        TEXT,
  storage_path      VARCHAR(500) NOT NULL,
  size_bytes        INTEGER NOT NULL,
  sha256            VARCHAR(64) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_frm_submissions_customer_group
  ON frm_submissions (customer_id, group_id, signed_at DESC);

CREATE TABLE IF NOT EXISTS sys_storage_cleanup (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID,
  path         VARCHAR(500) NOT NULL,
  kind         VARCHAR(12) NOT NULL DEFAULT 'directory' CHECK (kind IN ('file', 'directory')),
  reason       VARCHAR(100) NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_attempt TIMESTAMPTZ,
  UNIQUE (path, kind)
);

COMMIT;
