-- Persist the tax category and tax rate applied to each order line AT THE TIME OF SALE.
-- Previously only fin_order_items.tax_amount was stored; the category/rate had to be
-- re-derived from the item's current category, which is unreliable for audit (categories
-- can change and items can be deleted). Capturing them here makes each sale self-describing.

BEGIN;

ALTER TABLE fin_order_items
  ADD COLUMN IF NOT EXISTS tax_category_id UUID REFERENCES svc_tax_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_rate INTEGER;  -- basis points (2100 = 21.00%); NULL = unknown/non-taxable

-- Best-effort backfill for existing rows: reconstruct the category/rate from the item's
-- CURRENT tax category. This is APPROXIMATE, not as-charged — if an item's category changed
-- or the item was deleted since the sale, the historical value cannot be recovered. New sales
-- from this point forward record the true as-charged values via the checkout service.
UPDATE fin_order_items oi
SET tax_category_id = src.tax_category_id,
    tax_rate = tc.rate
FROM (
  SELECT id, tax_category_id, 'service'::text AS item_type FROM svc_services
  UNION ALL SELECT id, tax_category_id, 'product' FROM prd_merchandise
  UNION ALL SELECT id, tax_category_id, 'membership' FROM mbr_plans
  UNION ALL SELECT id, tax_category_id, 'package' FROM pkg_packages
) src
JOIN svc_tax_categories tc ON tc.id = src.tax_category_id
WHERE oi.item_id = src.id
  AND oi.item_type = src.item_type
  AND oi.tax_category_id IS NULL
  AND oi.tax_amount > 0;

COMMIT;
