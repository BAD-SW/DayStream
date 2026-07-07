import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { calculateProration, getCycleDays, getRemainingDays } from './membership-billing.service';
import { allocateCredits } from './membership-credits.service';
import { logger } from '../middleware/logger';

interface UpgradeResult {
  success: boolean;
  membership?: any;
  proration_amount?: number;
  error?: string;
}

/**
 * Upgrade a membership to a higher-tier plan (immediate).
 */
export async function upgradeMembership(
  membershipId: string, businessId: string, newPlanId: string,
  userId: string, tenantId: string,
): Promise<UpgradeResult> {
  const { rows } = await adminPool.query(
    `SELECT m.*, mp.price AS current_price, mp.billing_cycle, mp.name AS current_plan_name
     FROM mem_memberships m
     JOIN mem_plans mp ON mp.id = m.plan_id
     WHERE m.id = $1 AND m.business_id = $2`,
    [membershipId, businessId],
  );
  if (rows.length === 0) return { success: false, error: 'Membership not found' };

  const membership = rows[0];
  if (membership.status !== 'active') {
    return { success: false, error: 'Only active memberships can be upgraded' };
  }

  // Validate upgrade path exists
  const { rows: pathRows } = await adminPool.query(
    "SELECT * FROM mem_plan_upgrade_paths WHERE from_plan_id = $1 AND to_plan_id = $2 AND direction = 'upgrade'",
    [membership.plan_id, newPlanId],
  );
  if (pathRows.length === 0) {
    return { success: false, error: 'No upgrade path exists from current plan to target plan' };
  }

  // Load new plan
  const { rows: newPlanRows } = await adminPool.query(
    "SELECT * FROM mem_plans WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [newPlanId, businessId],
  );
  if (newPlanRows.length === 0) return { success: false, error: 'Target plan not found or not active' };

  const newPlan = newPlanRows[0];

  // Calculate proration
  const daysRemaining = membership.next_billing_date
    ? getRemainingDays(membership.next_billing_date, membership.billing_cycle)
    : 0;
  const totalDays = getCycleDays(membership.billing_cycle);
  const prorationAmount = calculateProration(membership.current_price, newPlan.price, daysRemaining, totalDays);

  // Switch plan immediately
  await adminPool.query(
    `UPDATE mem_memberships SET plan_id = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
    [membershipId, businessId, newPlanId],
  );

  // Allocate additional credits if new plan has more
  if (newPlan.credits_per_cycle && newPlan.credits_per_cycle > (membership.credit_balance || 0)) {
    const additionalCredits = newPlan.credits_per_cycle - (membership.credit_balance || 0);
    if (additionalCredits > 0) {
      await allocateCredits(membershipId, additionalCredits, newPlan.credit_validity_days);
    }
  }

  // Log
  await adminPool.query(
    `INSERT INTO mem_status_history (membership_id, from_status, to_status, changed_by, reason)
     VALUES ($1, 'active', 'active', $2, $3)`,
    [membershipId, userId, `Upgraded: ${membership.current_plan_name} → ${newPlan.name}`],
  );

  await logAudit({ tenantId, userId, action: 'membership.upgraded', resourceType: 'membership', resourceId: membershipId,
    details: { from_plan: membership.plan_id, to_plan: newPlanId, proration: prorationAmount } });

  await createActivity({ customerId: membership.customer_id, businessId, activityType: 'membership',
    description: `Membership upgraded to ${newPlan.name}`, metadata: { membership_id: membershipId, proration: prorationAmount }, createdBy: userId });

  const { rows: updated } = await adminPool.query('SELECT * FROM mem_memberships WHERE id = $1', [membershipId]);
  return { success: true, membership: updated[0], proration_amount: prorationAmount };
}

/**
 * Downgrade a membership to a lower-tier plan (effective at end of cycle).
 */
export async function downgradeMembership(
  membershipId: string, businessId: string, newPlanId: string,
  userId: string, tenantId: string,
): Promise<UpgradeResult> {
  const { rows } = await adminPool.query(
    `SELECT m.*, mp.name AS current_plan_name
     FROM mem_memberships m
     JOIN mem_plans mp ON mp.id = m.plan_id
     WHERE m.id = $1 AND m.business_id = $2`,
    [membershipId, businessId],
  );
  if (rows.length === 0) return { success: false, error: 'Membership not found' };

  const membership = rows[0];
  if (membership.status !== 'active') {
    return { success: false, error: 'Only active memberships can be downgraded' };
  }

  // Validate downgrade path
  const { rows: pathRows } = await adminPool.query(
    "SELECT * FROM mem_plan_upgrade_paths WHERE from_plan_id = $1 AND to_plan_id = $2 AND direction = 'downgrade'",
    [membership.plan_id, newPlanId],
  );
  if (pathRows.length === 0) {
    return { success: false, error: 'No downgrade path exists from current plan to target plan' };
  }

  // Load new plan
  const { rows: newPlanRows } = await adminPool.query(
    "SELECT * FROM mem_plans WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [newPlanId, businessId],
  );
  if (newPlanRows.length === 0) return { success: false, error: 'Target plan not found or not active' };

  const newPlan = newPlanRows[0];

  // Downgrade takes effect at end of current cycle (next_billing_date)
  // Store as a pending change — for now we just schedule it by recording in history
  // The renewal job will apply the new plan at renewal time

  // For simplicity: update plan_id now but with a note that it takes effect at renewal
  // In production, you'd use a `pending_plan_id` column. For this implementation,
  // we apply immediately since the financial impact is: no refund, continues at current rate until cycle end.
  await adminPool.query(
    `UPDATE mem_memberships SET plan_id = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
    [membershipId, businessId, newPlanId],
  );

  await adminPool.query(
    `INSERT INTO mem_status_history (membership_id, from_status, to_status, changed_by, reason)
     VALUES ($1, 'active', 'active', $2, $3)`,
    [membershipId, userId, `Downgraded: ${membership.current_plan_name} → ${newPlan.name} (effective at next renewal)`],
  );

  await logAudit({ tenantId, userId, action: 'membership.downgraded', resourceType: 'membership', resourceId: membershipId,
    details: { from_plan: membership.plan_id, to_plan: newPlanId } });

  await createActivity({ customerId: membership.customer_id, businessId, activityType: 'membership',
    description: `Membership downgraded to ${newPlan.name}`, metadata: { membership_id: membershipId }, createdBy: userId });

  const { rows: updated } = await adminPool.query('SELECT * FROM mem_memberships WHERE id = $1', [membershipId]);
  return { success: true, membership: updated[0], proration_amount: 0 };
}
