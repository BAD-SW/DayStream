-- Phase 11: Accounts Payable tables

-- ============================================================
-- 1. Compensation Rules
-- ============================================================

CREATE TABLE compensation_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    rule_type VARCHAR(20) NOT NULL
        CHECK (rule_type IN ('hourly', 'per_session', 'commission', 'salary')),
    rate INTEGER NOT NULL,
    threshold_amount INTEGER,
    overtime_multiplier NUMERIC(3,2) DEFAULT 1.5,
    overtime_after_hours INTEGER DEFAULT 40,
    holiday_multiplier NUMERIC(3,2) DEFAULT 2.0,
    effective_from DATE NOT NULL,
    effective_to DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_compensation_rules_business ON compensation_rules(business_id);
CREATE INDEX idx_compensation_rules_user ON compensation_rules(user_id);

-- ============================================================
-- 2. Payroll Deductions
-- ============================================================

CREATE TABLE payroll_deductions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    deduction_type VARCHAR(20) NOT NULL
        CHECK (deduction_type IN ('tax', 'insurance', 'benefits', 'loan', 'other')),
    calculation_type VARCHAR(10) NOT NULL CHECK (calculation_type IN ('percentage', 'fixed')),
    value INTEGER NOT NULL,
    is_recurring BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE NOT NULL,
    effective_to DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payroll_deductions_business ON payroll_deductions(business_id);
CREATE INDEX idx_payroll_deductions_user ON payroll_deductions(user_id);

-- ============================================================
-- 3. Pay Periods
-- ============================================================

CREATE TABLE pay_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'processing', 'finalized')),
    finalized_at TIMESTAMPTZ,
    finalized_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, period_start, period_end)
);

CREATE INDEX idx_pay_periods_business ON pay_periods(business_id);

-- ============================================================
-- 4. Payroll Entries
-- ============================================================

CREATE TABLE payroll_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pay_period_id UUID NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    hours_worked NUMERIC(6,2) NOT NULL DEFAULT 0,
    sessions_delivered INTEGER NOT NULL DEFAULT 0,
    revenue_generated INTEGER NOT NULL DEFAULT 0,
    gross_pay INTEGER NOT NULL DEFAULT 0,
    total_deductions INTEGER NOT NULL DEFAULT 0,
    net_pay INTEGER NOT NULL DEFAULT 0,
    breakdown JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'finalized')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payroll_entries_period ON payroll_entries(pay_period_id);
CREATE INDEX idx_payroll_entries_user ON payroll_entries(user_id);

-- ============================================================
-- 5. Time Entries
-- ============================================================

CREATE TABLE time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('clock', 'manual', 'booking')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    hours NUMERIC(5,2),
    description VARCHAR(200),
    booking_id UUID REFERENCES bookings(id),
    approved BOOLEAN DEFAULT false,
    approved_by UUID REFERENCES users(id),
    pay_period_id UUID REFERENCES pay_periods(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_time_entries_business ON time_entries(business_id);
CREATE INDEX idx_time_entries_user ON time_entries(user_id);
CREATE INDEX idx_time_entries_period ON time_entries(pay_period_id);

-- ============================================================
-- 6. Vendors
-- ============================================================

CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    contact_name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    tax_id VARCHAR(50),
    payment_terms INTEGER DEFAULT 30,
    category VARCHAR(50),
    default_account_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vendors_business ON vendors(business_id);

-- ============================================================
-- 7. Bills
-- ============================================================

CREATE TABLE bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    invoice_number VARCHAR(100),
    amount INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending', 'approved', 'paid', 'overdue', 'void')),
    amount_paid INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    recurrence_interval VARCHAR(20),
    attachment_path TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bills_business ON bills(business_id);
CREATE INDEX idx_bills_vendor ON bills(vendor_id);
CREATE INDEX idx_bills_status ON bills(business_id, status);
CREATE INDEX idx_bills_due_date ON bills(due_date) WHERE status NOT IN ('paid', 'void');

CREATE TABLE bill_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    description VARCHAR(200) NOT NULL,
    quantity NUMERIC(8,2) NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL,
    account_id UUID,
    amount INTEGER NOT NULL
);

CREATE INDEX idx_bill_line_items_bill ON bill_line_items(bill_id);

-- ============================================================
-- 8. Expenses
-- ============================================================

CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    amount INTEGER NOT NULL,
    account_id UUID,
    description VARCHAR(500),
    vendor_id UUID REFERENCES vendors(id),
    payment_method VARCHAR(50),
    receipt_path TEXT,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES users(id),
    submitted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_business ON expenses(business_id);
CREATE INDEX idx_expenses_date ON expenses(business_id, date);
CREATE INDEX idx_expenses_status ON expenses(business_id, status);

-- ============================================================
-- 9. Chart of Accounts
-- ============================================================

CREATE TABLE chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES chart_of_accounts(id),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL
        CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id, code)
);

CREATE INDEX idx_chart_of_accounts_business ON chart_of_accounts(business_id);
CREATE INDEX idx_chart_of_accounts_type ON chart_of_accounts(business_id, account_type);

-- ============================================================
-- 10. Journal Entries
-- ============================================================

CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    description VARCHAR(500) NOT NULL,
    reference_type VARCHAR(30),
    reference_id UUID,
    is_void BOOLEAN NOT NULL DEFAULT false,
    void_entry_id UUID REFERENCES journal_entries(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_journal_entries_business ON journal_entries(business_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(business_id, entry_date);
CREATE INDEX idx_journal_entries_reference ON journal_entries(reference_type, reference_id);

CREATE TABLE journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    debit INTEGER NOT NULL DEFAULT 0,
    credit INTEGER NOT NULL DEFAULT 0,
    description VARCHAR(200)
);

CREATE INDEX idx_journal_entry_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_journal_entry_lines_account ON journal_entry_lines(account_id);

-- ============================================================
-- 11. Bank Reconciliation
-- ============================================================

CREATE TABLE bank_statements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    account_name VARCHAR(100) NOT NULL,
    statement_date DATE NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_statements_business ON bank_statements(business_id);

CREATE TABLE bank_statement_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    description VARCHAR(500),
    amount INTEGER NOT NULL,
    reference VARCHAR(100),
    reconciliation_status VARCHAR(20) NOT NULL DEFAULT 'unmatched'
        CHECK (reconciliation_status IN ('unmatched', 'matched', 'discrepancy')),
    matched_entry_id UUID REFERENCES journal_entries(id),
    reconciled_at TIMESTAMPTZ
);

CREATE INDEX idx_bank_statement_lines_statement ON bank_statement_lines(statement_id);
CREATE INDEX idx_bank_statement_lines_status ON bank_statement_lines(reconciliation_status);

-- ============================================================
-- 12. Tax Documents
-- ============================================================

CREATE TABLE tax_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    tax_year INTEGER NOT NULL,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('w2', '1099_nec')),
    total_compensation INTEGER NOT NULL,
    total_federal_tax INTEGER NOT NULL DEFAULT 0,
    total_state_tax INTEGER NOT NULL DEFAULT 0,
    total_social_security INTEGER NOT NULL DEFAULT 0,
    total_medicare INTEGER NOT NULL DEFAULT 0,
    data JSONB NOT NULL,
    file_path TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'generated'
        CHECK (status IN ('generated', 'delivered', 'corrected')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    corrects_id UUID REFERENCES tax_documents(id)
);

CREATE INDEX idx_tax_documents_business ON tax_documents(business_id);
CREATE INDEX idx_tax_documents_user ON tax_documents(user_id, tax_year);

-- ============================================================
-- 13. RLS Policies
-- ============================================================

ALTER TABLE compensation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compensation_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_compensation_rules ON compensation_rules FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_compensation_rules ON compensation_rules FOR ALL TO postgres USING (true);

ALTER TABLE payroll_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_deductions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payroll_deductions ON payroll_deductions FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_payroll_deductions ON payroll_deductions FOR ALL TO postgres USING (true);

ALTER TABLE pay_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pay_periods ON pay_periods FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_pay_periods ON pay_periods FOR ALL TO postgres USING (true);

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payroll_entries ON payroll_entries FOR ALL TO daystream_app
    USING (pay_period_id IN (SELECT id FROM pay_periods WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_payroll_entries ON payroll_entries FOR ALL TO postgres USING (true);

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_time_entries ON time_entries FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_time_entries ON time_entries FOR ALL TO postgres USING (true);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vendors ON vendors FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_vendors ON vendors FOR ALL TO postgres USING (true);

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bills ON bills FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_bills ON bills FOR ALL TO postgres USING (true);

ALTER TABLE bill_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_line_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bill_line_items ON bill_line_items FOR ALL TO daystream_app
    USING (bill_id IN (SELECT id FROM bills WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_bill_line_items ON bill_line_items FOR ALL TO postgres USING (true);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_expenses ON expenses FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_expenses ON expenses FOR ALL TO postgres USING (true);

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chart_of_accounts ON chart_of_accounts FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_chart_of_accounts ON chart_of_accounts FOR ALL TO postgres USING (true);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_journal_entries ON journal_entries FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_journal_entries ON journal_entries FOR ALL TO postgres USING (true);

ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_journal_entry_lines ON journal_entry_lines FOR ALL TO daystream_app
    USING (journal_entry_id IN (SELECT id FROM journal_entries WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_journal_entry_lines ON journal_entry_lines FOR ALL TO postgres USING (true);

ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bank_statements ON bank_statements FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_bank_statements ON bank_statements FOR ALL TO postgres USING (true);

ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bank_statement_lines ON bank_statement_lines FOR ALL TO daystream_app
    USING (statement_id IN (SELECT id FROM bank_statements WHERE business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)));
CREATE POLICY admin_full_access_bank_statement_lines ON bank_statement_lines FOR ALL TO postgres USING (true);

ALTER TABLE tax_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tax_documents ON tax_documents FOR ALL TO daystream_app
    USING (business_id IN (SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid));
CREATE POLICY admin_full_access_tax_documents ON tax_documents FOR ALL TO postgres USING (true);

-- ============================================================
-- 14. Grant permissions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON compensation_rules TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_deductions TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pay_periods TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_entries TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendors TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bills TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bill_line_items TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON chart_of_accounts TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entry_lines TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statements TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statement_lines TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_documents TO daystream_app;
