-- A booking has at most one no-show record. Needed so charging a no-show fee can
-- upsert (ON CONFLICT (booking_id)) the record with the charged fee amount.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_apt_no_show_records_booking
  ON apt_no_show_records(booking_id);

COMMIT;
