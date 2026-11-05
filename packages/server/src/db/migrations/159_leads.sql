-- Leads (THE-17): lead stages defined by each business, and a lead source for each person.
--
-- Decided by David (28 October 2026):
-- * Stages belong to the business. Defaults: New, Contacted, Interested, Trial booked, Lost;
--   the business may rename, reorder, delete or add to them (Settings → Leads).
--   A deleted stage is kept with deleted_at so its name stays readable on old Timeline
--   entries, and so defaults are created only once per business.
-- * A lead with no stage set is shown in the first stage.
-- * Lead source is a separate field from `source` (which records how the record was created).

BEGIN;

CREATE TABLE IF NOT EXISTS cus_lead_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cus_lead_stages_name
  ON cus_lead_stages (business_id, LOWER(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cus_lead_stages_business ON cus_lead_stages (business_id, sort_order);

ALTER TABLE cus_customers
  ADD COLUMN IF NOT EXISTS lead_stage_id UUID REFERENCES cus_lead_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_source VARCHAR(30);

ALTER TABLE cus_customers DROP CONSTRAINT IF EXISTS chk_cus_customers_lead_source;
ALTER TABLE cus_customers ADD CONSTRAINT chk_cus_customers_lead_source CHECK (lead_source IS NULL OR lead_source IN (
  'abandoned_checkout', 'meta_ads', 'api', 'missed_call', 'incoming_call',
  'incoming_sms', 'web_chat', 'app_message', 'whatsapp', 'website'));

-- Default stages for every existing business (new businesses get them on first use).
INSERT INTO cus_lead_stages (business_id, name, sort_order)
SELECT b.id, s.name, s.ord
  FROM sys_businesses b
 CROSS JOIN (VALUES ('New', 1), ('Contacted', 2), ('Interested', 3), ('Trial booked', 4), ('Lost', 5)) AS s(name, ord)
 WHERE NOT EXISTS (SELECT 1 FROM cus_lead_stages x WHERE x.business_id = b.id);

COMMIT;
