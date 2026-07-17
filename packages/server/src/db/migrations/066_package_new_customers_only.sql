-- Migration 066: Add new_customers_only flag to pkg_packages.
-- Intro packages can only be purchased by customers with no prior transaction history.

ALTER TABLE pkg_packages ADD COLUMN IF NOT EXISTS new_customers_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN pkg_packages.new_customers_only IS 'When true, only customers with no prior transaction history can purchase this package';
