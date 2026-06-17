-- Phase 24: Query Editor tables

-- ============================================================
-- 1. Query History table
-- ============================================================

CREATE TABLE query_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    query_text TEXT NOT NULL CHECK(char_length(query_text) <= 10000),
    execution_time_ms INTEGER NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL CHECK(status IN ('success', 'error', 'timeout', 'cancelled')),
    error_message TEXT,
    truncated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS policies for query_history
ALTER TABLE query_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY query_history_tenant_isolation ON query_history
    FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY query_history_user_scope ON query_history
    FOR SELECT TO daystream_app
    USING (user_id = current_setting('app.current_user_id')::uuid);

CREATE POLICY admin_full_access_query_history ON query_history
    FOR ALL TO postgres
    USING (true);

-- Index for user history lookups (sorted by newest first)
CREATE INDEX idx_query_history_user_created ON query_history(user_id, created_at DESC);

-- Index for auto-purge of old entries
CREATE INDEX idx_query_history_created_at ON query_history(created_at);

-- ============================================================
-- 2. Saved Queries table
-- ============================================================

CREATE TABLE saved_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    query_text TEXT NOT NULL CHECK(char_length(query_text) <= 10000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- RLS policies for saved_queries
ALTER TABLE saved_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_queries_tenant_isolation ON saved_queries
    FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY saved_queries_user_scope ON saved_queries
    FOR ALL TO daystream_app
    USING (user_id = current_setting('app.current_user_id')::uuid);

CREATE POLICY admin_full_access_saved_queries ON saved_queries
    FOR ALL TO postgres
    USING (true);

-- Index for user lookups (sorted by most recently updated)
CREATE INDEX idx_saved_queries_user ON saved_queries(user_id, updated_at DESC);

-- ============================================================
-- 3. Grant permissions to app role
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON query_history TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_queries TO daystream_app;
