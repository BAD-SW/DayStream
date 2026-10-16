-- Add a structured, clickable footer link to document branding templates
-- (spec 10, task 6.3 / Requirement C12 refinement).
--
-- The footer is plain text, but a business often wants ONE clickable link there
-- (e.g. "Visit our website", "Manage your subscription"). Rather than allow
-- free-form HTML in the footer (an href-injection surface), we store the link as
-- two typed columns and let the render layer build a safe <a> from them. The
-- render layer applies the template's secondary color to the link.

BEGIN;

ALTER TABLE pay_document_branding
  -- The visible text of the footer link (NULL / empty = no link rendered).
  ADD COLUMN IF NOT EXISTS footer_link_text VARCHAR(160),
  -- The destination URL. Validated as http(s) at the API layer before save.
  ADD COLUMN IF NOT EXISTS footer_link_url TEXT;

COMMIT;
