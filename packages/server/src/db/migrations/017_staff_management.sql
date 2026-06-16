-- Phase 12: Staff Management tables

-- ============================================================
-- 1. Staff Profiles
-- ============================================================

CREATE TABLE staff_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    staff_ref VARCHAR(20) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    mobile_phone VARCHAR(50),
    date_of_birth DATE,
    hire_date DATE,
    employment_type VARCHAR(20) NOT NULL DEFAULT 'full_time'
        CHECK (employment_type IN ('full_time', 'part_time', 'contractor')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'onboarding', 'terminated')),
    bio TEXT,
    profile_photo_path TEXT,
    languages VARCHAR(200),
    show_on_directory BOOLEAN NOT NULL DEFAULT true,
    primary_location_id UUID,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, staff_ref)
);

CREATE INDEX idx_staff_profiles_tenant ON staff_profiles(tenant_id);
CREATE INDEX idx_staff_profiles_user ON staff_profiles(user_id);
CREATE INDEX idx_staff_profiles_status ON staff_profiles(tenant_id, status);

-- ============================================================
-- 2. Staff Qualifications
-- ============================================================

CREATE TABLE staff_qualifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    issuing_body VARCHAR(200),
    date_obtained DATE,
    expiry_date DATE,
    certification_number VARCHAR(100),
    document_path TEXT,
    show_on_directory BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_qualifications_staff ON staff_qualifications(staff_id);
CREATE INDEX idx_staff_qualifications_expiry ON staff_qualifications(expiry_date)
    WHERE expiry_date IS NOT NULL;

-- ============================================================
-- 3. Service Qualification Requirements
-- ============================================================

CREATE TABLE service_qualification_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    qualification_name VARCHAR(200) NOT NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(service_id, qualification_name)
);

-- ============================================================
-- 4. Availability Patterns
-- ============================================================

CREATE TABLE availability_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_default BOOLEAN NOT NULL DEFAULT false,
    location_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_availability_patterns_staff ON availability_patterns(staff_id);
CREATE INDEX idx_availability_patterns_dates ON availability_patterns(staff_id, effective_from, effective_to);

-- ============================================================
-- 5. Availability Pattern Slots
-- ============================================================

CREATE TABLE availability_pattern_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_id UUID NOT NULL REFERENCES availability_patterns(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    CHECK (end_time > start_time)
);

CREATE INDEX idx_availability_slots_pattern ON availability_pattern_slots(pattern_id);

-- ============================================================
-- 6. Availability Overrides
-- ============================================================

CREATE TABLE availability_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    override_date DATE NOT NULL,
    override_type VARCHAR(20) NOT NULL
        CHECK (override_type IN ('add', 'remove', 'modify')),
    start_time TIME,
    end_time TIME,
    reason VARCHAR(200),
    location_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_availability_overrides_staff_date ON availability_overrides(staff_id, override_date);

-- ============================================================
-- 7. Leave Requests
-- ============================================================

CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL
        CHECK (leave_type IN ('holiday', 'sick', 'personal', 'training', 'other')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_staff ON leave_requests(staff_id);
CREATE INDEX idx_leave_requests_dates ON leave_requests(staff_id, start_date, end_date)
    WHERE status = 'approved';
CREATE INDEX idx_leave_requests_tenant ON leave_requests(tenant_id);

-- ============================================================
-- 8. Leave Balances
-- ============================================================

CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL,
    year INTEGER NOT NULL,
    total_days NUMERIC(5,1) NOT NULL DEFAULT 0,
    used_days NUMERIC(5,1) NOT NULL DEFAULT 0,
    UNIQUE(staff_id, leave_type, year)
);

-- ============================================================
-- 9. Staff Service Assignments
-- ============================================================

CREATE TABLE staff_service_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    variant_id UUID,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_staff_service_assignments_unique
    ON staff_service_assignments(staff_id, service_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'));
CREATE INDEX idx_staff_service_assignments_service ON staff_service_assignments(service_id);
CREATE INDEX idx_staff_service_assignments_staff ON staff_service_assignments(staff_id);

-- ============================================================
-- 10. Staff Location Assignments
-- ============================================================

CREATE TABLE staff_location_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(staff_id, location_id)
);

CREATE INDEX idx_staff_location_assignments_staff ON staff_location_assignments(staff_id);

-- ============================================================
-- 11. Capacity Configuration
-- ============================================================

CREATE TABLE staff_capacity_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    max_bookings_per_day INTEGER,
    max_bookings_per_week INTEGER,
    max_consecutive_hours NUMERIC(4,1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(staff_id)
);

-- ============================================================
-- 12. Capacity Overrides
-- ============================================================

CREATE TABLE staff_capacity_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    override_date DATE NOT NULL,
    max_bookings INTEGER NOT NULL,
    reason VARCHAR(200) NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_capacity_overrides_staff ON staff_capacity_overrides(staff_id, override_date);

-- ============================================================
-- 13. Notification Preferences
-- ============================================================

CREATE TABLE staff_notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    channel_email BOOLEAN NOT NULL DEFAULT true,
    channel_in_app BOOLEAN NOT NULL DEFAULT true,
    channel_sms BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(staff_id, event_type)
);

-- ============================================================
-- 14. RLS Policies
-- ============================================================

ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_staff_profiles ON staff_profiles FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_staff_profiles ON staff_profiles FOR ALL TO postgres USING (true);

ALTER TABLE staff_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_qualifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_staff_qualifications ON staff_qualifications FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_staff_qualifications ON staff_qualifications FOR ALL TO postgres USING (true);

ALTER TABLE service_qualification_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_qualification_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_service_qual_reqs ON service_qualification_requirements FOR ALL TO daystream_app
    USING (service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_service_qual_reqs ON service_qualification_requirements FOR ALL TO postgres USING (true);

ALTER TABLE availability_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_patterns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_availability_patterns ON availability_patterns FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_availability_patterns ON availability_patterns FOR ALL TO postgres USING (true);

ALTER TABLE availability_pattern_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_pattern_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_availability_pattern_slots ON availability_pattern_slots FOR ALL TO daystream_app
    USING (pattern_id IN (SELECT id FROM availability_patterns WHERE staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_availability_pattern_slots ON availability_pattern_slots FOR ALL TO postgres USING (true);

ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_availability_overrides ON availability_overrides FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_availability_overrides ON availability_overrides FOR ALL TO postgres USING (true);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leave_requests ON leave_requests FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_leave_requests ON leave_requests FOR ALL TO postgres USING (true);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leave_balances ON leave_balances FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_leave_balances ON leave_balances FOR ALL TO postgres USING (true);

ALTER TABLE staff_service_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_service_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_staff_service_assignments ON staff_service_assignments FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_staff_service_assignments ON staff_service_assignments FOR ALL TO postgres USING (true);

ALTER TABLE staff_location_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_location_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_staff_location_assignments ON staff_location_assignments FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_staff_location_assignments ON staff_location_assignments FOR ALL TO postgres USING (true);

ALTER TABLE staff_capacity_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_capacity_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_staff_capacity_config ON staff_capacity_config FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_staff_capacity_config ON staff_capacity_config FOR ALL TO postgres USING (true);

ALTER TABLE staff_capacity_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_capacity_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_staff_capacity_overrides ON staff_capacity_overrides FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_staff_capacity_overrides ON staff_capacity_overrides FOR ALL TO postgres USING (true);

ALTER TABLE staff_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_staff_notification_prefs ON staff_notification_preferences FOR ALL TO daystream_app
    USING (staff_id IN (SELECT id FROM staff_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_staff_notification_prefs ON staff_notification_preferences FOR ALL TO postgres USING (true);

-- ============================================================
-- 15. Grant permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_profiles TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_qualifications TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_qualification_requirements TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON availability_patterns TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON availability_pattern_slots TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON availability_overrides TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_requests TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_balances TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_service_assignments TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_location_assignments TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_capacity_config TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_capacity_overrides TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_notification_preferences TO daystream_app;
