-- The card held for a reservation (spec 51, gap 5): a service whose Reservation Payment Rule is
-- "Card required for reservation" needs a card on file attached when staff save the booking.
-- Nothing is charged then; Checkout charges the card for the final total after the service.
--   payment_method_id  the customer's saved card held for this booking
--   card_saved_at      when it was attached, after staff confirmed the customer agreed to it
--   card_saved_by      the staff member who attached it
BEGIN;

ALTER TABLE apt_bookings
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES pay_payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS card_saved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS card_saved_by UUID REFERENCES usr_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_apt_bookings_payment_method ON apt_bookings(payment_method_id) WHERE payment_method_id IS NOT NULL;

COMMIT;
