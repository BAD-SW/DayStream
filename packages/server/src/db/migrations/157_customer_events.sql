-- Customer events (THE-20): customers browse the organisation's events, register, pay a
-- paid ticket online or at reception, and cancel within the limits the business sets.
--
-- 1. An event ticket is its own kind of sale: order line type 'event', posted to a new
--    revenue account 4700 Event Revenue (like 4600 for no-show fees).
-- 2. Each event takes a tax category of the business that hosts it (the business of the
--    event's location). NULL = that business's default tax.
-- 3. A registration remembers how it is paid ('online' | 'reception') and the order
--    that paid it, so a cancellation can refund or credit that sale.
-- 4. Business settings (sys_business_configurations), separate for events and for
--    appointments: may customers cancel, up to how many hours before the start, and
--    whether a paid cancellation goes back to the card or becomes account credit.
--    Customers could not cancel before, so cancelling starts switched off.

BEGIN;

ALTER TABLE fin_order_items DROP CONSTRAINT IF EXISTS fin_order_items_item_type_check;
ALTER TABLE fin_order_items
  ADD CONSTRAINT fin_order_items_item_type_check
  CHECK (item_type IN ('service', 'product', 'membership', 'package', 'no_show_fee', 'gift_card', 'event'));

INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '4700', 'Event Revenue', 'revenue', false
FROM sys_businesses b
WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts WHERE business_id = b.id)
ON CONFLICT (business_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '1000', 'Assets', 'asset', true),
        (p_business_id, '1100', 'Cash & Bank', 'asset', true),
        (p_business_id, '1200', 'Accounts Receivable', 'asset', true)
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

ALTER TABLE evt_events
  ADD COLUMN IF NOT EXISTS tax_category_id UUID REFERENCES svc_tax_categories(id) ON DELETE SET NULL;

ALTER TABLE evt_registrations
  ADD COLUMN IF NOT EXISTS pay_at VARCHAR(20) CHECK (pay_at IN ('online', 'reception')),
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES fin_orders(id) ON DELETE SET NULL;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description) VALUES
  ('events.customer_cancel_enabled', 'booking', 'boolean', 'false',
   'Events: customers may cancel their own registration'),
  ('events.customer_cancel_hours', 'booking', 'number', '24',
   'Events: customers may cancel up to this many hours before the event starts'),
  ('events.cancel_refund_to', 'booking', 'string', 'card',
   'Events: a paid registration cancelled in time is refunded to the card (card) or given as account credit (credit)'),
  ('appointments.customer_cancel_enabled', 'booking', 'boolean', 'false',
   'Appointments: customers may cancel their own appointment'),
  ('appointments.customer_cancel_hours', 'booking', 'number', '24',
   'Appointments: customers may cancel up to this many hours before the appointment starts'),
  ('appointments.cancel_refund_to', 'booking', 'string', 'card',
   'Appointments: a paid appointment cancelled in time is refunded to the card (card) or given as account credit (credit)')
ON CONFLICT (key) DO NOTHING;

COMMIT;
