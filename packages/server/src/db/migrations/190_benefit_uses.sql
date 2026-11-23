-- Spec 51, gap 19 (design 19.2): each use of a membership's or package's allowance, so it can be
-- counted, shown, moved and given back. Held when a booking is made with it, used when the order
-- is paid, released when the booking is cancelled, the line is changed or the payment refunded.
BEGIN;
CREATE TABLE IF NOT EXISTS pay_benefit_uses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  business_id      UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  kind             VARCHAR(12) NOT NULL CHECK (kind IN ('membership', 'package')),
  -- a membership: the enrollment and the plan item it uses
  enrollment_id    UUID REFERENCES mbr_enrollments(id) ON DELETE CASCADE,
  plan_item_id     UUID REFERENCES mbr_plan_items(id) ON DELETE CASCADE,
  -- a package: the purchase and the package item it uses
  purchase_id      UUID REFERENCES pkg_purchases(id) ON DELETE CASCADE,
  package_item_id  UUID REFERENCES pkg_package_items(id) ON DELETE CASCADE,
  booking_id       UUID REFERENCES apt_bookings(id) ON DELETE SET NULL,
  order_id         UUID REFERENCES fin_orders(id) ON DELETE SET NULL,
  order_item_id    UUID REFERENCES fin_order_items(id) ON DELETE SET NULL,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),   -- sessions, uses or items
  minutes          INTEGER CHECK (minutes IS NULL OR minutes > 0),     -- a minutes package
  -- a membership's allowance window the use counts in (none for an unlimited item)
  window_start     DATE,
  window_end       DATE,
  status           VARCHAR(10) NOT NULL CHECK (status IN ('held', 'used', 'released')),
  -- when used: the package redemption or the membership usage it added to, undone on release
  redemption_id    UUID REFERENCES pkg_redemptions(id) ON DELETE SET NULL,
  mbr_usage_id     UUID REFERENCES mbr_usage(id) ON DELETE SET NULL,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'membership' AND enrollment_id IS NOT NULL AND plan_item_id IS NOT NULL AND purchase_id IS NULL)
      OR (kind = 'package' AND purchase_id IS NOT NULL AND package_item_id IS NOT NULL AND enrollment_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_pay_benefit_uses_membership ON pay_benefit_uses(enrollment_id, plan_item_id, window_start) WHERE status <> 'released';
CREATE INDEX IF NOT EXISTS idx_pay_benefit_uses_package ON pay_benefit_uses(purchase_id, package_item_id) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_pay_benefit_uses_booking ON pay_benefit_uses(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay_benefit_uses_order_item ON pay_benefit_uses(order_item_id) WHERE order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay_benefit_uses_customer ON pay_benefit_uses(business_id, customer_id);

ALTER TABLE pay_benefit_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_benefit_uses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pay_benefit_uses ON pay_benefit_uses FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_pay_benefit_uses ON pay_benefit_uses FOR ALL TO CURRENT_USER USING (true);
GRANT SELECT, INSERT, UPDATE ON pay_benefit_uses TO daystream_app;
COMMIT;
