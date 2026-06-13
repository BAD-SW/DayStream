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
  operator: Joi.string().valid('eq', 'neq', 'gt', 'lt', 'in', 'between', 'contains').required(),
  value: Joi.any().required(),
});

const createSegmentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  rules: Joi.object({
    logic: Joi.string().valid('AND', 'OR').required(),
    rules: Joi.array().items(ruleSchema).min(1).required(),
  }).required(),
  business_id: Joi.string().uuid().required(),
});

// --- Routes ---

// GET /api/v1/segments — List saved segments
segmentsRouter.get('/', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

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
      createdBy: authReq.user.sub,
    });
    success(res, segment, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create segment', 'INTERNAL_ERROR', 500);
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
    error(res, 'Failed to delete segment', 'INTERNAL_ERROR', 500);
  }
});
