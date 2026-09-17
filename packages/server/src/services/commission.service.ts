import { adminPool } from '../db/pool';

/**
 * Order-based commission — the single source of truth shared by payroll (Posted)
 * and the Commissions report (Projected), so the two always agree.
 *
 * Commission is earned on COMPLETED-order line items credited to a staff member
 * (fin_orders.status = 'completed'). Basing it on completed orders means it is
 * tied to locked-in, collected revenue: an order that is never checked out, or
 * later voided/refunded, earns nothing — which closes the "fake completed
 * appointment" abuse vector that a booking-status basis allowed.
 *
 * Two compensation rule types earn commission, both from the same order lines
 * and both applying to any eligible offer type (service, product, membership,
 * package — only no_show_fee penalty lines are excluded):
 *   - 'commission' (percentage): amount = round(lineBase * rate / 10000),
 *     lineBase = unit_price*quantity - discount_amount (pre-tax net).
 *   - 'per_session' (flat rate): amount = quantity * rate — a flat amount per
 *     unit sold (e.g. $20 per massage, $0.50 per lotion, $5 per new membership).
 *
 * Rule scoping is honored: a rule matches a line when reference_type IS NULL
 * (all offerings) OR reference_type = line.item_type AND line.item_id =
 * ANY(reference_ids). A scoped (specific) rule takes precedence over a generic
 * (NULL) rule of the same type for a given line.
 *
 * Threshold_amount is intentionally NOT applied here — it is a period-level
 * concept (pay period / quarter / year) and does not map to per-line commission.
 */

export interface CommissionLine {
  order_id: string;
  order_number: string;
  /** TIMESTAMPTZ from pg — a Date at runtime (or null). */
  completed_at: Date | string | null;
  customer_id: string | null;
  staff_id: string;
  item_type: string;
  item_name: string;
  line_base: number; // cents, pre-tax net (for percentage); gross qty for per_session context
  quantity: number;
  rule_type: 'commission' | 'per_session';
  rate: number; // bps for commission, cents/session for per_session
  commission: number; // cents earned on this line
}

interface ComputeArgs {
  businessId: string;
  start: string; // yyyy-mm-dd inclusive (by order completed_at date)
  end: string;
  /** Optional: restrict to a single staff member. */
  userId?: string;
}

/**
 * Return one row per (completed order line × the matching commission rule) that
 * earns commission for a credited staff member in the range. Ordered by order.
 */
export async function computeOrderCommissionLines(args: ComputeArgs): Promise<CommissionLine[]> {
  const { businessId, start, end, userId } = args;
  const params: any[] = [businessId, start, end];
  let userClause = '';
  if (userId) { params.push(userId); userClause = `AND COALESCE(oi.credited_to, o.credited_to) = $${params.length}`; }

  // For each eligible completed-order line, find the staff member's applicable
  // active commission rule(s) as of the order's completion date. A scoped rule
  // (reference_ids matches the line) is preferred over a generic (NULL) rule of
  // the same rule_type via DISTINCT ON ordering (specific first).
  const { rows } = await adminPool.query(
    `WITH lines AS (
       SELECT oi.id AS line_id,
              o.id AS order_id,
              o.order_number,
              o.completed_at,
              o.customer_id,
              COALESCE(oi.credited_to, o.credited_to) AS staff_id,
              oi.item_type,
              oi.item_name,
              oi.item_id,
              oi.quantity,
              (oi.unit_price * oi.quantity - oi.discount_amount)::int AS line_base
         FROM fin_order_items oi
         JOIN fin_orders o ON o.id = oi.order_id
        WHERE o.business_id = $1
          AND o.status = 'completed'
          AND o.completed_at::date BETWEEN $2::date AND $3::date
          AND COALESCE(oi.credited_to, o.credited_to) IS NOT NULL
          AND oi.item_type IN ('service', 'product', 'membership', 'package')
          ${userClause}
     ),
     matched AS (
       -- One winning rule per (line × rule_type): a scoped rule beats a generic
       -- one, then most-recent effective_from. A line can earn under BOTH a
       -- 'commission' and a 'per_session' rule (distinct rule_types).
       SELECT DISTINCT ON (l.line_id, cr.rule_type)
              l.order_id, l.order_number, l.completed_at, l.customer_id, l.staff_id,
              l.item_type, l.item_name, l.quantity, l.line_base,
              cr.rule_type, cr.rate
         FROM lines l
         JOIN fin_compensation_rules cr
           ON cr.business_id = $1
          AND cr.user_id = l.staff_id
          AND cr.status = 'active'
          AND cr.rule_type IN ('commission', 'per_session')
          AND cr.effective_from <= l.completed_at::date
          AND (cr.effective_to IS NULL OR cr.effective_to >= l.completed_at::date)
          -- scope: generic (NULL) matches any eligible line; scoped matches its type + ids
          AND (
            cr.reference_type IS NULL
            OR (cr.reference_type = l.item_type
                AND (cr.reference_ids IS NULL OR l.item_id = ANY(cr.reference_ids)))
          )
        ORDER BY l.line_id, cr.rule_type, (cr.reference_ids IS NOT NULL) DESC, cr.effective_from DESC
     )
     SELECT order_id, order_number, completed_at, customer_id, staff_id,
            item_type, item_name, quantity, line_base, rule_type, rate,
            CASE
              WHEN rule_type = 'commission' THEN ROUND(line_base * rate / 10000.0)::int
              WHEN rule_type = 'per_session' THEN (quantity * rate)::int
              ELSE 0
            END AS commission
       FROM matched
      WHERE (
        (rule_type = 'commission' AND ROUND(line_base * rate / 10000.0)::int <> 0)
        OR (rule_type = 'per_session' AND quantity * rate <> 0)
      )
      ORDER BY completed_at DESC, order_number`,
    params,
  );

  return rows.map((r) => ({
    order_id: r.order_id,
    order_number: r.order_number,
    completed_at: r.completed_at,
    customer_id: r.customer_id,
    staff_id: r.staff_id,
    item_type: r.item_type,
    item_name: r.item_name,
    line_base: Number(r.line_base) || 0,
    quantity: Number(r.quantity) || 0,
    rule_type: r.rule_type,
    rate: Number(r.rate) || 0,
    commission: Number(r.commission) || 0,
  }));
}

/**
 * Total order-based commission per staff member for the range, split by rule
 * type. Used by payroll to compute the commission/per_session gross for a
 * period. Keyed by staff user_id.
 */
export async function commissionTotalsByStaff(
  args: ComputeArgs,
): Promise<Map<string, { commission: number; perSession: number }>> {
  const lines = await computeOrderCommissionLines(args);
  const totals = new Map<string, { commission: number; perSession: number }>();
  for (const line of lines) {
    let t = totals.get(line.staff_id);
    if (!t) { t = { commission: 0, perSession: 0 }; totals.set(line.staff_id, t); }
    if (line.rule_type === 'commission') t.commission += line.commission;
    else t.perSession += line.commission;
  }
  return totals;
}
