import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requireClinical } from '../auth/clinical';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as charts from '../services/chart.service';
import type { ChartActor } from '../services/chart.service';

/**
 * Treatment charts (spec 51, gap 2). Only clinical roles may use any of this; the guard runs
 * before every route. Every route needs a business_id belonging to the caller's tenant.
 */
export const chartsRouter = Router();
chartsRouter.use(authenticate);
chartsRouter.use(tenantContext);
chartsRouter.use(requireClinical());

const HTTP: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  LOCKED: 409,
  NOT_SIGNED: 409,
  INVALID_ANSWERS: 400,
  INVALID_AMENDMENT: 400,
  STORAGE_FAILED: 500,
};

function fail(res: Response, e: unknown, fallback: string): void {
  const err = e as { code?: string; message?: string; details?: unknown };
  if (err.code && HTTP[err.code]) {
    error(res, err.message ?? fallback, err.code, HTTP[err.code], err.details);
    return;
  }
  // The audit log must be written before a chart is shown or changed; if it can't be, say so plainly.
  console.error(fallback, err.message ?? e);
  error(res, fallback, 'INTERNAL_ERROR', 500);
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function ownBusiness(req: Request, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    'SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2',
    [businessId, (req as AuthenticatedRequest).tenantId],
  );
  return rows.length > 0;
}

function actorOf(req: Request): ChartActor {
  const a = req as AuthenticatedRequest;
  const perms = a.user.permissions || [];
  return {
    userId: a.user.sub,
    tenantId: a.tenantId,
    isManager: perms.some((p) => p === '*:*' || p === 'customers:*'),
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

/** Reads business_id from the query and checks it; sends the error and returns null if it fails. */
async function queryBusiness(req: Request, res: Response): Promise<string | null> {
  const businessId = req.query.business_id as string;
  if (!businessId || !UUID_RE.test(businessId)) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return null; }
  if (!(await ownBusiness(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return null; }
  return businessId;
}

async function bodyBusiness(req: Request, res: Response): Promise<string | null> {
  const businessId = req.body.business_id as string;
  if (!(await ownBusiness(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return null; }
  return businessId;
}

// GET /v1/charts/customer/:customerId?business_id=
chartsRouter.get('/customer/:customerId', async (req: Request, res: Response) => {
  try {
    const businessId = await queryBusiness(req, res); if (!businessId) return;
    if (!UUID_RE.test(req.params.customerId)) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    success(res, await charts.listCustomerCharts(businessId, req.params.customerId, actorOf(req)));
  } catch (e) { fail(res, e, 'Failed to list charts'); }
});

// GET /v1/charts/booking/:bookingId?business_id=
chartsRouter.get('/booking/:bookingId', async (req: Request, res: Response) => {
  try {
    const businessId = await queryBusiness(req, res); if (!businessId) return;
    if (!UUID_RE.test(req.params.bookingId)) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }
    success(res, await charts.listBookingCharts(businessId, req.params.bookingId, actorOf(req)));
  } catch (e) { fail(res, e, 'Failed to list charts'); }
});

// GET /v1/charts/:id?business_id=
chartsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const businessId = await queryBusiness(req, res); if (!businessId) return;
    if (!UUID_RE.test(req.params.id)) { error(res, 'Chart not found', 'NOT_FOUND', 404); return; }
    success(res, await charts.getChart(businessId, req.params.id, actorOf(req)));
  } catch (e) { fail(res, e, 'Failed to load chart'); }
});

// GET /v1/charts/:id/pdf?business_id=
chartsRouter.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const businessId = await queryBusiness(req, res); if (!businessId) return;
    if (!UUID_RE.test(req.params.id)) { error(res, 'Chart not found', 'NOT_FOUND', 404); return; }
    const { data, filename } = await charts.getPdf(businessId, req.params.id, actorOf(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  } catch (e) { fail(res, e, 'Failed to load the chart PDF'); }
});

const createSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().required(),
  form_id: Joi.string().uuid().required(),
  booking_id: Joi.string().uuid().allow(null),
});

// POST /v1/charts
chartsRouter.post('/', validate(createSchema), async (req: Request, res: Response) => {
  try {
    const businessId = await bodyBusiness(req, res); if (!businessId) return;
    const chart = await charts.createChart(businessId, {
      customerId: req.body.customer_id, formId: req.body.form_id, bookingId: req.body.booking_id ?? null,
    }, actorOf(req));
    success(res, chart, undefined, 201);
  } catch (e) { fail(res, e, 'Failed to start chart'); }
});

const saveSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  answers: Joi.object().unknown(true).required(),
});

// PUT /v1/charts/:id (draft only)
chartsRouter.put('/:id', validate(saveSchema), async (req: Request, res: Response) => {
  try {
    const businessId = await bodyBusiness(req, res); if (!businessId) return;
    success(res, await charts.updateChart(businessId, req.params.id, req.body.answers, actorOf(req)));
  } catch (e) { fail(res, e, 'Failed to save chart'); }
});

const businessOnly = Joi.object({ business_id: Joi.string().uuid().required() });

// DELETE /v1/charts/:id (draft only)
chartsRouter.delete('/:id', validate(businessOnly), async (req: Request, res: Response) => {
  try {
    const businessId = await bodyBusiness(req, res); if (!businessId) return;
    await charts.deleteDraft(businessId, req.params.id, actorOf(req));
    success(res, { deleted: true });
  } catch (e) { fail(res, e, 'Failed to delete chart'); }
});

// POST /v1/charts/:id/sign
chartsRouter.post('/:id/sign', validate(businessOnly), async (req: Request, res: Response) => {
  try {
    const businessId = await bodyBusiness(req, res); if (!businessId) return;
    success(res, await charts.signOff(businessId, req.params.id, actorOf(req)));
  } catch (e) { fail(res, e, 'Failed to sign off chart'); }
});

const amendSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  content: Joi.string().max(5000).required(),
});

// POST /v1/charts/:id/amendments
chartsRouter.post('/:id/amendments', validate(amendSchema), async (req: Request, res: Response) => {
  try {
    const businessId = await bodyBusiness(req, res); if (!businessId) return;
    success(res, await charts.addAmendment(businessId, req.params.id, req.body.content, actorOf(req)), undefined, 201);
  } catch (e) { fail(res, e, 'Failed to add amendment'); }
});
