import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as promotionService from '../services/promotion.service';

export const promotionsRouter = Router();

promotionsRouter.use(authenticate);
promotionsRouter.use(tenantContext);

const createPromotionSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(2000).allow('', null),
  type: Joi.string().valid('discount_percentage', 'discount_fixed', 'price_override', 'premium_percentage', 'premium_fixed').required(),
  value: Joi.number().integer().min(0).required(),
  promo_code: Joi.string().max(50).allow('', null),
  date_from: Joi.string().isoDate().allow('', null),
  date_to: Joi.string().isoDate().allow('', null),
  days_of_week: Joi.array().items(Joi.number().integer().min(0).max(6)).allow(null),
  time_from: Joi.string().allow('', null),
  time_to: Joi.string().allow('', null),
  applies_to: Joi.string().valid('all', 'services', 'products', 'categories').default('all'),
  service_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  merchandise_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  category_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  variant_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  location_ids: Joi.array().items(Joi.string().uuid()).allow(null),
  max_redemptions: Joi.number().integer().min(1).allow(null),
  max_per_customer: Joi.number().integer().min(1).allow(null),
  priority: Joi.number().integer().min(0).default(0),
  stackable: Joi.boolean().default(false),
});

// GET /api/v1/promotions
promotionsRouter.get('/', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await promotionService.getPromotions({
      businessId,
      status: req.query.status as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.promotions, { total: result.total, page: result.page, limit: result.limit });
  } catch (err: any) { error(res, 'Failed to list promotions', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/promotions
promotionsRouter.post('/', requirePermission('services:*'), validate(createPromotionSchema), async (req: Request, res: Response) => {
  try {
    const promo = await promotionService.createPromotion({
      businessId: req.body.business_id,
      name: req.body.name,
      description: req.body.description,
      type: req.body.type,
      value: req.body.value,
      promoCode: req.body.promo_code,
      dateFrom: req.body.date_from,
      dateTo: req.body.date_to,
      daysOfWeek: req.body.days_of_week,
      timeFrom: req.body.time_from,
      timeTo: req.body.time_to,
      appliesTo: req.body.applies_to,
      serviceIds: req.body.service_ids,
      merchandiseIds: req.body.merchandise_ids,
      categoryIds: req.body.category_ids,
      maxRedemptions: req.body.max_redemptions,
      maxPerCustomer: req.body.max_per_customer,
      priority: req.body.priority,
      stackable: req.body.stackable,
    });
    success(res, promo, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.message?.includes('unique')) {
      error(res, 'A promotion with this code already exists', 'DUPLICATE_CODE', 409);
    } else { error(res, 'Failed to create promotion', 'INTERNAL_ERROR', 500); }
  }
});

// GET /api/v1/promotions/:id
promotionsRouter.get('/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const promo = await promotionService.getPromotionById(req.params.id, businessId);
    if (!promo) { error(res, 'Promotion not found', 'NOT_FOUND', 404); return; }
    success(res, promo);
  } catch (err: any) { error(res, 'Failed to get promotion', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/promotions/:id
promotionsRouter.put('/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const promo = await promotionService.updatePromotion(req.params.id, businessId, req.body);
    if (!promo) { error(res, 'Promotion not found', 'NOT_FOUND', 404); return; }
    success(res, promo);
  } catch (err: any) { error(res, 'Failed to update promotion', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/promotions/:id/archive
promotionsRouter.put('/:id/archive', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const archived = await promotionService.archivePromotion(req.params.id, businessId);
    if (!archived) { error(res, 'Promotion not found', 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) { error(res, 'Failed to archive promotion', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/promotions/:id/activate
promotionsRouter.put('/:id/activate', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const activated = await promotionService.activatePromotion(req.params.id, businessId);
    if (!activated) { error(res, 'Promotion not found', 'NOT_FOUND', 404); return; }
    success(res, { activated: true });
  } catch (err: any) { error(res, 'Failed to activate promotion', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/promotions/:id/pause
promotionsRouter.put('/:id/pause', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const paused = await promotionService.pausePromotion(req.params.id, businessId);
    if (!paused) { error(res, 'Promotion not found', 'NOT_FOUND', 404); return; }
    success(res, { paused: true });
  } catch (err: any) { error(res, 'Failed to pause promotion', 'INTERNAL_ERROR', 500); }
});
