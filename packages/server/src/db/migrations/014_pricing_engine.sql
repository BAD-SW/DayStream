-- Phase 09: Pricing Engine tables

-- ============================================================
-- 1. Pricing Rules
-- ============================================================

CREATE TABLE pricing_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    rule_type VARCHAR(30) NOT NULL
        CHECK (rule_type IN ('membership', 'promotion', 'seasonal', 'first_time', 'corporate', 'volume', 'time_of_day', 'day_of_week')),
    -- Discount
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value INTEGER NOT NULL,
    -- Priority & stacking
    priority INTEGER NOT NULL DEFAULT 100,
    stacking_mode VARCHAR(20) NOT NULL DEFAULT 'stackable'
        CHECK (stacking_mode IN ('stackable', 'exclusive', 'non_stackable')),
    -- Scope: what it applies to
    applies_to_all_services BOOLEAN NOT NULL DEFAULT true,
    service_ids UUID[],
    category_ids UUID[],
    variant_ids UUID[],
    -- Scope: who it applies to
    applies_to_all_customers BOOLEAN NOT NULL DEFAULT true,
    customer_segment VARCHAR(50),
    membership_plan_ids UUID[],
    corporate_account_id UUID,
    -- Conditions
    min_purchase_amount INTEGER,
    max_redemptions INTEGER,
    current_redemptions INTEGER NOT NULL DEFAULT 0,
    first_time_booking_limit INTEGER,
    -- Schedule
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    time_from TIME,
    time_to TIME,
    days_of_week INTEGER[],
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pricing_rules_business ON pricing_rules(business_id);
CREATE INDEX idx_pricing_rules_status ON pricing_rules(business_id, status);
CREATE INDEX idx_pricing_rules_type ON pricing_rules(business_id, rule_type);
CREATE INDEX idx_pricing_rules_effective ON pricing_rules(effective_from, effective_to) WHERE status = 'active';

-- ============================================================
-- 2. Discount Codes
-- ============================================================

CREATE TABLE discount_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value INTEGER NOT NULL,
    -- Validity
    valid_from TIMESTAMPTZ,
    valid_to TIMESTAMPTZ,
    max_total_uses INTEGER,
    max_uses_per_customer INTEGER DEFAULT 1,
    current_uses INTEGER NOT NULL DEFAULT 0,
    min_purchase_amount INTEGER,
    -- Scope
    applies_to_all_services BOOLEAN NOT NULL DEFAULT true,
    service_ids UUID[],
    category_ids UUID[],
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'expired')),
    is_single_use BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, code)
);

CREATE INDEX idx_discount_codes_business ON discount_codes(business_id);
CREATE INDEX idx_discount_codes_code ON discount_codes(business_id, code);
CREATE INDEX idx_discount_codes_status ON discount_codes(business_id, status);

-- ============================================================
-- 3. Discount Code Usage
-- ============================================================

CREATE TABLE discount_code_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_id UUID NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    booking_id UUID REFERENCES bookings(id),
    amount_saved INTEGER NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_discount_usage_code ON discount_code_usage(code_id);
CREATE INDEX idx_discount_usage_customer ON discount_code_usage(code_id, customer_id);

-- ============================================================
-- 4. Pricing Bundles
-- ============================================================

CREATE TABLE pricing_bundles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    bundle_type VARCHAR(20) NOT NULL CHECK (bundle_type IN ('fixed_price', 'percentage_off')),
    bundle_price INTEGER,
    discount_percentage INTEGER,
    expiration_days INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pricing_bundles_business ON pricing_bundles(business_id);

CREATE TABLE bundle_items (
    bundle_id UUID NOT NULL REFERENCES pricing_bundles(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES service_variants(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (bundle_id, variant_id)
);

-- ============================================================
-- 5. Corporate Accounts
-- ============================================================

CREATE TABLE corporate_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    contact_email VARCHAR(255),
    billing_email VARCHAR(255),
    discount_percentage INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_corporate_accounts_business ON corporate_accounts(business_id);

CREATE TABLE corporate_account_members (
    account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, customer_id)
);

CREATE INDEX idx_corporate_members_customer ON corporate_account_members(customer_id);

-- ============================================================
-- 6. Price History
-- ============================================================

CREATE TABLE price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id),
    entity_type VARCHAR(20) NOT NULL
        CHECK (entity_type IN ('service_variant', 'membership_plan')),
    entity_id UUID NOT NULL,
    old_price INTEGER NOT NULL,
    new_price INTEGER NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_price_history_business ON price_history(business_id);
CREATE INDEX idx_price_history_entity ON price_history(entity_type, entity_id);

-- ============================================================
-- 7. RLS Policies
-- ============================================================

-- Pricing rules
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pricing_rules ON pricing_rules
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_pricing_rules ON pricing_rules
    FOR ALL TO CURRENT_USER
    USING (true);

-- Discount codes
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_discount_codes ON discount_codes
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_discount_codes ON discount_codes
    FOR ALL TO CURRENT_USER
    USING (true);

-- Discount code usage
ALTER TABLE discount_code_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_code_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_discount_usage ON discount_code_usage
    FOR ALL TO daystream_app
    USING (code_id IN (SELECT id FROM discount_codes WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));

CREATE POLICY admin_full_access_discount_usage ON discount_code_usage
    FOR ALL TO CURRENT_USER
    USING (true);

-- Pricing bundles
ALTER TABLE pricing_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_bundles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pricing_bundles ON pricing_bundles
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_pricing_bundles ON pricing_bundles
    FOR ALL TO CURRENT_USER
    USING (true);

-- Corporate accounts
ALTER TABLE corporate_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE corporate_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_corporate_accounts ON corporate_accounts
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_corporate_accounts ON corporate_accounts
    FOR ALL TO CURRENT_USER
    USING (true);

-- Price history
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_price_history ON price_history
    FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));

CREATE POLICY admin_full_access_price_history ON price_history
    FOR ALL TO CURRENT_USER
    USING (true);

-- ============================================================
-- 8. Grant permissions to app role
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON pricing_rules TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON discount_codes TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON discount_code_usage TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pricing_bundles TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bundle_items TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON corporate_accounts TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON corporate_account_members TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON price_history TO daystream_app;
