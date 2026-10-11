import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import {
  chargeStoredMethod, insertChargeRow, resolveBusinessCurrency, generateReference,
} from './customer-payment.service';
import { advanceEnrollmentPeriod } from './membership-renewal.service';
import { getRetrySchedule } from './dunning-schedule';
import { logAudit } from './audit.service';
import { queueNotification } from './booking-notifications.service';
import type { MethodOwner } from './payment-methods.service';

/**
 * Section C — Dunning (spec 10-payment-platform, task 4.4 / Requirement C6).
 *
 * When a membership renewal charge is declined, task 4.3 opens the first
 * `pay_dunning_attempts` row (pending). This service drives the retry lifecycle:
 * on each daily billing run it processes the dunning attempts whose `scheduled_for`
 * has arrived, retries the stored-method charge, and either recovers the
 * enrollment (settle + roll the period) or schedules the next retry per a
 * configurable schedule with escalating notices — expiring the enrollment when
 * the schedule is exhausted.
 *
 * A dunning cycle "pauses" ordinary renewals for that enrollment (the renewal
 * query skips enrollments with an open attempt), so there's never a double charge.
 */

/** Escalating notice tiers, indexed by how many attempts have failed so far. */
type NoticeTier = 'friendly' | 'warning' | 'final';
function noticeTierForAttempt(attemptNumber: number, totalAttempts: number): NoticeTier {
  if (attemptNumber >= totalAttempts) return 'final';
  if (attemptNumber === 1) return 'friendly';
  return 'warning';
}

export interface DunningSummary {
  businessId: string;
  due: number;        // attempts processed
  recovered: number;  // charge succeeded → enrollment renewed
  retried: number;    // still failing, next attempt scheduled
  expired: number;    // schedule exhausted → enrollment expired
  skipped: number;    // couldn't attempt (method gone, setup issue)
}

interface DunningRow {
  id: string;
  enrollment_id: string;
  attempt_number: number;
  plan_id: string;
  customer_id: string;
  payment_method_id: string | null;
  next_billing_date: string | null;
  pending_plan_id: string | null;
  price: number;
  billing_frequency: string;
  plan_name: string;
  enrollment_status: string;
}

/**
 * Process all dunning attempts due today for one business. Returns a summary.
 * Idempotent per day: an attempt is marked settled/failed as it's processed, so a
 * re-run won't reprocess it (only still-pending, due attempts are selected).
 */
export async function processDunning(
  businessId: string, today: Date = new Date(), _executionId: string | null = null,
): Promise<DunningSummary> {
  const summary: DunningSummary = { businessId, due: 0, recovered: 0, retried: 0, expired: 0, skipped: 0 };

  const { rows: bizRows } = await adminPool.query(
    'SELECT tenant_id, currency FROM sys_businesses WHERE id = $1',
    [businessId],
  );
  if (bizRows.length === 0) return summary;
  const tenantId: string = bizRows[0].tenant_id;
  const currency: string = bizRows[0].currency || (await resolveBusinessCurrency(businessId));
  const schedule = await getRetrySchedule(businessId);

  const todayStr = today.toISOString().split('T')[0];

  const { rows: dueAttempts } = await adminPool.query<DunningRow>(
    `SELECT d.id, d.enrollment_id, d.attempt_number,
            e.plan_id, e.customer_id, e.payment_method_id, e.next_billing_date,
            e.pending_plan_id, e.status AS enrollment_status,
            p.price, p.billing_frequency, p.name AS plan_name
     FROM pay_dunning_attempts d
     JOIN mbr_enrollments e ON e.id = d.enrollment_id
     JOIN mbr_plans p ON p.id = e.plan_id
     WHERE d.business_id = $1 AND d.outcome = 'pending' AND d.scheduled_for <= $2::date
     ORDER BY d.scheduled_for`,
    [businessId, todayStr],
  );
  summary.due = dueAttempts.length;

  for (const attempt of dueAttempts) {
    try {
      const outcome = await processOne(attempt, businessId, tenantId, currency, schedule, today);
      summary[outcome] += 1;
    } catch (e: any) {
      summary.skipped += 1;
      logger.warn(`Dunning attempt ${attempt.id} skipped: ${e?.message || e}`);
    }
  }

  logger.info(`Dunning (business ${businessId}): ${JSON.stringify(summary)}`);
  return summary;
}

type DunningOutcome = 'recovered' | 'retried' | 'expired' | 'skipped';

async function processOne(
  attempt: DunningRow, businessId: string, tenantId: string, currency: string,
  schedule: number[], today: Date,
): Promise<DunningOutcome> {
  // If the enrollment is no longer active-ish (cancelled), close the attempt and stop.
  if (attempt.enrollment_status === 'cancelled' || attempt.enrollment_status === 'expired') {
    await closeAttempt(attempt.id, 'settled', null, 'Enrollment no longer active; dunning closed');
    return 'skipped';
  }
  if (!attempt.payment_method_id) {
    // No method to retry — escalate straight to the next scheduled step or expire.
    return failAndSchedule(attempt, businessId, tenantId, schedule, today, null, 'No payment method on file');
  }

  const effectivePlanId = attempt.pending_plan_id || attempt.plan_id;
  let amountCents = attempt.price;
  let frequency = attempt.billing_frequency;
  if (attempt.pending_plan_id && attempt.pending_plan_id !== attempt.plan_id) {
    const { rows } = await adminPool.query(
      'SELECT price, billing_frequency FROM mbr_plans WHERE id = $1 AND business_id = $2',
      [attempt.pending_plan_id, businessId],
    );
    if (rows[0]) { amountCents = rows[0].price; frequency = rows[0].billing_frequency; }
  }

  const reference = generateReference();
  const owner: MethodOwner = {
    ownerLevel: 'customer', businessId, tenantId, customerId: attempt.customer_id,
  };

  const charge = await chargeStoredMethod({
    owner,
    amountCents,
    currency,
    paymentMethodId: attempt.payment_method_id,
    // Stable per (enrollment, period, attempt) so a provider retry never double-charges.
    idempotencyKey: `dunning:${attempt.enrollment_id}:${attempt.next_billing_date}:${attempt.attempt_number}`,
    description: `${attempt.plan_name} membership renewal (retry ${attempt.attempt_number})`,
    metadata: {
      kind: 'membership_dunning',
      business_id: businessId,
      tenant_id: tenantId,
      enrollment_id: attempt.enrollment_id,
      attempt: String(attempt.attempt_number),
    },
  });

  const status = charge.outcome === 'succeeded' ? 'completed'
    : charge.outcome === 'pending' ? 'pending' : 'failed';

  if (status !== 'failed') {
    // Recovered. Record the ledger row, settle the attempt, renew the enrollment.
    const txn = await insertChargeRow(adminPool, {
      businessId, customerId: attempt.customer_id, enrollmentId: attempt.enrollment_id,
      amountCents, currency, method: 'card', status,
      referenceNumber: reference, description: `${attempt.plan_name} membership renewal (recovered)`,
      processedBy: null, isProcessed: true, providerReference: charge.providerReference ?? null,
      paymentMethodId: attempt.payment_method_id,
    });
    await closeAttempt(attempt.id, 'settled', txn.id, null);
    await advanceEnrollmentPeriod({
      enrollmentId: attempt.enrollment_id, currentPlanId: attempt.plan_id, effectivePlanId,
      periodStartDate: attempt.next_billing_date || today.toISOString().split('T')[0], frequency,
    });
    await audit(tenantId, attempt, 'dunning.recovered', { amount_cents: amountCents, reference });
    return 'recovered';
  }

  // Still failing: record the failed ledger row, then schedule next or expire.
  const failTxn = await insertChargeRow(adminPool, {
    businessId, customerId: attempt.customer_id, enrollmentId: attempt.enrollment_id,
    amountCents, currency, method: 'card', status: 'failed',
    referenceNumber: reference, description: `${attempt.plan_name} membership renewal (retry failed)`,
    processedBy: null, isProcessed: true, providerReference: null,
    paymentMethodId: attempt.payment_method_id,
  });
  return failAndSchedule(attempt, businessId, tenantId, schedule, today, failTxn.id, charge.failureReason ?? 'Declined');
}

/**
 * Mark the current attempt failed, then either schedule the next retry (if the
 * configurable schedule has more steps) or expire the enrollment (schedule
 * exhausted). Sends the appropriately escalating customer notice.
 */
async function failAndSchedule(
  attempt: DunningRow, businessId: string, tenantId: string, schedule: number[], today: Date,
  transactionId: string | null, failureReason: string,
): Promise<DunningOutcome> {
  const totalAttempts = schedule.length;              // schedule entries = number of retries
  await closeAttempt(attempt.id, 'failed', transactionId, failureReason);

  if (attempt.attempt_number < totalAttempts) {
    // Schedule the next retry. The interval is the gap between consecutive offsets
    // in the schedule (so [1,3,7] → retry 1 after 1d, retry 2 after +2d, retry 3 after +4d).
    const prevOffset = schedule[attempt.attempt_number - 1];
    const nextOffset = schedule[attempt.attempt_number];
    const gapDays = Math.max(1, nextOffset - prevOffset);
    const scheduledFor = new Date(today);
    scheduledFor.setDate(scheduledFor.getDate() + gapDays);
    const scheduledForStr = scheduledFor.toISOString().split('T')[0];
    const nextAttemptNumber = attempt.attempt_number + 1;

    await adminPool.query(
      `INSERT INTO pay_dunning_attempts
         (tenant_id, business_id, enrollment_id, attempt_number, scheduled_for, outcome, failure_reason)
       VALUES ($1, $2, $3, $4, $5::date, 'pending', $6)`,
      [tenantId, businessId, attempt.enrollment_id, nextAttemptNumber, scheduledForStr, failureReason],
    );

    await notify(attempt, businessId, noticeTierForAttempt(nextAttemptNumber, totalAttempts), scheduledForStr);
    await audit(tenantId, attempt, 'dunning.retry_failed', {
      attempt: attempt.attempt_number, next_attempt: nextAttemptNumber, next_retry: scheduledForStr, reason: failureReason,
    });
    return 'retried';
  }

  // Exhausted — expire the membership (C6.5). Stop billing it.
  await adminPool.query(
    `UPDATE mbr_enrollments SET status = 'expired', next_billing_date = NULL, updated_at = NOW() WHERE id = $1`,
    [attempt.enrollment_id],
  );
  await notify(attempt, businessId, 'final', null);
  await audit(tenantId, attempt, 'dunning.exhausted', { attempts: attempt.attempt_number, reason: failureReason });
  return 'expired';
}

/** Close a dunning attempt row with its final outcome. */
async function closeAttempt(
  attemptId: string, outcome: 'settled' | 'failed', transactionId: string | null, failureReason: string | null,
): Promise<void> {
  await adminPool.query(
    `UPDATE pay_dunning_attempts
     SET outcome = $2, attempted_at = NOW(),
         transaction_id = COALESCE($3, transaction_id),
         failure_reason = COALESCE($4, failure_reason)
     WHERE id = $1`,
    [attemptId, outcome, transactionId, failureReason],
  );
}

/** Queue the escalating dunning notice to the customer. Non-blocking. */
async function notify(
  attempt: DunningRow, businessId: string, tier: NoticeTier, nextRetryDate: string | null,
): Promise<void> {
  try {
    const { rows } = await adminPool.query(
      'SELECT email, first_name, last_name FROM cus_customers WHERE id = $1',
      [attempt.customer_id],
    );
    const cust = rows[0];
    await queueNotification({
      businessId,
      type: 'payment.dunning',
      recipientId: attempt.customer_id,
      recipientEmail: cust?.email || undefined,
      data: {
        tier,                                   // friendly | warning | final
        plan_name: attempt.plan_name,
        attempt_number: attempt.attempt_number,
        next_retry_date: nextRetryDate,         // null when expired (final notice)
        update_payment_method: true,
        customer_name: cust ? [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() : null,
      },
    });
  } catch (e: any) {
    logger.warn(`Dunning notice enqueue failed for enrollment ${attempt.enrollment_id}: ${e?.message || e}`);
  }
}

/** Audit a dunning event (C6.7). */
async function audit(
  tenantId: string, attempt: DunningRow, action: string, details: Record<string, unknown>,
): Promise<void> {
  await logAudit({
    tenantId,
    action,
    resourceType: 'membership_enrollment',
    resourceId: attempt.enrollment_id,
    details,
  }).catch(() => { /* audit must never block billing */ });
}

/**
 * Manual retry by staff (C6.8) — e.g. after the customer updates their card.
 * Processes the enrollment's open dunning attempt immediately, ignoring its
 * scheduled date. Returns the outcome, or null if there's no open attempt.
 */
export async function retryDunningNow(
  enrollmentId: string, businessId: string, userId: string,
): Promise<DunningOutcome | null> {
  const { rows: bizRows } = await adminPool.query(
    'SELECT tenant_id, currency FROM sys_businesses WHERE id = $1',
    [businessId],
  );
  if (bizRows.length === 0) return null;
  const tenantId: string = bizRows[0].tenant_id;
  const currency: string = bizRows[0].currency || (await resolveBusinessCurrency(businessId));
  const schedule = await getRetrySchedule(businessId);

  const { rows } = await adminPool.query<DunningRow>(
    `SELECT d.id, d.enrollment_id, d.attempt_number,
            e.plan_id, e.customer_id, e.payment_method_id, e.next_billing_date,
            e.pending_plan_id, e.status AS enrollment_status,
            p.price, p.billing_frequency, p.name AS plan_name
     FROM pay_dunning_attempts d
     JOIN mbr_enrollments e ON e.id = d.enrollment_id
     JOIN mbr_plans p ON p.id = e.plan_id
     WHERE d.enrollment_id = $1 AND d.business_id = $2 AND d.outcome = 'pending'
     ORDER BY d.attempt_number DESC
     LIMIT 1`,
    [enrollmentId, businessId],
  );
  const attempt = rows[0];
  if (!attempt) return null;

  await logAudit({
    tenantId, userId, action: 'dunning.manual_retry',
    resourceType: 'membership_enrollment', resourceId: enrollmentId,
    details: { attempt: attempt.attempt_number },
  }).catch(() => {});

  return processOne(attempt, businessId, tenantId, currency, schedule, new Date());
}
