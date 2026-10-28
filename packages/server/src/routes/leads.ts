import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as leads from '../services/leads.service';

/**
 * Leads (THE-17): the Marketing → Leads list and the business's lead stages.
 * Reading needs customers:read; changing a lead needs customers:*; the stages are business
 * setup, under Settings, so changing them needs settings:*. Deleting a lead archives it
 * (PUT /v1/customers/:id/archive) and restoring it uses PUT /v1/customers/:id/reactivate.
 */
export const leadsRouter = Router();
leadsRouter.use(authenticate);
leadsRouter.use(tenantContext);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The business named in the query, if it belongs to the caller's organisation. */
async function businessOf(req: Request, res: Response): Promise<string | null> {
  const businessId = req.query.business_id as string;
  if (!businessId || !uuid.test(businessId)) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return null; }
  const { rows } = await adminPool.query('SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [businessId, (req as AuthenticatedRequest).tenantId]);
  if (!rows[0]) { error(res, 'Business not found', 'NOT_FOUND', 404); return null; }
  return businessId;
}

function fail(res: Response, err: any, what: string) {
  if (err instanceof leads.LeadError) {
    res.status(err.status).json({ error: err.message, code: err.code, ...((err as any).details ? { details: (err as any).details } : {}) });
    return;
  }
  console.error(`[leads] ${what} failed:`, err?.message || err);
  error(res, `Failed to ${what}`, 'INTERNAL_ERROR', 500);
}

// --- Stages (Settings → Leads) ---

leadsRouter.get('/stages', requirePermission('customers:read'), async (req, res) => {
  try {
    const businessId = await businessOf(req, res); if (!businessId) return;
    success(res, await leads.getStages(businessId));
  } catch (err) { fail(res, err, 'list lead stages'); }
});

const stageSchema = Joi.object({ name: Joi.string().trim().min(1).max(60).required() });

leadsRouter.post('/stages', requirePermission('settings:*'), validate(stageSchema), async (req, res) => {
  try {
    const businessId = await businessOf(req, res); if (!businessId) return;
    success(res, await leads.addStage(businessId, req.body.name), undefined, 201);
  } catch (err) { fail(res, err, 'add a lead stage'); }
});

leadsRouter.put('/stages/order', requirePermission('settings:*'), validate(Joi.object({ ids: Joi.array().items(Joi.string().uuid()).min(1).required() })), async (req, res) => {
  try {
    const businessId = await businessOf(req, res); if (!businessId) return;
    success(res, await leads.reorderStages(businessId, req.body.ids));
  } catch (err) { fail(res, err, 'reorder lead stages'); }
});

leadsRouter.put('/stages/:id', requirePermission('settings:*'), validate(stageSchema), async (req, res) => {
  try {
    const businessId = await businessOf(req, res); if (!businessId) return;
    if (!uuid.test(req.params.id)) { error(res, 'Lead stage not found', 'STAGE_NOT_FOUND', 404); return; }
    success(res, await leads.renameStage(businessId, req.params.id, req.body.name));
  } catch (err) { fail(res, err, 'rename a lead stage'); }
});

// DELETE /v1/leads/stages/:id?business_id=&move_to=<stage id>
leadsRouter.delete('/stages/:id', requirePermission('settings:*'), async (req, res) => {
  try {
    const businessId = await businessOf(req, res); if (!businessId) return;
    const moveTo = req.query.move_to as string | undefined;
    if (!uuid.test(req.params.id) || (moveTo && !uuid.test(moveTo))) { error(res, 'Lead stage not found', 'STAGE_NOT_FOUND', 404); return; }
    success(res, await leads.deleteStage(businessId, req.params.id, moveTo, (req as AuthenticatedRequest).user.sub));
  } catch (err) { fail(res, err, 'delete a lead stage'); }
});

// --- Leads ---

leadsRouter.get('/', requirePermission('customers:read'), async (req, res) => {
  try {
    const businessId = await businessOf(req, res); if (!businessId) return;
    const q = req.query;
    const owner = q.owner as string | undefined;
    const stageId = q.stage_id as string | undefined;
    if (stageId && !uuid.test(stageId)) { error(res, 'Unknown stage', 'VALIDATION_ERROR', 400); return; }
    const result = await leads.listLeads(businessId, {
      stage_id: stageId,
      lead_source: q.lead_source as string | undefined,
      owner: owner === 'me' ? (req as AuthenticatedRequest).user.sub : owner,
      search: q.search as string | undefined,
      archived: q.archived === 'true',
      sort: q.sort as string | undefined,
      order: q.order as 'asc' | 'desc' | undefined,
      page: q.page ? parseInt(q.page as string, 10) : 1,
      limit: q.limit ? parseInt(q.limit as string, 10) : 20,
    });
    success(res, result.leads, {
      page: result.page, limit: result.limit, total: result.total,
      totalPages: Math.ceil(result.total / result.limit), stages: result.stages, timezone: result.timezone,
    });
  } catch (err) { fail(res, err, 'list leads'); }
});

const createSchema = Joi.object({
  first_name: Joi.string().trim().min(1).max(100).required(),
  last_name: Joi.string().max(100).allow('', null),
  email: Joi.string().email({ tlds: false }).allow('', null),
  phone: Joi.string().max(50).allow('', null),
  lead_source: Joi.string().max(30).allow('', null),
  lead_stage_id: Joi.string().uuid().allow('', null),
  owner_user_id: Joi.string().uuid().allow('', null),
  tag_ids: Joi.array().items(Joi.string().uuid()).default([]),
});

leadsRouter.post('/', requirePermission('customers:*'), validate(createSchema), async (req, res) => {
  try {
    const businessId = await businessOf(req, res); if (!businessId) return;
    const authReq = req as AuthenticatedRequest;
    const b = req.body;
    const lead = await leads.createLead(businessId, authReq.tenantId, authReq.user.sub, {
      first_name: b.first_name, last_name: b.last_name || null, email: b.email || null, phone: b.phone || null,
      lead_source: b.lead_source || null, lead_stage_id: b.lead_stage_id || null, owner_user_id: b.owner_user_id || null, tag_ids: b.tag_ids,
    });
    success(res, lead, undefined, 201);
  } catch (err) { fail(res, err, 'add a lead'); }
});

const patchSchema = Joi.object({
  lead_stage_id: Joi.string().uuid(),
  owner_user_id: Joi.string().uuid().allow('', null),
  lead_source: Joi.string().max(30).allow('', null),
}).min(1);

leadsRouter.patch('/:id', requirePermission('customers:*'), validate(patchSchema), async (req, res) => {
  try {
    const businessId = await businessOf(req, res); if (!businessId) return;
    if (!uuid.test(req.params.id)) { error(res, 'Lead not found', 'NOT_FOUND', 404); return; }
    const authReq = req as AuthenticatedRequest;
    const b = req.body;
    success(res, await leads.updateLead(businessId, authReq.tenantId, authReq.user.sub, req.params.id, {
      lead_stage_id: b.lead_stage_id,
      owner_user_id: b.owner_user_id === undefined ? undefined : (b.owner_user_id || null),
      lead_source: b.lead_source === undefined ? undefined : (b.lead_source || null),
    }));
  } catch (err) { fail(res, err, 'change the lead'); }
});
