-- Spec 51, gap 7 (design 7.7): purchase orders, receiving stock against them, and the vendor bill.
BEGIN;

-- An order placed with a vendor, delivered to one location.
CREATE TABLE IF NOT EXISTS inv_purchase_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  business_id  UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  po_number    VARCHAR(20) NOT NULL,
  vendor_id    UUID NOT NULL REFERENCES fin_vendors(id),
  location_id  UUID NOT NULL REFERENCES sys_locations(id),
  status       VARCHAR(20) NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'sent', 'partly_received', 'received', 'closed', 'cancelled')),
  expected_on  DATE,
  note         TEXT,
  sent_at      TIMESTAMPTZ,
  created_by   UUID REFERENCES usr_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, po_number)
);
CREATE INDEX IF NOT EXISTS idx_inv_po_business ON inv_purchase_orders (business_id, created_at DESC);

-- One product (or option) on a purchase order: ordered, received so far, billed so far.
CREATE TABLE IF NOT EXISTS inv_po_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  business_id     UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  po_id           UUID NOT NULL REFERENCES inv_purchase_orders(id) ON DELETE CASCADE,
  merchandise_id  UUID NOT NULL REFERENCES prd_merchandise(id),
  variant_id      UUID REFERENCES prd_merchandise_variants(id),
  qty_ordered     INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received    INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  qty_billed      INTEGER NOT NULL DEFAULT 0 CHECK (qty_billed >= 0 AND qty_billed <= qty_received),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_po_lines_po ON inv_po_lines (po_id);

-- A receipt movement says which purchase order line it came in on; a bill says which order it bills.
ALTER TABLE inv_movements ADD COLUMN IF NOT EXISTS po_line_id UUID REFERENCES inv_po_lines(id) ON DELETE SET NULL;
ALTER TABLE fin_bills ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES inv_purchase_orders(id) ON DELETE SET NULL;

-- Inventory (asset): stock bought is held here until it is sold (design 7.5).
INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '1300', 'Inventory', 'asset', true
FROM sys_businesses b
WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts WHERE business_id = b.id)
ON CONFLICT (business_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '1000', 'Assets', 'asset', true),
        (p_business_id, '1100', 'Cash & Bank', 'asset', true),
        (p_business_id, '1200', 'Accounts Receivable', 'asset', true),
        (p_business_id, '1300', 'Inventory', 'asset', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '2000', 'Liabilities', 'liability', true),
        (p_business_id, '2100', 'Accounts Payable', 'liability', true),
        (p_business_id, '2200', 'Payroll Payable', 'liability', true),
        (p_business_id, '2300', 'Tax Payable', 'liability', true),
        (p_business_id, '2400', 'Deferred Revenue', 'liability', true),
        (p_business_id, '2500', 'Customer Deposits', 'liability', true),
        (p_business_id, '2600', 'Gift Card Liability', 'liability', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '4000', 'Revenue', 'revenue', true),
        (p_business_id, '4100', 'Service Revenue', 'revenue', true),
        (p_business_id, '4200', 'Membership Revenue', 'revenue', true),
        (p_business_id, '4300', 'Product Revenue', 'revenue', false),
        (p_business_id, '4400', 'Gift Card Revenue', 'revenue', false),
        (p_business_id, '4500', 'Package Revenue', 'revenue', false),
        (p_business_id, '4600', 'No-Show Fee Revenue', 'revenue', false),
        (p_business_id, '4700', 'Event Revenue', 'revenue', false),
        (p_business_id, '4900', 'Discounts & Adjustments', 'revenue', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '6000', 'Operating Expenses', 'expense', true),
        (p_business_id, '6100', 'Rent & Occupancy', 'expense', false),
        (p_business_id, '6200', 'Utilities', 'expense', false),
        (p_business_id, '6300', 'Insurance', 'expense', false),
        (p_business_id, '6400', 'Marketing & Advertising', 'expense', false),
        (p_business_id, '6500', 'Supplies & Consumables', 'expense', false),
        (p_business_id, '6600', 'Equipment & Maintenance', 'expense', false),
        (p_business_id, '6700', 'Software & Technology', 'expense', false),
        (p_business_id, '6800', 'Professional Services', 'expense', false),
        (p_business_id, '6900', 'Other Operating Expenses', 'expense', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '7000', 'Payroll Expenses', 'expense', true),
        (p_business_id, '7100', 'Wages & Salaries', 'expense', true),
        (p_business_id, '7200', 'Commissions', 'expense', false),
        (p_business_id, '7300', 'Contractor Payments', 'expense', false),
        (p_business_id, '7400', 'Payroll Taxes (Employer)', 'expense', false),
        (p_business_id, '7500', 'Benefits & Insurance (Employer)', 'expense', false)
    ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Row-level security and grants
ALTER TABLE inv_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inv_purchase_orders ON inv_purchase_orders FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_inv_purchase_orders ON inv_purchase_orders FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE inv_po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_po_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inv_po_lines ON inv_po_lines FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_inv_po_lines ON inv_po_lines FOR ALL TO CURRENT_USER USING (true);

GRANT SELECT, INSERT, UPDATE ON inv_purchase_orders TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON inv_po_lines TO daystream_app;

COMMIT;
