import { Router, Request, Response } from 'express';
import { isTranslatableEntity } from '@daystream/shared';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { msg } from '../i18n';
import * as translations from '../services/offering-translations.service';
import { MachineTranslationError } from '../services/machine-translation.service';

/**
 * The translations of a business's offerings (Phase 44, requirement 9): services, products,
 * memberships, packages, service options and add-ons. Anyone who can manage them may translate them
 * (services:*); business_id is required, and the record must belong to the business.
 */
export const translationsRouter = Router();
translationsRouter.use(authenticate);
translationsRouter.use(tenantContext);

/** The business from ?business_id, when the caller may work on it (in their tenant; for a business user, their own). */
async function businessOf(req: Request, res: Response): Promise<string | null> {
  const businessId = typeof req.query.business_id === 'string' ? req.query.business_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) { error(res, msg('errors:translation.businessIdRequired'), 'VALIDATION_ERROR', 400); return null; }
  const authReq = req as AuthenticatedRequest;
  const { rows } = await adminPool.query(
    `SELECT b.id, u.business_id AS user_business FROM sys_businesses b LEFT JOIN usr_users u ON u.id = $3
      WHERE b.id = $1 AND b.tenant_id = $2`,
    [businessId, authReq.tenantId, authReq.user.sub],
  );
  if (!rows[0] || (rows[0].user_business && rows[0].user_business !== businessId)) {
    error(res, msg('errors:translation.notFound'), 'NOT_FOUND', 404); return null;
  }
  return businessId;
}

function entityOf(req: Request, res: Response) {
  const { entityType, entityId } = req.params;
  if (!isTranslatableEntity(entityType) || !/^[0-9a-f-]{36}$/i.test(entityId)) {
    error(res, msg('errors:translation.notFound'), 'NOT_FOUND', 404); return null;
  }
  return { entityType, entityId };
}

function fail(res: Response, err: unknown, logLabel: string) {
  if (err instanceof translations.TranslationError) {
    error(res, err.message, err.code, err.code === 'NOT_FOUND' ? 404 : 400); return;
  }
  if (err instanceof MachineTranslationError) {
    error(res, err.message, `TRANSLATION_${err.code}`, err.code === 'NO_KEY' ? 503 : 502); return;
  }
  console.error(logLabel, (err as Error)?.message || err);
  error(res, msg('errors:translation.failed'), 'INTERNAL_ERROR', 500);
}

// GET /api/v1/translations/:entityType/:entityId — the table: default-language text, and a row per other language
translationsRouter.get('/:entityType/:entityId', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const e = entityOf(req, res); if (!e) return;
    const businessId = await businessOf(req, res); if (!businessId) return;
    success(res, await translations.getTranslationTable(e.entityType, e.entityId, businessId));
  } catch (err) { fail(res, err, 'Failed to load translations'); }
});

// PUT /api/v1/translations/:entityType/:entityId/:language — { fields, translated_by }: save one language
translationsRouter.put('/:entityType/:entityId/:language', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const e = entityOf(req, res); if (!e) return;
    const businessId = await businessOf(req, res); if (!businessId) return;
    const by = req.body?.translated_by === 'machine' ? 'machine' : 'person';
    success(res, await translations.saveTranslation(e.entityType, e.entityId, businessId, req.params.language,
      { fields: req.body?.fields, translatedBy: by }, (req as AuthenticatedRequest).user.sub));
  } catch (err) { fail(res, err, 'Failed to save translation'); }
});

// POST /api/v1/translations/:entityType/:entityId/:language/translate — Google's translation (not saved)
translationsRouter.post('/:entityType/:entityId/:language/translate', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const e = entityOf(req, res); if (!e) return;
    const businessId = await businessOf(req, res); if (!businessId) return;
    success(res, await translations.machineTranslate(e.entityType, e.entityId, businessId, req.params.language));
  } catch (err) { fail(res, err, 'Machine translation failed'); }
});
