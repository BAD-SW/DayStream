-- Phase 03: Core Platform tables

-- Extend tenants table with locale/currency/timezone
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_language VARCHAR(5) NOT NULL DEFAULT 'en';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'UTC';

-- Configuration definitions (system-level - what settings exist)
CREATE TABLE configuration_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    data_type VARCHAR(20) NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'json')),
    default_value TEXT NOT NULL,
    description VARCHAR(500),
    validation_schema JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-specific configuration overrides
CREATE TABLE tenant_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL REFERENCES configuration_definitions(key),
    value TEXT NOT NULL,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, key)
);

CREATE INDEX idx_tenant_config_tenant ON tenant_configurations(tenant_id);

-- Feature flags
CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500),
    scope VARCHAR(20) NOT NULL DEFAULT 'global'
        CHECK (scope IN ('global', 'tenant', 'role', 'percentage')),
    enabled BOOLEAN NOT NULL DEFAULT false,
    percentage INTEGER CHECK (percentage >= 0 AND percentage <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feature flag tenant overrides
CREATE TABLE feature_flag_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL,
    UNIQUE(flag_id, tenant_id)
);

CREATE INDEX idx_feature_flag_overrides_tenant ON feature_flag_overrides(tenant_id);

-- Row-Level Security on tenant-scoped tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Exempt the table owner (app user) so migrations/seeds still work
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Seed default configuration definitions
INSERT INTO configuration_definitions (key, category, data_type, default_value, description) VALUES
    ('brand.primary_color', 'branding', 'string', '#C9A96E', 'Primary accent color'),
    ('brand.logo_url', 'branding', 'string', '', 'Tenant logo URL'),
    ('brand.business_name', 'branding', 'string', '', 'Display name override'),
    ('feature.online_booking', 'features', 'boolean', 'true', 'Enable online booking for customers'),
    ('feature.waitlist', 'features', 'boolean', 'true', 'Enable waitlist when services are full'),
    ('feature.memberships', 'features', 'boolean', 'true', 'Enable membership management'),
    ('limit.max_advance_booking_days', 'limits', 'number', '30', 'Maximum days in advance a booking can be made'),
    ('limit.max_bookings_per_customer', 'limits', 'number', '10', 'Maximum active bookings per customer'),
    ('limit.session_timeout_minutes', 'limits', 'number', '30', 'Session inactivity timeout'),
    ('integration.google_calendar', 'integrations', 'boolean', 'false', 'Enable Google Calendar sync'),
    ('integration.sms_notifications', 'integrations', 'boolean', 'false', 'Enable SMS appointment reminders');

-- Seed default feature flags
INSERT INTO feature_flags (key, description, scope, enabled) VALUES
    ('feature.online_booking', 'Customer-facing online booking', 'global', true),
    ('feature.waitlist', 'Waitlist when services are full', 'global', true),
    ('feature.memberships', 'Membership and subscription management', 'global', true),
    ('feature.packages', 'Service package bundles', 'global', true),
    ('feature.loyalty_points', 'Loyalty points system', 'global', false),
    ('feature.two_way_sms', 'Two-way SMS communications', 'tenant', false),
    ('feature.advanced_reporting', 'Advanced analytics and reporting', 'tenant', false);
