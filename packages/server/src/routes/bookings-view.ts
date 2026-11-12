import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { BOOKINGS_VIEWS, resolveView, setBusinessView } from '../services/bookings-view.service';

/**
 * Which screen Bookings opens on for staff (spec 51, gap 3). Anyone of the business may read what
 * applies to them; only those who manage the business settings may change the business default.
 * A staff member's own choice is saved with their staff profile (PUT /v1/staff/:id).
 */
export const bookingsViewRouter = Router();
bookingsViewRouter.use(authenticate);
bookingsViewRouter.use(tenantContext);

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function businessOfTenant(req: Request, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query('SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [businessId, (req as AuthenticatedRequest).tenantId]);
  return rows.length > 0;
}

// GET /v1/bookings-view?business_id= — { business, mine, view }
bookingsViewRouter.get('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId || !UUID_RE.test(businessId)) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!(await businessOfTenant(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, await resolveView(businessId, authReq.user.sub, authReq.tenantId));
  } catch (err) {
    console.error('Failed to read the Bookings view', (err as Error).message);
    error(res, 'Failed to read the Bookings view', 'INTERNAL_ERROR', 500);
  }
});

const putSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  view: Joi.string().valid(...BOOKINGS_VIEWS).required(),
});

// PUT /v1/bookings-view — the business default
bookingsViewRouter.put('/', requirePermission('settings:*'), validate(putSchema), async (req: Request, res: Response) => {
  try {
    const { business_id: businessId, view } = req.body;
    if (!(await businessOfTenant(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, { business: await setBusinessView(businessId, view) });
  } catch (err) {
    console.error('Failed to save the Bookings view', (err as Error).message);
    error(res, 'Failed to save the Bookings view', 'INTERNAL_ERROR', 500);
  }
});
