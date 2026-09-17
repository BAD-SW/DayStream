-- Theme Setup module (spec 37): named, saved themes a user can pick from a gallery,
-- customise, and apply at system/tenant/business scope. Supersedes the flat brand.*
-- cascade (103/104/105) as the source of truth for theme resolution — the old columns
-- are left in place (harmless, unused) rather than dropped in the same pass.
BEGIN;

CREATE TABLE IF NOT EXISTS cfg_themes (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  base_theme   VARCHAR(50)  NOT NULL CHECK (base_theme IN ('bold-business', 'classic')),
  tokens       JSONB        NOT NULL DEFAULT '{}',
  scope        VARCHAR(20)  NOT NULL CHECK (scope IN ('system', 'tenant', 'business')),
  scope_id     UUID,        -- NULL for scope='system'; tenant.id for 'tenant'; business.id for 'business'
  is_active    BOOLEAN      NOT NULL DEFAULT false,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Unique theme name per (tenant, scope, scope_id) — prevents collisions within a scope
CREATE UNIQUE INDEX IF NOT EXISTS cfg_themes_name_uidx
  ON cfg_themes (tenant_id, scope, scope_id, name)
  WHERE deleted_at IS NULL;

-- Fast lookup for the resolve query and gallery listings
CREATE INDEX IF NOT EXISTS cfg_themes_scope_idx
  ON cfg_themes (tenant_id, scope, scope_id)
  WHERE deleted_at IS NULL;

-- Assignment pointer: which saved theme is active at each scope level.
-- Named active_custom_theme_id (not active_theme_id) to avoid colliding with the
-- existing base_theme string column on sys_businesses (105_theme_base_and_favicon.sql).
ALTER TABLE sys_businesses
  ADD COLUMN IF NOT EXISTS active_custom_theme_id UUID REFERENCES cfg_themes(id) ON DELETE SET NULL;

ALTER TABLE sys_tenants
  ADD COLUMN IF NOT EXISTS active_custom_theme_id UUID REFERENCES cfg_themes(id) ON DELETE SET NULL;

-- System-level default: reuses the existing sys_configuration_definitions key-value
-- store (same table the brand.* cascade already uses) rather than a new table.
-- NULL default_value means "use the Bold Business built-in code default."
INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('theme.system_active_theme_id', 'branding', 'string', '', 'UUID of the system-level active cfg_themes row; blank means Bold Business built-in default')
ON CONFLICT (key) DO NOTHING;

COMMIT;
