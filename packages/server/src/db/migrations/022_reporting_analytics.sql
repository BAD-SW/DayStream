-- Phase 17: Reporting & Analytics tables

-- ============================================================
-- 1. Aggregated Daily Metrics
-- ============================================================

CREATE TABLE report_daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    metric_category VARCHAR(30) NOT NULL,
    metric_name VARCHAR(50) NOT NULL,
    metric_value NUMERIC NOT NULL DEFAULT 0,
    dimensions JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, metric_date, metric_category, metric_name, dimensions)
);

CREATE INDEX idx_daily_metrics_tenant_date ON report_daily_metrics(tenant_id, metric_date);
CREATE INDEX idx_daily_metrics_category ON report_daily_metrics(tenant_id, metric_category, metric_name);

-- ============================================================
-- 2. Dashboard Configurations
-- ============================================================

CREATE TABLE dashboard_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL DEFAULT 'My Dashboard',
    role_type VARCHAR(30),
    widgets JSONB NOT NULL DEFAULT '[]',
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dashboard_configs_user ON dashboard_configs(user_id);

-- ============================================================
-- 3. Scheduled Reports
-- ============================================================

CREATE TABLE scheduled_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    schedule_type VARCHAR(20) NOT NULL
        CHECK (schedule_type IN ('daily', 'weekly', 'monthly', 'custom')),
    cron_expression VARCHAR(100),
    report_types JSONB NOT NULL DEFAULT '[]',
    recipients JSONB NOT NULL DEFAULT '[]',
    format VARCHAR(10) NOT NULL DEFAULT 'pdf'
        CHECK (format IN ('pdf', 'csv', 'email_summary')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_sent_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_reports_tenant ON scheduled_reports(tenant_id);
CREATE INDEX idx_scheduled_reports_next ON scheduled_reports(next_run_at) WHERE is_active = true;

-- ============================================================
-- 4. Report Delivery Log
-- ============================================================

CREATE TABLE report_delivery_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheduled_report_id UUID NOT NULL REFERENCES scheduled_reports(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recipients_count INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent', 'failed')),
    error_message TEXT
);

-- ============================================================
-- 5. RLS Policies
-- ============================================================

ALTER TABLE report_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_daily_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_report_daily_metrics ON report_daily_metrics FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_report_daily_metrics ON report_daily_metrics FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE dashboard_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_dashboard_configs ON dashboard_configs FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_dashboard_configs ON dashboard_configs FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_scheduled_reports ON scheduled_reports FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_scheduled_reports ON scheduled_reports FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE report_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_delivery_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_report_delivery_log ON report_delivery_log FOR ALL TO daystream_app
    USING (scheduled_report_id IN (SELECT id FROM scheduled_reports WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_report_delivery_log ON report_delivery_log FOR ALL TO CURRENT_USER USING (true);

-- ============================================================
-- 6. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON report_daily_metrics TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_configs TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_reports TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_delivery_log TO daystream_app;
