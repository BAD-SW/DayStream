-- Phase 46 (R14): marketing records belong to a business, not only to a tenant.
-- Campaigns, sequences, lead forms and message templates gain a business_id, so two
-- businesses of the same tenant no longer see or send each other's marketing.
-- See .kiro/specs/46-people-foundation/design.md sections 2.6 and 3.

ALTER TABLE mkt_campaigns         ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES sys_businesses(id);
ALTER TABLE mkt_sequences         ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES sys_businesses(id);
ALTER TABLE mkt_lead_funnels      ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES sys_businesses(id);
ALTER TABLE mkt_message_templates ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES sys_businesses(id);

CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_business ON mkt_campaigns (business_id);
CREATE INDEX IF NOT EXISTS idx_mkt_sequences_business ON mkt_sequences (business_id);
CREATE INDEX IF NOT EXISTS idx_mkt_lead_funnels_business ON mkt_lead_funnels (business_id);
CREATE INDEX IF NOT EXISTS idx_mkt_message_templates_business ON mkt_message_templates (business_id);

-- ============================================================
-- Backfill (each step only touches rows still without a business)
-- ============================================================

-- 1. A campaign belongs to the business of its audience.
UPDATE mkt_campaigns c
   SET business_id = s.business_id
  FROM cus_segments s
 WHERE c.business_id IS NULL AND c.segment_id = s.id;

-- 2. A sequence belongs to the business of the people enrolled in it, when they all share one.
UPDATE mkt_sequences q
   SET business_id = e.business_id
  FROM (
    SELECT se.sequence_id, MIN(c.business_id::text)::uuid AS business_id
      FROM mkt_sequence_enrollments se
      JOIN cus_customers c ON c.id = se.customer_id
     GROUP BY se.sequence_id
    HAVING COUNT(DISTINCT c.business_id) = 1
  ) e
 WHERE q.business_id IS NULL AND q.is_template = false AND q.id = e.sequence_id;

-- 3. A lead form belongs to the business of the sequence it feeds.
UPDATE mkt_lead_funnels f
   SET business_id = q.business_id
  FROM mkt_sequences q
 WHERE f.business_id IS NULL AND f.sequence_id = q.id AND q.business_id IS NOT NULL;

-- 4. Whatever is left goes to the tenant's business when the tenant has exactly one.
--    System templates and sequence templates stay without a business: every business sees them.
WITH single AS (
  SELECT tenant_id, MIN(id::text)::uuid AS business_id FROM sys_businesses GROUP BY tenant_id HAVING COUNT(*) = 1
)
UPDATE mkt_campaigns t SET business_id = single.business_id FROM single
 WHERE t.business_id IS NULL AND t.tenant_id = single.tenant_id;

WITH single AS (
  SELECT tenant_id, MIN(id::text)::uuid AS business_id FROM sys_businesses GROUP BY tenant_id HAVING COUNT(*) = 1
)
UPDATE mkt_sequences t SET business_id = single.business_id FROM single
 WHERE t.business_id IS NULL AND t.is_template = false AND t.tenant_id = single.tenant_id;

WITH single AS (
  SELECT tenant_id, MIN(id::text)::uuid AS business_id FROM sys_businesses GROUP BY tenant_id HAVING COUNT(*) = 1
)
UPDATE mkt_lead_funnels t SET business_id = single.business_id FROM single
 WHERE t.business_id IS NULL AND t.tenant_id = single.tenant_id;

WITH single AS (
  SELECT tenant_id, MIN(id::text)::uuid AS business_id FROM sys_businesses GROUP BY tenant_id HAVING COUNT(*) = 1
)
UPDATE mkt_message_templates t SET business_id = single.business_id FROM single
 WHERE t.business_id IS NULL AND t.is_system = false AND t.tenant_id = single.tenant_id;

-- 5. Report what could not be assigned. These rows stay hidden from every business until
--    someone gives them one; the column therefore stays nullable.
DO $$
DECLARE
  c INT; s INT; f INT; t INT;
BEGIN
  SELECT COUNT(*) INTO c FROM mkt_campaigns WHERE business_id IS NULL;
  SELECT COUNT(*) INTO s FROM mkt_sequences WHERE business_id IS NULL AND is_template = false;
  SELECT COUNT(*) INTO f FROM mkt_lead_funnels WHERE business_id IS NULL;
  SELECT COUNT(*) INTO t FROM mkt_message_templates WHERE business_id IS NULL AND is_system = false;
  IF c + s + f + t > 0 THEN
    RAISE NOTICE 'Marketing records without a business (tenant has several businesses and nothing says which): % campaigns, % sequences, % lead forms, % templates', c, s, f, t;
  END IF;
END $$;

-- ============================================================
-- A lead form's address is unique within its business, not within the whole tenant
-- ============================================================
ALTER TABLE mkt_lead_funnels DROP CONSTRAINT IF EXISTS lead_funnels_tenant_id_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_lead_funnels_business_slug ON mkt_lead_funnels (business_id, slug) WHERE business_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_lead_funnels_tenant_slug ON mkt_lead_funnels (tenant_id, slug) WHERE business_id IS NULL;
