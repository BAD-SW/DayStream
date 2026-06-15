-- Phase 06: Service Management tables

-- ============================================================
-- 1. Tax Categories
-- ============================================================

CREATE TABLE tax_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    rate INTEGER NOT NULL DEFAULT 0,                          -- basis points (2100 = 21.00%)
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, name)
);

CREATE INDEX idx_tax_categories_business ON tax_categories(business_id);

-- ============================================================
-- 2. Cancellation Policies
-- ============================================================

CREATE TABLE cancellation_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    free_cancellation_hours INTEGER NOT NULL DEFAULT 24,
    late_cancel_fee_type VARCHAR(10) NOT NULL DEFAULT 'percentage'
        CHECK (late_cancel_fee_type IN ('percentage', 'fixed')),
    late_cancel_fee_value INTEGER NOT NULL DEFAULT 50,
    noshow_fee_type VARCHAR(10) NOT NULL DEFAULT 'percentage'
        CHECK (noshow_fee_type IN ('percentage', 'fixed')),
    noshow_fee_value INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cancellation_policies_business ON cancellation_policies(business_id);

-- ============================================================
-- 3. Service Categories
-- ============================================================

CREATE TABLE service_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    display_order INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, name, parent_id)
);

CREATE INDEX idx_service_categories_business ON service_categories(business_id);
CREATE INDEX idx_service_categories_parent ON service_categories(parent_id);

-- ============================================================
-- 4. Services
-- ============================================================

CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES service_categories(id),
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    booking_type VARCHAR(20) NOT NULL DEFAULT 'individual'
        CHECK (booking_type IN ('individual', 'shared', 'group', 'resource')),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    -- Configuration
    default_duration INTEGER NOT NULL DEFAULT 60,
    buffer_before INTEGER NOT NULL DEFAULT 0,
    buffer_after INTEGER NOT NULL DEFAULT 0,
    max_capacity INTEGER NOT NULL DEFAULT 1,
    min_advance_booking_hours INTEGER NOT NULL DEFAULT 2,
    max_advance_booking_days INTEGER NOT NULL DEFAULT 30,
    online_booking_enabled BOOLEAN NOT NULL DEFAULT true,
    preparation_notes TEXT,
    -- Display
    display_order INTEGER NOT NULL DEFAULT 0,
    -- Tax
    tax_category_id UUID REFERENCES tax_categories(id) ON DELETE SET NULL,
    -- Cancellation
    cancellation_policy_id UUID REFERENCES cancellation_policies(id) ON DELETE SET NULL,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, slug)
);

CREATE INDEX idx_services_business ON services(business_id);
CREATE INDEX idx_services_category ON services(category_id);
CREATE INDEX idx_services_status ON services(business_id, status);
CREATE INDEX idx_services_slug ON services(business_id, slug);

-- Full-text search index
CREATE INDEX idx_services_search ON services
    USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '') || ' ' || COALESCE(short_description, '')));

-- ============================================================
-- 5. Service Variants
-- ============================================================

CREATE TABLE service_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    duration INTEGER NOT NULL,
    price INTEGER NOT NULL,                                   -- cents
    pricing_model VARCHAR(20) NOT NULL DEFAULT 'per_session'
        CHECK (pricing_model IN ('per_session', 'subscription')),
    -- Subscription fields (NULL for per_session)
    billing_interval VARCHAR(20)
        CHECK (billing_interval IS NULL OR billing_interval IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annually')),
    included_sessions INTEGER,
    sessions_rollover BOOLEAN DEFAULT false,
    -- Overrides
    capacity_override INTEGER,
    -- Display
    display_order INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_variants_service ON service_variants(service_id);

-- Constraint: subscription variants must have billing_interval
ALTER TABLE service_variants ADD CONSTRAINT chk_subscription_interval
    CHECK (pricing_model != 'subscription' OR billing_interval IS NOT NULL);

-- ============================================================
-- 6. Service Images (metadata only)
-- ============================================================

CREATE TABLE service_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    filename VARCHAR(255) NOT NULL,
    alt_text VARCHAR(500),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    mime_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_images_service ON service_images(service_id);

-- ============================================================
-- 7. Staff Assignment
-- ============================================================

CREATE TABLE service_staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES service_variants(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(service_id, user_id, variant_id)
);

CREATE INDEX idx_service_staff_service ON service_staff(service_id);
CREATE INDEX idx_service_staff_user ON service_staff(user_id);

-- ============================================================
-- 8. Service Resource Requirements
-- ============================================================

CREATE TABLE service_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL,
    variant_id UUID REFERENCES service_variants(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(service_id, resource_id, variant_id)
);

CREATE INDEX idx_service_resources_service ON service_resources(service_id);

-- ============================================================
-- 9. Service Location Assignment
-- ============================================================

CREATE TABLE service_locations (
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,
    PRIMARY KEY (service_id, location_id)
);

-- ============================================================
-- 10. Service Availability Rules
-- ============================================================

CREATE TABLE service_availability_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    rule_type VARCHAR(20) NOT NULL
        CHECK (rule_type IN ('recurring', 'seasonal', 'block')),
    days_of_week INTEGER[],
    start_time TIME,
    end_time TIME,
    effective_from DATE,
    effective_to DATE,
    blocked_dates DATE[],
    description VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_availability_rules_service ON service_availability_rules(service_id);

-- ============================================================
-- 11. Service Templates (system-level)
-- ============================================================

CREATE TABLE service_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_type VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    booking_type VARCHAR(20) NOT NULL DEFAULT 'individual',
    default_duration INTEGER NOT NULL DEFAULT 60,
    suggested_price INTEGER,
    cancellation_hours INTEGER DEFAULT 24,
    display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_service_templates_type ON service_templates(business_type);

-- ============================================================
-- 12. RLS Policies
-- ============================================================

-- Tax categories
ALTER TABLE tax_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tax_categories ON tax_categories
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_tax_categories ON tax_categories
    FOR ALL TO postgres
    USING (true);

-- Cancellation policies
ALTER TABLE cancellation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cancellation_policies ON cancellation_policies
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_cancellation_policies ON cancellation_policies
    FOR ALL TO postgres
    USING (true);

-- Service categories
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_service_categories ON service_categories
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_service_categories ON service_categories
    FOR ALL TO postgres
    USING (true);

-- Services
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_services ON services
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_services ON services
    FOR ALL TO postgres
    USING (true);

-- Service variants
ALTER TABLE service_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_variants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_service_variants ON service_variants
    FOR ALL TO daystream_app
    USING (service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_service_variants ON service_variants
    FOR ALL TO postgres
    USING (true);

-- Service images
ALTER TABLE service_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_images FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_service_images ON service_images
    FOR ALL TO daystream_app
    USING (service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_service_images ON service_images
    FOR ALL TO postgres
    USING (true);

-- Service staff
ALTER TABLE service_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_staff FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_service_staff ON service_staff
    FOR ALL TO daystream_app
    USING (service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_service_staff ON service_staff
    FOR ALL TO postgres
    USING (true);

-- Service resources
ALTER TABLE service_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_resources FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_service_resources ON service_resources
    FOR ALL TO daystream_app
    USING (service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_service_resources ON service_resources
    FOR ALL TO postgres
    USING (true);

-- Availability rules
ALTER TABLE service_availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_availability_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_availability_rules ON service_availability_rules
    FOR ALL TO daystream_app
    USING (service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_availability_rules ON service_availability_rules
    FOR ALL TO postgres
    USING (true);

-- ============================================================
-- 13. Grant permissions to app role
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON tax_categories TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cancellation_policies TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_categories TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON services TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_variants TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_images TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_staff TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_resources TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_locations TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_availability_rules TO daystream_app;
GRANT SELECT ON service_templates TO daystream_app;
