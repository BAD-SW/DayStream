-- Phase: Business Layer
-- Introduces the businesses table and refactors user personas.
--
-- Persona model:
--   System User   → tenant_id NULL, business_id NULL (platform admin)
--   Tenant User   → tenant_id set, business_id NULL (manages tenant, all businesses)
--   Business User → tenant_id set, business_id set (works within a business)
--   Customer      → tenant_id set, business_id NULL (can use multiple businesses in tenant)

-- ============================================================
-- 1. Businesses table
-- ============================================================

CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'archived')),
    -- Branding (personalized per business)
    primary_color VARCHAR(7) DEFAULT '#C9A96E',
    logo_url TEXT,
    -- Locale (can differ from tenant)
    default_language VARCHAR(5) NOT NULL DEFAULT 'en',
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    -- Contact
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_businesses_tenant ON businesses(tenant_id);
CREATE INDEX idx_businesses_slug ON businesses(slug);

-- ============================================================
-- 2. Update users table for persona model
-- ============================================================

-- Add persona type and optional business_id
ALTER TABLE users ADD COLUMN IF NOT EXISTS persona VARCHAR(20) NOT NULL DEFAULT 'customer'
    CHECK (persona IN ('system', 'tenant', 'business', 'customer'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;

CREATE INDEX idx_users_business ON users(business_id);
CREATE INDEX idx_users_persona ON users(persona);

-- Update the role CHECK constraint to support new role set
-- Drop existing constraint and replace
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN (
        -- System roles
        'system_admin', 'system_support',
        -- Tenant roles
        'tenant_owner', 'tenant_manager',
        -- Business roles
        'business_owner', 'business_manager', 'business_staff',
        -- Customer
        'customer',
        -- Legacy (to be migrated)
        'super_admin', 'manager', 'reception', 'therapist', 'trainer'
    ));

-- ============================================================
-- 3. Business-scoped configuration
-- ============================================================

-- Business-specific configuration overrides (branding, features, limits)
CREATE TABLE business_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL REFERENCES configuration_definitions(key),
    value TEXT NOT NULL,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, key)
);

CREATE INDEX idx_business_config_business ON business_configurations(business_id);

-- ============================================================
-- 4. Customer-business relationship (many-to-many)
-- ============================================================

-- A customer can be associated with multiple businesses within a tenant
CREATE TABLE customer_businesses (
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (customer_id, business_id)
);

CREATE INDEX idx_customer_businesses_customer ON customer_businesses(customer_id);
CREATE INDEX idx_customer_businesses_business ON customer_businesses(business_id);

-- ============================================================
-- 5. RLS policies for new tables
-- ============================================================

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_businesses ON businesses
    FOR ALL
    TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_businesses ON businesses
    FOR ALL
    TO postgres
    USING (true);

ALTER TABLE business_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_configurations FORCE ROW LEVEL SECURITY;

-- Business config: allow if the business belongs to the current tenant
CREATE POLICY tenant_isolation_business_configurations ON business_configurations
    FOR ALL
    TO daystream_app
    USING (business_id IN (
        SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

CREATE POLICY admin_full_access_business_configurations ON business_configurations
    FOR ALL
    TO postgres
    USING (true);

ALTER TABLE customer_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_businesses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customer_businesses ON customer_businesses
    FOR ALL
    TO daystream_app
    USING (business_id IN (
        SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

CREATE POLICY admin_full_access_customer_businesses ON customer_businesses
    FOR ALL
    TO postgres
    USING (true);

-- ============================================================
-- 6. Grant permissions to app role for new tables
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON businesses TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON business_configurations TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_businesses TO daystream_app;

-- ============================================================
-- 7. Migrate existing seed data to new persona model
-- ============================================================

-- Update existing seed users to use the new persona field
UPDATE users SET persona = 'business' WHERE role IN ('business_owner', 'manager', 'reception', 'therapist', 'trainer');
UPDATE users SET persona = 'customer' WHERE role = 'customer';
UPDATE users SET persona = 'system' WHERE role = 'super_admin';
