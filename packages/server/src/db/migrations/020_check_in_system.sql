-- Phase 15: Check-In System tables

-- ============================================================
-- 1. Check-In Records
-- ============================================================

CREATE TABLE check_in_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    check_in_method VARCHAR(20) NOT NULL
        CHECK (check_in_method IN ('qr_staff', 'qr_self', 'reception', 'kiosk', 'walk_in')),
    status VARCHAR(20) NOT NULL DEFAULT 'checked_in'
        CHECK (status IN ('checked_in', 'in_progress', 'completed', 'cancelled')),
    validated BOOLEAN NOT NULL DEFAULT true,
    validation_warnings JSONB DEFAULT '[]',
    override_reason VARCHAR(200),
    processed_by UUID REFERENCES users(id),
    location_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_check_in_records_tenant ON check_in_records(tenant_id);
CREATE INDEX idx_check_in_records_booking ON check_in_records(booking_id);
CREATE INDEX idx_check_in_records_customer ON check_in_records(customer_id);
CREATE INDEX idx_check_in_records_date ON check_in_records(tenant_id, check_in_time);

-- ============================================================
-- 2. QR Codes
-- ============================================================

CREATE TABLE check_in_qr_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL UNIQUE,
    code_type VARCHAR(20) NOT NULL
        CHECK (code_type IN ('booking', 'customer')),
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qr_codes_code ON check_in_qr_codes(code);
CREATE INDEX idx_qr_codes_customer ON check_in_qr_codes(customer_id);
CREATE INDEX idx_qr_codes_booking ON check_in_qr_codes(booking_id);

-- ============================================================
-- 3. No-Show Records
-- ============================================================

CREATE TABLE no_show_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES bookings(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fee_amount INTEGER DEFAULT 0,
    fee_charged BOOLEAN NOT NULL DEFAULT false,
    waived BOOLEAN NOT NULL DEFAULT false,
    waived_by UUID REFERENCES users(id),
    waive_reason VARCHAR(200),
    notified BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_no_show_records_customer ON no_show_records(customer_id);
CREATE INDEX idx_no_show_records_tenant ON no_show_records(tenant_id);

-- ============================================================
-- 4. Check-In Configuration
-- ============================================================

CREATE TABLE check_in_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    grace_period_minutes INTEGER NOT NULL DEFAULT 15,
    early_arrival_minutes INTEGER NOT NULL DEFAULT 15,
    late_arrival_max_minutes INTEGER NOT NULL DEFAULT 30,
    credit_deduction_mode VARCHAR(20) NOT NULL DEFAULT 'on_booking'
        CHECK (credit_deduction_mode IN ('on_booking', 'on_checkin')),
    no_show_warning_threshold INTEGER NOT NULL DEFAULT 2,
    no_show_restrict_threshold INTEGER NOT NULL DEFAULT 4,
    no_show_ban_threshold INTEGER NOT NULL DEFAULT 6,
    walk_in_enabled BOOLEAN NOT NULL DEFAULT true,
    kiosk_enabled BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(tenant_id)
);

-- ============================================================
-- 5. Kiosk Sessions
-- ============================================================

CREATE TABLE kiosk_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    location_id UUID NOT NULL,
    device_name VARCHAR(100),
    token VARCHAR(200) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. RLS Policies
-- ============================================================

ALTER TABLE check_in_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_check_in_records ON check_in_records FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_check_in_records ON check_in_records FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE check_in_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in_qr_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_check_in_qr_codes ON check_in_qr_codes FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_check_in_qr_codes ON check_in_qr_codes FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE no_show_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE no_show_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_no_show_records ON no_show_records FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_no_show_records ON no_show_records FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE check_in_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_check_in_config ON check_in_config FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_check_in_config ON check_in_config FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_kiosk_sessions ON kiosk_sessions FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_kiosk_sessions ON kiosk_sessions FOR ALL TO CURRENT_USER USING (true);

-- ============================================================
-- 7. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON check_in_records TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON check_in_qr_codes TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON no_show_records TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON check_in_config TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON kiosk_sessions TO daystream_app;
