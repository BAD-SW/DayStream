import { adminPool } from '../db/pool';

interface BenefitEvaluation {
  has_access: boolean;
  discount_percentage: number;
  is_exclusive: boolean;
  insufficient_credits: boolean;
  credit_cost: number;
}

/**
 * Evaluate membership benefits for a booking attempt.
 * Checks access, discount, exclusivity, and credits.
 */
export async function evaluateBenefitsForBooking(
  customerId: string,
  businessId: string,
  serviceId: string,
): Promise<BenefitEvaluation> {
  // Find active memberships for this customer
  const { rows: memberships } = await adminPool.query(
    `SELECT m.id, m.plan_id, m.credit_balance, mp.plan_type
     FROM memberships m
     JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.customer_id = $1 AND m.business_id = $2 AND m.status = 'active'`,
    [customerId, businessId],
  );

  if (memberships.length === 0) {
    return { has_access: false, discount_percentage: 0, is_exclusive: false, insufficient_credits: false, credit_cost: 0 };
  }

  let bestDiscount = 0;
  let hasAccess = false;
  let isExclusive = false;
  let creditCost = 0;
  let insufficientCredits = false;

  for (const membership of memberships) {
    // Check plan_service_access for this service
    const { rows: accessRows } = await adminPool.query(
      `SELECT * FROM plan_service_access
       WHERE plan_id = $1 AND (service_id = $2 OR category_id IN (SELECT category_id FROM services WHERE id = $2))`,
      [membership.plan_id, serviceId],
    );

    if (accessRows.length > 0) {
      const access = accessRows[0];
      hasAccess = true;
      creditCost = access.credit_cost || 1;

      if (access.access_type === 'exclusive') isExclusive = true;
      if (access.access_type === 'discounted' && access.discount_percentage) {
        bestDiscount = Math.max(bestDiscount, access.discount_percentage);
      }
      if (access.access_type === 'included') {
        bestDiscount = 100; // fully included = 100% discount on service price
      }

      // For credit-based plans, check balance
      if (membership.plan_type === 'credit' || membership.plan_type === 'hybrid' || membership.plan_type === 'punch_card') {
        if (membership.credit_balance < creditCost) {
          insufficientCredits = true;
        }
      }
    }

    // Check plan benefits for general discounts
    const { rows: benefits } = await adminPool.query(
      "SELECT * FROM plan_benefits WHERE plan_id = $1 AND benefit_type = 'discount'",
      [membership.plan_id],
    );
    for (const b of benefits) {
      if (b.value && b.value > bestDiscount && bestDiscount < 100) {
        bestDiscount = b.value;
      }
    }
  }

  return {
    has_access: hasAccess,
    discount_percentage: bestDiscount,
    is_exclusive: isExclusive,
    insufficient_credits: insufficientCredits,
    credit_cost: creditCost,
  };
}

/**
 * Check if a service requires exclusive membership access.
 */
export async function isServiceExclusive(serviceId: string, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT 1 FROM plan_service_access psa
     JOIN membership_plans mp ON mp.id = psa.plan_id
     WHERE psa.service_id = $1 AND mp.business_id = $2 AND psa.access_type = 'exclusive'
     LIMIT 1`,
    [serviceId, businessId],
  );
  return rows.length > 0;
}

/**
 * Get guest pass usage for a membership in current cycle.
 */
export async function getGuestPassUsage(membershipId: string): Promise<{ used: number; total: number }> {
  const { rows: benefits } = await adminPool.query(
    `SELECT pb.value FROM plan_benefits pb
     JOIN memberships m ON m.plan_id = pb.plan_id
     WHERE m.id = $1 AND pb.benefit_type = 'guest_pass' AND pb.per_cycle = true`,
    [membershipId],
  );

  if (benefits.length === 0) return { used: 0, total: 0 };

  const total = benefits[0].value || 0;

  // Count guest bookings this cycle (simplified: this month)
  const { rows: usage } = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM bookings b
     WHERE b.customer_id IN (
       SELECT customer_id FROM memberships WHERE primary_membership_id = $1
     )
     AND b.created_at >= DATE_TRUNC('month', NOW())
     AND b.status IN ('confirmed', 'completed')`,
    [membershipId],
  );

  return { used: usage[0]?.count || 0, total };
}

/**
 * Get all active benefits for a customer's memberships.
 */
export async function getCustomerBenefits(customerId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT pb.*, mp.name AS plan_name
     FROM plan_benefits pb
     JOIN membership_plans mp ON mp.id = pb.plan_id
     JOIN memberships m ON m.plan_id = mp.id
     WHERE m.customer_id = $1 AND m.business_id = $2 AND m.status = 'active'`,
    [customerId, businessId],
  );
  return rows;
}
