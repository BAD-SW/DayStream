-- Spec 51, gap 2: treatment charting.
-- Chart templates share frm_forms (kind = 'chart'); a chart is a filled-in template about a customer.
-- Isolation is application-level (tenant_id / business_id on every query), like the forms tables.
BEGIN;

ALTER TABLE frm_forms
  ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'form' CHECK (kind IN ('form', 'chart'));
CREATE INDEX IF NOT EXISTS idx_frm_forms_business_kind ON frm_forms (business_id, kind, status);

-- A service can name the chart template suggested for its bookings (the template's group_id).
ALTER TABLE svc_services ADD COLUMN IF NOT EXISTS default_chart_group_id UUID;

CREATE TABLE IF NOT EXISTS chr_charts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  business_id          UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id          UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  booking_id           UUID,
  form_id              UUID,
  form_name            VARCHAR(200) NOT NULL,
  form_version         INTEGER NOT NULL,
  -- The template as it was when the chart was started, encrypted, so later template edits change nothing.
  definition_encrypted TEXT NOT NULL,
  answers_encrypted    TEXT NOT NULL,
  status               VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed')),
  created_by           UUID,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  signed_by            UUID,
  signed_at            TIMESTAMPTZ,
  pdf_path             VARCHAR(500),
  pdf_sha256           VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_chr_charts_customer ON chr_charts (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chr_charts_booking ON chr_charts (booking_id);

-- Append only: an amendment is never edited or removed (except with its chart).
CREATE TABLE IF NOT EXISTS chr_amendments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  business_id       UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  chart_id          UUID NOT NULL REFERENCES chr_charts(id) ON DELETE CASCADE,
  content_encrypted TEXT NOT NULL,
  created_by        UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chr_amendments_chart ON chr_amendments (chart_id, created_at);

-- Clinical permission for the roles that hold business-wide authority. Therapists and trainers
-- share the Staff role with reception, so they are admitted by their job title instead
-- (see auth/clinical.ts); the Staff role is deliberately not given this permission.
UPDATE usr_roles r
SET permissions = (
  SELECT jsonb_agg(DISTINCT p)
  FROM jsonb_array_elements_text(r.permissions || '["clinical:*"]'::jsonb) AS p
)
WHERE r.name IN ('Tenant Owner', 'Business Owner', 'Manager') AND r.is_system = true;

COMMIT;
