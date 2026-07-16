-- Migration 056: Packages (bundled offerings purchased once, redeemed over time).

BEGIN;

-- Package definitions (what the business offers)
CREATE TABLE IF NOT EXISTS pkg_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  short_description VARCHAR(500),
  price INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Expiration policy
  expiration_type VARCHAR(20) NOT NULL DEFAULT 'none',
  expiration_days INTEGER,
  -- Metadata
  display_order INTEGER NOT NULL DEFAULT 0,
  is_taxable BOOLEAN NOT NULL DEFAULT false,
  tax_category_id UUID REFERENCES svc_tax_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pkg_packages_business ON pkg_packages(business_id, status);

-- Package items (what's included in the package)
CREATE TABLE IF NOT EXISTS pkg_package_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES pkg_packages(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL,
  service_id UUID REFERENCES svc_services(id) ON DELETE SET NULL,
  merchandise_id UUID REFERENCES prd_merchandise(id) ON DELETE SET NULL,
  variant_id UUID,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pkg_package_items_pkg ON pkg_package_items(package_id);

-- Customer purchases of packages
CREATE TABLE IF NOT EXISTS pkg_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES pkg_packages(id),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pkg_purchases_customer ON pkg_purchases(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_pkg_purchases_business ON pkg_purchases(business_id, status);

-- Redemption tracking (what has been used from a purchased package)
CREATE TABLE IF NOT EXISTS pkg_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES pkg_purchases(id) ON DELETE CASCADE,
  package_item_id UUID NOT NULL REFERENCES pkg_package_items(id) ON DELETE CASCADE,
  quantity_redeemed INTEGER NOT NULL DEFAULT 1,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  booking_id UUID,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_pkg_redemptions_purchase ON pkg_redemptions(purchase_id);

COMMIT;
