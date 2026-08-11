-- Backfill mbr_enrollments from completed orders with membership items
-- that don't already have an enrollment for that customer+plan combination.

BEGIN;

INSERT INTO mbr_enrollments (plan_id, business_id, customer_id, status, start_date, current_period_start, current_period_end, next_billing_date)
SELECT DISTINCT
  oi.item_id AS plan_id,
  o.business_id,
  o.customer_id,
  'active',
  DATE(o.completed_at) AS start_date,
  DATE(o.completed_at) AS current_period_start,
  -- End of the month the order was completed in
  (DATE_TRUNC('month', o.completed_at) + INTERVAL '1 month' - INTERVAL '1 day')::date AS current_period_end,
  -- Next billing date = first of next month
  (DATE_TRUNC('month', o.completed_at) + INTERVAL '1 month')::date AS next_billing_date
FROM fin_order_items oi
JOIN fin_orders o ON o.id = oi.order_id
WHERE oi.item_type = 'membership'
  AND oi.item_id IS NOT NULL
  AND o.status = 'completed'
  AND o.customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mbr_enrollments e
    WHERE e.plan_id = oi.item_id
      AND e.customer_id = o.customer_id
      AND e.business_id = o.business_id
  );

COMMIT;
