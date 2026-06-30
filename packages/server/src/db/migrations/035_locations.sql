-- Phase: Multi-Location Support
-- Introduces the locations table and adds foreign key constraints to existing location references.

-- ============================================================
-- 1. Locations Table
-- ============================================================

CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'temporarily_closed')),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state_province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(2),
    -- Contact
    phone VARCHAR(50),
    email VARCHAR(255),
    -- Geo
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    -- Operating
    timezone VARCHAR(50),
    -- Display
    description TEXT,
    photo_url TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, slug)
);

CREATE INDEX idx_locations_business ON locations(business_id);
CREATE INDEX idx_locations_status ON locations(business_id, status);

-- ============================================================
-- 2. Add FK Constraints to Existing Tables
-- ============================================================

-- Resources → locations
ALTER TABLE resources
    ADD CONSTRAINT fk_resources_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;

-- Service locations join table
ALTER TABLE service_locations
    ADD CONSTRAINT fk_service_locations_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

-- Staff location assignments
ALTER TABLE staff_location_assignments
    ADD CONSTRAINT fk_staff_location_assignments_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

-- Staff profiles primary location
ALTER TABLE staff_profiles
    ADD CONSTRAINT fk_staff_profiles_primary_location
    FOREIGN KEY (primary_location_id) REFERENCES locations(id) ON DELETE SET NULL;

-- Availability patterns location
ALTER TABLE availability_patterns
    ADD CONSTRAINT fk_availability_patterns_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;

-- Availability overrides location
ALTER TABLE availability_overrides
    ADD CONSTRAINT fk_availability_overrides_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;

-- ============================================================
-- 3. RLS Policies
-- ============================================================

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_locations ON locations
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

CREATE POLICY admin_full_access_locations ON locations
    FOR ALL TO postgres
    USING (true);

-- ============================================================
-- 4. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO daystream_app;
