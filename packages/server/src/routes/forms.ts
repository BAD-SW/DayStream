import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { SUPPORTED_LANGUAGES } from '@daystream/shared';
import * as forms from '../services/forms.service';
import { countOutstandingForBookings } from '../services/form-status.service';

/**
 * Forms a business builds (spec 51, gap 1). Any staff member can read them (they pick a form to
 * send or fill in); building and changing them needs the business settings permission.
 */
export const formsRouter = Router();
formsRouter.use(authenticate);
formsRouter.use(tenantContext);

const HTTP: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_NAME: 400,
  INVALID_LANGUAGE: 400,
  INVALID_DEFINITION: 400,
  INVALID_RENEWAL: 400,
  LANGUAGE_EXISTS: 409,
};

function fail(res: Response, e: unknown, fallback: string): void {
  const err = e as { code?: string; message?: string };
  if (err.code && HTTP[err.code]) { error(res, err.message ?? fallback, err.code, HTTP[err.code]); return; }
  console.error(fallback, err.message ?? e);
  error(res, fallback, 'INTERNAL_ERROR', 500);
}

/** The business must belong to the caller's tenant. */
async function ownBusiness(req: Request, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    'SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2',
    [businessId, (req as AuthenticatedRequest).tenantId],
  );
  return rows.length > 0;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

// GET /v1/forms?business_id=
formsRouter.get('/', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId || !UUID_RE.test(businessId)) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!(await ownBusiness(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    success(res, await forms.listForms(businessId));
  } catch (e) { fail(res, e, 'Failed to list forms'); }
});

// GET /v1/forms/outstanding?business_id=&booking_ids=a,b — forms still needed, per booking.
// Information for booking detail and check-in; it never blocks anything. (Before /:id.)
formsRouter.get('/outstanding', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId || !UUID_RE.test(businessId)) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!(await ownBusiness(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const ids = String(req.query.booking_ids ?? '').split(',').map((x) => x.trim()).filter((x) => UUID_RE.test(x));
    success(res, await countOutstandingForBookings(businessId, ids));
  } catch (e) { fail(res, e, 'Failed to check forms'); }
});

// GET /v1/forms/:id?business_id=
formsRouter.get('/:id', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId || !UUID_RE.test(businessId)) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!(await ownBusiness(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const form = await forms.getForm(businessId, req.params.id);
    if (!form || form.status === 'archived') { error(res, 'Form not found', 'NOT_FOUND', 404); return; }
    success(res, form);
  } catch (e) { fail(res, e, 'Failed to load form'); }
});

const appliesSchema = Joi.object({
  first_visit: Joi.boolean(),
  service_ids: Joi.array().items(Joi.string().uuid()).max(200),
});

// The definition's shape is checked by the shared validator in the service.
const baseFields = {
  name: Joi.string().max(200),
  language: Joi.string().valid(...SUPPORTED_LANGUAGES).allow(null, ''),
  definition: Joi.object().unknown(true),
  applies: appliesSchema,
  renew_after_months: Joi.number().integer().min(1).max(240).allow(null),
  is_active: Joi.boolean(),
};

const createSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  ...baseFields,
  name: Joi.string().max(200).required(),
  definition: Joi.object().unknown(true).required(),
});

// POST /v1/forms
formsRouter.post('/', requirePermission('settings:*'), validate(createSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const b = req.body;
    if (!(await ownBusiness(req, b.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const created = await forms.createForm({
      tenantId: authReq.tenantId,
      businessId: b.business_id,
      createdBy: authReq.user.sub,
      name: b.name,
      language: b.language,
      definition: b.definition,
      applies: b.applies,
      renewAfterMonths: b.renew_after_months,
      isActive: b.is_active,
    });
    success(res, created, undefined, 201);
  } catch (e) { fail(res, e, 'Failed to create form'); }
});

const updateSchema = Joi.object({ business_id: Joi.string().uuid().required(), ...baseFields });

// PUT /v1/forms/:id
formsRouter.put('/:id', requirePermission('settings:*'), validate(updateSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const b = req.body;
    if (!(await ownBusiness(req, b.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const updated = await forms.updateForm(b.business_id, req.params.id, {
      name: b.name,
      language: b.language,
      definition: b.definition,
      applies: b.applies,
      renewAfterMonths: b.renew_after_months,
      isActive: b.is_active,
    }, authReq.user.sub, authReq.tenantId);
    success(res, updated);
  } catch (e) { fail(res, e, 'Failed to save form'); }
});

const businessOnly = Joi.object({ business_id: Joi.string().uuid().required() });

// DELETE /v1/forms/:id (archive)
formsRouter.delete('/:id', requirePermission('settings:*'), validate(businessOnly), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!(await ownBusiness(req, req.body.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    await forms.archiveForm(req.body.business_id, req.params.id, authReq.user.sub, authReq.tenantId);
    success(res, { archived: true });
  } catch (e) { fail(res, e, 'Failed to delete form'); }
});

// POST /v1/forms/:id/duplicate
formsRouter.post('/:id/duplicate', requirePermission('settings:*'), validate(businessOnly), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!(await ownBusiness(req, req.body.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const copy = await forms.duplicateForm(req.body.business_id, req.params.id, authReq.user.sub, authReq.tenantId);
    success(res, copy, undefined, 201);
  } catch (e) { fail(res, e, 'Failed to duplicate form'); }
});

const languageSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  language: Joi.string().valid(...SUPPORTED_LANGUAGES).required(),
});

// POST /v1/forms/:id/language-versions
formsRouter.post('/:id/language-versions', requirePermission('settings:*'), validate(languageSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!(await ownBusiness(req, req.body.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const created = await forms.addLanguageVersion(
      req.body.business_id, req.params.id, req.body.language, authReq.user.sub, authReq.tenantId,
    );
    success(res, created, undefined, 201);
  } catch (e) { fail(res, e, 'Failed to add language version'); }
});
