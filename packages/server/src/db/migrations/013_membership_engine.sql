-- Phase 08: Membership & Subscriptions tables

-- ============================================================
-- 1. Membership Plans
-- ============================================================

CREATE TABLE membership_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    plan_type VARCHAR(20) NOT NULL
        CHECK (plan_type IN ('unlimited', 'credit', 'hybrid', 'punch_card', 'intro_package')),
    billing_cycle VARCHAR(20) NOT NULL
        CHECK (billing_cycle IN ('monthly', 'quarterly', 'annually', 'one_time')),
    price INTEGER NOT NULL,
    -- Credit configuration
    credits_per_cycle INTEGER,
    credit_validity_days INTEGER,
    rollover_policy VARCHAR(20) DEFAULT 'none'
        CHECK (rollover_policy IN ('none', 'limited', 'unlimited')),
    max_rollover_credits INTEGER,
    -- Punch card / intro
    total_sessions INTEGER,
    expiration_days INTEGER,
    is_intro_only BOOLEAN NOT NULL DEFAULT false,
    -- Limits
    max_frequency_per_day INTEGER,
    trial_days INTEGER DEFAULT 0,
    max_pause_days_per_year INTEGER DEFAULT 30,
    max_pauses_per_year INTEGER DEFAULT 2,
    -- Family
    max_additional_members INTEGER DEFAULT 0,
    shared_credits BOOLEAN DEFAULT false,
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_membership_plans_business ON membership_plans(business_id);
CREATE INDEX idx_membership_plans_status ON membership_plans(business_id, status);
CREATE INDEX idx_membership_plans_type ON membership_plans(business_id, plan_type);

-- ============================================================
-- 2. Plan Service Access
-- ============================================================

CREATE TABLE plan_service_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    category_id UUID REFERENCES service_categories(id) ON DELETE CASCADE,
    credit_cost INTEGER NOT NULL DEFAULT 1,
    access_type VARCHAR(20) NOT NULL DEFAULT 'included'
        CHECK (access_type IN ('included', 'discounted', 'exclusive')),
    discount_percentage INTEGER,
    CONSTRAINT chk_service_or_category CHECK (service_id IS NOT NULL OR category_id IS NOT NULL)
);

CREATE INDEX idx_plan_service_access_plan ON plan_service_access(plan_id);
CREATE INDEX idx_plan_service_access_service ON plan_service_access(service_id);

-- ============================================================
-- 3. Plan Benefits
-- ============================================================

CREATE TABLE plan_benefits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    benefit_type VARCHAR(30) NOT NULL
        CHECK (benefit_type IN ('discount', 'priority_booking', 'exclusive_access', 'guest_pass', 'free_addon')),
    value INTEGER,
    description VARCHAR(200),
    per_cycle BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_plan_benefits_plan ON plan_benefits(plan_id);

-- ============================================================
-- 4. Plan Upgrade Paths
-- ============================================================

CREATE TABLE plan_upgrade_paths (
    from_plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    to_plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('upgrade', 'downgrade')),
    PRIMARY KEY (from_plan_id, to_plan_id)
);

-- ============================================================
-- 5. Memberships (active instances)
-- ============================================================

CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    plan_id UUID NOT NULL REFERENCES membership_plans(id),
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'paused', 'frozen', 'cancelled', 'expired')),
    -- Billing
    start_date DATE NOT NULL,
    end_date DATE,
    next_billing_date DATE,
    auto_renew BOOLEAN NOT NULL DEFAULT true,
    -- Credits
    credit_balance INTEGER NOT NULL DEFAULT 0,
    -- Pause tracking
    paused_at TIMESTAMPTZ,
    pause_end_date DATE,
    total_paused_days INTEGER NOT NULL DEFAULT 0,
    pause_count INTEGER NOT NULL DEFAULT 0,
    -- Family
    primary_membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id),
    cancellation_reason TEXT,
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_memberships_business ON memberships(business_id);
CREATE INDEX idx_memberships_customer ON memberships(customer_id);
CREATE INDEX idx_memberships_plan ON memberships(plan_id);
CREATE INDEX idx_memberships_status ON memberships(business_id, status);
CREATE INDEX idx_memberships_billing ON memberships(next_billing_date) WHERE status = 'active' AND auto_renew = true;
CREATE INDEX idx_memberships_primary ON memberships(primary_membership_id);

-- ============================================================
-- 6. Credit Transactions
-- ============================================================

CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('allocated', 'deducted', 'restored', 'expired', 'adjusted', 'rollover')),
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    description TEXT,
    booking_id UUID REFERENCES bookings(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_membership ON credit_transactions(membership_id);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(membership_id, type);
CREATE INDEX idx_credit_transactions_expires ON credit_transactions(expires_at) WHERE type = 'allocated' AND expires_at IS NOT NULL;
CREATE INDEX idx_credit_transactions_booking ON credit_transactions(booking_id);

-- ============================================================
-- 7. Membership Status History
-- ============================================================

CREATE TABLE membership_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    changed_by UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_membership_history_membership ON membership_status_history(membership_id);

-- ============================================================
-- 8. RLS Policies
-- ============================================================

-- Membership plans
ALTER TABLE membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_plans FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_membership_plans ON membership_plans
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_membership_plans ON membership_plans
    FOR ALL TO postgres
    USING (true);

-- Plan service access
ALTER TABLE plan_service_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_service_access FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_plan_service_access ON plan_service_access
    FOR ALL TO daystream_app
    USING (plan_id IN (SELECT id FROM membership_plans WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_plan_service_access ON plan_service_access
    FOR ALL TO postgres
    USING (true);

-- Plan benefits
ALTER TABLE plan_benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_benefits FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_plan_benefits ON plan_benefits
    FOR ALL TO daystream_app
    USING (plan_id IN (SELECT id FROM membership_plans WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_plan_benefits ON plan_benefits
    FOR ALL TO postgres
    USING (true);

-- Memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_memberships ON memberships
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_memberships ON memberships
    FOR ALL TO postgres
    USING (true);

-- Credit transactions
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_credit_transactions ON credit_transactions
    FOR ALL TO daystream_app
    USING (membership_id IN (SELECT id FROM memberships WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_credit_transactions ON credit_transactions
    FOR ALL TO postgres
    USING (true);

-- Membership status history
ALTER TABLE membership_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_status_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_membership_history ON membership_status_history
    FOR ALL TO daystream_app
    USING (membership_id IN (SELECT id FROM memberships WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_membership_history ON membership_status_history
    FOR ALL TO postgres
    USING (true);

-- ============================================================
-- 9. Grant permissions to app role
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON membership_plans TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_service_access TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_benefits TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_upgrade_paths TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON credit_transactions TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON membership_status_history TO daystream_app;
