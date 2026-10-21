-- Per-business gift-card expiry setting (spec 10, Requirement C7).
--
-- How long a purchased gift card stays valid varies significantly by jurisdiction
-- (some countries ban expiry, others cap the minimum validity period). This is a
-- per-business setting expressed in DAYS: when a gift card is purchased, its
-- expiry date defaults to purchase_date + expiry_days. A value of 0 (the default)
-- means NO expiry — the safest default, since several jurisdictions prohibit
-- expiring gift cards. Staff can override the computed date at the point of sale.
--
-- Applies only to newly issued cards; existing cards are never retroactively
-- expired.
--
-- The key must be registered in sys_configuration_definitions first because
-- sys_business_configurations.key has a FK to it (same pattern as 147).

BEGIN;

-- data_type is one of ('string','number','boolean','json') per the definitions
-- CHECK (migration 003); days is a whole number stored as 'number'.
INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('gift_card.expiry_days', 'billing', 'number', '0',
        'Number of days a purchased gift card is valid for (expiry = purchase date + this many days). 0 means no expiry. Depends on jurisdiction.')
ON CONFLICT (key) DO NOTHING;

-- The expiry date chosen at the point of sale travels on the gift-card order line
-- (computed default = sale date + expiry_days, or a staff override), then is read
-- at order completion to set the created card's expires_at. Nullable; only used by
-- gift_card lines. NULL = no expiry. Mirrors the gift_recipient_* columns (146).
ALTER TABLE fin_order_items
  ADD COLUMN IF NOT EXISTS gift_expiry DATE;

COMMIT;
