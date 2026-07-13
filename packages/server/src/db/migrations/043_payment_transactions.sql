-- Migration 043: Payment transactions table for manual payment recording.
-- Supports recording payments, refunds, and linking to bookings/memberships.

BEGIN;

CREATE TABLE IF NOT EXISTS pay_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES cus_customers(id),
  -- What this payment is for
  booking_id UUID REFERENCES apt_bookings(id) ON DELETE SET NULL,
  membership_id UUID REFERENCES mem_memberships(id) ON DELETE SET NULL,
  -- Payment details
  type VARCHAR(20) NOT NULL CHECK (type IN ('charge', 'refund', 'credit')),
  status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  amount INTEGER NOT NULL, -- in minor currency units (cents)
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  payment_method VARCHAR(30) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'check', 'gift_card', 'other')),
  -- Reference
  reference_number VARCHAR(100),
  description TEXT,
  -- Refund link
  refund_of_id UUID REFERENCES pay_transactions(id) ON DELETE SET NULL,
  refund_reason TEXT,
  -- Metadata
  processed_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pay_transactions_business ON pay_transactions(business_id);
CREATE INDEX idx_pay_transactions_customer ON pay_transactions(customer_id);
CREATE INDEX idx_pay_transactions_booking ON pay_transactions(booking_id);
CREATE INDEX idx_pay_transactions_date ON pay_transactions(business_id, created_at DESC);
CREATE INDEX idx_pay_transactions_type ON pay_transactions(business_id, type);

-- RLS
ALTER TABLE pay_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pay_transactions ON pay_transactions
  FOR ALL TO daystream_app
  USING (business_id IN (
    SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
  ));

CREATE POLICY admin_full_access_pay_transactions ON pay_transactions
  FOR ALL TO postgres USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON pay_transactions TO daystream_app;

COMMIT;
