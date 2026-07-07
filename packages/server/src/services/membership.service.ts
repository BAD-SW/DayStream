import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { logger } from '../middleware/logger';

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['active', 'cancelled'],
  active: ['paused', 'frozen', 'cancelled', 'expired'],
  paused: ['active', 'cancelled'],
  frozen: ['active', 'cancelled'],
};

interface CreateMembershipInput {
  businessId: string;
  customerId: string;
  planId: string;
  createdBy: string;
  tenantId: string;
  staffInitiated?: boolean;
}

/**
 * Purchase/activate a membership.
 */
export async function createMembership(input: CreateMembershipInput) {
  // Load plan
  const { rows: planRows } = await adminPool.query(
    "SELECT * FROM mem_plans WHERE id = $1 AND business_id = $2 AND status = 'active'",
    [input.planId, input.businessId],
  );
  if (planRows.length === 0) throw new Error('Plan not found or not active');

  const plan = planRows[0];

  // Validate intro package eligibility
  if (plan.is_intro_only) {
    const { rows: priorMemberships } = await adminPool.query(
      'SELECT id FROM mem_memberships WHERE customer_id = $1 AND business_id = $2 AND plan_id = $3',
      [input.customerId, input.businessId, input.planId],
    );
    if (priorMemberships.length > 0) {
      throw new Error('Intro package already purchased by this customer');
    }
  }

  // Prevent duplicate active memberships of same plan
  const { rows: activeDups } = await adminPool.query(
    "SELECT id FROM mem_memberships WHERE customer_id = $1 AND plan_id = $2 AND status IN ('active', 'pending', 'paused')",
    [input.customerId, input.planId],
  );
  if (activeDups.length > 0) {
    throw new Error('Customer already has an active membership of this plan');
  }

  // Calculate dates
  const startDate = new Date();
  let endDate: Date | null = null;
  let nextBillingDate: Date | null = null;

  if (plan.billing_cycle === 'one_time') {
    // Punch cards / intro packages have expiration
    if (plan.expiration_days) {
      endDate = new Date(startDate.getTime() + plan.expiration_days * 24 * 60 * 60 * 1000);
    }
  } else {
    // Recurring: calculate next billing
    nextBillingDate = calculateNextBillingDate(startDate, plan.billing_cycle, plan.trial_days || 0);
  }

  // Initial status
  const status = input.staffInitiated ? 'active' : 'active'; // auto-activate for now

  // Initial credits
  const initialCredits = plan.credits_per_cycle || plan.total_sessions || 0;

  const { rows } = await adminPool.query(
    `INSERT INTO mem_memberships (business_id, customer_id, plan_id, status, start_date, end_date, next_billing_date, auto_renew, credit_balance, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.businessId, input.customerId, input.planId, status,
      startDate.toISOString().slice(0, 10),
      endDate ? endDate.toISOString().slice(0, 10) : null,
      nextBillingDate ? nextBillingDate.toISOString().slice(0, 10) : null,
      plan.billing_cycle !== 'one_time',
      initialCredits,
      input.createdBy,
    ],
  );

  const membership = rows[0];

  // Record initial credit allocation
  if (initialCredits > 0) {
    const expiresAt = plan.credit_validity_days
      ? new Date(startDate.getTime() + plan.credit_validity_days * 24 * 60 * 60 * 1000)
      : null;

    await adminPool.query(
      `INSERT INTO mem_credit_transactions (membership_id, type, amount, balance_after, description, expires_at)
       VALUES ($1, 'allocated', $2, $2, 'Initial credit allocation', $3)`,
      [membership.id, initialCredits, expiresAt ? expiresAt.toISOString() : null],
    );
  }

  // Status history
  await adminPool.query(
    `INSERT INTO mem_status_history (membership_id, from_status, to_status, changed_by)
     VALUES ($1, NULL, $2, $3)`,
    [membership.id, status, input.createdBy],
  );

  // Customer activity
  await createActivity({
    customerId: input.customerId,
    businessId: input.businessId,
    activityType: 'membership',
    description: `Membership activated: ${plan.name}`,
    metadata: { membership_id: membership.id, plan_name: plan.name },
    createdBy: input.createdBy,
  });

  // Audit
  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'membership.created',
    resourceType: 'membership',
    resourceId: membership.id,
    details: { plan: plan.name, customer_id: input.customerId },
  });

  return membership;
}

/**
 * Get memberships with filters.
 */
export async function getMemberships(businessId: string, filters?: { status?: string; customerId?: string; planId?: string; page?: number; limit?: number }) {
  const conditions = ['m.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;

  if (filters?.status) { conditions.push(`m.status = $${idx++}`); params.push(filters.status); }
  if (filters?.customerId) { conditions.push(`m.customer_id = $${idx++}`); params.push(filters.customerId); }
  if (filters?.planId) { conditions.push(`m.plan_id = $${idx++}`); params.push(filters.planId); }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters?.limit || 20, 100);
  const page = filters?.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT m.*, mp.name AS plan_name, mp.plan_type, c.first_name, c.last_name, c.email
       FROM mem_memberships m
       JOIN mem_plans mp ON mp.id = m.plan_id
       JOIN cus_customers c ON c.id = m.customer_id
       WHERE ${where}
       ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM mem_memberships m WHERE ${where}`, params),
  ]);

  return { memberships: dataResult.rows, total: countResult.rows[0].total, page, limit };
}

/**
 * Get a single membership by ID.
 */
export async function getMembershipById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT m.*, mp.name AS plan_name, mp.plan_type, mp.billing_cycle, mp.credits_per_cycle,
            c.first_name, c.last_name, c.email
     FROM mem_memberships m
     JOIN mem_plans mp ON mp.id = m.plan_id
     JOIN cus_customers c ON c.id = m.customer_id
     WHERE m.id = $1 AND m.business_id = $2`,
    [id, businessId],
  );
  if (rows.length === 0) return null;

  const { rows: history } = await adminPool.query(
    'SELECT * FROM mem_status_history WHERE membership_id = $1 ORDER BY created_at',
    [id],
  );

  return { ...rows[0], status_history: history };
}

/**
 * Cancel a membership.
 */
export async function cancelMembership(id: string, businessId: string, userId: string, tenantId: string, reason?: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM mem_memberships WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  if (rows.length === 0) return { success: false, error: 'Membership not found' };

  const membership = rows[0];
  const allowed = VALID_TRANSITIONS[membership.status];
  if (!allowed || !allowed.includes('cancelled')) {
    return { success: false, error: `Cannot cancel membership in '${membership.status}' status` };
  }

  await adminPool.query(
    "UPDATE mem_memberships SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $3, cancellation_reason = $4, updated_at = NOW() WHERE id = $1 AND business_id = $2",
    [id, businessId, userId, reason || null],
  );

  await adminPool.query(
    `INSERT INTO mem_status_history (membership_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, 'cancelled', $3, $4)`,
    [id, membership.status, userId, reason || null],
  );

  await logAudit({ tenantId, userId, action: 'membership.cancelled', resourceType: 'membership', resourceId: id, details: { reason } });

  await createActivity({
    customerId: membership.customer_id,
    businessId,
    activityType: 'membership',
    description: `Membership cancelled${reason ? ': ' + reason : ''}`,
    metadata: { membership_id: id },
    createdBy: userId,
  });

  // Deactivate family members
  await adminPool.query(
    "UPDATE mem_memberships SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = 'Primary membership cancelled' WHERE primary_membership_id = $1 AND status IN ('active', 'paused')",
    [id],
  );

  return { success: true };
}

/**
 * Auto-expire memberships past their end date or with exhausted credits (one-time plans).
 */
export async function evaluateExpirations(): Promise<number> {
  // Expire one-time plans past end_date
  const { rowCount: dateExpired } = await adminPool.query(
    `UPDATE mem_memberships SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE`,
  );

  // Expire one-time plans with zero credits
  const { rowCount: creditExpired } = await adminPool.query(
    `UPDATE mem_memberships SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND credit_balance <= 0
       AND plan_id IN (SELECT id FROM mem_plans WHERE billing_cycle = 'one_time' AND (plan_type = 'punch_card' OR plan_type = 'intro_package'))`,
  );

  const total = (dateExpired ?? 0) + (creditExpired ?? 0);
  if (total > 0) logger.info('Memberships expired', { count: total });
  return total;
}

// --- Helpers ---

function calculateNextBillingDate(startDate: Date, billingCycle: string, trialDays: number): Date {
  const date = new Date(startDate.getTime() + trialDays * 24 * 60 * 60 * 1000);
  switch (billingCycle) {
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
    case 'quarterly': date.setMonth(date.getMonth() + 3); break;
    case 'annually': date.setFullYear(date.getFullYear() + 1); break;
  }
  return date;
}
