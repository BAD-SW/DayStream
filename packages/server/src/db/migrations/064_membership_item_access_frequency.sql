-- Migration 064: Add access_frequency to mbr_plan_items.
-- Decouples service access cadence from billing frequency.
-- access_frequency defines how often the allowance resets (daily, weekly, monthly, unlimited).
-- quantity_per_period is how many uses within that access window.
-- Unused allowances do NOT roll over.

ALTER TABLE mbr_plan_items ADD COLUMN IF NOT EXISTS access_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly';

COMMENT ON COLUMN mbr_plan_items.access_frequency IS 'How often the quantity resets: daily, weekly, monthly, unlimited';
