-- Spec 51, gap 7 (design 7.2, 7.4): moving stock between locations. (Counting is done per product,
-- on its Stock card, with the existing set-count movement; owner, 18 Nov 2026.)
BEGIN;

-- A move of stock from one location to another, done at once (no stock in transit).
CREATE TABLE IF NOT EXISTS inv_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  business_id      UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  from_location_id UUID NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  to_location_id   UUID NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  note             TEXT,
  created_by       UUID REFERENCES usr_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_location_id <> to_location_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_transfers_business ON inv_transfers (business_id, created_at DESC);

-- Which transfer a movement belongs to.
ALTER TABLE inv_movements
  ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES inv_transfers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inv_movements_transfer ON inv_movements (transfer_id) WHERE transfer_id IS NOT NULL;

-- Row-level security and grants
ALTER TABLE inv_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inv_transfers ON inv_transfers FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_inv_transfers ON inv_transfers FOR ALL TO CURRENT_USER USING (true);

GRANT SELECT, INSERT, UPDATE ON inv_transfers TO daystream_app;

COMMIT;
