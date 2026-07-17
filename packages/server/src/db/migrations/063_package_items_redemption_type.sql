-- Migration 063: Add redemption_type to pkg_package_items.
-- Supports two modes:
--   'sessions' (default): quantity = number of sessions (existing behavior)
--   'minutes': quantity = total minutes in the pool (time-based packages)
-- When redemption_type = 'minutes', variant_id is optional (any variant of the service applies).

ALTER TABLE pkg_package_items ADD COLUMN IF NOT EXISTS redemption_type VARCHAR(20) NOT NULL DEFAULT 'sessions';

-- Also add minutes_redeemed to pkg_redemptions for tracking time usage
ALTER TABLE pkg_redemptions ADD COLUMN IF NOT EXISTS minutes_redeemed INTEGER;

COMMENT ON COLUMN pkg_package_items.redemption_type IS 'sessions = fixed number of visits, minutes = time pool';
COMMENT ON COLUMN pkg_redemptions.minutes_redeemed IS 'Duration in minutes consumed (for minutes-based items)';
