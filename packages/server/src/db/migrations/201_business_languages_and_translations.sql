-- Phase 44 (Language Support), requirements 8 and 9 (owner, 24 Nov 2026).
--  * A business's languages: its default language plus the others it chose (sys_businesses.languages).
--    Existing businesses start with every language on DayStream's list now (English and Spanish); a new
--    business starts with its default language only; a language DayStream adds later is not switched on
--    for any business by itself.
--  * cat_translations: a business's translations of its services, products, memberships, packages,
--    service options and add-ons (name, short description, description), per language.
BEGIN;

ALTER TABLE sys_businesses
  ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}';

UPDATE sys_businesses SET languages = ARRAY['en', 'es'] WHERE languages = '{}';

CREATE TABLE IF NOT EXISTS cat_translations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  business_id   UUID NOT NULL REFERENCES sys_businesses(id),
  entity_type   VARCHAR(20) NOT NULL CHECK (entity_type IN ('service', 'product', 'membership', 'package', 'service_option', 'addon')),
  entity_id     UUID NOT NULL,
  language      VARCHAR(10) NOT NULL,
  -- { name, short_description, description }
  fields        JSONB NOT NULL DEFAULT '{}',
  -- The default-language text the translation was made from: when it differs from the record's current
  -- text, the translation is out of date.
  source        JSONB NOT NULL DEFAULT '{}',
  translated_by VARCHAR(10) NOT NULL DEFAULT 'person' CHECK (translated_by IN ('machine', 'person')),
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by    UUID,
  updated_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, language)
);

CREATE INDEX IF NOT EXISTS idx_cat_translations_business ON cat_translations (business_id, entity_type, language);

DO $$
DECLARE t TEXT := 'cat_translations';
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%s ON %I', t, t);
  EXECUTE format('CREATE POLICY tenant_isolation_%s ON %I FOR ALL TO daystream_app USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t, t);
  EXECUTE format('DROP POLICY IF EXISTS admin_full_access_%s ON %I', t, t);
  EXECUTE format('CREATE POLICY admin_full_access_%s ON %I FOR ALL TO CURRENT_USER USING (true)', t, t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO daystream_app', t);
END $$;

COMMIT;
