import { evaluateScheduledTransitions } from '../services/customer-lifecycle.service';
import { recognizeRevenueForYesterday } from '../services/revenue-recognition.service';
import { logger } from '../middleware/logger';

/**
 * Job execution context passed to each handler.
 */
export interface JobContext {
  /** The scope this job runs at: platform (DayStream-wide), tenant, or business. */
  scopeLevel: 'platform' | 'tenant' | 'business';
  /** Null for platform-scoped jobs. */
  businessId: string | null;
  /** Null for platform-scoped jobs. */
  tenantId: string | null;
  /** The sys_job_executions row id for this run (for per-attempt audit linkage). */
  executionId?: string | null;
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

  // Billing processor (Section C) — membership renewal charges + lifecycle.
  // Business-scoped: one schedule per business. Auto-resumes paused memberships
  // whose pause window elapsed, then charges enrollments due today against their
  // stored method (advancing the period / rolling usage on success, opening a
  // dunning attempt on failure).
  'billing_process': async (ctx) => {
    const businessId = ctx.businessId!;   // business-scoped job: businessId is always present
    const { autoResumeExpiredPauses } = await import('../services/membership.service');
    const { runMembershipRenewals } = await import('../services/membership-renewal.service');
    const { processDunning } = await import('../services/dunning.service');

    // Resume first so a just-resumed enrollment with a due date is picked up.
    const resumed = await autoResumeExpiredPauses(businessId);
    // Renewals (skips enrollments already in a dunning cycle), then process the
    // dunning retries that are due today.
    const renewals = await runMembershipRenewals(businessId, new Date(), ctx.executionId ?? null);
    const dunning = await processDunning(businessId, new Date(), ctx.executionId ?? null);

    logger.info(`Recurring charges (business ${businessId}): ${resumed} auto-resumed, renewals ${JSON.stringify(renewals)}, dunning ${JSON.stringify(dunning)}`);
    return { status: 'processed', auto_resumed: resumed, renewals, dunning };
  },

  // Payment reconciliation (Section C) — re-checks PENDING processed charges
  // (bank draws that settle asynchronously) against the provider and finalizes
  // them to completed/failed. This is the reliable settlement path: because each
  // business charges on its own Stripe account, the platform webhook can't verify
  // or route a business charge's event, so we poll frequently.
  //
  // Normally runs PLATFORM-scoped (one job every ~15 min sweeping every business
  // with pending charges) so nothing needs per-business provisioning. If invoked
  // with a businessId (manual/scoped trigger), it reconciles just that business.
  'payment_reconciliation': async (ctx) => {
    const recon = await import('../services/payment-reconciliation.service');
    if (ctx.businessId) {
      const summary = await recon.reconcileBusinessPayments(ctx.businessId);
      return { status: 'reconciled', scope: 'business', ...summary };
    }
    const summary = await recon.reconcileAllPendingPayments();
    return { status: 'reconciled', scope: 'platform', ...summary };
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
    const result = await recognizeRevenueForYesterday(ctx.businessId!);
    return result;
  },

  // Platform billing (Section A) — DayStream charges tenants. Platform-scoped:
  // one schedule for the whole platform, processes all tenants due today + any
  // with outstanding failed charges.
  'platform_billing': async (ctx) => {
    const { runPlatformBilling } = await import('../services/platform-billing.service');
    const summary = await runPlatformBilling(new Date(), ctx.executionId ?? null);
    logger.info(`Platform billing run: ${JSON.stringify(summary)}`);
    return summary;
  },

  // Tenant billing (Section B) — a tenant charges its businesses. Tenant-scoped:
  // one schedule per tenant, processes that tenant's businesses due today + any
  // with outstanding failed charges.
  'tenant_billing': async (ctx) => {
    if (!ctx.tenantId) throw new Error('tenant_billing job requires a tenant scope');
    const { runTenantBilling } = await import('../services/tenant-billing.service');
    const summary = await runTenantBilling(ctx.tenantId, new Date(), ctx.executionId ?? null);
    logger.info(`Tenant billing run (tenant ${ctx.tenantId}): ${JSON.stringify(summary)}`);
    return summary;
  },
};

/**
 * Get list of available job types for the UI.
 */
export function getAvailableJobTypes(): Array<{ type: string; label: string; description: string; defaultFrequency: string }> {
  return [
    { type: 'revenue_recognition', label: 'Revenue Recognition', description: 'Recognize deferred membership revenue daily', defaultFrequency: 'daily' },
    { type: 'billing_process', label: 'Recurring Charges', description: 'Charge membership renewals due today and auto-resume expired pauses', defaultFrequency: 'daily' },
    { type: 'payment_reconciliation', label: 'Payment Reconciliation', description: 'Finalize pending bank-draw payments once they settle at the provider', defaultFrequency: 'every_15min' },
    { type: 'campaign_dispatch', label: 'Campaigns', description: 'Send scheduled marketing campaigns', defaultFrequency: 'every_15min' },
    { type: 'lifecycle_evaluation', label: 'Customer Lifecycle', description: 'Automatically transition inactive customers through lifecycle stages', defaultFrequency: 'daily' },
    { type: 'report_aggregation', label: 'Reporting', description: 'Aggregate daily metrics for reporting dashboards', defaultFrequency: 'daily' },
  ];
}
