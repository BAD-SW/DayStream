import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { logger } from '../middleware/logger';

/**
 * Deduct a session from a punch card membership.
 */
export async function deductPunchCardSession(
  membershipId: string,
  bookingId?: string,
  description?: string,
): Promise<{ success: boolean; sessions_remaining?: number; error?: string }> {
  const { rows } = await adminPool.query(
    `SELECT m.*, mp.plan_type FROM memberships m
     JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.id = $1 AND m.status = 'active'`,
    [membershipId],
  );

  if (rows.length === 0) return { success: false, error: 'Membership not found or not active' };
  const membership = rows[0];

  if (membership.plan_type !== 'punch_card' && membership.plan_type !== 'intro_package') {
    return { success: false, error: 'Not a punch card or intro package' };
  }

  if (membership.credit_balance <= 0) {
    return { success: false, error: 'No sessions remaining' };
  }

  const newBalance = membership.credit_balance - 1;

  await adminPool.query(
    'UPDATE memberships SET credit_balance = $2, updated_at = NOW() WHERE id = $1',
    [membershipId, newBalance],
  );

  await adminPool.query(
    `INSERT INTO credit_transactions (membership_id, type, amount, balance_after, description, booking_id)
     VALUES ($1, 'deducted', -1, $2, $3, $4)`,
    [membershipId, newBalance, description || 'Session used', bookingId || null],
  );

  // Auto-expire if zero remaining
  if (newBalance === 0) {
    await adminPool.query(
      "UPDATE memberships SET status = 'expired', updated_at = NOW() WHERE id = $1",
      [membershipId],
    );
    await adminPool.query(
      `INSERT INTO membership_status_history (membership_id, from_status, to_status, reason)
       VALUES ($1, 'active', 'expired', 'All sessions used')`,
      [membershipId],
    );
  }

  return { success: true, sessions_remaining: newBalance };
}

/**
 * Validate intro package eligibility.
 * Returns true if the customer has never purchased any membership for this business.
 */
export async function validateIntroEligibility(customerId: string, businessId: string, planId: string): Promise<{ eligible: boolean; reason?: string }> {
  const { rows } = await adminPool.query(
    'SELECT id FROM memberships WHERE customer_id = $1 AND business_id = $2 AND plan_id = $3',
    [customerId, businessId, planId],
  );

  if (rows.length > 0) {
    return { eligible: false, reason: 'Intro package already purchased by this customer' };
  }

  return { eligible: true };
}

/**
 * Get all active punch cards for a customer.
 */
export async function getActivePunchCards(customerId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT m.*, mp.name AS plan_name, mp.total_sessions
     FROM memberships m
     JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.customer_id = $1 AND m.business_id = $2 AND m.status = 'active'
       AND mp.plan_type IN ('punch_card', 'intro_package')
     ORDER BY m.end_date NULLS LAST`,
    [customerId, businessId],
  );
  return rows;
}

/**
 * Convert a punch card customer to a recurring membership.
 * Creates a new recurring membership while the punch card continues independently.
 */
export async function convertToRecurring(
  customerId: string, businessId: string, newPlanId: string,
  userId: string, tenantId: string,
): Promise<{ success: boolean; membership?: any; error?: string }> {
  // Validate new plan is recurring
  const { rows: planRows } = await adminPool.query(
    "SELECT * FROM membership_plans WHERE id = $1 AND business_id = $2 AND status = 'active' AND billing_cycle != 'one_time'",
    [newPlanId, businessId],
  );
  if (planRows.length === 0) {
    return { success: false, error: 'Target plan must be a recurring plan' };
  }

  // Check no duplicate
  const { rows: existing } = await adminPool.query(
    "SELECT id FROM memberships WHERE customer_id = $1 AND plan_id = $2 AND status IN ('active', 'pending')",
    [customerId, newPlanId],
  );
  if (existing.length > 0) {
    return { success: false, error: 'Customer already has this recurring membership' };
  }

  const plan = planRows[0];
  const startDate = new Date();
  const nextBilling = new Date(startDate);
  switch (plan.billing_cycle) {
    case 'monthly': nextBilling.setMonth(nextBilling.getMonth() + 1); break;
    case 'quarterly': nextBilling.setMonth(nextBilling.getMonth() + 3); break;
    case 'annually': nextBilling.setFullYear(nextBilling.getFullYear() + 1); break;
  }

  const initialCredits = plan.credits_per_cycle || 0;

  const { rows: mbrRows } = await adminPool.query(
    `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, auto_renew, credit_balance, created_by)
     VALUES ($1, $2, $3, 'active', $4, $5, true, $6, $7)
     RETURNING *`,
    [businessId, customerId, newPlanId, startDate.toISOString().slice(0, 10), nextBilling.toISOString().slice(0, 10), initialCredits, userId],
  );

  const membership = mbrRows[0];

  if (initialCredits > 0) {
    await adminPool.query(
      `INSERT INTO credit_transactions (membership_id, type, amount, balance_after, description)
       VALUES ($1, 'allocated', $2, $2, 'Initial allocation (converted from punch card)')`,
      [membership.id, initialCredits],
    );
  }

  await createActivity({
    customerId, businessId, activityType: 'membership',
    description: `Converted to recurring membership: ${plan.name}`,
    metadata: { membership_id: membership.id }, createdBy: userId,
  });

  await logAudit({ tenantId, userId, action: 'membership.converted', resourceType: 'membership', resourceId: membership.id,
    details: { plan: plan.name } });

  return { success: true, membership };
}
