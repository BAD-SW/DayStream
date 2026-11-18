-- Spec 51, gap 7: retail inventory (in-person sales only). Stock per product (or variant) and
-- location, changed only through recorded movements, valued at average cost.
BEGIN;

-- What a product needs for stock: whether it is tracked, its cost, barcode and supplier.
ALTER TABLE prd_merchandise
  ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cost_cents  INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),
  ADD COLUMN IF NOT EXISTS barcode     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES fin_vendors(id) ON DELETE SET NULL;
ALTER TABLE prd_merchandise_variants
  ADD COLUMN IF NOT EXISTS cost_cents  INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),
  ADD COLUMN IF NOT EXISTS barcode     VARCHAR(64);

-- Where a sale happens (its stock comes from there): the booking's location, else the one chosen.
ALTER TABLE fin_orders ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES sys_locations(id) ON DELETE SET NULL;

-- One row per stock item (a product without variants, or one variant) and location.
CREATE TABLE IF NOT EXISTS inv_stock (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  business_id     UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  merchandise_id  UUID NOT NULL REFERENCES prd_merchandise(id) ON DELETE CASCADE,
  variant_id      UUID REFERENCES prd_merchandise_variants(id) ON DELETE CASCADE,
  on_hand         INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  avg_cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost_cents >= 0),
  reorder_level   INTEGER CHECK (reorder_level IS NULL OR reorder_level >= 0),
  reorder_qty     INTEGER CHECK (reorder_qty IS NULL OR reorder_qty > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_stock_item ON inv_stock
  (location_id, merchandise_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_inv_stock_business ON inv_stock (business_id, merchandise_id);

-- Every stock change. Never updated or deleted: on_hand is kept equal to their sum.
CREATE TABLE IF NOT EXISTS inv_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  business_id     UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  merchandise_id  UUID NOT NULL REFERENCES prd_merchandise(id) ON DELETE CASCADE,
  variant_id      UUID REFERENCES prd_merchandise_variants(id) ON DELETE CASCADE,
  qty_change      INTEGER NOT NULL,
  reason          VARCHAR(20) NOT NULL CHECK (reason IN ('opening', 'sale', 'sale_cancelled', 'refund_restock',
                  'refund_write_off', 'receive', 'adjust', 'count', 'transfer_in', 'transfer_out')),
  adjust_reason   VARCHAR(40),
  unit_cost_cents INTEGER,
  on_hand_after   INTEGER NOT NULL,
  order_id        UUID REFERENCES fin_orders(id) ON DELETE SET NULL,
  order_item_id   UUID REFERENCES fin_order_items(id) ON DELETE SET NULL,
  note            TEXT,
  created_by      UUID REFERENCES usr_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_movements_item ON inv_movements (merchandise_id, variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_order_item ON inv_movements (order_item_id) WHERE order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_movements_business ON inv_movements (business_id, created_at DESC);

-- Row-level security and grants
ALTER TABLE inv_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_stock FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inv_stock ON inv_stock FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_inv_stock ON inv_stock FOR ALL TO CURRENT_USER USING (true);
ALTER TABLE inv_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inv_movements ON inv_movements FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_inv_movements ON inv_movements FOR ALL TO CURRENT_USER USING (true);
GRANT SELECT, INSERT, UPDATE ON inv_stock TO daystream_app;
GRANT SELECT, INSERT ON inv_movements TO daystream_app;

COMMIT;
