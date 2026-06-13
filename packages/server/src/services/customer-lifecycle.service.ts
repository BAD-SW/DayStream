import { adminPool } from '../db/pool';
import { createActivity } from './customer-activity.service';
import { logger } from '../middleware/logger';

// Valid lifecycle stages
export const LIFECYCLE_STAGES = ['lead', 'trial', 'active', 'at_risk', 'churned', 'winback'] as const;
export type LifecycleStage = typeof LIFECYCLE_STAGES[number];

// Default configuration values
const DEFAULT_CONFIG = {
  'lifecycle.trial_after_bookings': 1,
  'lifecycle.active_after_visits': 3,
  'lifecycle.at_risk_days': 30,
  'lifecycle.churned_days': 90,
};

/**
 * Get lifecycle configuration for a business.
 * Checks business_configurations first, then falls back to configuration_definitions defaults.
 */
export async function getLifecycleConfig(businessId: string): Promise<Record<string, number>> {
  const keys = Object.keys(DEFAULT_CONFIG);

  const { rows } = await adminPool.query(
    `SELECT cd.key, COALESCE(bc.value, cd.default_value) AS value
     FROM configuration_definitions cd
     LEFT JOIN business_configurations bc ON bc.key = cd.key AND bc.business_id = $1
     WHERE cd.key = ANY($2)`,
    [businessId, keys],
  );

  const config: Record<string, number> = { ...DEFAULT_CONFIG };
  for (const row of rows) {
    config[row.key] = parseInt(row.value, 10);
  }
  return config;
}

/**
 * Transition a customer's lifecycle stage.
 * Validates the transition, updates the customer record, and logs the activity.
 */
export async function transitionLifecycle(
  customerId: string,
  businessId: string,
  newStage: LifecycleStage,
  reason: string,
  triggeredBy?: string,
): Promise<{ success: boolean; from?: string; to?: string; error?: string }> {
  // Get current stage
  const { rows } = await adminPool.query(
    'SELECT lifecycle_stage, status FROM customers WHERE id = $1 AND business_id = $2',
    [customerId, businessId],
  );

  if (rows.length === 0) {
    return { success: false, error: 'Customer not found' };
  }

  const customer = rows[0];

  if (customer.status === 'anonymized') {
    return { success: false, error: 'Cannot transition anonymized customer' };
  }

  const fromStage = customer.lifecycle_stage as LifecycleStage;

  if (fromStage === newStage) {
    return { success: true, from: fromStage, to: newStage };
  }

  // Update lifecycle stage
  await adminPool.query(
    'UPDATE customers SET lifecycle_stage = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3',
    [newStage, customerId, businessId],
  );

  // Log in activity timeline
  await createActivity({
    customerId,
    businessId,
    activityType: 'lifecycle',
    description: `Stage: ${formatStage(fromStage)} → ${formatStage(newStage)}`,
    metadata: { from: fromStage, to: newStage, reason },
    createdBy: triggeredBy,
  });

  logger.info('Lifecycle transition', { customerId, businessId, from: fromStage, to: newStage, reason });

  return { success: true, from: fromStage, to: newStage };
}

/**
 * Manually override a customer's lifecycle stage (staff action).
 */
export async function manualOverride(
  customerId: string,
  businessId: string,
  newStage: LifecycleStage,
  userId: string,
): Promise<{ success: boolean; from?: string; to?: string; error?: string }> {
  if (!LIFECYCLE_STAGES.includes(newStage)) {
    return { success: false, error: `Invalid lifecycle stage: ${newStage}` };
  }

  return transitionLifecycle(customerId, businessId, newStage, 'Manual override by staff', userId);
}

/**
 * Get lifecycle stage counts for a business (pipeline view).
 */
export async function getLifecycleSummary(businessId: string): Promise<Record<string, number>> {
  const { rows } = await adminPool.query(
    `SELECT lifecycle_stage, COUNT(*)::int AS count
     FROM customers
     WHERE business_id = $1 AND status != 'anonymized'
     GROUP BY lifecycle_stage`,
    [businessId],
  );

  // Initialize all stages to 0
  const summary: Record<string, number> = {};
  for (const stage of LIFECYCLE_STAGES) {
    summary[stage] = 0;
  }

  // Fill with actual counts
  for (const row of rows) {
    summary[row.lifecycle_stage] = row.count;
  }

  return summary;
}

/**
 * Evaluate lifecycle transitions triggered by booking/attendance events.
 * Called when a booking is created or attended.
 */
export async function evaluateOnBooking(customerId: string, businessId: string): Promise<void> {
  const config = await getLifecycleConfig(businessId);

  const { rows } = await adminPool.query(
    'SELECT lifecycle_stage FROM customers WHERE id = $1 AND business_id = $2',
    [customerId, businessId],
  );

  if (rows.length === 0) return;

  const currentStage = rows[0].lifecycle_stage as LifecycleStage;

  // Churned → Winback: any activity after being churned
  if (currentStage === 'churned') {
    await transitionLifecycle(customerId, businessId, 'winback', 'Returned after churn (booking)');
    return;
  }

  // Lead → Trial: first booking made
  if (currentStage === 'lead') {
    const { rows: bookingCount } = await adminPool.query(
      `SELECT COUNT(*)::int AS count FROM customer_activities
       WHERE customer_id = $1 AND business_id = $2 AND activity_type = 'booking'`,
      [customerId, businessId],
    );

    if (bookingCount[0].count >= config['lifecycle.trial_after_bookings']) {
      await transitionLifecycle(customerId, businessId, 'trial', `Reached ${config['lifecycle.trial_after_bookings']} booking(s)`);
    }
    return;
  }

  // Trial → Active: 3+ visits (attendance)
  if (currentStage === 'trial') {
    const { rows: visitCount } = await adminPool.query(
      `SELECT COUNT(*)::int AS count FROM customer_activities
       WHERE customer_id = $1 AND business_id = $2 AND activity_type = 'booking'
       AND (metadata->>'status' = 'attended' OR metadata->>'attended' = 'true')`,
      [customerId, businessId],
    );

    if (visitCount[0].count >= config['lifecycle.active_after_visits']) {
      await transitionLifecycle(customerId, businessId, 'active', `Reached ${config['lifecycle.active_after_visits']} attended visits`);
    }
    return;
  }

  // At-Risk → Active: new booking while at risk
  if (currentStage === 'at_risk') {
    await transitionLifecycle(customerId, businessId, 'active', 'New booking while at-risk');
    return;
  }

  // Winback → Active: continued activity
  if (currentStage === 'winback') {
    const { rows: recentVisits } = await adminPool.query(
      `SELECT COUNT(*)::int AS count FROM customer_activities
       WHERE customer_id = $1 AND business_id = $2 AND activity_type = 'booking'
       AND created_at > (SELECT updated_at FROM customers WHERE id = $1)`,
      [customerId, businessId],
    );

    if (recentVisits[0].count >= config['lifecycle.active_after_visits']) {
      await transitionLifecycle(customerId, businessId, 'active', 'Enough visits after winback');
    }
    return;
  }
}

/**
 * Evaluate lifecycle transitions triggered by membership purchase.
 */
export async function evaluateOnMembership(customerId: string, businessId: string): Promise<void> {
  const { rows } = await adminPool.query(
    'SELECT lifecycle_stage FROM customers WHERE id = $1 AND business_id = $2',
    [customerId, businessId],
  );

  if (rows.length === 0) return;

  const currentStage = rows[0].lifecycle_stage as LifecycleStage;

  // Trial → Active: membership purchased
  if (currentStage === 'trial' || currentStage === 'lead') {
    await transitionLifecycle(customerId, businessId, 'active', 'Membership purchased');
    return;
  }

  // Churned → Winback
  if (currentStage === 'churned') {
    await transitionLifecycle(customerId, businessId, 'winback', 'Membership purchased after churn');
    return;
  }

  // At-Risk → Active
  if (currentStage === 'at_risk') {
    await transitionLifecycle(customerId, businessId, 'active', 'Membership purchased while at-risk');
    return;
  }
}

/**
 * Scheduled job: Evaluate At-Risk and Churned transitions for all businesses.
 * Checks last activity date against configured thresholds.
 * Should be called periodically (e.g., daily).
 */
export async function evaluateScheduledTransitions(): Promise<{ processed: number; transitioned: number }> {
  let processed = 0;
  let transitioned = 0;

  // Get all active businesses
  const { rows: businesses } = await adminPool.query(
    "SELECT id FROM businesses WHERE status = 'active'",
  );

  for (const business of businesses) {
    const businessId = business.id;
    const config = await getLifecycleConfig(businessId);

    const atRiskDays = config['lifecycle.at_risk_days'];
    const churnedDays = config['lifecycle.churned_days'];

    // Active → At-Risk: no activity in atRiskDays
    const { rows: atRiskCandidates } = await adminPool.query(
      `SELECT c.id FROM customers c
       WHERE c.business_id = $1
         AND c.lifecycle_stage = 'active'
         AND c.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM customer_activities ca
           WHERE ca.customer_id = c.id
             AND ca.business_id = $1
             AND ca.activity_type IN ('booking', 'payment', 'membership')
             AND ca.created_at > NOW() - INTERVAL '1 day' * $2
         )`,
      [businessId, atRiskDays],
    );

    for (const candidate of atRiskCandidates) {
      await transitionLifecycle(candidate.id, businessId, 'at_risk', `No activity in ${atRiskDays} days`);
      transitioned++;
    }
    processed += atRiskCandidates.length;

    // At-Risk → Churned: no activity in churnedDays
    const { rows: churnedCandidates } = await adminPool.query(
      `SELECT c.id FROM customers c
       WHERE c.business_id = $1
         AND c.lifecycle_stage = 'at_risk'
         AND c.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM customer_activities ca
           WHERE ca.customer_id = c.id
             AND ca.business_id = $1
             AND ca.activity_type IN ('booking', 'payment', 'membership')
             AND ca.created_at > NOW() - INTERVAL '1 day' * $2
         )`,
      [businessId, churnedDays],
    );

    for (const candidate of churnedCandidates) {
      await transitionLifecycle(candidate.id, businessId, 'churned', `No activity in ${churnedDays} days`);
      transitioned++;
    }
    processed += churnedCandidates.length;
  }

  logger.info('Scheduled lifecycle evaluation complete', { processed, transitioned });
  return { processed, transitioned };
}

/**
 * Format a lifecycle stage for display.
 */
function formatStage(stage: string): string {
  return stage.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}
