-- Spec 51, gap 19 (owner, 23 Nov 2026): a package sold at Checkout was charged but never given to
-- the customer (no pkg_purchases row), so it was not offered when booking, not on the package's
-- Buyers and not counted as sold. Checkout now creates the purchase when the order is paid; each
-- purchase records the order line that sold it, so a line gives one purchase per package sold.
BEGIN;
ALTER TABLE pkg_purchases ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES fin_order_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pkg_purchases_order_item ON pkg_purchases(order_item_id) WHERE order_item_id IS NOT NULL;

-- Packages already sold at Checkout without a purchase: given now, dated (and expiring) from the
-- day the order was paid. Skipped where the customer already has that package from about then
-- (given by hand on the package's page), so nothing is given twice.
INSERT INTO pkg_purchases (package_id, business_id, customer_id, status, purchased_at, expires_at, source, order_item_id)
SELECT p.id, o.business_id, o.customer_id, 'active', COALESCE(o.completed_at, o.created_at),
       CASE WHEN p.expiration_type <> 'none' AND p.expiration_days IS NOT NULL THEN
         COALESCE(o.completed_at, o.created_at) + CASE COALESCE(p.expiration_unit, 'days')
           WHEN 'months' THEN make_interval(months => p.expiration_days)
           WHEN 'weeks' THEN make_interval(weeks => p.expiration_days)
           ELSE make_interval(days => p.expiration_days) END
       END,
       'admin', oi.id
  FROM fin_order_items oi
  JOIN fin_orders o ON o.id = oi.order_id
  JOIN pkg_packages p ON p.id = oi.item_id AND p.business_id = o.business_id
  CROSS JOIN LATERAL generate_series(1, GREATEST(oi.quantity - COALESCE(oi.refunded_quantity, 0), 0)) AS n
 WHERE oi.item_type = 'package' AND o.status IN ('completed', 'partially_refunded') AND o.customer_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM pkg_purchases x WHERE x.order_item_id = oi.id)
   AND NOT EXISTS (
     SELECT 1 FROM pkg_purchases x
      WHERE x.customer_id = o.customer_id AND x.package_id = p.id
        AND x.purchased_at BETWEEN COALESCE(o.completed_at, o.created_at) - INTERVAL '1 day' AND COALESCE(o.completed_at, o.created_at) + INTERVAL '1 day');
COMMIT;
