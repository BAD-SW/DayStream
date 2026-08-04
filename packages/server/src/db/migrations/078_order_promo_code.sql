-- Add promo code tracking to orders

BEGIN;

ALTER TABLE fin_orders ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50);
ALTER TABLE fin_orders ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES prm_promotions(id);

COMMIT;
