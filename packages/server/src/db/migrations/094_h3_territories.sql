-- H3 Hexagonal Territory System
-- Stores territory hexagon assignments per tenant for gap-free coverage visualization

BEGIN;

CREATE TABLE IF NOT EXISTS prp_tenant_territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  h3_index VARCHAR(15) NOT NULL,
  UNIQUE(tenant_id, h3_index)
);

CREATE INDEX IF NOT EXISTS idx_prp_territories_h3 ON prp_tenant_territories(h3_index);
CREATE INDEX IF NOT EXISTS idx_prp_territories_tenant ON prp_tenant_territories(tenant_id);

COMMIT;
