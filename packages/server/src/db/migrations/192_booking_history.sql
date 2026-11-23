-- Spec 51, gap 18 (owner, 23 Nov 2026): an appointment's full history. The status history table
-- becomes the history of everything that happens to an appointment: its creation, each status
-- change, each change to its fields (before and after), and its payments; who made it (a staff
-- member, the customer or the system), where it came from, and for an automatic job its name.
-- Entries cannot be edited or deleted, except to anonymise a customer's data and when the
-- appointment itself is removed.
BEGIN;
ALTER TABLE apt_booking_status_history
  ALTER COLUMN to_status DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS event VARCHAR(12) NOT NULL DEFAULT 'status'
    CHECK (event IN ('created', 'status', 'changed', 'payment')),
  -- the fields changed: [{ "field": "start_time", "from": "...", "to": "..." }]
  ADD COLUMN IF NOT EXISTS changes JSONB,
  -- a payment: { "kind": "paid" | "refunded" | "fee" | "order", "order_id", "order_number", "amount_cents", "method" }
  ADD COLUMN IF NOT EXISTS details JSONB,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(10) CHECK (actor_type IN ('staff', 'customer', 'system')),
  ADD COLUMN IF NOT EXISTS source VARCHAR(20)
    CHECK (source IN ('staff', 'widget', 'customer_portal', 'self_check_in', 'import', 'job', 'system')),
  ADD COLUMN IF NOT EXISTS job VARCHAR(80);

-- What was recorded before: a creation (no previous status), a move ("Rescheduled", the same
-- status twice) or a status change, by a person when one was recorded, else by the system.
UPDATE apt_booking_status_history
   SET event = CASE WHEN from_status IS NULL THEN 'created'
                    WHEN reason = 'Rescheduled' AND from_status = to_status THEN 'changed'
                    ELSE 'status' END,
       actor_type = CASE WHEN changed_by IS NOT NULL THEN 'staff' ELSE 'system' END
 WHERE actor_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_history_booking_time ON apt_booking_status_history(booking_id, created_at DESC);

-- Entries are never edited or deleted (criterion 7). Allowed only: removing them with their
-- appointment (a cascade, which runs inside the foreign key's trigger), and anonymising a
-- customer's data (app.history_anonymise = 'on', set for that one transaction).
CREATE OR REPLACE FUNCTION apt_booking_history_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF current_setting('app.history_anonymise', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'An appointment''s history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_history_immutable ON apt_booking_status_history;
CREATE TRIGGER trg_booking_history_immutable
  BEFORE UPDATE OR DELETE ON apt_booking_status_history
  FOR EACH ROW EXECUTE FUNCTION apt_booking_history_immutable();
COMMIT;
