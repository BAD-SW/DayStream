-- Phase 07: Booking Engine tables

-- ============================================================
-- 1. Recurring Booking Series (referenced by bookings)
-- ============================================================

CREATE TABLE recurring_booking_series (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    service_id UUID NOT NULL REFERENCES services(id),
    variant_id UUID NOT NULL REFERENCES service_variants(id),
    staff_id UUID REFERENCES users(id),
    -- Pattern
    recurrence_pattern VARCHAR(20) NOT NULL
        CHECK (recurrence_pattern IN ('weekly', 'biweekly', 'monthly')),
    day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
    day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
    start_time TIME NOT NULL,
    -- End condition
    end_type VARCHAR(20) NOT NULL DEFAULT 'ongoing'
        CHECK (end_type IN ('ongoing', 'count', 'date')),
    end_count INTEGER,
    end_date DATE,
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_recurring_series_business ON recurring_booking_series(business_id);
CREATE INDEX idx_recurring_series_customer ON recurring_booking_series(customer_id);

-- ============================================================
-- 2. Bookings
-- ============================================================

CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    service_id UUID NOT NULL REFERENCES services(id),
    variant_id UUID NOT NULL REFERENCES service_variants(id),
    staff_id UUID REFERENCES users(id),
    resource_id UUID,
    -- Timing
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    buffer_before INTEGER NOT NULL DEFAULT 0,
    buffer_after INTEGER NOT NULL DEFAULT 0,
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
    -- Details
    booking_reference VARCHAR(20) NOT NULL,
    booking_type VARCHAR(20) NOT NULL
        CHECK (booking_type IN ('individual', 'shared', 'group', 'resource')),
    price INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    cancellation_reason TEXT,
    cancelled_by UUID REFERENCES users(id),
    cancelled_at TIMESTAMPTZ,
    -- Recurring
    recurring_series_id UUID REFERENCES recurring_booking_series(id) ON DELETE SET NULL,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    UNIQUE(business_id, booking_reference)
);

CREATE INDEX idx_bookings_business ON bookings(business_id);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_staff ON bookings(staff_id);
CREATE INDEX idx_bookings_service ON bookings(service_id);
CREATE INDEX idx_bookings_status ON bookings(business_id, status);
CREATE INDEX idx_bookings_time ON bookings(business_id, start_time, end_time);
CREATE INDEX idx_bookings_staff_time ON bookings(staff_id, start_time, end_time);
CREATE INDEX idx_bookings_resource_time ON bookings(resource_id, start_time, end_time);
CREATE INDEX idx_bookings_customer_time ON bookings(customer_id, start_time, end_time);

-- ============================================================
-- 3. Booking Status History
-- ============================================================

CREATE TABLE booking_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    changed_by UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_booking_history_booking ON booking_status_history(booking_id);

-- ============================================================
-- 4. Slot Holds (Temporary Reservations)
-- ============================================================

CREATE TABLE slot_holds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    service_id UUID NOT NULL REFERENCES services(id),
    variant_id UUID NOT NULL REFERENCES service_variants(id),
    staff_id UUID REFERENCES users(id),
    resource_id UUID,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    held_by UUID NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_slot_holds_expiry ON slot_holds(expires_at);
CREATE INDEX idx_slot_holds_staff ON slot_holds(staff_id, start_time, end_time);
CREATE INDEX idx_slot_holds_resource ON slot_holds(resource_id, start_time, end_time);
CREATE INDEX idx_slot_holds_business ON slot_holds(business_id);

-- ============================================================
-- 5. Waitlist
-- ============================================================

CREATE TABLE waitlist_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    service_id UUID NOT NULL REFERENCES services(id),
    -- For shared/group: references the specific time slot
    slot_start_time TIMESTAMPTZ NOT NULL,
    slot_end_time TIMESTAMPTZ NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    position INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'notified', 'confirmed', 'expired', 'removed')),
    notified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(service_id, slot_start_time, customer_id)
);

CREATE INDEX idx_waitlist_service_slot ON waitlist_entries(service_id, slot_start_time);
CREATE INDEX idx_waitlist_customer ON waitlist_entries(customer_id);
CREATE INDEX idx_waitlist_status ON waitlist_entries(status);

-- ============================================================
-- 6. Staff Schedules (interface for Phase 12)
-- ============================================================

CREATE TABLE staff_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    effective_from DATE,
    effective_to DATE,
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_schedules_user ON staff_schedules(user_id);
CREATE INDEX idx_staff_schedules_business ON staff_schedules(business_id);
CREATE INDEX idx_staff_schedules_day ON staff_schedules(user_id, day_of_week);

-- ============================================================
-- 7. Staff Time Off / Blocks
-- ============================================================

CREATE TABLE staff_time_off (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    reason VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_time_off_user ON staff_time_off(user_id, start_time, end_time);
CREATE INDEX idx_staff_time_off_business ON staff_time_off(business_id);

-- ============================================================
-- 8. Notification Queue
-- ============================================================

CREATE TABLE notification_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    type VARCHAR(50) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'email'
        CHECK (channel IN ('email', 'sms', 'push')),
    recipient_id UUID NOT NULL,
    recipient_email VARCHAR(255),
    data JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_queue_status ON notification_queue(status, scheduled_for);
CREATE INDEX idx_notification_queue_business ON notification_queue(business_id);
CREATE INDEX idx_notification_queue_recipient ON notification_queue(recipient_id);

-- ============================================================
-- 9. RLS Policies
-- ============================================================

-- Bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_bookings ON bookings
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_bookings ON bookings
    FOR ALL TO CURRENT_USER
    USING (true);

-- Booking status history
ALTER TABLE booking_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_status_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_booking_history ON booking_status_history
    FOR ALL TO daystream_app
    USING (booking_id IN (SELECT id FROM bookings WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_booking_history ON booking_status_history
    FOR ALL TO CURRENT_USER
    USING (true);

-- Slot holds
ALTER TABLE slot_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_holds FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_slot_holds ON slot_holds
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_slot_holds ON slot_holds
    FOR ALL TO CURRENT_USER
    USING (true);

-- Waitlist
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_waitlist ON waitlist_entries
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_waitlist ON waitlist_entries
    FOR ALL TO CURRENT_USER
    USING (true);

-- Recurring series
ALTER TABLE recurring_booking_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_booking_series FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_recurring ON recurring_booking_series
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_recurring ON recurring_booking_series
    FOR ALL TO CURRENT_USER
    USING (true);

-- Staff schedules
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_staff_schedules ON staff_schedules
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_staff_schedules ON staff_schedules
    FOR ALL TO CURRENT_USER
    USING (true);

-- Staff time off
ALTER TABLE staff_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_time_off FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_staff_time_off ON staff_time_off
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_staff_time_off ON staff_time_off
    FOR ALL TO CURRENT_USER
    USING (true);

-- Notification queue
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_notifications ON notification_queue
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_notifications ON notification_queue
    FOR ALL TO CURRENT_USER
    USING (true);

-- ============================================================
-- 10. Grant permissions to app role
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_status_history TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON slot_holds TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON waitlist_entries TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_booking_series TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_schedules TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_time_off TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_queue TO daystream_app;

-- ============================================================
-- 11. Booking reference sequence helper
-- ============================================================

CREATE OR REPLACE FUNCTION generate_booking_reference(p_business_id UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
    current_year INTEGER;
    next_num INTEGER;
    ref VARCHAR(20);
BEGIN
    current_year := EXTRACT(YEAR FROM NOW());

    SELECT COALESCE(MAX(
        CAST(SUBSTRING(booking_reference FROM 9) AS INTEGER)
    ), 0) + 1
    INTO next_num
    FROM bookings
    WHERE business_id = p_business_id
      AND booking_reference LIKE 'BK-' || current_year || '-%';

    ref := 'BK-' || current_year || '-' || LPAD(next_num::TEXT, 4, '0');
    RETURN ref;
END;
$$ LANGUAGE plpgsql;
