import { Router, Request, Response } from 'express';
import { authenticate } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import * as addonsService from '../services/addons.service';
import { msg } from '../i18n';

/**
 * Service add-ons (spec 51, gap 15). Add-ons are added on their service (/v1/services/:id/addons);
 * this lists the business's add-ons with their service, for a package's included items.
 */
export const addonsRouter = Router();

addonsRouter.use(authenticate);
addonsRouter.use(tenantContext);

// GET /api/v1/addons?business_id= — the business's add-ons, with their service
addonsRouter.get('/', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:addons.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    success(res, await addonsService.businessAddons(businessId));
  } catch (err: any) {
    console.error('Failed to list add-ons', err?.message || err);
    error(res, msg('errors:addons.failedToListAddOns'), 'INTERNAL_ERROR', 500);
  }
});
