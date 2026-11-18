-- A signed-in person's own settings for how screens look to them (owner, 19 Nov 2026), one value
-- per key; the first is reports.category_order, the order of the Reports page's categories.
-- Stored on the server so the choice follows the person to any browser or device.
BEGIN;

CREATE TABLE IF NOT EXISTS usr_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES usr_users(id) ON DELETE CASCADE,
  key         VARCHAR(80) NOT NULL,
  value       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key)
);

ALTER TABLE usr_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE usr_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_usr_preferences ON usr_preferences FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_usr_preferences ON usr_preferences FOR ALL TO CURRENT_USER USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON usr_preferences TO daystream_app;

COMMIT;
