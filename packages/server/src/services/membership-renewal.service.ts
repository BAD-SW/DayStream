import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import {
  chargeStoredMethod, insertChargeRow, resolveBusinessCurrency, generateReference,
} from './customer-payment.service';
import { calculatePeriodEnd, calculateNextBillingDate, getPlanItems } from './membership.service';
import { getRetrySchedule } from './dunning-schedule';
import { postPaymentJournalEntry } from './payment-journal.service';
import type { MethodOwner } from './payment-methods.service';

/**
 * Section C — Subscription (membership) renewal charging (spec 10-payment-platform,
 * task 4.3). Fleshes out the business-scoped `billing_process` job: each day, for
 * the business, charge the membership enrollments whose next billing date has
 * arrived against the stored method on the enrollment, advance the period, roll
 * usage for the new period, and apply any scheduled (downgrade) plan change.
 *
 * Operates on the current membership model (`mbr_enrollments` / `mbr_plans` /
 * `mbr_usage`), not the legacy `mem_memberships`. A renewal charge links to its
 * enrollment via `pay_transactions.enrollment_id`.
 *
 * Idempotency: the period is advanced only after a non-failed charge, in the same
 * transaction, so a re-run on the same day sees `next_billing_date` already in the
 * future and skips the enrollment. The adapter idempotency key is stable per
 * (enrollment, period) so a provider-side retry never double-charges.
 *
 * Failure handoff: a declined charge records the failed ledger row and opens the
 * first dunning attempt; it does NOT advance the period. The configurable retry
 * schedule and escalation live in task 4.4 — here we only open attempt #1.
 */



export interface RenewalSummary {
  businessId: string;
  due: number;        // enrollments selected as due
  charged: number;    // charge succeeded (settled)
  pending: number;    // charge accepted but settling async (bank debit)
  failed: number;     // charge declined/failed → dunning opened
  skipped: number;    // no stored method, or no connection/setup issue
}

interface DueEnrollment {
  id: string;
  plan_id: string;
  customer_id: string;
  payment_method_id: string | null;
  current_period_start: string;
  next_billing_date: string;
  pending_plan_id: string | null;
  price: number;
  billing_frequency: string;
  plan_name: string;
}

/**
 * Renew all membership enrollments due today for one business. Returns a summary
 * of what happened. Safe to re-run (idempotent via period advancement).
 */
export async function runMembershipRenewals(
  businessId: string, today: Date = new Date(), _executionId: string | null = null,
): Promise<RenewalSummary> {
  const summary: RenewalSummary = { businessId, due: 0, charged: 0, pending: 0, failed: 0, skipped: 0 };

  // Resolve the business's tenant + currency once (enrollments carry neither).
  const { rows: bizRows } = await adminPool.query(
    'SELECT tenant_id, currency FROM sys_businesses WHERE id = $1',
    [businessId],
  );
  if (bizRows.length === 0) {
    logger.warn(`Membership renewals: business ${businessId} not found`);
    return summary;
  }
  const tenantId: string = bizRows[0].tenant_id;
  const currency: string = bizRows[0].currency || (await resolveBusinessCurrency(businessId));

  const todayStr = today.toISOString().split('T')[0];

  // Due = active enrollments whose billing date has arrived. Paused/cancelled rows
  // have next_billing_date = NULL, so they're excluded by the predicate. An
  // enrollment already in an open dunning cycle is excluded too — dunning owns its
  // retries, so renewals must not also charge it (C6.6: no double-charge).
  const { rows: due } = await adminPool.query<DueEnrollment>(
    `SELECT e.id, e.plan_id, e.customer_id, e.payment_method_id,
            e.current_period_start, e.next_billing_date, e.pending_plan_id,
            p.price, p.billing_frequency, p.name AS plan_name
     FROM mbr_enrollments e
     JOIN mbr_plans p ON p.id = e.plan_id
     WHERE e.business_id = $1 AND e.status = 'active'
       AND e.next_billing_date IS NOT NULL AND e.next_billing_date <= $2::date
       AND NOT EXISTS (
         SELECT 1 FROM pay_dunning_attempts d
         WHERE d.enrollment_id = e.id AND d.outcome = 'pending'
       )
     ORDER BY e.next_billing_date`,
    [businessId, todayStr],
  );
  summary.due = due.length;

  for (const enr of due) {
    try {
      const outcome = await renewOne(enr, businessId, tenantId, currency);
      summary[outcome] += 1;
    } catch (e: any) {
      // A setup problem (no connection, method gone) — treat as skipped, not a
      // hard job failure, so one bad enrollment doesn't stop the whole run.
      summary.skipped += 1;
      logger.warn(`Membership renewal skipped for enrollment ${enr.id}: ${e?.message || e}`);
    }
  }

  logger.info(`Membership renewals (business ${businessId}): ${JSON.stringify(summary)}`);
  return summary;
}

type RenewalOutcome = 'charged' | 'pending' | 'failed' | 'skipped';

/** Renew a single enrollment. Returns which summary bucket it landed in. */
async function renewOne(
  enr: DueEnrollment, businessId: string, tenantId: string, currency: string,
): Promise<RenewalOutcome> {
  // The plan that takes effect this cycle: a scheduled downgrade (pending_plan_id)
  // applies at renewal; otherwise the current plan.
  const effectivePlanId = enr.pending_plan_id || enr.plan_id;

  // The renewal amount is the (effective) plan's price. If a downgrade is pending,
  // charge the new plan's price for the new period.
  let amountCents = enr.price;
  let frequency = enr.billing_frequency;
  if (enr.pending_plan_id && enr.pending_plan_id !== enr.plan_id) {
    const { rows } = await adminPool.query(
      'SELECT price, billing_frequency FROM mbr_plans WHERE id = $1 AND business_id = $2',
      [enr.pending_plan_id, businessId],
    );
    if (rows[0]) { amountCents = rows[0].price; frequency = rows[0].billing_frequency; }
  }

  const reference = generateReference();

  // No stored method on the enrollment → can't charge. Record as skipped; a future
  // reminder/collection flow (or the UI) prompts the customer to add a method.
  if (!enr.payment_method_id) {
    logger.info(`Enrollment ${enr.id} has no stored payment method; skipping renewal charge`);
    return 'skipped';
  }

  const owner: MethodOwner = {
    ownerLevel: 'customer', businessId, tenantId, customerId: enr.customer_id,
  };

  // Zero-price plan (free membership): no charge, just advance the period.
  if (amountCents <= 0) {
    await advanceEnrollmentPeriod({
      enrollmentId: enr.id, currentPlanId: enr.plan_id, effectivePlanId,
      periodStartDate: enr.next_billing_date, frequency,
    });
    return 'charged';
  }

  const charge = await chargeStoredMethod({
    owner,
    amountCents,
    currency,
    paymentMethodId: enr.payment_method_id,
    // Stable per (enrollment, period) so a provider retry never double-charges.
    idempotencyKey: `enroll:${enr.id}:${enr.next_billing_date}`,
    description: `${enr.plan_name} membership renewal`,
    metadata: {
      kind: 'membership_renewal',
      business_id: businessId,
      tenant_id: tenantId,
      enrollment_id: enr.id,
      period: enr.next_billing_date,
    },
  });

  const status = charge.outcome === 'succeeded' ? 'completed'
    : charge.outcome === 'pending' ? 'pending' : 'failed';

  if (status === 'failed') {
    // Record the failed charge + open the first dunning attempt. Leave the period
    // intact so the enrollment stays "due" for the retry (task 4.4 drives retries).
    await recordFailure(enr, businessId, tenantId, currency, amountCents, reference, charge.failureReason ?? 'Declined');
    return 'failed';
  }

  // Success (settled or async-pending): write the ledger row, then advance the
  // period + roll usage + apply the pending plan change atomically.
  const renewalRow = await insertChargeRow(adminPool, {
    businessId, customerId: enr.customer_id, enrollmentId: enr.id,
    amountCents, currency, method: 'card', status,
    referenceNumber: reference, description: `${enr.plan_name} membership renewal`,
    processedBy: null, isProcessed: true, providerReference: charge.providerReference ?? null,
    paymentMethodId: enr.payment_method_id,
  });
  // Post the GL entry (enrollment-linked → credits Deferred Revenue so the
  // recognition job can move it to Membership Revenue over the period).
  if (status === 'completed') await postPaymentJournalEntry(renewalRow);

  await advanceEnrollmentPeriod({
    enrollmentId: enr.id, currentPlanId: enr.plan_id, effectivePlanId,
    periodStartDate: enr.next_billing_date, frequency,
  });
  return status === 'pending' ? 'pending' : 'charged';
}

/**
 * Advance an enrollment to its next period and roll usage, in one transaction.
 * The new period starts on the date that was due; the new period end and next
 * billing date derive from the (effective) frequency. A scheduled plan change
 * (pending_plan_id) is applied here and cleared. Also sets status back to
 * 'active' so a dunning-recovered enrollment is reactivated.
 *
 * Exported so the renewal path (task 4.3) and the dunning-recovery path (task
 * 4.4) share one source of truth for "a renewal succeeded, roll the period."
 */
export async function advanceEnrollmentPeriod(params: {
  enrollmentId: string;
  currentPlanId: string;
  effectivePlanId: string;
  periodStartDate: string;   // the due date that becomes the new period start
  frequency: string;
}): Promise<void> {
  const { enrollmentId, currentPlanId, effectivePlanId, periodStartDate, frequency } = params;
  const newPeriodEnd = calculatePeriodEnd(periodStartDate, frequency);
  const newNextBilling = calculateNextBillingDate(periodStartDate, frequency);
  const planChanged = effectivePlanId !== currentPlanId;

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE mbr_enrollments
       SET status = 'active',
           plan_id = $2,
           pending_plan_id = NULL,
           current_period_start = $3,
           current_period_end = $4,
           next_billing_date = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [enrollmentId, effectivePlanId, periodStartDate, newPeriodEnd, newNextBilling],
    );

    // Roll usage: seed a fresh allowance row per plan item for the new period.
    // ON CONFLICT keeps the advance idempotent if this cycle was partly applied.
    const items = await getPlanItems(effectivePlanId);
    for (const item of items) {
      await client.query(
        `INSERT INTO mbr_usage (enrollment_id, plan_item_id, period_start, period_end, quantity_used, quantity_allowed)
         VALUES ($1, $2, $3, $4, 0, $5)
         ON CONFLICT (enrollment_id, plan_item_id, period_start) DO NOTHING`,
        [enrollmentId, item.id, periodStartDate, newPeriodEnd, item.quantity_per_period],
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  if (planChanged) {
    logger.info(`Enrollment ${enrollmentId} applied pending plan change ${currentPlanId} → ${effectivePlanId}`);
  }
}

/**
 * Record a failed renewal: the failed ledger row + the first dunning attempt. The
 * period is NOT advanced (the enrollment stays due). Task 4.4 owns the retry
 * schedule, escalation, and past-due state transitions.
 */
async function recordFailure(
  enr: DueEnrollment, businessId: string, tenantId: string, currency: string,
  amountCents: number, reference: string, failureReason: string,
): Promise<void> {
  const txn = await insertChargeRow(adminPool, {
    businessId, customerId: enr.customer_id, enrollmentId: enr.id,
    amountCents, currency, method: 'card', status: 'failed',
    referenceNumber: reference, description: `${enr.plan_name} membership renewal (failed)`,
    processedBy: null, isProcessed: true, providerReference: null,
    paymentMethodId: enr.payment_method_id,
  });

  // First retry follows the business's configured dunning schedule (first offset).
  const schedule = await getRetrySchedule(businessId);
  const firstOffsetDays = schedule[0] ?? 1;
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + firstOffsetDays);
  const scheduledForStr = scheduledFor.toISOString().split('T')[0];

  // Open the first dunning attempt only if there isn't already an open one for this
  // enrollment (avoids piling up attempts across daily runs before 4.4 lands).
  await adminPool.query(
    `INSERT INTO pay_dunning_attempts
       (tenant_id, business_id, enrollment_id, attempt_number, scheduled_for, outcome, transaction_id, failure_reason)
     SELECT $1, $2, $3, 1, $4::date, 'pending', $5, $6
     WHERE NOT EXISTS (
       SELECT 1 FROM pay_dunning_attempts
       WHERE enrollment_id = $3 AND outcome = 'pending'
     )`,
    [tenantId, businessId, enr.id, scheduledForStr, txn.id, failureReason],
  );

  logger.info(`Enrollment ${enr.id} renewal failed (${failureReason}); dunning attempt opened for ${scheduledForStr}`);
}

// ============================================================
// Business billing-run schedule (Requirement C6a) — one per-business daily run.
// One sys_scheduled_jobs row at scope_level='business', job_type='billing_process'
// (which runs auto-resume + renewals + dunning). Mirrors the tenant-level schedule.
// ============================================================

export interface BusinessScheduleView {
  enabled: boolean;
  scheduleTime: string;      // 'HH:MM'
  scheduleTimezone: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
}

/** Read a business's recurring-billing schedule (null if never configured). */
export async function getBusinessBillingSchedule(businessId: string): Promise<BusinessScheduleView | null> {
  const { rows } = await adminPool.query(
    `SELECT enabled, schedule_time, schedule_timezone, last_run_at, last_run_status, next_run_at
     FROM sys_scheduled_jobs
     WHERE scope_level = 'business' AND business_id = $1::uuid AND job_type = 'billing_process' LIMIT 1`,
    [businessId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    enabled: r.enabled,
    scheduleTime: typeof r.schedule_time === 'string' ? r.schedule_time.slice(0, 5) : String(r.schedule_time).slice(0, 5),
    scheduleTimezone: r.schedule_timezone,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastRunStatus: r.last_run_status,
    nextRunAt: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
  };
}

/**
 * Create or update a business's recurring-billing schedule: a single daily
 * `billing_process` job at the given time in the business's timezone (C6a).
 * One row per business. tenant_id is required by the scope CHECK constraint.
 */
export async function saveBusinessBillingSchedule(
  businessId: string, tenantId: string, scheduleTime: string, scheduleTimezone: string, enabled: boolean,
): Promise<BusinessScheduleView> {
  const [h, m] = scheduleTime.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  await adminPool.query(
    `INSERT INTO sys_scheduled_jobs
       (scope_level, business_id, tenant_id, job_type, schedule_time, schedule_timezone, frequency, enabled, next_run_at)
     VALUES ('business', $1::uuid, $2::uuid, 'billing_process', $3, $4, 'daily', $5, $6)
     ON CONFLICT (business_id, job_type) WHERE scope_level = 'business'
     DO UPDATE SET schedule_time = $3, schedule_timezone = $4, enabled = $5,
                   next_run_at = $6, updated_at = NOW()`,
    [businessId, tenantId, scheduleTime, scheduleTimezone, enabled, next.toISOString()],
  );
  return (await getBusinessBillingSchedule(businessId))!;
}

/** Run a business's recurring billing now (manual trigger): resume + renew + dun. */
export async function runBusinessBillingNow(businessId: string): Promise<{ autoResumed: number; renewals: RenewalSummary; dunning: any }> {
  const { autoResumeExpiredPauses } = await import('./membership.service');
  const { processDunning } = await import('./dunning.service');
  const autoResumed = await autoResumeExpiredPauses(businessId);
  const renewals = await runMembershipRenewals(businessId, new Date(), null);
  const dunning = await processDunning(businessId, new Date(), null);
  return { autoResumed, renewals, dunning };
}
