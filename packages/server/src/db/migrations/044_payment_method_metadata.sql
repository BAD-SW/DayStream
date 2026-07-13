-- Migration 044: Add payment method-specific metadata fields to transactions.
-- These store reference data for each payment method type.

BEGIN;

-- Card details (manual entry reference — not actual card data)
ALTER TABLE pay_transactions ADD COLUMN IF NOT EXISTS card_last4 VARCHAR(4);
ALTER TABLE pay_transactions ADD COLUMN IF NOT EXISTS card_brand VARCHAR(20);

-- Bank transfer details
ALTER TABLE pay_transactions ADD COLUMN IF NOT EXISTS bank_routing_number VARCHAR(20);
ALTER TABLE pay_transactions ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(30);

-- Check details
ALTER TABLE pay_transactions ADD COLUMN IF NOT EXISTS check_number VARCHAR(20);

-- Gift card details
ALTER TABLE pay_transactions ADD COLUMN IF NOT EXISTS gift_card_code VARCHAR(50);

COMMIT;
