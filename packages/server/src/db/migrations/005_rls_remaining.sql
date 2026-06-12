-- Enable RLS on remaining tenant-scoped tables

-- Tenants table: non-superuser can only see their own tenant
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenants ON tenants
    FOR ALL
    TO daystream_app
    USING (id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_tenants ON tenants
    FOR ALL
    TO postgres
    USING (true);

-- RLS on login_attempts
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_login_attempts ON login_attempts
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR tenant_id IS NULL);

CREATE POLICY admin_full_access_login_attempts ON login_attempts
    FOR ALL
    TO postgres
    USING (true);

-- RLS on refresh_tokens (scoped by user, not tenant directly)
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;

-- Allow all access for app role on refresh_tokens (looked up by token hash, not tenant)
CREATE POLICY app_access_refresh_tokens ON refresh_tokens
    FOR ALL
    TO daystream_app
    USING (true);

CREATE POLICY admin_full_access_refresh_tokens ON refresh_tokens
    FOR ALL
    TO postgres
    USING (true);

-- RLS on password_history
ALTER TABLE password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_history FORCE ROW LEVEL SECURITY;

CREATE POLICY app_access_password_history ON password_history
    FOR ALL
    TO daystream_app
    USING (true);

CREATE POLICY admin_full_access_password_history ON password_history
    FOR ALL
    TO postgres
    USING (true);

-- RLS on user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_user_roles ON user_roles
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_user_roles ON user_roles
    FOR ALL
    TO postgres
    USING (true);

-- RLS on audit_log
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit_log ON audit_log
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_audit_log ON audit_log
    FOR ALL
    TO postgres
    USING (true);

-- RLS on consent_records
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_consent_records ON consent_records
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_consent_records ON consent_records
    FOR ALL
    TO postgres
    USING (true);

-- RLS on deletion_requests
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_deletion_requests ON deletion_requests
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_deletion_requests ON deletion_requests
    FOR ALL
    TO postgres
    USING (true);

-- RLS on tenant_configurations
ALTER TABLE tenant_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_configurations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenant_configurations ON tenant_configurations
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_tenant_configurations ON tenant_configurations
    FOR ALL
    TO postgres
    USING (true);

-- RLS on feature_flag_overrides
ALTER TABLE feature_flag_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_feature_flag_overrides ON feature_flag_overrides
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_feature_flag_overrides ON feature_flag_overrides
    FOR ALL
    TO postgres
    USING (true);

-- Tables without tenant_id (system-level, open to app role)
-- roles, oauth_links, user_mfa, mfa_backup_codes, configuration_definitions, feature_flags
-- These are either system-level or linked via user_id rather than tenant_id directly.

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

-- Roles: system roles have NULL tenant_id, tenant roles match current context
CREATE POLICY app_access_roles ON roles
    FOR ALL
    TO daystream_app
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_roles ON roles
    FOR ALL
    TO postgres
    USING (true);

-- configuration_definitions and feature_flags are system-level, no tenant scoping needed
ALTER TABLE configuration_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY app_read_config_definitions ON configuration_definitions
    FOR SELECT
    TO daystream_app
    USING (true);

CREATE POLICY admin_full_access_config_definitions ON configuration_definitions
    FOR ALL
    TO postgres
    USING (true);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;

CREATE POLICY app_read_feature_flags ON feature_flags
    FOR SELECT
    TO daystream_app
    USING (true);

CREATE POLICY admin_full_access_feature_flags ON feature_flags
    FOR ALL
    TO postgres
    USING (true);

-- oauth_links scoped by tenant
ALTER TABLE oauth_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_links FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_oauth_links ON oauth_links
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_oauth_links ON oauth_links
    FOR ALL
    TO postgres
    USING (true);

-- user_mfa and mfa_backup_codes: open to app role (looked up by user_id)
ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa FORCE ROW LEVEL SECURITY;

CREATE POLICY app_access_user_mfa ON user_mfa
    FOR ALL
    TO daystream_app
    USING (true);

CREATE POLICY admin_full_access_user_mfa ON user_mfa
    FOR ALL
    TO postgres
    USING (true);

ALTER TABLE mfa_backup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_backup_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY app_access_mfa_backup_codes ON mfa_backup_codes
    FOR ALL
    TO daystream_app
    USING (true);

CREATE POLICY admin_full_access_mfa_backup_codes ON mfa_backup_codes
    FOR ALL
    TO postgres
    USING (true);
