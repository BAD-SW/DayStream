-- Migration 129: business tax identifier for invoices (spec 10-payment-platform,
-- task 4.7 / Requirement C5.3).
--
-- A payable invoice must show the issuing business's own details, including its
-- tax ID (VAT/EIN/etc.). sys_businesses already carries name, address, email, and
-- phone; this adds the optional tax identifier used in the invoice header.
--
-- Whether a business issues invoices at all is a per-business setting stored in
-- sys_business_configurations under 'invoicing.enabled' (no column needed).

BEGIN;

ALTER TABLE sys_businesses ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50);

COMMIT;
