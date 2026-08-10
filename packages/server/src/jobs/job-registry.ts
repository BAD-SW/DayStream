import { evaluateScheduledTransitions } from '../services/customer-lifecycle.service';
import { recognizeRevenueForYesterday } from '../services/revenue-recognition.service';
import { logger } from '../middleware/logger';

/**
 * Job execution context passed to each handler.
 */
export interface JobContext {
  businessId: string;
  tenantId: string;
  config: Record<string, any>;
}

/**
 * Job handler function signature.
 * Returns an optional result object for logging.
 */
export type JobHandler = (ctx: JobContext) => Promise<Record<string, any> | void>;

/**
 * Registry of all available job types and their handlers.
 * Add new job types here as they are implemented.
 */
export const jobRegistry: Record<string, JobHandler> = {
  // Customer lifecycle evaluation (per business)
  'lifecycle_evaluation': async (ctx) => {
    const { adminPool } = await import('../db/pool');

    // Check if lifecycle is enabled for this business
    const { rows } = await adminPool.query(
      `SELECT value FROM sys_business_configurations WHERE business_id = $1 AND key = 'lifecycle.enabled'`,
      [ctx.businessId],
    );
    const enabled = rows.length === 0 || rows[0].value !== 'false';
    if (!enabled) return { skipped: true, reason: 'disabled' };

    // Get config
    const { rows: configRows } = await adminPool.query(
      `SELECT key, value FROM sys_business_configurations WHERE business_id = $1 AND key LIKE 'lifecycle.%'`,
      [ctx.businessId],
    );
    const config: Record<string, number> = { 'lifecycle.at_risk_days': 30, 'lifecycle.churned_days': 60 };
    for (const row of configRows) {
      config[row.key] = parseInt(row.value, 10);
    }

    const atRiskDays = config['lifecycle.at_risk_days'];
    const churnedDays = config['lifecycle.churned_days'];
    let transitioned = 0;

    // Active → At-Risk (batch processing, 50 at a time)
    const { rows: atRiskCandidates } = await adminPool.query(
      `SELECT c.id FROM cus_customers c
       WHERE c.business_id = $1 AND c.lifecycle_stage = 'active' AND c.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM cus_activities ca
         WHERE ca.customer_id = c.id AND ca.business_id = $1
         AND ca.activity_type IN ('booking', 'payment', 'membership')
         AND ca.created_at > NOW() - INTERVAL '1 day' * $2
       ) LIMIT 50`,
      [ctx.businessId, atRiskDays],
    );

    for (const cust of atRiskCandidates) {
      await adminPool.query(
        `UPDATE cus_customers SET lifecycle_stage = 'at_risk', updated_at = NOW() WHERE id = $1`,
        [cust.id],
      );
      transitioned++;
    }

    // At-Risk → Churned (batch processing, 50 at a time)
    const { rows: churnedCandidates } = await adminPool.query(
      `SELECT c.id FROM cus_customers c
       WHERE c.business_id = $1 AND c.lifecycle_stage = 'at_risk' AND c.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM cus_activities ca
         WHERE ca.customer_id = c.id AND ca.business_id = $1
         AND ca.activity_type IN ('booking', 'payment', 'membership')
         AND ca.created_at > NOW() - INTERVAL '1 day' * $2
       ) LIMIT 50`,
      [ctx.businessId, churnedDays],
    );

    for (const cust of churnedCandidates) {
      await adminPool.query(
        `UPDATE cus_customers SET lifecycle_stage = 'churned', updated_at = NOW() WHERE id = $1`,
        [cust.id],
      );
      transitioned++;
    }

    return { processed: atRiskCandidates.length + churnedCandidates.length, transitioned };
  },

  // Billing processor (placeholder — will be implemented with Phase 10)
  'billing_process': async (ctx) => {
    logger.info(`Billing process triggered for business ${ctx.businessId} (not yet implemented)`);
    return { status: 'not_implemented' };
  },

  // Marketing campaign dispatch (checks for scheduled campaigns ready to send)
  'campaign_dispatch': async (ctx) => {
    logger.info(`Campaign dispatch triggered for business ${ctx.businessId}`);
    // Would check for campaigns with status='scheduled' and scheduled_at <= NOW()
    return { status: 'checked' };
  },

  // Report aggregation (daily rollup of metrics)
  'report_aggregation': async (ctx) => {
    logger.info(`Report aggregation triggered for business ${ctx.businessId}`);
    return { status: 'checked' };
  },

  // Revenue recognition — moves deferred revenue to membership revenue daily
  'revenue_recognition': async (ctx) => {
    const result = await recognizeRevenueForYesterday(ctx.businessId);
    return result;
  },
};

/**
 * Get list of available job types for the UI.
 */
export function getAvailableJobTypes(): Array<{ type: string; label: string; description: string; defaultFrequency: string }> {
  return [
    { type: 'revenue_recognition', label: 'Revenue Recognition', description: 'Recognize deferred membership revenue daily', defaultFrequency: 'daily' },
    { type: 'billing_process', label: 'Recurring Charges', description: 'Process scheduled payments for active memberships', defaultFrequency: 'daily' },
    { type: 'campaign_dispatch', label: 'Campaigns', description: 'Send scheduled marketing campaigns', defaultFrequency: 'every_15min' },
    { type: 'lifecycle_evaluation', label: 'Customer Lifecycle', description: 'Automatically transition inactive customers through lifecycle stages', defaultFrequency: 'daily' },
    { type: 'report_aggregation', label: 'Reporting', description: 'Aggregate daily metrics for reporting dashboards', defaultFrequency: 'daily' },
  ];
}
