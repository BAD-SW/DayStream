-- Phase 16: Marketing & Automation tables

-- ============================================================
-- 1. Message Templates
-- ============================================================

CREATE TABLE message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
    subject VARCHAR(500),
    html_content TEXT,
    text_content TEXT,
    blocks JSONB DEFAULT '[]',
    is_system BOOLEAN NOT NULL DEFAULT false,
    category VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_templates_tenant ON message_templates(tenant_id);

-- ============================================================
-- 2. Campaigns
-- ============================================================

CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
    segment_id UUID,
    subject VARCHAR(500),
    sender_name VARCHAR(100),
    sender_email VARCHAR(255),
    content TEXT,
    html_content TEXT,
    template_id UUID REFERENCES message_templates(id),
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    ab_test_enabled BOOLEAN NOT NULL DEFAULT false,
    ab_variant_b_subject VARCHAR(500),
    ab_split_percentage INTEGER DEFAULT 50,
    total_recipients INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX idx_campaigns_status ON campaigns(tenant_id, status);

-- ============================================================
-- 3. Campaign Recipients
-- ============================================================

CREATE TABLE campaign_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    email VARCHAR(255),
    phone VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'complained', 'unsubscribed')),
    ab_variant VARCHAR(1),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    provider_message_id VARCHAR(200)
);

CREATE INDEX idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_customer ON campaign_recipients(customer_id);

-- ============================================================
-- 4. Sequences
-- ============================================================

CREATE TABLE sequences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    canvas_data JSONB NOT NULL DEFAULT '{}',
    allow_reentry BOOLEAN NOT NULL DEFAULT false,
    is_template BOOLEAN NOT NULL DEFAULT false,
    template_category VARCHAR(50),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ
);

CREATE INDEX idx_sequences_tenant ON sequences(tenant_id);
CREATE INDEX idx_sequences_status ON sequences(tenant_id, status);

-- ============================================================
-- 5. Sequence Steps
-- ============================================================

CREATE TABLE sequence_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    step_category VARCHAR(20) NOT NULL
        CHECK (step_category IN ('trigger', 'action', 'output', 'start', 'end')),
    step_type VARCHAR(30) NOT NULL,
    label VARCHAR(200),
    config JSONB NOT NULL DEFAULT '{}',
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sequence_steps_sequence ON sequence_steps(sequence_id);

-- ============================================================
-- 6. Sequence Connections
-- ============================================================

CREATE TABLE sequence_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    source_step_id UUID NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
    target_step_id UUID NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
    label VARCHAR(100),
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX idx_sequence_connections_sequence ON sequence_connections(sequence_id);

-- ============================================================
-- 7. Sequence Enrollments
-- ============================================================

CREATE TABLE sequence_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    current_step_id UUID REFERENCES sequence_steps(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'exited', 'paused')),
    context JSONB DEFAULT '{}',
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    step_entered_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    exit_reason VARCHAR(200),
    UNIQUE(sequence_id, customer_id)
);

CREATE INDEX idx_sequence_enrollments_sequence ON sequence_enrollments(sequence_id);
CREATE INDEX idx_sequence_enrollments_customer ON sequence_enrollments(customer_id);
CREATE INDEX idx_sequence_enrollments_active ON sequence_enrollments(sequence_id, status) WHERE status = 'active';

-- ============================================================
-- 8. Sequence History
-- ============================================================

CREATE TABLE sequence_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    step_id UUID NOT NULL REFERENCES sequence_steps(id),
    action VARCHAR(50) NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sequence_history_sequence ON sequence_history(sequence_id);
CREATE INDEX idx_sequence_history_customer ON sequence_history(customer_id);

-- ============================================================
-- 9. Communication Preferences
-- ============================================================

CREATE TABLE communication_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
    category VARCHAR(50) NOT NULL DEFAULT 'marketing',
    opted_in BOOLEAN NOT NULL DEFAULT false,
    opted_in_at TIMESTAMPTZ,
    opted_out_at TIMESTAMPTZ,
    source VARCHAR(50),
    UNIQUE(tenant_id, customer_id, channel, category)
);

CREATE INDEX idx_comm_prefs_customer ON communication_preferences(customer_id);
CREATE INDEX idx_comm_prefs_tenant ON communication_preferences(tenant_id);

-- ============================================================
-- 10. Lead Funnels
-- ============================================================

CREATE TABLE lead_funnels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) NOT NULL,
    headline VARCHAR(300),
    description TEXT,
    image_path TEXT,
    form_fields JSONB DEFAULT '[]',
    cta_text VARCHAR(100) DEFAULT 'Sign Up',
    discount_code VARCHAR(50),
    sequence_id UUID REFERENCES sequences(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    page_views INTEGER NOT NULL DEFAULT 0,
    submissions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_lead_funnels_tenant ON lead_funnels(tenant_id);

-- ============================================================
-- 11. RLS Policies
-- ============================================================

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_message_templates ON message_templates FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_message_templates ON message_templates FOR ALL TO postgres USING (true);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaigns ON campaigns FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_campaigns ON campaigns FOR ALL TO postgres USING (true);

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign_recipients ON campaign_recipients FOR ALL TO daystream_app
    USING (campaign_id IN (SELECT id FROM campaigns WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_campaign_recipients ON campaign_recipients FOR ALL TO postgres USING (true);

ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sequences ON sequences FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_sequences ON sequences FOR ALL TO postgres USING (true);

ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sequence_steps ON sequence_steps FOR ALL TO daystream_app
    USING (sequence_id IN (SELECT id FROM sequences WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_sequence_steps ON sequence_steps FOR ALL TO postgres USING (true);

ALTER TABLE sequence_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sequence_connections ON sequence_connections FOR ALL TO daystream_app
    USING (sequence_id IN (SELECT id FROM sequences WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_sequence_connections ON sequence_connections FOR ALL TO postgres USING (true);

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sequence_enrollments ON sequence_enrollments FOR ALL TO daystream_app
    USING (sequence_id IN (SELECT id FROM sequences WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_sequence_enrollments ON sequence_enrollments FOR ALL TO postgres USING (true);

ALTER TABLE sequence_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sequence_history ON sequence_history FOR ALL TO daystream_app
    USING (sequence_id IN (SELECT id FROM sequences WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_sequence_history ON sequence_history FOR ALL TO postgres USING (true);

ALTER TABLE communication_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_communication_preferences ON communication_preferences FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_communication_preferences ON communication_preferences FOR ALL TO postgres USING (true);

ALTER TABLE lead_funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_funnels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_lead_funnels ON lead_funnels FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_lead_funnels ON lead_funnels FOR ALL TO postgres USING (true);

-- ============================================================
-- 12. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON message_templates TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_recipients TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sequences TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sequence_steps TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sequence_connections TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sequence_enrollments TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sequence_history TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON communication_preferences TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_funnels TO daystream_app;
