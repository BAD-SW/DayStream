-- Per-business "apply tax to gift card sales" setting (spec 10, Requirement C7).
--
-- Whether a gift-card SALE is taxed depends on jurisdiction — some countries tax
-- the sale of a gift card, most treat it as non-taxable stored value. This is a
-- per-business On/Off setting (default OFF) stored in sys_business_configurations.
-- When ON, a gift-card checkout line is taxed at the business's default tax
-- category rate; when OFF, the line carries no tax.
--
-- The key must be registered in sys_configuration_definitions first because
-- sys_business_configurations.key has a FK to it (same pattern as 131/145).

BEGIN;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('gift_card.tax_enabled', 'billing', 'boolean', 'false',
        'Whether the sale of a gift card is taxed (at the business default tax rate). Off by default; depends on jurisdiction.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
