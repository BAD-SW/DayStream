-- Phase 14: Events & Workshops tables

-- ============================================================
-- 1. Event Types
-- ============================================================

CREATE TABLE event_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_event_types_tenant ON event_types(tenant_id);

-- ============================================================
-- 2. Event Series
-- ============================================================

CREATE TABLE event_series (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    total_sessions INTEGER NOT NULL,
    pricing_model VARCHAR(20) NOT NULL DEFAULT 'per_series'
        CHECK (pricing_model IN ('per_series', 'per_session')),
    series_price INTEGER,
    allow_drop_in BOOLEAN NOT NULL DEFAULT false,
    require_sequential BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_series_tenant ON event_series(tenant_id);

-- ============================================================
-- 3. Recurring Event Templates
-- ============================================================

CREATE TABLE recurring_event_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type_id UUID NOT NULL REFERENCES event_types(id),
    title VARCHAR(300) NOT NULL,
    description TEXT,
    recurrence_pattern VARCHAR(20) NOT NULL
        CHECK (recurrence_pattern IN ('weekly', 'biweekly', 'monthly', 'custom')),
    custom_interval_days INTEGER,
    day_of_week INTEGER,
    day_of_month INTEGER,
    start_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL,
    location_id UUID,
    location_name VARCHAR(200),
    capacity INTEGER NOT NULL,
    end_type VARCHAR(20) NOT NULL DEFAULT 'ongoing'
        CHECK (end_type IN ('ongoing', 'count', 'date')),
    end_after_count INTEGER,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'cancelled')),
    template_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_templates_tenant ON recurring_event_templates(tenant_id);

-- ============================================================
-- 4. Events
-- ============================================================

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type_id UUID NOT NULL REFERENCES event_types(id),
    title VARCHAR(300) NOT NULL,
    slug VARCHAR(300) NOT NULL,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    location_id UUID,
    location_name VARCHAR(200),
    capacity INTEGER NOT NULL,
    min_attendees INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
    cover_image_path TEXT,
    tags TEXT[] DEFAULT '{}',
    custom_fields JSONB DEFAULT '[]',
    cancellation_policy JSONB,
    recurrence_id UUID REFERENCES recurring_event_templates(id) ON DELETE SET NULL,
    series_id UUID REFERENCES event_series(id) ON DELETE SET NULL,
    series_order INTEGER,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug),
    CHECK (end_time > start_time)
);

CREATE INDEX idx_events_tenant ON events(tenant_id);
CREATE INDEX idx_events_status ON events(tenant_id, status);
CREATE INDEX idx_events_start ON events(tenant_id, start_time);
CREATE INDEX idx_events_type ON events(event_type_id);
CREATE INDEX idx_events_series ON events(series_id);
CREATE INDEX idx_events_recurrence ON events(recurrence_id);

-- ============================================================
-- 5. Event Facilitators
-- ============================================================

CREATE TABLE event_facilitators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES staff_profiles(id),
    role VARCHAR(50) DEFAULT 'facilitator',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, staff_id)
);

CREATE INDEX idx_event_facilitators_event ON event_facilitators(event_id);

-- ============================================================
-- 6. Ticket Tiers
-- ============================================================

CREATE TABLE event_ticket_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,
    quantity_available INTEGER,
    quantity_sold INTEGER NOT NULL DEFAULT 0,
    availability_start TIMESTAMPTZ,
    availability_end TIMESTAMPTZ,
    eligibility_type VARCHAR(30) DEFAULT 'all'
        CHECK (eligibility_type IN ('all', 'members_only', 'first_time', 'custom')),
    eligibility_config JSONB,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_tickets_event ON event_ticket_tiers(event_id);

-- ============================================================
-- 7. Registrations
-- ============================================================

CREATE TABLE event_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    ticket_tier_id UUID NOT NULL REFERENCES event_ticket_tiers(id),
    reference_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'waitlisted', 'no_show')),
    amount_paid INTEGER NOT NULL DEFAULT 0,
    attendee_info JSONB DEFAULT '{}',
    group_size INTEGER NOT NULL DEFAULT 1,
    checked_in_at TIMESTAMPTZ,
    check_in_method VARCHAR(20),
    cancelled_at TIMESTAMPTZ,
    refund_amount INTEGER DEFAULT 0,
    hold_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_registrations_event ON event_registrations(event_id);
CREATE INDEX idx_event_registrations_customer ON event_registrations(customer_id);
CREATE INDEX idx_event_registrations_status ON event_registrations(event_id, status);

-- ============================================================
-- 8. Waitlist
-- ============================================================

CREATE TABLE event_waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    ticket_tier_id UUID REFERENCES event_ticket_tiers(id),
    position INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'notified', 'confirmed', 'expired', 'cancelled')),
    notified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, customer_id)
);

CREATE INDEX idx_event_waitlist_event ON event_waitlist(event_id, position);

-- ============================================================
-- 9. Communications Log
-- ============================================================

CREATE TABLE event_communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    communication_type VARCHAR(30) NOT NULL
        CHECK (communication_type IN ('confirmation', 'reminder', 'preparation', 'follow_up', 'cancellation', 'ad_hoc')),
    recipient_type VARCHAR(20) NOT NULL DEFAULT 'all'
        CHECK (recipient_type IN ('all', 'individual', 'waitlisted')),
    recipient_id UUID,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    subject VARCHAR(300),
    content TEXT
);

CREATE INDEX idx_event_communications_event ON event_communications(event_id);

-- ============================================================
-- 10. RLS Policies
-- ============================================================

ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_types FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_types ON event_types FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_event_types ON event_types FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE event_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_series FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_series ON event_series FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_event_series ON event_series FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE recurring_event_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_event_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_recurring_templates ON recurring_event_templates FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_recurring_templates ON recurring_event_templates FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_events ON events FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_events ON events FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE event_facilitators ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_facilitators FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_facilitators ON event_facilitators FOR ALL TO daystream_app
    USING (event_id IN (SELECT id FROM events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_event_facilitators ON event_facilitators FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE event_ticket_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_ticket_tiers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_ticket_tiers ON event_ticket_tiers FOR ALL TO daystream_app
    USING (event_id IN (SELECT id FROM events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_event_ticket_tiers ON event_ticket_tiers FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_registrations ON event_registrations FOR ALL TO daystream_app
    USING (event_id IN (SELECT id FROM events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_event_registrations ON event_registrations FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE event_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_waitlist FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_waitlist ON event_waitlist FOR ALL TO daystream_app
    USING (event_id IN (SELECT id FROM events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_event_waitlist ON event_waitlist FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE event_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_communications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_communications ON event_communications FOR ALL TO daystream_app
    USING (event_id IN (SELECT id FROM events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_event_communications ON event_communications FOR ALL TO CURRENT_USER USING (true);

-- ============================================================
-- 11. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON event_types TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_series TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_event_templates TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON events TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_facilitators TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_ticket_tiers TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_registrations TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_waitlist TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_communications TO daystream_app;
