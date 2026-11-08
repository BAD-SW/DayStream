-- Migration 166: previous processor customer id on customers (spec 50, Payment Methods import).
--
-- A legacy system's customer export may carry each client's customer id at its payment processor
-- (e.g. Stripe 'cus_...'). Stored here at customer import, it gives the payment-method import an
-- EXACT match key: Stripe's account-to-account copy keeps customer ids unchanged, and Stripe's
-- processor import maps the old processor id to the new Stripe id.
--
-- Deliberately NOT written to pay_customer_refs: that table is the id DayStream CHARGES through,
-- and until the cards are copied this id belongs to the previous system's processor account.
-- The payment-method import records the charging reference once it imports the card.

BEGIN;

ALTER TABLE cus_customers ADD COLUMN IF NOT EXISTS processor_customer_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_cus_customers_processor_customer_id
  ON cus_customers(business_id, processor_customer_id)
  WHERE processor_customer_id IS NOT NULL;

COMMIT;
