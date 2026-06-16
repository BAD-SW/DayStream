-- Phase 13: Resource Management tables

-- ============================================================
-- 1. Resource Types
-- ============================================================

CREATE TABLE resource_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(20) NOT NULL DEFAULT 'equipment'
        CHECK (category IN ('room', 'equipment', 'facility')),
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_resource_types_tenant ON resource_types(tenant_id);

-- ============================================================
-- 2. Resources
-- ============================================================

CREATE TABLE resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    resource_type_id UUID NOT NULL REFERENCES resource_types(id),
    location_id UUID,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    capacity INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'maintenance')),
    photo_path TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    buffer_minutes INTEGER NOT NULL DEFAULT 0,
    is_24_7 BOOLEAN NOT NULL DEFAULT false,
    custom_attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resources_tenant ON resources(tenant_id);
CREATE INDEX idx_resources_type ON resources(resource_type_id);
CREATE INDEX idx_resources_location ON resources(tenant_id, location_id);
CREATE INDEX idx_resources_status ON resources(tenant_id, status);

-- ============================================================
-- 3. Resource Schedules (Operating Hours)
-- ============================================================

CREATE TABLE resource_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'Default',
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resource_schedules_resource ON resource_schedules(resource_id);

CREATE TABLE resource_schedule_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID NOT NULL REFERENCES resource_schedules(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    CHECK (end_time > start_time)
);

CREATE INDEX idx_resource_schedule_slots ON resource_schedule_slots(schedule_id);

-- ============================================================
-- 4. Resource Schedule Blocks (Holidays/Closures)
-- ============================================================

CREATE TABLE resource_schedule_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    block_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    reason VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resource_blocks_date ON resource_schedule_blocks(resource_id, block_date);

-- ============================================================
-- 5. Resource Bookings
-- ============================================================

CREATE TABLE resource_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    booking_type VARCHAR(20) NOT NULL DEFAULT 'service'
        CHECK (booking_type IN ('service', 'maintenance', 'hold', 'manual')),
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'cancelled', 'completed')),
    notes VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time)
);

CREATE INDEX idx_resource_bookings_resource ON resource_bookings(resource_id);
CREATE INDEX idx_resource_bookings_time ON resource_bookings(resource_id, start_time, end_time)
    WHERE status = 'confirmed';
CREATE INDEX idx_resource_bookings_booking ON resource_bookings(booking_id);

-- ============================================================
-- 6. Service-Resource Requirements
-- ============================================================

CREATE TABLE service_resource_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    variant_id UUID,
    resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
    resource_type_id UUID REFERENCES resource_types(id) ON DELETE CASCADE,
    requirement_type VARCHAR(20) NOT NULL DEFAULT 'required'
        CHECK (requirement_type IN ('required', 'preferred')),
    buffer_minutes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (resource_id IS NOT NULL OR resource_type_id IS NOT NULL)
);

CREATE INDEX idx_service_resource_reqs_service ON service_resource_requirements(service_id);
CREATE INDEX idx_service_resource_reqs_resource ON service_resource_requirements(resource_id);

-- ============================================================
-- 7. Resource Dependencies
-- ============================================================

CREATE TABLE resource_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    depends_on_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    offset_minutes INTEGER NOT NULL DEFAULT 0,
    duration_minutes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(resource_id, depends_on_id)
);

-- ============================================================
-- 8. Resource Maintenance
-- ============================================================

CREATE TABLE resource_maintenance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    maintenance_type VARCHAR(20) NOT NULL
        CHECK (maintenance_type IN ('recurring', 'one_time')),
    day_of_week INTEGER,
    start_time TIME,
    end_time TIME,
    specific_date DATE,
    description VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resource_maintenance ON resource_maintenance(resource_id);

-- ============================================================
-- 9. RLS Policies
-- ============================================================

ALTER TABLE resource_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_types FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_resource_types ON resource_types FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_resource_types ON resource_types FOR ALL TO postgres USING (true);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_resources ON resources FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_resources ON resources FOR ALL TO postgres USING (true);

ALTER TABLE resource_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_resource_schedules ON resource_schedules FOR ALL TO daystream_app
    USING (resource_id IN (SELECT id FROM resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_resource_schedules ON resource_schedules FOR ALL TO postgres USING (true);

ALTER TABLE resource_schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_schedule_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_resource_schedule_slots ON resource_schedule_slots FOR ALL TO daystream_app
    USING (schedule_id IN (SELECT id FROM resource_schedules WHERE resource_id IN (SELECT id FROM resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_resource_schedule_slots ON resource_schedule_slots FOR ALL TO postgres USING (true);

ALTER TABLE resource_schedule_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_schedule_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_resource_schedule_blocks ON resource_schedule_blocks FOR ALL TO daystream_app
    USING (resource_id IN (SELECT id FROM resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_resource_schedule_blocks ON resource_schedule_blocks FOR ALL TO postgres USING (true);

ALTER TABLE resource_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_resource_bookings ON resource_bookings FOR ALL TO daystream_app
    USING (resource_id IN (SELECT id FROM resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_resource_bookings ON resource_bookings FOR ALL TO postgres USING (true);

ALTER TABLE service_resource_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_resource_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_service_resource_reqs ON service_resource_requirements FOR ALL TO daystream_app
    USING (service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_service_resource_reqs ON service_resource_requirements FOR ALL TO postgres USING (true);

ALTER TABLE resource_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_resource_dependencies ON resource_dependencies FOR ALL TO daystream_app
    USING (resource_id IN (SELECT id FROM resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_resource_dependencies ON resource_dependencies FOR ALL TO postgres USING (true);

ALTER TABLE resource_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_maintenance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_resource_maintenance ON resource_maintenance FOR ALL TO daystream_app
    USING (resource_id IN (SELECT id FROM resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_resource_maintenance ON resource_maintenance FOR ALL TO postgres USING (true);

-- ============================================================
-- 10. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON resource_types TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON resources TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_schedules TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_schedule_slots TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_schedule_blocks TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_bookings TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_resource_requirements TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_dependencies TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_maintenance TO daystream_app;
