-- Embeddable Booking Widget (spec 38): booking source tracking, per-business widget
-- configuration, and simulated payment transactions.
BEGIN;

ALTER TABLE apt_bookings
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'admin'
    CHECK (source IN ('admin', 'widget'));

CREATE TABLE IF NOT EXISTS wgt_widget_configs (
  id                                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                            UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id                          UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  is_enabled                           BOOLEAN NOT NULL DEFAULT false,
  require_payment_before_confirmation  BOOLEAN NOT NULL DEFAULT true,
  allowed_origins                      TEXT[],
  created_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id)
);

CREATE TABLE IF NOT EXISTS wgt_widget_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id    UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  booking_id     UUID NOT NULL REFERENCES apt_bookings(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  currency       VARCHAR(3) NOT NULL DEFAULT 'EUR',
  payment_method VARCHAR(20) NOT NULL DEFAULT 'simulated' CHECK (payment_method IN ('simulated')),
  status         VARCHAR(20) NOT NULL CHECK (status IN ('completed', 'failed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wgt_widget_transactions_booking_idx ON wgt_widget_transactions (booking_id);
CREATE INDEX IF NOT EXISTS apt_bookings_source_idx ON apt_bookings (business_id, source);

COMMIT;
