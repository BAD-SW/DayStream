import { adminPool } from '../db/pool';
import { allocateCredits, processRollover } from './membership-credits.service';
import { logger } from '../middleware/logger';

/**
 * Process membership renewals due today.
 * DayStream initiates all billing — the payment processor is a passive endpoint.
 */
export async function processRenewals(): Promise<{ processed: number; renewed: number; failed: number }> {
  // Find active memberships with next_billing_date = today and auto_renew = true
  const { rows: due } = await adminPool.query(
    `SELECT m.id, m.business_id, m.customer_id, m.plan_id, m.credit_balance,
            mp.price, mp.billing_cycle, mp.credits_per_cycle, mp.credit_validity_days,
            mp.rollover_policy, mp.max_rollover_credits
     FROM memberships m
     JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.status = 'active' AND m.auto_renew = true AND m.next_billing_date <= CURRENT_DATE`,
  );

  let renewed = 0;
  let failed = 0;

  for (const membership of due) {
    try {
      // Initiate payment (stub — Phase 10 implements actual charge)
      const paymentSuccess = await initiatePayment(membership.business_id, membership.customer_id, membership.price, `Membership renewal: ${membership.id}`);

      if (paymentSuccess) {
        // Process rollover before allocating new credits
        if (membership.credits_per_cycle && membership.credit_balance > 0) {
          await processRollover(membership.id, membership.rollover_policy, membership.max_rollover_credits);
        }

        // Allocate new credits
        if (membership.credits_per_cycle) {
          await allocateCredits(membership.id, membership.credits_per_cycle, membership.credit_validity_days);
        }

        // Extend billing date
        const nextBilling = calculateNextBillingDate(new Date(), membership.billing_cycle);
        await adminPool.query(
          'UPDATE memberships SET next_billing_date = $2, updated_at = NOW() WHERE id = $1',
          [membership.id, nextBilling.toISOString().slice(0, 10)],
        );

        renewed++;
      } else {
        // Payment failed — enter dunning
        await enterDunning(membership.id, membership.business_id);
        failed++;
      }
    } catch (err: any) {
      logger.error('Renewal processing error', { membershipId: membership.id, error: err.message });
      failed++;
    }
  }

  if (due.length > 0) {
    logger.info('Renewal processing complete', { processed: due.length, renewed, failed });
  }

  return { processed: due.length, renewed, failed };
}

/**
 * Process dunning retries for failed payments.
 * Dunning schedule: retry at day 1, 3, 7 after initial failure.
 */
export async function processDunning(): Promise<{ retried: number; expired: number }> {
  // Find memberships in dunning (tracked via notification_queue or a simple flag)
  // For now, check memberships that are active but past their billing date by > 7 days
  const { rows: pastDue } = await adminPool.query(
    `SELECT id, business_id, customer_id, next_billing_date
     FROM memberships
     WHERE status = 'active' AND auto_renew = true
       AND next_billing_date < CURRENT_DATE - INTERVAL '7 days'`,
  );

  let expired = 0;
  for (const m of pastDue) {
    // Max retries exhausted — expire
    await adminPool.query(
      "UPDATE memberships SET status = 'expired', updated_at = NOW() WHERE id = $1",
      [m.id],
    );
    await adminPool.query(
      `INSERT INTO membership_status_history (membership_id, from_status, to_status, reason)
       VALUES ($1, 'active', 'expired', 'Payment failed after dunning retries')`,
      [m.id],
    );
    expired++;
  }

  if (expired > 0) logger.info('Dunning: memberships expired', { count: expired });
  return { retried: 0, expired };
}

/**
 * Calculate proration for mid-cycle upgrade.
 */
export function calculateProration(
  currentPrice: number,
  newPrice: number,
  daysRemaining: number,
  totalDaysInCycle: number,
): number {
  if (daysRemaining <= 0 || totalDaysInCycle <= 0) return 0;
  const priceDifference = newPrice - currentPrice;
  if (priceDifference <= 0) return 0; // downgrade = no charge
  return Math.round(priceDifference * (daysRemaining / totalDaysInCycle));
}

/**
 * Get the total days in a billing cycle.
 */
export function getCycleDays(billingCycle: string): number {
  switch (billingCycle) {
    case 'monthly': return 30;
    case 'quarterly': return 90;
    case 'annually': return 365;
    default: return 30;
  }
}

/**
 * Calculate remaining days in current billing cycle.
 */
export function getRemainingDays(nextBillingDate: string, billingCycle: string): number {
  const next = new Date(nextBillingDate);
  const now = new Date();
  const diff = Math.ceil((next.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, diff);
}

// --- Internal helpers ---

/**
 * Initiate a payment charge.
 * Stub for Phase 10 — returns true for now (simulating successful payment).
 */
async function initiatePayment(businessId: string, customerId: string, amount: number, description: string): Promise<boolean> {
  // Phase 10 will implement actual Stripe/payment processor integration
  // DayStream initiates the charge — the processor is a passive endpoint
  logger.info('Payment initiated (stub)', { businessId, customerId, amount, description });
  return true;
}

/**
 * Enter dunning flow after a failed payment.
 */
async function enterDunning(membershipId: string, businessId: string): Promise<void> {
  // Queue a notification about failed payment
  await adminPool.query(
    `INSERT INTO notification_queue (business_id, type, channel, recipient_id, data, scheduled_for)
     SELECT $1, 'membership.payment_failed', 'email', m.customer_id,
       json_build_object('membership_id', m.id, 'plan_name', mp.name)::jsonb,
       NOW()
     FROM memberships m
     JOIN membership_plans mp ON mp.id = m.plan_id
     WHERE m.id = $2`,
    [businessId, membershipId],
  );

  logger.warn('Membership entered dunning', { membershipId, businessId });
}

function calculateNextBillingDate(fromDate: Date, billingCycle: string): Date {
  const date = new Date(fromDate);
  switch (billingCycle) {
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
    case 'quarterly': date.setMonth(date.getMonth() + 3); break;
    case 'annually': date.setFullYear(date.getFullYear() + 1); break;
  }
  return date;
}
