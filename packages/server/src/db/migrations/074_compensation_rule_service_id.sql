-- Add service_id to compensation rules
-- Allows flat rate and commission rules to be scoped to a specific service

BEGIN;

ALTER TABLE fin_compensation_rules ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES svc_services(id) ON DELETE SET NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_compensation_rules_service ON fin_compensation_rules(service_id);

COMMIT;
