-- Payment Rules on a service (spec 51, gap 5): what booking the service asks of the customer's card.
--   no_card           No card required for reservation (pay at the desk; how every service works today)
--   card_required     Card required for reservation (the card is held, and charged after the service)
--   charge_at_booking Card charged at reservation (paid in full when booked)
-- Existing services keep working as they do now: no_card.
BEGIN;

ALTER TABLE svc_services
  ADD COLUMN IF NOT EXISTS payment_rule VARCHAR(20) NOT NULL DEFAULT 'no_card'
    CHECK (payment_rule IN ('no_card', 'card_required', 'charge_at_booking'));

COMMIT;
