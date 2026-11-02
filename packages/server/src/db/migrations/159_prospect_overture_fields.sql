-- Migration 159: additional Overture-sourced prospect fields (spec 31 follow-up).
-- Additive, non-breaking. Leverages Overture place fields we were not storing:
--   - country:          addresses[].country (completes the address, esp. international).
--   - email:            emails[0] (an extra contact channel; feeds contactability).
--   - operating_status: Overture's open/closed flag — lets us hold defunct businesses
--                       (reversible, never deleted) rather than waste outreach on them.

BEGIN;

ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS country VARCHAR(2);
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS email VARCHAR(320);
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS operating_status VARCHAR(32);

COMMIT;
