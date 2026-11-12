import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as completion from '../services/form-completion.service';
import { getCustomerFormStatus } from '../services/form-status.service';

/**
 * A customer's forms, for staff (spec 51, gap 1): see what they completed, start a device session
 * or send a link, fill in an unsigned form for them, and view or email a copy of the PDF.
 * Any staff member can see completed forms (customers:read); starting and completing needs customers:*.
 */
export const customerFormsRouter = Router({ mergeParams: true });
customerFormsRouter.use(authenticate);
customerFormsRouter.use(tenantContext);

const HTTP: Record<string, number> = {
  NOT_FOUND: 404,
  FILE_MISSING: 404,
  INVALID_ANSWERS: 422,
  NO_ACTIVE_FORM: 409,
  NO_EMAIL: 409,
  SIGNED_FORM_STAFF: 409,
  EMAIL_FAILED: 502,
  STORAGE_FAILED: 503,
};

function fail(res: Response, e: unknown, fallback: string): void {
  const err = e as { code?: string; message?: string; details?: unknown };
  if (err.code && HTTP[err.code]) { error(res, err.message ?? fallback, err.code, HTTP[err.code], err.details); return; }
  console.error(fallback, err.message ?? e);
  error(res, fallback, 'INTERNAL_ERROR', 500);
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** The business must be the caller's tenant's, and the customer one of its customers. */
async function guard(req: Request, res: Response, businessId: unknown): Promise<string | null> {
  const customerId = req.params.id;
  if (typeof businessId !== 'string' || !UUID_RE.test(businessId) || !UUID_RE.test(customerId)) {
    error(res, 'business_id required', 'VALIDATION_ERROR', 400); return null;
  }
  const { rows } = await adminPool.query(
    `SELECT 1 FROM cus_customers c JOIN sys_businesses b ON b.id = c.business_id
      WHERE c.id = $1 AND c.business_id = $2 AND b.tenant_id = $3`,
    [customerId, businessId, (req as AuthenticatedRequest).tenantId],
  );
  if (rows.length === 0) { error(res, 'Customer not found', 'NOT_FOUND', 404); return null; }
  return businessId;
}

// GET /v1/customers/:id/forms?business_id=
customerFormsRouter.get('/', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = await guard(req, res, req.query.business_id);
    if (!businessId) return;
    const bookingId = typeof req.query.booking_id === 'string' && UUID_RE.test(req.query.booking_id) ? req.query.booking_id : null;
    const serviceId = typeof req.query.service_id === 'string' && UUID_RE.test(req.query.service_id) ? req.query.service_id : null;
    const [forms, submissions] = await Promise.all([
      getCustomerFormStatus(businessId, req.params.id, bookingId, serviceId),
      completion.listSubmissions(businessId, req.params.id),
    ]);
    success(res, { forms, submissions });
  } catch (e) { fail(res, e, 'Failed to load forms'); }
});

const requestSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  group_id: Joi.string().uuid().required(),
  channel: Joi.string().valid('device', 'email').required(),
  booking_id: Joi.string().uuid().allow(null),
});

// POST /v1/customers/:id/forms/requests
customerFormsRouter.post('/requests', requirePermission('customers:*'), validate(requestSchema), async (req: Request, res: Response) => {
  try {
    const businessId = await guard(req, res, req.body.business_id);
    if (!businessId) return;
    const created = await completion.createRequest({
      businessId, customerId: req.params.id, groupId: req.body.group_id, channel: req.body.channel,
      bookingId: req.body.booking_id ?? null, createdBy: (req as AuthenticatedRequest).user.sub,
    });
    success(res, created, undefined, 201);
  } catch (e) { fail(res, e, 'Failed to start the form'); }
});

const staffSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  group_id: Joi.string().uuid().required(),
  language: Joi.string().max(10).allow(null, ''),
  booking_id: Joi.string().uuid().allow(null),
  answers: Joi.object().unknown(true).required(),
});

// POST /v1/customers/:id/forms/submissions — staff complete an unsigned form
customerFormsRouter.post('/submissions', requirePermission('customers:*'), validate(staffSchema), async (req: Request, res: Response) => {
  try {
    const businessId = await guard(req, res, req.body.business_id);
    if (!businessId) return;
    const result = await completion.completeByStaff({
      businessId, customerId: req.params.id, groupId: req.body.group_id, language: req.body.language || null,
      answers: req.body.answers, bookingId: req.body.booking_id ?? null,
      staffUserId: (req as AuthenticatedRequest).user.sub,
    }, { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
    success(res, result, undefined, 201);
  } catch (e) { fail(res, e, 'Failed to save the form'); }
});

// GET /v1/customers/:id/forms/submissions/:sid/file?business_id=  — the PDF
customerFormsRouter.get('/submissions/:sid/file', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = await guard(req, res, req.query.business_id);
    if (!businessId) return;
    if (!UUID_RE.test(req.params.sid)) { error(res, 'Form not found', 'NOT_FOUND', 404); return; }
    const file = await completion.getSubmissionFile(businessId, req.params.id, req.params.sid);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.data);
  } catch (e) { fail(res, e, 'Failed to load the form'); }
});

const emailSchema = Joi.object({ business_id: Joi.string().uuid().required() });

// POST /v1/customers/:id/forms/submissions/:sid/email — email a copy to the customer
customerFormsRouter.post('/submissions/:sid/email', requirePermission('customers:*'), validate(emailSchema), async (req: Request, res: Response) => {
  try {
    const businessId = await guard(req, res, req.body.business_id);
    if (!businessId) return;
    if (!UUID_RE.test(req.params.sid)) { error(res, 'Form not found', 'NOT_FOUND', 404); return; }
    success(res, await completion.emailSubmissionCopy(
      businessId, req.params.id, req.params.sid, (req as AuthenticatedRequest).user.sub,
    ));
  } catch (e) { fail(res, e, 'Failed to email the form'); }
});
