-- Spec 51, gap 15 (owner, 24 Nov 2026): an add-on belongs to its service, like an option: a name,
-- a description and a price, added on the service. No shared list of add-ons and no product
-- add-ons. Only test data existed (every add-on was offered on one service).
BEGIN;

ALTER TABLE svc_addons ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES svc_services(id) ON DELETE CASCADE;
ALTER TABLE svc_addons ADD COLUMN IF NOT EXISTS price INTEGER;
ALTER TABLE svc_addons ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

-- each add-on takes the service it was offered on, with that price
UPDATE svc_addons a
   SET service_id = sa.service_id, price = sa.price, display_order = sa.display_order,
       status = CASE WHEN sa.status = 'archived' THEN 'archived' ELSE a.status END
  FROM (SELECT DISTINCT ON (addon_id) addon_id, service_id, price, display_order, status
          FROM svc_service_addons ORDER BY addon_id, (status = 'active') DESC, created_at) sa
 WHERE sa.addon_id = a.id AND a.service_id IS NULL;

-- a product add-on keeps its product's name as a plain add-on
UPDATE svc_addons a
   SET name = COALESCE(
         (SELECT m.name FROM prd_merchandise m WHERE m.id = a.merchandise_id)
           || COALESCE(' · ' || (SELECT mv.name FROM prd_merchandise_variants mv WHERE mv.id = a.variant_id), ''),
         'Add-on')
 WHERE a.name IS NULL;
-- one offered on no service: archived, at no price, under the first service of its business
UPDATE svc_addons a SET status = 'archived', price = 0,
       service_id = (SELECT s.id FROM svc_services s WHERE s.business_id = a.business_id ORDER BY s.created_at LIMIT 1)
 WHERE a.service_id IS NULL;
DELETE FROM svc_addons WHERE service_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM apt_booking_addons ba WHERE ba.addon_id = svc_addons.id)
   AND NOT EXISTS (SELECT 1 FROM pkg_package_items pi WHERE pi.addon_id = svc_addons.id);

-- dropping the product columns also drops the type CHECK and the one-add-on-per-product index
ALTER TABLE svc_addons DROP COLUMN IF EXISTS addon_type;
ALTER TABLE svc_addons DROP COLUMN IF EXISTS merchandise_id;
ALTER TABLE svc_addons DROP COLUMN IF EXISTS variant_id;
ALTER TABLE svc_addons ALTER COLUMN name SET NOT NULL;
ALTER TABLE svc_addons ALTER COLUMN service_id SET NOT NULL;
ALTER TABLE svc_addons ALTER COLUMN price SET NOT NULL;
ALTER TABLE svc_addons ADD CONSTRAINT svc_addons_price_check CHECK (price >= 0);
CREATE INDEX IF NOT EXISTS idx_svc_addons_service ON svc_addons(service_id, status, display_order);

ALTER TABLE apt_booking_addons DROP COLUMN IF EXISTS addon_type;
ALTER TABLE apt_booking_addons DROP COLUMN IF EXISTS merchandise_id;
ALTER TABLE apt_booking_addons DROP COLUMN IF EXISTS variant_id;

DROP TABLE IF EXISTS svc_service_addons;

COMMIT;
