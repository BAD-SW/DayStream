import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { SUPPORTED_LANGUAGES } from '@daystream/shared';
import * as texts from '../services/checkin-texts.service';

/**
 * The wording of the customer check-in screens (spec 51, gap 3), edited in Business Setup > Templates >
 * Check-In. Needs the business settings permission.
 */
export const checkInTextsRouter = Router();
checkInTextsRouter.use(authenticate);
checkInTextsRouter.use(tenantContext);
checkInTextsRouter.use(requirePermission('settings:*'));

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function ownBusiness(req: Request, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    'SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [businessId, (req as AuthenticatedRequest).tenantId],
  );
  return rows.length > 0;
}

// GET /v1/checkin-texts?business_id=&language= — what the business changed for a language
checkInTextsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const businessId = String(req.query.business_id || '');
    const language = String(req.query.language || '');
    if (!UUID_RE.test(businessId)) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(language)) { error(res, 'Choose a supported language.', 'INVALID_LANGUAGE', 400); return; }
    if (!(await ownBusiness(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, { language, overrides: await texts.getOverrides(businessId, language) });
  } catch (e) {
    console.error('Failed to load check-in wording', (e as Error).message);
    error(res, 'Failed to load the wording', 'INTERNAL_ERROR', 500);
  }
});

const saveSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  language: Joi.string().valid(...SUPPORTED_LANGUAGES).required(),
  texts: Joi.object().pattern(Joi.string(), Joi.string().allow('', null)).required(),
});

// PUT /v1/checkin-texts
checkInTextsRouter.put('/', validate(saveSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const b = req.body;
    if (!(await ownBusiness(req, b.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const saved = await texts.saveOverrides(b.business_id, authReq.tenantId, authReq.user.sub, b.language, b.texts);
    success(res, { language: b.language, overrides: saved });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'INVALID_TEXT' || err.code === 'INVALID_LANGUAGE') { error(res, err.message ?? 'Invalid wording', err.code, 400); return; }
    console.error('Failed to save check-in wording', err.message);
    error(res, 'Failed to save the wording', 'INTERNAL_ERROR', 500);
  }
});
