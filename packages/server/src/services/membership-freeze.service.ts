import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { logger } from '../middleware/logger';

interface PauseResult {
  success: boolean;
  membership?: any;
  error?: string;
}

/**
 * Pause a membership.
 */
export async function pauseMembership(
  membershipId: string, businessId: string, pauseDays: number,
  userId: string, tenantId: string, adminOverride = false,
): Promise<PauseResult> {
  const { rows } = await adminPool.query(
    `SELECT m.*, mp.max_pause_days_per_year, mp.max_pauses_per_year
     FROM mem_memberships m
     JOIN mem_plans mp ON mp.id = m.plan_id
     WHERE m.id = $1 AND m.business_id = $2`,
    [membershipId, businessId],
  );

  if (rows.length === 0) return { success: false, error: 'Membership not found' };
  const membership = rows[0];

  if (membership.status !== 'active') {
    return { success: false, error: 'Only active memberships can be paused' };
  }

  // Validate limits (unless admin override)
  if (!adminOverride) {
    if (membership.pause_count >= membership.max_pauses_per_year) {
      return { success: false, error: `Maximum ${membership.max_pauses_per_year} pauses per year exceeded` };
    }
    if (membership.total_paused_days + pauseDays > membership.max_pause_days_per_year) {
      return { success: false, error: `Maximum ${membership.max_pause_days_per_year} pause days per year exceeded` };
    }
  }

  const pauseEndDate = new Date(Date.now() + pauseDays * 24 * 60 * 60 * 1000);

  // Extend end_date by pause days (if set)
  let newEndDate = membership.end_date;
  if (membership.end_date) {
    const end = new Date(membership.end_date);
    end.setDate(end.getDate() + pauseDays);
    newEndDate = end.toISOString().slice(0, 10);
  }

  // Extend next_billing_date by pause days (if set)
  let newBillingDate = membership.next_billing_date;
  if (membership.next_billing_date) {
    const billing = new Date(membership.next_billing_date);
    billing.setDate(billing.getDate() + pauseDays);
    newBillingDate = billing.toISOString().slice(0, 10);
  }

  await adminPool.query(
    `UPDATE mem_memberships SET
       status = 'paused', paused_at = NOW(), pause_end_date = $3,
       total_paused_days = total_paused_days + $4, pause_count = pause_count + 1,
       end_date = $5, next_billing_date = $6, updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [membershipId, businessId, pauseEndDate.toISOString().slice(0, 10), pauseDays, newEndDate, newBillingDate],
  );

  // Status history
  await adminPool.query(
    `INSERT INTO mem_status_history (membership_id, from_status, to_status, changed_by, reason)
     VALUES ($1, 'active', 'paused', $2, $3)`,
    [membershipId, userId, `Paused for ${pauseDays} days`],
  );

  await logAudit({ tenantId, userId, action: 'membership.paused', resourceType: 'membership', resourceId: membershipId, details: { pause_days: pauseDays } });

  const { rows: updated } = await adminPool.query('SELECT * FROM mem_memberships WHERE id = $1', [membershipId]);
  return { success: true, membership: updated[0] };
}

/**
 * Resume a paused membership.
 */
export async function resumeMembership(
  membershipId: string, businessId: string, userId: string, tenantId: string,
): Promise<PauseResult> {
  const { rows } = await adminPool.query(
    'SELECT * FROM mem_memberships WHERE id = $1 AND business_id = $2',
    [membershipId, businessId],
  );

  if (rows.length === 0) return { success: false, error: 'Membership not found' };
  const membership = rows[0];

  if (membership.status !== 'paused' && membership.status !== 'frozen') {
    return { success: false, error: 'Membership is not paused or frozen' };
  }

  await adminPool.query(
    `UPDATE mem_memberships SET status = 'active', paused_at = NULL, pause_end_date = NULL, updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [membershipId, businessId],
  );

  await adminPool.query(
    `INSERT INTO mem_status_history (membership_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, 'active', $3, 'Resumed')`,
    [membershipId, membership.status, userId],
  );

  await logAudit({ tenantId, userId, action: 'membership.resumed', resourceType: 'membership', resourceId: membershipId });

  const { rows: updated } = await adminPool.query('SELECT * FROM mem_memberships WHERE id = $1', [membershipId]);
  return { success: true, membership: updated[0] };
}

/**
 * Auto-resume paused memberships that have reached their pause_end_date (scheduled job).
 */
export async function autoResumePaused(): Promise<number> {
  const { rows } = await adminPool.query(
    "SELECT id, business_id FROM mem_memberships WHERE status = 'paused' AND pause_end_date <= CURRENT_DATE",
  );

  for (const m of rows) {
    await adminPool.query(
      "UPDATE mem_memberships SET status = 'active', paused_at = NULL, pause_end_date = NULL, updated_at = NOW() WHERE id = $1",
      [m.id],
    );
    await adminPool.query(
      `INSERT INTO mem_status_history (membership_id, from_status, to_status, reason)
       VALUES ($1, 'paused', 'active', 'Auto-resumed (pause period ended)')`,
      [m.id],
    );
  }

  if (rows.length > 0) logger.info('Auto-resumed memberships', { count: rows.length });
  return rows.length;
}
