-- Phase 20: Integrations tables

-- ============================================================
-- 1. Integration Connections
-- ============================================================

CREATE TABLE integration_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    integration_type VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'disconnected', 'error', 'expired')),
    config JSONB DEFAULT '{}',
    oauth_access_token TEXT,
    oauth_refresh_token TEXT,
    oauth_expires_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_connections_tenant ON integration_connections(tenant_id);
CREATE INDEX idx_integration_connections_type ON integration_connections(tenant_id, integration_type);

-- ============================================================
-- 2. Sync Log
-- ============================================================

CREATE TABLE integration_sync_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    operation VARCHAR(30) NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    resource_type VARCHAR(50),
    resource_id UUID,
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'retrying')),
    error_message TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_log_connection ON integration_sync_log(connection_id);
CREATE INDEX idx_sync_log_date ON integration_sync_log(created_at);

-- ============================================================
-- 3. Webhook Subscriptions
-- ============================================================

CREATE TABLE webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    secret VARCHAR(200) NOT NULL,
    event_types JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_delivery_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_subs_tenant ON webhook_subscriptions(tenant_id);

-- ============================================================
-- 4. Webhook Deliveries
-- ============================================================

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id);
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) WHERE status = 'retrying';

-- ============================================================
-- 5. API Keys
-- ============================================================

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(200) NOT NULL,
    key_prefix VARCHAR(10) NOT NULL,
    scopes JSONB DEFAULT '["*"]',
    rate_limit INTEGER NOT NULL DEFAULT 1000,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

-- ============================================================
-- 6. iCal Feeds
-- ============================================================

CREATE TABLE ical_feeds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    customer_id UUID REFERENCES customers(id),
    feed_token VARCHAR(100) NOT NULL UNIQUE,
    feed_type VARCHAR(20) NOT NULL CHECK (feed_type IN ('staff', 'customer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ical_feeds_token ON ical_feeds(feed_token);

-- ============================================================
-- 7. RLS Policies
-- ============================================================

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_integration_connections ON integration_connections FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_integration_connections ON integration_connections FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_integration_sync_log ON integration_sync_log FOR ALL TO daystream_app
    USING (connection_id IN (SELECT id FROM integration_connections WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_integration_sync_log ON integration_sync_log FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_webhook_subscriptions ON webhook_subscriptions FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_webhook_subscriptions ON webhook_subscriptions FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_webhook_deliveries ON webhook_deliveries FOR ALL TO daystream_app
    USING (subscription_id IN (SELECT id FROM webhook_subscriptions WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_webhook_deliveries ON webhook_deliveries FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_api_keys ON api_keys FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_api_keys ON api_keys FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE ical_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE ical_feeds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ical_feeds ON ical_feeds FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_ical_feeds ON ical_feeds FOR ALL TO CURRENT_USER USING (true);

-- ============================================================
-- 8. Grant Permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON integration_connections TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON integration_sync_log TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_subscriptions TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ical_feeds TO daystream_app;
