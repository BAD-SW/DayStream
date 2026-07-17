-- Migration 065: Add expiration_unit to pkg_packages.
-- Allows expiration to be defined in days, weeks, or months.
-- expiration_days holds the numeric value, expiration_unit defines the unit.

ALTER TABLE pkg_packages ADD COLUMN IF NOT EXISTS expiration_unit VARCHAR(10) NOT NULL DEFAULT 'days';

COMMENT ON COLUMN pkg_packages.expiration_unit IS 'Unit for expiration_days value: days, weeks, or months';
