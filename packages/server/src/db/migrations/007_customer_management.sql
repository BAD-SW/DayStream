-- Phase 05: Customer Management tables

-- ============================================================
-- 1. Customers table
-- ============================================================

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    business_id UUID NOT NULL REFERENCES businesses(id),
    reference_number VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    date_of_birth DATE,
    gender VARCHAR(20),
    preferred_language VARCHAR(5) DEFAULT 'en',
    country VARCHAR(100),
    avatar_url TEXT,
    lifecycle_stage VARCHAR(20) NOT NULL DEFAULT 'lead'
        CHECK (lifecycle_stage IN ('lead', 'trial', 'active', 'at_risk', 'churned', 'winback')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived', 'anonymized')),
    anonymized_at TIMESTAMPTZ,
    anonymized_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, email)
);

CREATE INDEX idx_customers_business ON customers(business_id);
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_name ON customers(last_name, first_name);
CREATE INDEX idx_customers_lifecycle ON customers(business_id, lifecycle_stage);
CREATE INDEX idx_customers_reference ON customers(business_id, reference_number);

-- Full-text search index
CREATE INDEX idx_customers_search ON customers
    USING GIN (to_tsvector('english', first_name || ' ' || last_name || ' ' || email || ' ' || COALESCE(phone, '')));

-- ============================================================
-- 2. Note categories (per business)
-- ============================================================

CREATE TABLE note_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    is_sensitive BOOLEAN NOT NULL DEFAULT false,
    customer_visible BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, name)
);

-- ============================================================
-- 3. Customer notes (encrypted content)
-- ============================================================

CREATE TABLE customer_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id),
    category VARCHAR(50) NOT NULL,
    content_encrypted TEXT NOT NULL,
    is_sensitive BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_notes_customer ON customer_notes(customer_id);
CREATE INDEX idx_customer_notes_business ON customer_notes(business_id);

-- ============================================================
-- 4. Tags
-- ============================================================

CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) DEFAULT '#8A8A8A',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, name)
);

CREATE TABLE customer_tags (
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    PRIMARY KEY (customer_id, tag_id)
);

CREATE INDEX idx_customer_tags_customer ON customer_tags(customer_id);
CREATE INDEX idx_customer_tags_tag ON customer_tags(tag_id);

-- ============================================================
-- 5. Customer custom fields
-- ============================================================

CREATE TABLE customer_custom_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value TEXT,
    UNIQUE(customer_id, key)
);

CREATE INDEX idx_custom_fields_customer ON customer_custom_fields(customer_id);

-- ============================================================
-- 6. Activity timeline
-- ============================================================

CREATE TABLE customer_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id),
    activity_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_activities_customer ON customer_activities(customer_id);
CREATE INDEX idx_activities_type ON customer_activities(customer_id, activity_type);
CREATE INDEX idx_activities_date ON customer_activities(customer_id, created_at DESC);
CREATE INDEX idx_activities_business ON customer_activities(business_id);

-- ============================================================
-- 7. Segments
-- ============================================================

CREATE TABLE segments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    rules JSONB NOT NULL,
    is_predefined BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_segments_business ON segments(business_id);

-- ============================================================
-- 8. Communication preferences
-- ============================================================

CREATE TABLE customer_preferences (
    customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    email_marketing BOOLEAN NOT NULL DEFAULT false,
    sms_marketing BOOLEAN NOT NULL DEFAULT false,
    push_notifications BOOLEAN NOT NULL DEFAULT false,
    booking_reminders BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. RLS policies
-- ============================================================

-- Customers: business-scoped via tenant
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customers ON customers
    FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY admin_full_access_customers ON customers
    FOR ALL TO CURRENT_USER
    USING (true);

-- Customer notes
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customer_notes ON customer_notes
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_customer_notes ON customer_notes
    FOR ALL TO CURRENT_USER
    USING (true);

-- Note categories
ALTER TABLE note_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_note_categories ON note_categories
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_note_categories ON note_categories
    FOR ALL TO CURRENT_USER
    USING (true);

-- Tags
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tags ON tags
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_tags ON tags
    FOR ALL TO CURRENT_USER
    USING (true);

-- Customer tags
ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customer_tags ON customer_tags
    FOR ALL TO daystream_app
    USING (customer_id IN (SELECT id FROM customers WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_customer_tags ON customer_tags
    FOR ALL TO CURRENT_USER
    USING (true);

-- Custom fields
ALTER TABLE customer_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_custom_fields FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_custom_fields ON customer_custom_fields
    FOR ALL TO daystream_app
    USING (customer_id IN (SELECT id FROM customers WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_custom_fields ON customer_custom_fields
    FOR ALL TO CURRENT_USER
    USING (true);

-- Activities
ALTER TABLE customer_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_activities FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_activities ON customer_activities
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_activities ON customer_activities
    FOR ALL TO CURRENT_USER
    USING (true);

-- Segments
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_segments ON segments
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_segments ON segments
    FOR ALL TO CURRENT_USER
    USING (true);

-- Customer preferences
ALTER TABLE customer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_preferences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_preferences ON customer_preferences
    FOR ALL TO daystream_app
    USING (customer_id IN (SELECT id FROM customers WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_preferences ON customer_preferences
    FOR ALL TO CURRENT_USER
    USING (true);

-- ============================================================
-- 10. Grant permissions to app role
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_notes TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON note_categories TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tags TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_tags TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_custom_fields TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_activities TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON segments TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_preferences TO daystream_app;

-- ============================================================
-- 11. Reference number sequence helper
-- ============================================================

-- Function to generate next reference number for a business
CREATE OR REPLACE FUNCTION generate_customer_reference(p_business_id UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
    next_num INTEGER;
    ref VARCHAR(20);
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(reference_number FROM 6) AS INTEGER)), 0) + 1
    INTO next_num
    FROM customers
    WHERE business_id = p_business_id;

    ref := 'CUST-' || LPAD(next_num::TEXT, 4, '0');
    RETURN ref;
END;
$$ LANGUAGE plpgsql;
