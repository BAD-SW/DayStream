-- Spec 51, gap 15 (design 15.1): service add-ons. The business keeps one list of add-ons, ad hoc
-- (a name and a description) or a product from the catalogue, and offers each on the services it
-- chooses at a price set per service. An appointment keeps the name and price of each add-on as
-- they were when it was chosen. An add-on adds no time.
BEGIN;

CREATE TABLE IF NOT EXISTS svc_addons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  business_id    UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  addon_type     VARCHAR(10) NOT NULL CHECK (addon_type IN ('ad_hoc', 'product')),
  -- ad hoc: required; product: NULL, the product's (and variant's) name is shown
  name           VARCHAR(200),
  description    TEXT,
  merchandise_id UUID REFERENCES prd_merchandise(id) ON DELETE RESTRICT,
  variant_id     UUID REFERENCES prd_merchandise_variants(id) ON DELETE RESTRICT,
  status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((addon_type = 'ad_hoc' AND name IS NOT NULL AND merchandise_id IS NULL AND variant_id IS NULL)
      OR (addon_type = 'product' AND merchandise_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_svc_addons_business ON svc_addons(business_id, status);
-- one add-on per product (or variant): the same product is not listed twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_addons_product
  ON svc_addons(business_id, merchandise_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE addon_type = 'product';

CREATE TABLE IF NOT EXISTS svc_service_addons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  business_id   UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES svc_services(id) ON DELETE CASCADE,
  addon_id      UUID NOT NULL REFERENCES svc_addons(id) ON DELETE CASCADE,
  price         INTEGER NOT NULL CHECK (price >= 0),   -- cents
  display_order INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, addon_id)
);
CREATE INDEX IF NOT EXISTS idx_svc_service_addons_addon ON svc_service_addons(addon_id);

CREATE TABLE IF NOT EXISTS apt_booking_addons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  business_id    UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  booking_id     UUID NOT NULL REFERENCES apt_bookings(id) ON DELETE CASCADE,
  addon_id       UUID NOT NULL REFERENCES svc_addons(id),
  addon_type     VARCHAR(10) NOT NULL CHECK (addon_type IN ('ad_hoc', 'product')),
  name           VARCHAR(200) NOT NULL,
  merchandise_id UUID,
  variant_id     UUID,
  price          INTEGER NOT NULL CHECK (price >= 0),  -- cents, as it was when chosen
  status         VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by     UUID,
  removed_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apt_booking_addons_active ON apt_booking_addons(booking_id, addon_id) WHERE status = 'active';

-- an order line for an add-on points to it; an ad hoc add-on's line has its own type
ALTER TABLE fin_order_items ADD COLUMN IF NOT EXISTS booking_addon_id UUID REFERENCES apt_booking_addons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fin_order_items_booking_addon ON fin_order_items(booking_addon_id) WHERE booking_addon_id IS NOT NULL;
ALTER TABLE fin_order_items DROP CONSTRAINT IF EXISTS fin_order_items_item_type_check;
ALTER TABLE fin_order_items ADD CONSTRAINT fin_order_items_item_type_check
  CHECK (item_type IN ('service', 'product', 'membership', 'package', 'no_show_fee', 'gift_card', 'event', 'add_on'));

-- a package can include an add-on (item_type 'add_on')
ALTER TABLE pkg_package_items ADD COLUMN IF NOT EXISTS addon_id UUID REFERENCES svc_addons(id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['svc_addons', 'svc_service_addons', 'apt_booking_addons'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%s ON %I', t, t);
    EXECUTE format('CREATE POLICY tenant_isolation_%s ON %I FOR ALL TO daystream_app USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS admin_full_access_%s ON %I', t, t);
    EXECUTE format('CREATE POLICY admin_full_access_%s ON %I FOR ALL TO CURRENT_USER USING (true)', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO daystream_app', t);
  END LOOP;
END $$;

COMMIT;
