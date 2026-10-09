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
import { getAdapter } from '../services/payments';
import * as processorConfig from '../services/processor-config.service';
import type { ConfigOwner } from '../services/processor-config.service';
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
const webhookSchema = Joi.object({}).unknown(true);
paymentPlatformRouter.post('/webhooks/:provider', async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as PaymentProviderName;
    const signature = (req.headers['x-webhook-signature'] as string) || (req.headers['stripe-signature'] as string) || '';
    let adapter;
    try { adapter = getAdapter(provider); }
    catch { error(res, 'Unknown provider', 'VALIDATION_ERROR', 400); return; }

    // NOTE(stripe): the global express.json() parser consumes the raw body, so we
    // re-serialize here for the mock's HMAC check. The real Stripe adapter requires
    // the untouched raw body — mount express.raw() on this path when wiring Stripe.
    const rawBody = JSON.stringify(req.body ?? {});
    let event;
    try { event = adapter.parseWebhook(rawBody, signature); }
    catch { error(res, 'Invalid webhook signature', 'INVALID_SIGNATURE', 400); return; }

    // Phase 1 just acknowledges + normalizes; downstream handlers consume events in later phases.
    success(res, { received: true, type: event.type, reference: event.providerReference ?? null });
  } catch (err: any) { error(res, 'Webhook processing failed', 'INTERNAL_ERROR', 500); }
});

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
  return {
    ownerLevel,
    tenantId: (req.body?.tenant_id || req.query.tenant_id) ?? null,
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
  tenant_id: Joi.string().uuid().allow(null),
  business_id: Joi.string().uuid().allow(null),
  customer_id: Joi.string().uuid().allow(null),
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
  tenant_id: Joi.string().uuid().allow(null),
  business_id: Joi.string().uuid().allow(null),
  customer_id: Joi.string().uuid().allow(null),
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
