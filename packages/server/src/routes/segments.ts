import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as segmentsService from '../services/customer-segments.service';

export const segmentsRouter = Router();

segmentsRouter.use(authenticate);
segmentsRouter.use(tenantContext);

// --- Validation schemas ---

const ruleSchema = Joi.object({
  field: Joi.string().required(),
  operator: Joi.string().valid('eq', 'neq', 'gt', 'lt', 'in', 'between', 'contains', 'within_days', 'older_than_days', 'never', 'is_true', 'is_false').required(),
  // 'never', 'is_true' and 'is_false' need no value.
  value: Joi.any(),
});

const rulesSchema = Joi.object({
  logic: Joi.string().valid('AND', 'OR').required(),
  rules: Joi.array().items(ruleSchema).min(1).required(),
});

const createSegmentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  kind: Joi.string().valid('dynamic', 'static').default('dynamic'),
  description: Joi.string().max(300).allow('', null),
  // A fixed list has no rules; a dynamic segment needs them.
  rules: Joi.when('kind', { is: 'static', then: rulesSchema.optional(), otherwise: rulesSchema.required() }),
  business_id: Joi.string().uuid().required(),
});

const updateSegmentSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  description: Joi.string().max(300).allow('', null),
  rules: rulesSchema,
  business_id: Joi.string().uuid().required(),
}).or('name', 'description', 'rules');

const countSchema = Joi.object({
  rules: rulesSchema.required(),
  business_id: Joi.string().uuid().required(),
});

const membersSchema = Joi.object({
  customer_ids: Joi.array().items(Joi.string().uuid()).min(1).max(5000).required(),
  business_id: Joi.string().uuid().required(),
});

const CHANNELS = ['email', 'sms', 'whatsapp', 'in_app', 'push'];

// --- Routes ---

// GET /api/v1/segments — List saved segments
segmentsRouter.get('/', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    // Every business has the starter segments; they are created the first time the list is opened.
    await segmentsService.seedPredefinedSegments(businessId);
    const segments = await segmentsService.getSegments(businessId);
    success(res, segments);
  } catch (err: any) {
    error(res, 'Failed to list segments', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/segments — Create segment
segmentsRouter.post('/', requirePermission('customers:*'), validate(createSegmentSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const segment = await segmentsService.createSegment({
      businessId: req.body.business_id,
      name: req.body.name,
      rules: req.body.rules,
      kind: req.body.kind,
      description: req.body.description,
      createdBy: authReq.user.sub,
    });
    success(res, segment, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create segment', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/segments/count — Live member count for rules that are still being edited
segmentsRouter.post('/count', requirePermission('customers:read'), validate(countSchema), async (req: Request, res: Response) => {
  try {
    success(res, { total: await segmentsService.countRules(req.body.rules, req.body.business_id) });
  } catch (err: any) {
    error(res, 'Failed to count segment members', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/segments/:id — Rename a segment or change its rules
segmentsRouter.put('/:id', requirePermission('customers:*'), validate(updateSegmentSchema), async (req: Request, res: Response) => {
  try {
    const segment = await segmentsService.updateSegment(req.params.id, req.body.business_id, {
      name: req.body.name,
      description: req.body.description,
      rules: req.body.rules,
    });
    if (!segment) { error(res, 'Segment not found', 'NOT_FOUND', 404); return; }
    success(res, segment);
  } catch (err: any) {
    error(res, 'Failed to update segment', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/segments/:id/members — Evaluate segment and return members
segmentsRouter.get('/:id/members', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const result = await segmentsService.evaluateSegment(req.params.id, businessId, page, limit);
    if (!result) {
      error(res, 'Segment not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, result.members, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    error(res, 'Failed to evaluate segment', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/segments/:id/members — Add people to a fixed list
segmentsRouter.post('/:id/members', requirePermission('customers:*'), validate(membersSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const added = await segmentsService.addMembers(req.params.id, req.body.business_id, req.body.customer_ids, authReq.user.sub);
    if (added === null) { error(res, 'Fixed list not found', 'NOT_FOUND', 404); return; }
    success(res, { added });
  } catch (err: any) {
    error(res, 'Failed to add people to the list', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/segments/:id/members — Remove people from a fixed list
segmentsRouter.delete('/:id/members', requirePermission('customers:*'), validate(membersSchema), async (req: Request, res: Response) => {
  try {
    const removed = await segmentsService.removeMembers(req.params.id, req.body.business_id, req.body.customer_ids);
    if (removed === null) { error(res, 'Fixed list not found', 'NOT_FOUND', 404); return; }
    success(res, { removed });
  } catch (err: any) {
    error(res, 'Failed to remove people from the list', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/segments/:id/audience-summary — Who would receive a message, and why the rest would not
segmentsRouter.get('/:id/audience-summary', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const channel = (req.query.channel as string) || 'email';
    const purpose = (req.query.purpose as string) || 'marketing';
    if (!CHANNELS.includes(channel) || !['marketing', 'transactional'].includes(purpose)) {
      error(res, 'Unknown channel or purpose', 'VALIDATION_ERROR', 400); return;
    }
    const summary = await segmentsService.audienceSummary(req.params.id, businessId, channel as any, purpose as any);
    if (!summary) { error(res, 'Segment not found', 'NOT_FOUND', 404); return; }
    success(res, summary);
  } catch (err: any) {
    error(res, 'Failed to summarise the audience', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/segments/:id — Delete segment
segmentsRouter.delete('/:id', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const deleted = await segmentsService.deleteSegment(req.params.id, businessId);
    if (!deleted) {
      error(res, 'Segment not found or is predefined', 'NOT_FOUND', 404);
      return;
    }

    success(res, { deleted: true });
  } catch (err: any) {
    if (err instanceof segmentsService.SegmentInUseError) {
      error(res, err.message, 'SEGMENT_IN_USE', 409);
      return;
    }
    error(res, 'Failed to delete segment', 'INTERNAL_ERROR', 500);
  }
});
