-- Create a non-superuser role for the application to use.
-- Table owners (postgres) bypass RLS, so we need a dedicated app role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daystream_app') THEN
    CREATE ROLE daystream_app LOGIN PASSWORD 'daystream_app_dev';
  END IF;
END
$$;

-- Grant usage on the database. Dynamic rather than a hardcoded 'daystream_dev' — that
-- name is a local-dev-only convention and doesn't exist on managed hosts (e.g. Neon's
-- default database is 'neondb'), so a literal reference broke any fresh migration run
-- against a differently-named database (spec 38 Phase 4).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO daystream_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO daystream_app;

-- Grant table-level permissions (all current and future tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO daystream_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO daystream_app;

-- Ensure future tables also get these grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO daystream_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO daystream_app;

-- Re-enable RLS with proper policy for the app role
-- Drop the existing overly-broad policy and recreate with correct behavior
DROP POLICY IF EXISTS tenant_isolation_users ON users;

-- Policy: app role can only see rows matching the session variable
CREATE POLICY tenant_isolation_users ON users
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Also allow the connecting admin/owner role full access (for migrations, seeds) — the
-- role is named 'postgres' locally but varies on managed hosts (e.g. Neon's is
-- 'neondb_owner'), so it's captured dynamically via current_user rather than hardcoded.
DO $$
BEGIN
  EXECUTE format('CREATE POLICY admin_full_access_users ON users FOR ALL TO %I USING (true)', current_user);
END
$$;
