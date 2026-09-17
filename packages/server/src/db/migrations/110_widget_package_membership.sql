-- Phase 5 (spec 38) — package/membership purchase support for the booking widget.
-- Widget transactions can now settle a package purchase or membership enrollment,
-- not only a booking — booking_id becomes optional, and exactly one of the three
-- target columns must be set per row.

ALTER TABLE wgt_widget_transactions
  ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES pkg_purchases(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES mbr_enrollments(id) ON DELETE CASCADE;

ALTER TABLE wgt_widget_transactions
  ADD CONSTRAINT wgt_widget_transactions_one_target CHECK (
    (CASE WHEN booking_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN purchase_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN enrollment_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

CREATE INDEX IF NOT EXISTS wgt_widget_transactions_purchase_idx ON wgt_widget_transactions (purchase_id);
CREATE INDEX IF NOT EXISTS wgt_widget_transactions_enrollment_idx ON wgt_widget_transactions (enrollment_id);

-- Mirrors apt_bookings.source (migration 109) — same admin/widget provenance tracking.
ALTER TABLE pkg_purchases
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'widget'));

ALTER TABLE mbr_enrollments
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'widget'));

CREATE INDEX IF NOT EXISTS pkg_purchases_source_idx ON pkg_purchases (business_id, source);
CREATE INDEX IF NOT EXISTS mbr_enrollments_source_idx ON mbr_enrollments (business_id, source);
