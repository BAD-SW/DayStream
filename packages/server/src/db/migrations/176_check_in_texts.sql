-- Spec 51, gap 3: the wording of the customer check-in screens (phone page, kiosk, forms list), one row per
-- business and language. Only the pieces a business changed are stored; the rest come from the built-in
-- wording of that language. Isolation is application-level (business_id on every query), like the forms tables.
BEGIN;

CREATE TABLE IF NOT EXISTS apt_check_in_texts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  language    VARCHAR(10) NOT NULL,
  texts       JSONB NOT NULL DEFAULT '{}',
  updated_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (business_id, language)
);

COMMIT;