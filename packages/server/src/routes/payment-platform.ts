import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as methods from '../services/payment-methods.service';
import type { MethodOwner, OwnerLevel } from '../services/payment-methods.service';
import { getMethodCatalog, resolveAvailableMethods } from '../services/payment-catalog.service';
import { getConfiguredAdapter } from '../services/payments';
import * as processorConfig from '../services/processor-config.service';
import type { ConfigOwner } from '../services/processor-config.service';
import * as platformBilling from '../services/platform-billing.service';
import * as tenantBilling from '../services/tenant-billing.service';
import { queryResourceAudit } from '../services/audit.service';
import type { MethodType, PaymentProviderName } from '../services/payments';

/**
 * Payment Platform foundation routes (spec phase 10, task 1.5):
 *   - processor connections (platform/tenant/business)
 *   - tokenized payment methods (shared capture mechanism)
 *   - method catalog + Section C availability
 *   - provider webhook ingestion
 *
 * Mounted at /api/v1/pay.
 */
export const paymentPlatformRouter = Router();

const METHOD_TYPES = ['card', 'bank_draw', 'google_pay', 'apple_pay'];

// Webhook ingestion is public (verified by provider signature) — register BEFORE auth.
paymentPlatformRouter.post('/webhooks/:provider', async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as PaymentProviderName;
    const signature = (req.headers['x-webhook-signature'] as string) || (req.headers['stripe-signature'] as string) || '';

    // The app mounts express.raw() on this path, so req.body is the untouched
    // Buffer Stripe's signature verification needs. (Falls back to a re-serialized
    // string for the mock, whose HMAC check doesn't require byte-exact input.)
    const rawBody: string | Buffer = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? {});

    // Build the adapter from the PLATFORM connection's secrets so the real Stripe
    // webhook secret is available (constructEvent needs it); falls back to mock.
    const platformSecrets = await processorConfig.getDecryptedSecrets({ ownerLevel: 'platform' }).catch(() => ({}));
    const adapter = getConfiguredAdapter(provider, platformSecrets);

    let event;
    try { event = adapter.parseWebhook(rawBody, signature); }
    catch { error(res, 'Invalid webhook signature', 'INVALID_SIGNATURE', 400); return; }

    // Reconcile platform billing charges by provider reference (Section A async
    // settlement): a charge that was 'pending' flips to settled/failed when Stripe
    // reports the final outcome days later. Safe no-op if the ref isn't ours.
    if (event.providerReference && (event.type === 'charge.succeeded' || event.type === 'charge.failed')) {
      await reconcilePlatformCharge(event.providerReference, event.type);
    }

    success(res, { received: true, type: event.type, reference: event.providerReference ?? null });
  } catch (err: any) { error(res, 'Webhook processing failed', 'INTERNAL_ERROR', 500); }
});

/** Flip a pending platform billing charge to settled/failed when Stripe reports it. */
async function reconcilePlatformCharge(providerReference: string, type: 'charge.succeeded' | 'charge.failed'): Promise<void> {
  const status = type === 'charge.succeeded' ? 'settled' : 'failed';
  await adminPool.query(
    `UPDATE pay_platform_billing_charges
     SET status = $1::varchar,
         settled_at = CASE WHEN $1::varchar = 'settled' THEN NOW() ELSE settled_at END,
         updated_at = NOW()
     WHERE provider_reference = $2 AND status IN ('pending', 'retrying', 'failed')`,
    [status, providerReference],
  );
}

// Everything below requires authentication + tenant context.
paymentPlatformRouter.use(authenticate);
paymentPlatformRouter.use(tenantContext);

// ============================================================
// Method catalog (reference) + Section C availability
// ============================================================

paymentPlatformRouter.get('/catalog', async (_req: Request, res: Response) => {
  success(res, getMethodCatalog());
});

paymentPlatformRouter.get('/available-methods', async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const recurring = req.query.recurring === 'true';
    const available = await resolveAvailableMethods(businessId, { recurring });
    success(res, available);
  } catch (err: any) { error(res, 'Failed to resolve available methods', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Processor connections (platform / tenant / business)
// ============================================================

const connectSchema = Joi.object({
  owner_level: Joi.string().valid('platform', 'tenant', 'business').required(),
  tenant_id: Joi.string().uuid().allow(null),
  business_id: Joi.string().uuid().allow(null),
  provider: Joi.string().valid('stripe', 'mock').default('stripe'),
  provider_account_ref: Joi.string().allow('', null),
});

paymentPlatformRouter.get('/processors', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `SELECT id, owner_level, tenant_id, business_id, provider, provider_account_ref, status, created_at
       FROM pay_processor_connections ORDER BY owner_level, created_at`,
    );
    success(res, rows);
  } catch (err: any) { error(res, 'Failed to list processor connections', 'INTERNAL_ERROR', 500); }
});

paymentPlatformRouter.post('/processors/connect', requirePermission('settings:*'), validate(connectSchema), async (req: Request, res: Response) => {
  try {
    const { owner_level, tenant_id, business_id, provider, provider_account_ref } = req.body;
    const { rows } = await adminPool.query(
      `INSERT INTO pay_processor_connections (tenant_id, business_id, owner_level, provider, provider_account_ref)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (owner_level, COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid), COALESCE(business_id,'00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET provider = $4, provider_account_ref = $5, status = 'active', updated_at = NOW()
       RETURNING id, owner_level, tenant_id, business_id, provider, provider_account_ref, status`,
      [tenant_id ?? null, business_id ?? null, owner_level, provider, provider_account_ref ?? null],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { error(res, 'Failed to connect processor', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Provider config schemas + per-connection configuration
// ============================================================

// Available providers and their config field schemas (no secret values).
paymentPlatformRouter.get('/providers', async (_req: Request, res: Response) => {
  success(res, processorConfig.getProviderSchemas());
});

function configOwnerFromReq(req: Request): ConfigOwner | null {
  const ownerLevel = (req.body?.owner_level || req.query.owner_level) as ConfigOwner['ownerLevel'];
  if (!ownerLevel || !['platform', 'tenant', 'business'].includes(ownerLevel)) return null;
  // A tenant-level connection MUST be pinned to a tenant id. The tenant self-service
  // UI sends only owner_level, so fall back to the authenticated tenant from the JWT
  // (never trust a client-supplied tenant_id over the caller's own context). A
  // system admin acting on a specific tenant may still pass an explicit tenant_id.
  const authTenantId = (req as AuthenticatedRequest).tenantId ?? null;
  const tenantId = (req.body?.tenant_id || req.query.tenant_id || (ownerLevel === 'tenant' ? authTenantId : null)) ?? null;
  return {
    ownerLevel,
    tenantId,
    businessId: (req.body?.business_id || req.query.business_id) ?? null,
  };
}

// Read a connection's provider config (non-secret values + masked secrets).
paymentPlatformRouter.get('/processors/config', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const owner = configOwnerFromReq(req);
    if (!owner) { error(res, 'owner_level required (platform|tenant|business)', 'VALIDATION_ERROR', 400); return; }
    const view = await processorConfig.getProcessorConfig(owner);
    success(res, view); // null when nothing configured yet
  } catch (err: any) { error(res, 'Failed to read processor config', 'INTERNAL_ERROR', 500); }
});

const saveConfigSchema = Joi.object({
  owner_level: Joi.string().valid('platform', 'tenant', 'business').required(),
  tenant_id: Joi.string().uuid().allow(null),
  business_id: Joi.string().uuid().allow(null),
  provider: Joi.string().required(),
  config: Joi.object().pattern(Joi.string(), Joi.string().allow('')).default({}),
});

// Test a connection with the typed (unsaved) values — no state change.
paymentPlatformRouter.post('/processors/test', requirePermission('settings:*'), validate(saveConfigSchema), async (req: Request, res: Response) => {
  try {
    const owner = configOwnerFromReq(req)!;
    const result = await processorConfig.testProcessorConnection(owner, req.body.provider, req.body.config || {});
    success(res, result);
  } catch (err: any) {
    error(res, 'Failed to test connection', 'INTERNAL_ERROR', 500);
  }
});

// Prepare an end-to-end probe: validates the secret key server-side and (for
// Stripe) returns a throwaway SetupIntent client_secret + publishable key so the
// browser can confirm it, proving BOTH keys work for real card capture. No state change.
paymentPlatformRouter.post('/processors/test-probe', requirePermission('settings:*'), validate(saveConfigSchema), async (req: Request, res: Response) => {
  try {
    const owner = configOwnerFromReq(req)!;
    const result = await processorConfig.prepareConnectionProbe(owner, req.body.provider, req.body.config || {});
    success(res, result);
  } catch (err: any) {
    error(res, 'Failed to prepare connection probe', 'INTERNAL_ERROR', 500);
  }
});

// Save a connection's provider config (validates required, encrypts secrets).
paymentPlatformRouter.put('/processors/config', requirePermission('settings:*'), validate(saveConfigSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owner = configOwnerFromReq(req)!;
    const view = await processorConfig.saveProcessorConfig(owner, req.body.provider, req.body.config || {}, authReq.user.sub);
    success(res, view);
  } catch (e: any) {
    if (e.code === 'VALIDATION_ERROR') { error(res, e.message, 'VALIDATION_ERROR', 400, e.missing); return; }
    if (e.code === 'UNKNOWN_PROVIDER') { error(res, e.message, 'VALIDATION_ERROR', 400); return; }
    error(res, 'Failed to save processor config', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Section A — Platform Billing (DayStream → Tenant). System-admin only.
// ============================================================

// A tenant's current billing plan (null if none configured).
paymentPlatformRouter.get('/platform-billing/:tenantId/plan', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const plan = await platformBilling.getTenantPlan(req.params.tenantId);
    success(res, plan);
  } catch (err: any) { error(res, 'Failed to read tenant plan', 'INTERNAL_ERROR', 500); }
});

const planSchema = Joi.object({
  flatAmountCents: Joi.number().integer().min(0).required(),
  percentageRate: Joi.number().min(0).max(100).required(),
  capAmountCents: Joi.number().integer().min(0).allow(null),
  capAppliesTo: Joi.string().valid('percentage', 'combined').default('combined'),
  introPeriodMonths: Joi.number().integer().min(0).default(0),
  introFlatAmountCents: Joi.number().integer().min(0).default(0),
  introPercentageRate: Joi.number().min(0).max(100).default(0),
  billingDay: Joi.number().integer().min(1).max(31).required(),
  planStartDate: Joi.string().isoDate().optional(),
});

// Save a new plan version for a tenant.
paymentPlatformRouter.put('/platform-billing/:tenantId/plan', requirePermission('*:*'), validate(planSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const plan = await platformBilling.saveTenantPlan(req.params.tenantId, req.body, authReq.user.sub);
    success(res, plan);
  } catch (err: any) { error(res, 'Failed to save tenant plan', 'INTERNAL_ERROR', 500); }
});

// A tenant's plan version history (all versions, newest first).
paymentPlatformRouter.get('/platform-billing/:tenantId/plan-history', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    success(res, await platformBilling.listTenantPlanVersions(req.params.tenantId));
  } catch (err: any) { error(res, 'Failed to read plan history', 'INTERNAL_ERROR', 500); }
});

// A tenant's audit trail — all changes made to this tenant (paged, with who/when).
paymentPlatformRouter.get('/platform-billing/:tenantId/audit', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
    success(res, await queryResourceAudit('tenant', req.params.tenantId, { page, limit }));
  } catch (err: any) { error(res, 'Failed to read tenant audit', 'INTERNAL_ERROR', 500); }
});

// A tenant's charge history + current credit balance.
paymentPlatformRouter.get('/platform-billing/:tenantId/charges', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const [charges, creditBalance] = await Promise.all([
      platformBilling.listTenantCharges(req.params.tenantId),
      platformBilling.getTenantCreditBalance(req.params.tenantId),
    ]);
    success(res, { charges, creditBalance });
  } catch (err: any) { error(res, 'Failed to read tenant charges', 'INTERNAL_ERROR', 500); }
});

// A tenant's credits.
paymentPlatformRouter.get('/platform-billing/:tenantId/credits', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    success(res, await platformBilling.listTenantCredits(req.params.tenantId));
  } catch (err: any) { error(res, 'Failed to read tenant credits', 'INTERNAL_ERROR', 500); }
});

const creditSchema = Joi.object({
  amountCents: Joi.number().integer().positive().required(),
  reason: Joi.string().trim().min(1).required(),
});

// Issue a credit to a tenant.
paymentPlatformRouter.post('/platform-billing/:tenantId/credits', requirePermission('*:*'), validate(creditSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const credit = await platformBilling.issueTenantCredit(req.params.tenantId, req.body.amountCents, req.body.reason, authReq.user.sub);
    success(res, credit, undefined, 201);
  } catch (err: any) { error(res, 'Failed to issue credit', 'INTERNAL_ERROR', 500); }
});

const chargeNowSchema = Joi.object({
  year: Joi.number().integer().min(2020).max(2100).required(),
  month: Joi.number().integer().min(1).max(12).required(),
  currency: Joi.string().length(3).optional(),
});

// Manually bill a tenant for a specific cycle (idempotent per tenant+cycle).
paymentPlatformRouter.post('/platform-billing/:tenantId/charge-now', requirePermission('*:*'), validate(chargeNowSchema), async (req: Request, res: Response) => {
  try {
    const { year, month, currency } = req.body;
    const result = await platformBilling.billTenantForCycle(req.params.tenantId, { year, month }, currency || 'USD');
    success(res, result);
  } catch (e: any) {
    if (e.code === 'NO_PLAN') { error(res, e.message, 'NO_PLAN', 409); return; }
    error(res, 'Failed to charge tenant', 'INTERNAL_ERROR', 500);
  }
});

// The single platform-wide billing run schedule (A6).
paymentPlatformRouter.get('/platform-billing-schedule', requirePermission('*:*'), async (_req: Request, res: Response) => {
  try {
    success(res, await platformBilling.getPlatformSchedule());
  } catch (err: any) { error(res, 'Failed to read schedule', 'INTERNAL_ERROR', 500); }
});

const scheduleSchema = Joi.object({
  scheduleTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  scheduleTimezone: Joi.string().min(1).required(),
  enabled: Joi.boolean().default(true),
});

paymentPlatformRouter.put('/platform-billing-schedule', requirePermission('*:*'), validate(scheduleSchema), async (req: Request, res: Response) => {
  try {
    const { scheduleTime, scheduleTimezone, enabled } = req.body;
    success(res, await platformBilling.savePlatformSchedule(scheduleTime, scheduleTimezone, enabled));
  } catch (err: any) { error(res, 'Failed to save schedule', 'INTERNAL_ERROR', 500); }
});

// Run the platform billing now (manual trigger).
paymentPlatformRouter.post('/platform-billing-run-now', requirePermission('*:*'), async (_req: Request, res: Response) => {
  try {
    success(res, await platformBilling.runPlatformBillingNow());
  } catch (err: any) { error(res, 'Failed to run platform billing', 'INTERNAL_ERROR', 500); }
});

// Platform billing job runs within a date range (default last 7 days).
paymentPlatformRouter.get('/platform-billing-runs', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 200, 500);
    success(res, await platformBilling.listPlatformBillingRuns({ from, to, limit }));
  } catch (err: any) { error(res, 'Failed to read billing runs', 'INTERNAL_ERROR', 500); }
});

// The charges attempted during a specific run (drill-down).
paymentPlatformRouter.get('/platform-billing-runs/:runId/charges', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    success(res, await platformBilling.getRunCharges(req.params.runId));
  } catch (err: any) { error(res, 'Failed to read run charges', 'INTERNAL_ERROR', 500); }
});

// Platform-wide charges across all tenants; ?status=failed for the failed-charge report.
paymentPlatformRouter.get('/platform-billing-charges', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
    success(res, await platformBilling.listAllPlatformCharges({ status, limit }));
  } catch (err: any) { error(res, 'Failed to read charges', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Section B — Tenant Billing (Tenant → Business). Tenant-admin only.
// Mirror of Section A one level down. The acting tenant comes from the JWT
// (tenantContext); businesses are verified to belong to that tenant.
// ============================================================

/**
 * Verify a business belongs to the acting tenant, returning its tenant_id and
 * currency. Throws 404 (via the caller) if not found/owned — a tenant admin can
 * only bill its own businesses.
 */
async function requireOwnedBusiness(businessId: string, tenantId: string): Promise<{ tenantId: string; currency: string } | null> {
  const { rows } = await adminPool.query(
    `SELECT currency FROM sys_businesses WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    [businessId, tenantId],
  );
  if (rows.length === 0) return null;
  return { tenantId, currency: rows[0].currency || 'USD' };
}

// A business's current billing plan (null if none configured).
paymentPlatformRouter.get('/tenant-billing/:businessId/plan', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owned = await requireOwnedBusiness(req.params.businessId, authReq.tenantId!);
    if (!owned) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, await tenantBilling.getBusinessPlan(req.params.businessId));
  } catch (err: any) { error(res, 'Failed to read business plan', 'INTERNAL_ERROR', 500); }
});

const businessPlanSchema = Joi.object({
  flatAmountCents: Joi.number().integer().min(0).required(),
  percentageRate: Joi.number().min(0).max(100).required(),
  capAmountCents: Joi.number().integer().min(0).allow(null),
  capAppliesTo: Joi.string().valid('percentage', 'combined').default('combined'),
  introPeriodMonths: Joi.number().integer().min(0).default(0),
  introFlatAmountCents: Joi.number().integer().min(0).default(0),
  introPercentageRate: Joi.number().min(0).max(100).default(0),
  billingDay: Joi.number().integer().min(1).max(31).required(),
  planStartDate: Joi.string().isoDate().optional(),
});

// Save a new plan version for a business.
paymentPlatformRouter.put('/tenant-billing/:businessId/plan', tenantContext, requirePermission('settings:*'), validate(businessPlanSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owned = await requireOwnedBusiness(req.params.businessId, authReq.tenantId!);
    if (!owned) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const plan = await tenantBilling.saveBusinessPlan(req.params.businessId, authReq.tenantId!, req.body, authReq.user.sub);
    success(res, plan);
  } catch (err: any) { error(res, 'Failed to save business plan', 'INTERNAL_ERROR', 500); }
});

// A business's plan version history (all versions, newest first).
paymentPlatformRouter.get('/tenant-billing/:businessId/plan-history', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owned = await requireOwnedBusiness(req.params.businessId, authReq.tenantId!);
    if (!owned) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, await tenantBilling.listBusinessPlanVersions(req.params.businessId));
  } catch (err: any) { error(res, 'Failed to read plan history', 'INTERNAL_ERROR', 500); }
});

// A business's audit trail — all changes made to this business (paged).
paymentPlatformRouter.get('/tenant-billing/:businessId/audit', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owned = await requireOwnedBusiness(req.params.businessId, authReq.tenantId!);
    if (!owned) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
    success(res, await queryResourceAudit('business', req.params.businessId, { page, limit }));
  } catch (err: any) { error(res, 'Failed to read business audit', 'INTERNAL_ERROR', 500); }
});

// A business's charge history + current credit balance.
paymentPlatformRouter.get('/tenant-billing/:businessId/charges', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owned = await requireOwnedBusiness(req.params.businessId, authReq.tenantId!);
    if (!owned) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const [charges, creditBalance] = await Promise.all([
      tenantBilling.listBusinessCharges(req.params.businessId),
      tenantBilling.getBusinessCreditBalance(req.params.businessId),
    ]);
    success(res, { charges, creditBalance });
  } catch (err: any) { error(res, 'Failed to read business charges', 'INTERNAL_ERROR', 500); }
});

// A business's credits.
paymentPlatformRouter.get('/tenant-billing/:businessId/credits', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owned = await requireOwnedBusiness(req.params.businessId, authReq.tenantId!);
    if (!owned) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, await tenantBilling.listBusinessCredits(req.params.businessId));
  } catch (err: any) { error(res, 'Failed to read business credits', 'INTERNAL_ERROR', 500); }
});

const businessCreditSchema = Joi.object({
  amountCents: Joi.number().integer().positive().required(),
  reason: Joi.string().trim().min(1).required(),
});

// Issue a credit to a business.
paymentPlatformRouter.post('/tenant-billing/:businessId/credits', tenantContext, requirePermission('settings:*'), validate(businessCreditSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owned = await requireOwnedBusiness(req.params.businessId, authReq.tenantId!);
    if (!owned) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const credit = await tenantBilling.issueBusinessCredit(req.params.businessId, authReq.tenantId!, req.body.amountCents, req.body.reason, authReq.user.sub);
    success(res, credit, undefined, 201);
  } catch (err: any) { error(res, 'Failed to issue credit', 'INTERNAL_ERROR', 500); }
});

const businessChargeNowSchema = Joi.object({
  year: Joi.number().integer().min(2020).max(2100).required(),
  month: Joi.number().integer().min(1).max(12).required(),
  currency: Joi.string().length(3).optional(),
});

// Manually bill a business for a specific cycle (idempotent per business+cycle).
paymentPlatformRouter.post('/tenant-billing/:businessId/charge-now', tenantContext, requirePermission('settings:*'), validate(businessChargeNowSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const owned = await requireOwnedBusiness(req.params.businessId, authReq.tenantId!);
    if (!owned) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const { year, month, currency } = req.body;
    const result = await tenantBilling.chargeBusinessNow(req.params.businessId, authReq.tenantId!, { year, month }, currency || owned.currency);
    success(res, result);
  } catch (e: any) {
    if (e.code === 'NO_PLAN') { error(res, e.message, 'NO_PLAN', 409); return; }
    error(res, 'Failed to charge business', 'INTERNAL_ERROR', 500);
  }
});

// This tenant's billing run schedule (B6).
paymentPlatformRouter.get('/tenant-billing-schedule', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await tenantBilling.getTenantSchedule(authReq.tenantId!));
  } catch (err: any) { error(res, 'Failed to read schedule', 'INTERNAL_ERROR', 500); }
});

const tenantScheduleSchema = Joi.object({
  scheduleTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  scheduleTimezone: Joi.string().min(1).required(),
  enabled: Joi.boolean().default(true),
});

paymentPlatformRouter.put('/tenant-billing-schedule', tenantContext, requirePermission('settings:*'), validate(tenantScheduleSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { scheduleTime, scheduleTimezone, enabled } = req.body;
    success(res, await tenantBilling.saveTenantSchedule(authReq.tenantId!, scheduleTime, scheduleTimezone, enabled));
  } catch (err: any) { error(res, 'Failed to save schedule', 'INTERNAL_ERROR', 500); }
});

// Run this tenant's billing now (manual trigger).
paymentPlatformRouter.post('/tenant-billing-run-now', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await tenantBilling.runTenantBillingNow(authReq.tenantId!));
  } catch (err: any) { error(res, 'Failed to run tenant billing', 'INTERNAL_ERROR', 500); }
});

// This tenant's billing job runs within a date range (default last 7 days).
paymentPlatformRouter.get('/tenant-billing-runs', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 200, 500);
    success(res, await tenantBilling.listTenantBillingRuns(authReq.tenantId!, { from, to, limit }));
  } catch (err: any) { error(res, 'Failed to read billing runs', 'INTERNAL_ERROR', 500); }
});

// The charges attempted during a specific run (drill-down).
paymentPlatformRouter.get('/tenant-billing-runs/:runId/charges', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    success(res, await tenantBilling.getRunCharges(req.params.runId));
  } catch (err: any) { error(res, 'Failed to read run charges', 'INTERNAL_ERROR', 500); }
});

// Tenant-wide charges across all this tenant's businesses; ?status=failed for the failed-charge report.
paymentPlatformRouter.get('/tenant-billing-charges', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
    success(res, await tenantBilling.listAllBusinessCharges(authReq.tenantId!, { status, limit }));
  } catch (err: any) { error(res, 'Failed to read charges', 'INTERNAL_ERROR', 500); }
});

// The tenant's own receiving/billing bank account (where its businesses' payments
// are deposited). The tenant-level mirror of the Platform Receiving Account.
paymentPlatformRouter.get('/tenant-billing-account', tenantContext, requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await tenantBilling.getTenantBillingAccount(authReq.tenantId!));
  } catch (err: any) { error(res, 'Failed to read billing account', 'INTERNAL_ERROR', 500); }
});

const tenantBillingAccountSchema = Joi.object({
  bank_name: Joi.string().allow('').max(255),
  account_holder: Joi.string().allow('').max(255),
  account_number: Joi.string().allow('').max(255),
  routing_number: Joi.string().allow('').max(255),
  iban: Joi.string().allow('').max(255),
  swift: Joi.string().allow('').max(255),
}).min(1);

paymentPlatformRouter.put('/tenant-billing-account', tenantContext, requirePermission('settings:*'), validate(tenantBillingAccountSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await tenantBilling.saveTenantBillingAccount(authReq.tenantId!, req.body, authReq.user.sub));
  } catch (err: any) { error(res, 'Failed to save billing account', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Payment methods (shared tokenized capture)
// ============================================================

// Build a MethodOwner from the request. Platform/tenant management requires
// elevated permission; customer methods are scoped to the acting customer context.
function ownerFromRequest(req: Request): MethodOwner {
  const authReq = req as AuthenticatedRequest;
  const ownerLevel = (req.body?.owner_level || req.query.owner_level) as OwnerLevel;
  return {
    ownerLevel,
    tenantId: (req.body?.tenant_id || req.query.tenant_id || authReq.tenantId) ?? null,
    businessId: (req.body?.business_id || req.query.business_id) ?? null,
    customerId: (req.body?.customer_id || req.query.customer_id) ?? null,
  };
}

paymentPlatformRouter.get('/methods', async (req: Request, res: Response) => {
  try {
    const owner = ownerFromRequest(req);
    if (!owner.ownerLevel) { error(res, 'owner_level required', 'VALIDATION_ERROR', 400); return; }
    const list = await methods.listPaymentMethods(owner);
    success(res, list);
  } catch (err: any) { error(res, 'Failed to list payment methods', 'INTERNAL_ERROR', 500); }
});

const captureSessionSchema = Joi.object({
  owner_level: Joi.string().valid('platform', 'tenant', 'business', 'customer').required(),
  // Empty string is tolerated and treated as "not supplied" — the server resolves
  // tenant_id from the JWT in ownerFromRequest. The client sometimes sends '' for an
  // id it doesn't carry rather than omitting the field.
  tenant_id: Joi.string().uuid().allow('', null),
  business_id: Joi.string().uuid().allow('', null),
  customer_id: Joi.string().uuid().allow('', null),
  method_type: Joi.string().valid(...METHOD_TYPES).required(),
});

paymentPlatformRouter.post('/methods/capture-session', validate(captureSessionSchema), async (req: Request, res: Response) => {
  try {
    const owner = ownerFromRequest(req);
    const session = await methods.beginCaptureSession(owner, req.body.method_type as MethodType);
    success(res, session, undefined, 201);
  } catch (e: any) {
    if (e.code === 'NO_CONNECTION') { error(res, e.message, 'NO_CONNECTION', 409); return; }
    if (e.code === 'SCHEME_UNSUPPORTED') { error(res, e.message, 'SCHEME_UNSUPPORTED', 422); return; }
    if (e.code === 'SCHEME_NOT_IMPLEMENTED') { error(res, e.message, 'SCHEME_NOT_IMPLEMENTED', 422); return; }
    error(res, 'Failed to begin capture session', 'INTERNAL_ERROR', 500);
  }
});

const storeMethodSchema = Joi.object({
  owner_level: Joi.string().valid('platform', 'tenant', 'business', 'customer').required(),
  tenant_id: Joi.string().uuid().allow('', null),
  business_id: Joi.string().uuid().allow('', null),
  customer_id: Joi.string().uuid().allow('', null),
  method_type: Joi.string().valid(...METHOD_TYPES).required(),
  capture_payload: Joi.object().unknown(true).default({}),
});

paymentPlatformRouter.post('/methods', validate(storeMethodSchema), async (req: Request, res: Response) => {
  try {
    const owner = ownerFromRequest(req);
    const stored = await methods.storePaymentMethod(owner, req.body.method_type as MethodType, req.body.capture_payload || {});
    success(res, stored, undefined, 201);
  } catch (e: any) {
    if (e.code === 'NO_CONNECTION') { error(res, e.message, 'NO_CONNECTION', 409); return; }
    error(res, 'Failed to store payment method', 'INTERNAL_ERROR', 500);
  }
});

paymentPlatformRouter.put('/methods/:id/default', async (req: Request, res: Response) => {
  try {
    const owner = ownerFromRequest(req);
    const ok = await methods.setDefaultPaymentMethod(req.params.id, owner);
    if (!ok) { error(res, 'Payment method not found', 'NOT_FOUND', 404); return; }
    success(res, { updated: true });
  } catch (err: any) { error(res, 'Failed to set default', 'INTERNAL_ERROR', 500); }
});

paymentPlatformRouter.delete('/methods/:id', async (req: Request, res: Response) => {
  try {
    const owner = ownerFromRequest(req);
    const ok = await methods.removePaymentMethod(req.params.id, owner);
    if (!ok) { error(res, 'Payment method not found', 'NOT_FOUND', 404); return; }
    success(res, { removed: true });
  } catch (err: any) { error(res, 'Failed to remove payment method', 'INTERNAL_ERROR', 500); }
});
