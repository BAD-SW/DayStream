import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * Add a family member to a membership.
 */
export async function addFamilyMember(
  primaryMembershipId: string,
  businessId: string,
  customerId: string,
  userId: string,
): Promise<{ success: boolean; membership?: any; error?: string }> {
  // Load primary membership + plan config
  const { rows } = await adminPool.query(
    `SELECT m.*, mp.max_additional_members, mp.shared_credits, mp.plan_type, mp.credits_per_cycle, mp.credit_validity_days
     FROM memberships m
     JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.id = $1 AND m.business_id = $2 AND m.status = 'active' AND m.primary_membership_id IS NULL`,
    [primaryMembershipId, businessId],
  );

  if (rows.length === 0) return { success: false, error: 'Primary membership not found or not active' };
  const primary = rows[0];

  if (primary.max_additional_members <= 0) {
    return { success: false, error: 'Plan does not support additional family members' };
  }

  // Count current additional members
  const { rows: countRows } = await adminPool.query(
    "SELECT COUNT(*)::int AS count FROM memberships WHERE primary_membership_id = $1 AND status IN ('active', 'paused')",
    [primaryMembershipId],
  );

  if (countRows[0].count >= primary.max_additional_members) {
    return { success: false, error: `Maximum ${primary.max_additional_members} additional members reached` };
  }

  // Check customer doesn't already have a membership on this plan
  const { rows: existing } = await adminPool.query(
    "SELECT id FROM memberships WHERE customer_id = $1 AND plan_id = $2 AND status IN ('active', 'paused')",
    [customerId, primary.plan_id],
  );
  if (existing.length > 0) {
    return { success: false, error: 'Customer already has a membership on this plan' };
  }

  // Create additional member membership
  const credits = primary.shared_credits ? 0 : (primary.credits_per_cycle || 0);

  const { rows: mbrRows } = await adminPool.query(
    `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, auto_renew, credit_balance, primary_membership_id, created_by)
     VALUES ($1, $2, $3, 'active', CURRENT_DATE, $4, false, $5, $6, $7)
     RETURNING *`,
    [businessId, customerId, primary.plan_id, primary.next_billing_date, credits, primaryMembershipId, userId],
  );

  const membership = mbrRows[0];

  // Allocate credits if individual pool
  if (credits > 0) {
    await adminPool.query(
      `INSERT INTO credit_transactions (membership_id, type, amount, balance_after, description)
       VALUES ($1, 'allocated', $2, $2, 'Family member initial allocation')`,
      [membership.id, credits],
    );
  }

  return { success: true, membership };
}

/**
 * Remove a family member from a membership.
 */
export async function removeFamilyMember(
  primaryMembershipId: string,
  businessId: string,
  customerId: string,
): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE memberships SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = 'Removed from family membership'  WHERE primary_membership_id = $1 AND customer_id = $2 AND business_id = $3 AND status IN ('active', 'paused')",
    [primaryMembershipId, customerId, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get all family members for a membership.
 */
export async function getFamilyMembers(primaryMembershipId: string) {
  const { rows } = await adminPool.query(
    `SELECT m.id, m.customer_id, m.status, m.credit_balance, m.created_at,
            c.first_name, c.last_name, c.email
     FROM memberships m
     JOIN customers c ON c.id = m.customer_id
     WHERE m.primary_membership_id = $1
     ORDER BY m.created_at`,
    [primaryMembershipId],
  );
  return rows;
}

/**
 * Deduct from shared credit pool (primary membership balance).
 * Used when a family member books and the plan uses shared credits.
 */
export async function deductSharedCredit(
  memberMembershipId: string,
  amount: number,
  bookingId?: string,
): Promise<{ success: boolean; error?: string }> {
  // Find the primary membership
  const { rows } = await adminPool.query(
    'SELECT primary_membership_id FROM memberships WHERE id = $1',
    [memberMembershipId],
  );

  if (rows.length === 0) return { success: false, error: 'Membership not found' };

  const primaryId = rows[0].primary_membership_id;
  if (!primaryId) return { success: false, error: 'Not a family member membership' };

  // Deduct from primary's balance
  const { rows: primaryRows } = await adminPool.query(
    'SELECT credit_balance FROM memberships WHERE id = $1',
    [primaryId],
  );

  if (primaryRows.length === 0) return { success: false, error: 'Primary membership not found' };
  if (primaryRows[0].credit_balance < amount) return { success: false, error: 'Insufficient shared credits' };

  const newBalance = primaryRows[0].credit_balance - amount;
  await adminPool.query(
    'UPDATE memberships SET credit_balance = $2, updated_at = NOW() WHERE id = $1',
    [primaryId, newBalance],
  );

  await adminPool.query(
    `INSERT INTO credit_transactions (membership_id, type, amount, balance_after, description, booking_id)
     VALUES ($1, 'deducted', $2, $3, 'Shared credit (family member booking)', $4)`,
    [primaryId, -amount, newBalance, bookingId || null],
  );

  return { success: true };
}
