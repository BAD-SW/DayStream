-- Add variant_id to order items for precise promo scope matching

BEGIN;

ALTER TABLE fin_order_items ADD COLUMN IF NOT EXISTS variant_id UUID;

COMMIT;
