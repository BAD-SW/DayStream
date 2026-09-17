import { adminPool } from '../../../db/pool';

/**
 * Recognized revenue per customer, broken into service, product, and membership,
 * for lifetime-value reporting. All amounts are cents, PRE-TAX (net of discount).
 *
 *   - Service & product: recognized at point of sale = order line net (unit_price
 *     * quantity - discount_amount) on completed orders. Memberships/packages on
 *     orders are EXCLUDED here (they post to Deferred Revenue at sale, not
 *     revenue) — membership revenue is captured via recognition instead, so
 *     there's no double-count.
 *   - Membership: cumulative recognized revenue from fin_revenue_recognized,
 *     summed across ALL of the customer's enrollments (active, paused, or ended).
 *
 * Returns a map keyed by customer_id.
 */
export interface CustomerRecognized {
  service: number;
  product: number;
  membership: number;
}

export async function recognizedRevenueByCustomer(businessId: string): Promise<Map<string, CustomerRecognized>> {
  const map = new Map<string, CustomerRecognized>();
  const ensure = (id: string): CustomerRecognized => {
    let r = map.get(id);
    if (!r) { r = { service: 0, product: 0, membership: 0 }; map.set(id, r); }
    return r;
  };

  // Service + product recognized revenue from completed order line items (pre-tax, net of discount)
  const { rows: orderRows } = await adminPool.query(
    `SELECT o.customer_id,
            oi.item_type,
            COALESCE(SUM(oi.unit_price * oi.quantity - oi.discount_amount), 0)::int AS amount
       FROM fin_order_items oi
       JOIN fin_orders o ON o.id = oi.order_id
      WHERE o.business_id = $1
        AND o.status = 'completed'
        AND o.customer_id IS NOT NULL
        AND oi.item_type IN ('service', 'product')
      GROUP BY o.customer_id, oi.item_type`,
    [businessId],
  );
  for (const row of orderRows) {
    const r = ensure(row.customer_id);
    if (row.item_type === 'service') r.service += Number(row.amount) || 0;
    else if (row.item_type === 'product') r.product += Number(row.amount) || 0;
  }

  // Membership recognized revenue from the per-enrollment tracking table,
  // summed across all of the customer's enrollments.
  const { rows: memRows } = await adminPool.query(
    `SELECT e.customer_id,
            COALESCE(SUM(rr.amount_recognized), 0)::int AS amount
       FROM fin_revenue_recognized rr
       JOIN mbr_enrollments e ON e.id = rr.enrollment_id
      WHERE rr.business_id = $1
      GROUP BY e.customer_id`,
    [businessId],
  );
  for (const row of memRows) {
    ensure(row.customer_id).membership += Number(row.amount) || 0;
  }

  return map;
}
