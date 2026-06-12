-- Create a non-superuser role for the application to use.
-- Table owners (postgres) bypass RLS, so we need a dedicated app role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daystream_app') THEN
    CREATE ROLE daystream_app LOGIN PASSWORD 'daystream_app_dev';
  END IF;
END
$$;

-- Grant usage on the database
GRANT CONNECT ON DATABASE daystream_dev TO daystream_app;
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

-- Also allow the postgres superuser full access (for migrations, seeds)
CREATE POLICY admin_full_access_users ON users
    FOR ALL
    TO postgres
    USING (true);
