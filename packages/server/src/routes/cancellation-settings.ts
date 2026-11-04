import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { getCancelSettings, setCancelSettings, CancelKind } from '../services/customer-cancellation.service';

/**
 * Customer cancellation settings (THE-20), separate for events and for appointments.
 * Anyone of the business may read them (customers see the limits that apply to them);
 * only those who manage the business settings may change them.
 */
export const cancellationSettingsRouter = Router();
cancellationSettingsRouter.use(authenticate);
cancellationSettingsRouter.use(tenantContext);

const KINDS: CancelKind[] = ['events', 'appointments'];

async function businessOfTenant(req: Request, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query('SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [businessId, (req as AuthenticatedRequest).tenantId]);
  return rows.length > 0;
}

// GET /v1/cancellation-settings?business_id= — both kinds
cancellationSettingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId || !/^[0-9a-f-]{36}$/i.test(businessId)) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!(await businessOfTenant(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const { rows: biz } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]);
    success(res, {
      events: await getCancelSettings(businessId, 'events'),
      appointments: await getCancelSettings(businessId, 'appointments'),
      timezone: biz[0]?.timezone || 'UTC',
    });
  } catch (err: any) { console.error('Failed to read cancellation settings', err?.message || err); error(res, 'Failed to read cancellation settings', 'INTERNAL_ERROR', 500); }
});

const putSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  kind: Joi.string().valid(...KINDS).required(),
  customer_cancel_enabled: Joi.boolean(),
  // Up to 90 days before the start, in hours.
  customer_cancel_hours: Joi.number().integer().min(0).max(2160),
  cancel_refund_to: Joi.string().valid('card', 'credit'),
  // Events: days to cancel for a full refund after a date, time or place change (decision 14).
  change_refund_days: Joi.number().integer().min(0).max(90),
});

// PUT /v1/cancellation-settings — one kind
cancellationSettingsRouter.put('/', requirePermission('settings:*'), validate(putSchema), async (req: Request, res: Response) => {
  try {
    const { business_id: businessId, kind, ...values } = req.body;
    if (!(await businessOfTenant(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, await setCancelSettings(businessId, kind, values));
  } catch (err: any) { console.error('Failed to save cancellation settings', err?.message || err); error(res, 'Failed to save cancellation settings', 'INTERNAL_ERROR', 500); }
});
