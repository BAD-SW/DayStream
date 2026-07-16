-- Migration 052: Membership plans, included items, enrollments, and usage tracking.
-- Memberships are recurring access packages that include services and/or merchandise.

BEGIN;

-- Membership Plans (what the business offers)
CREATE TABLE IF NOT EXISTS mbr_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  short_description VARCHAR(500),
  billing_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
  price INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  trial_days INTEGER NOT NULL DEFAULT 0,
  discount_services_pct INTEGER NOT NULL DEFAULT 0,
  discount_merchandise_pct INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mbr_plans_business ON mbr_plans(business_id, status);

-- Plan Included Items (services and merchandise included per billing period)
CREATE TABLE IF NOT EXISTS mbr_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES mbr_plans(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL,
  service_id UUID REFERENCES svc_services(id) ON DELETE SET NULL,
  merchandise_id UUID REFERENCES prd_merchandise(id) ON DELETE SET NULL,
  variant_id UUID,
  quantity_per_period INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mbr_plan_items_plan ON mbr_plan_items(plan_id);

-- Customer Enrollments
CREATE TABLE IF NOT EXISTS mbr_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES mbr_plans(id),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  start_date DATE NOT NULL,
  current_period_start DATE NOT NULL,
  current_period_end DATE NOT NULL,
  next_billing_date DATE,
  cancelled_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mbr_enrollments_customer ON mbr_enrollments(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_mbr_enrollments_business ON mbr_enrollments(business_id, status);
CREATE INDEX IF NOT EXISTS idx_mbr_enrollments_billing ON mbr_enrollments(next_billing_date) WHERE status = 'active';

-- Usage Tracking (how many included items have been redeemed this period)
CREATE TABLE IF NOT EXISTS mbr_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES mbr_enrollments(id) ON DELETE CASCADE,
  plan_item_id UUID NOT NULL REFERENCES mbr_plan_items(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  quantity_used INTEGER NOT NULL DEFAULT 0,
  quantity_allowed INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(enrollment_id, plan_item_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_mbr_usage_enrollment ON mbr_usage(enrollment_id, period_start);

COMMIT;
