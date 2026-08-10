import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as plansService from '../services/membership-plans.service';
import * as membershipService from '../services/membership.service';

export const membershipsRouter = Router();

membershipsRouter.use(authenticate);
membershipsRouter.use(tenantContext);

// ============================================================
// Membership Plans
// ============================================================

const createPlanSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(2000).allow('', null),
  plan_type: Joi.string().valid('unlimited', 'credit', 'hybrid', 'punch_card', 'intro_package').required(),
  billing_cycle: Joi.string().valid('monthly', 'quarterly', 'annually', 'one_time').required(),
  price: Joi.number().integer().min(0).required(),
  credits_per_cycle: Joi.number().integer().min(1).allow(null),
  credit_validity_days: Joi.number().integer().min(1).allow(null),
  rollover_policy: Joi.string().valid('none', 'limited', 'unlimited').default('none'),
  max_rollover_credits: Joi.number().integer().min(1).allow(null),
  total_sessions: Joi.number().integer().min(1).allow(null),
  expiration_days: Joi.number().integer().min(1).allow(null),
  is_intro_only: Joi.boolean().default(false),
  max_frequency_per_day: Joi.number().integer().min(1).allow(null),
  trial_days: Joi.number().integer().min(0).default(0),
  max_pause_days_per_year: Joi.number().integer().min(0).default(30),
  max_pauses_per_year: Joi.number().integer().min(0).default(2),
  max_additional_members: Joi.number().integer().min(0).default(0),
  shared_credits: Joi.boolean().default(false),
  display_order: Joi.number().integer().min(0).default(0),
});

const updatePlanSchema = Joi.object({
  name: Joi.string().min(1).max(200),
  description: Joi.string().max(2000).allow('', null),
  plan_type: Joi.string().valid('unlimited', 'credit', 'hybrid', 'punch_card', 'intro_package'),
  billing_cycle: Joi.string().valid('monthly', 'quarterly', 'annually', 'one_time'),
  price: Joi.number().integer().min(0),
  status: Joi.string().valid('active', 'archived'),
  credits_per_cycle: Joi.number().integer().min(1).allow(null),
  credit_validity_days: Joi.number().integer().min(1).allow(null),
  rollover_policy: Joi.string().valid('none', 'limited', 'unlimited'),
  max_rollover_credits: Joi.number().integer().min(1).allow(null),
  total_sessions: Joi.number().integer().min(1).allow(null),
  expiration_days: Joi.number().integer().min(1).allow(null),
  max_frequency_per_day: Joi.number().integer().min(1).allow(null),
  trial_days: Joi.number().integer().min(0),
  max_pause_days_per_year: Joi.number().integer().min(0),
  max_pauses_per_year: Joi.number().integer().min(0),
  max_additional_members: Joi.number().integer().min(0),
  shared_credits: Joi.boolean(),
  display_order: Joi.number().integer().min(0),
}).min(1);

// GET /api/v1/memberships/plans
membershipsRouter.get('/plans', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await membershipService.getPlans({
      businessId,
      status: req.query.status as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    });
    success(res, result.plans, { total: result.total, page: result.page, limit: result.limit });
  } catch (err: any) { error(res, 'Failed to list plans', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/memberships/plans
membershipsRouter.post('/plans', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const plan = await membershipService.createPlan({
      businessId: req.body.business_id,
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.short_description,
      billingFrequency: req.body.billing_frequency,
      price: req.body.price,
      trialDays: req.body.trial_days,
      discountServicesPct: req.body.discount_services_pct,
      discountMerchandisePct: req.body.discount_merchandise_pct,
      displayOrder: req.body.display_order,
    });
    success(res, plan, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create plan', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/memberships/plans/:id
membershipsRouter.get('/plans/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const plan = await membershipService.getPlanById(req.params.id, businessId);
    if (!plan) { error(res, 'Plan not found', 'NOT_FOUND', 404); return; }
    success(res, plan);
  } catch (err: any) { error(res, 'Failed to get plan', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/plans/:id
membershipsRouter.put('/plans/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const plan = await membershipService.updatePlan(req.params.id, businessId, req.body);
    if (!plan) { error(res, 'Plan not found', 'NOT_FOUND', 404); return; }
    success(res, plan);
  } catch (err: any) { error(res, 'Failed to update plan', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/plans/:id/archive
membershipsRouter.put('/plans/:id/archive', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const archived = await membershipService.archivePlan(req.params.id, businessId);
    if (!archived) { error(res, 'Plan not found', 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) { error(res, 'Failed to archive plan', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/plans/:id/activate
membershipsRouter.put('/plans/:id/activate', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const activated = await membershipService.activatePlan(req.params.id, businessId);
    if (!activated) { error(res, 'Plan not found', 'NOT_FOUND', 404); return; }
    success(res, { activated: true });
  } catch (err: any) { error(res, 'Failed to activate plan', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/plans/:id/pause
membershipsRouter.put('/plans/:id/pause', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const paused = await membershipService.pausePlan(req.params.id, businessId);
    if (!paused) { error(res, 'Plan not found', 'NOT_FOUND', 404); return; }
    success(res, { paused: true });
  } catch (err: any) { error(res, 'Failed to pause plan', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Memberships (enrollments)
// ============================================================

const createMembershipSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().required(),
  plan_id: Joi.string().uuid().required(),
  start_date: Joi.string().isoDate().default(() => new Date().toISOString().split('T')[0]),
});

// POST /api/v1/memberships — Enroll customer
membershipsRouter.post('/', requirePermission('services:*'), validate(createMembershipSchema), async (req: Request, res: Response) => {
  try {
    const enrollment = await membershipService.enrollCustomer({
      planId: req.body.plan_id,
      businessId: req.body.business_id,
      customerId: req.body.customer_id,
      startDate: req.body.start_date,
    });
    success(res, enrollment, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('not found')) {
      error(res, err.message, 'NOT_FOUND', 404);
    } else { error(res, 'Failed to enroll customer', 'INTERNAL_ERROR', 500); }
  }
});

// GET /api/v1/memberships — List enrollments
membershipsRouter.get('/', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const enrollments = await membershipService.getEnrollments(businessId, {
      customerId: req.query.customer_id as string,
      planId: req.query.plan_id as string,
      status: req.query.status as string,
    });
    success(res, enrollments);
  } catch (err: any) { error(res, 'Failed to list enrollments', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/memberships/:id
membershipsRouter.get('/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const enrollment = await membershipService.getEnrollmentById(req.params.id, businessId);
    if (!enrollment) { error(res, 'Enrollment not found', 'NOT_FOUND', 404); return; }
    success(res, enrollment);
  } catch (err: any) { error(res, 'Failed to get enrollment', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/:id/pause
membershipsRouter.put('/:id/pause', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const maxPauseDays = req.body.max_pause_days ? parseInt(req.body.max_pause_days) : undefined;
    const paused = await membershipService.pauseEnrollment(req.params.id, businessId, maxPauseDays);
    if (!paused) { error(res, 'Enrollment not found or not active', 'NOT_FOUND', 404); return; }
    success(res, { paused: true });
  } catch (err: any) { error(res, 'Failed to pause enrollment', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/:id/resume
membershipsRouter.put('/:id/resume', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const resumed = await membershipService.resumeEnrollment(req.params.id, businessId);
    if (!resumed) { error(res, 'Enrollment not found or not paused', 'NOT_FOUND', 404); return; }
    success(res, { resumed: true });
  } catch (err: any) { error(res, 'Failed to resume enrollment', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/:id/change-plan
membershipsRouter.put('/:id/change-plan', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const { plan_id } = req.body;
    if (!plan_id) { error(res, 'plan_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await membershipService.changePlan(req.params.id, businessId, plan_id);
    success(res, result);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('Already on')) { error(res, err.message, 'VALIDATION_ERROR', 400); return; }
    error(res, 'Failed to change plan', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/memberships/:id/cancel
membershipsRouter.put('/:id/cancel', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const cancelled = await membershipService.cancelEnrollment(req.params.id, businessId);
    if (!cancelled) { error(res, 'Enrollment not found', 'NOT_FOUND', 404); return; }
    success(res, { cancelled: true });
  } catch (err: any) { error(res, 'Failed to cancel enrollment', 'INTERNAL_ERROR', 500); }
});

// --- Plan Items ---

// GET /api/v1/memberships/plans/:id/items
membershipsRouter.get('/plans/:id/items', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const items = await membershipService.getPlanItems(req.params.id);
    success(res, items);
  } catch (err: any) { error(res, 'Failed to get plan items', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/memberships/plans/:id/items
membershipsRouter.post('/plans/:id/items', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const item = await membershipService.addPlanItem({
      planId: req.params.id,
      itemType: req.body.item_type,
      serviceId: req.body.service_id,
      merchandiseId: req.body.merchandise_id,
      variantId: req.body.variant_id,
      quantityPerPeriod: req.body.quantity_per_period,
      accessFrequency: req.body.access_frequency,
    });
    success(res, item, undefined, 201);
  } catch (err: any) { error(res, 'Failed to add plan item', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/memberships/plans/:id/items/:itemId
membershipsRouter.delete('/plans/:id/items/:itemId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await membershipService.removePlanItem(req.params.itemId);
    if (!deleted) { error(res, 'Item not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to remove plan item', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/plans/:id/items/:itemId
membershipsRouter.put('/plans/:id/items/:itemId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const updated = await membershipService.updatePlanItem(req.params.itemId, {
      quantityPerPeriod: req.body.quantity_per_period,
      variantId: req.body.variant_id,
      accessFrequency: req.body.access_frequency,
    });
    if (!updated) { error(res, 'Item not found', 'NOT_FOUND', 404); return; }
    success(res, updated);
  } catch (err: any) { error(res, 'Failed to update plan item', 'INTERNAL_ERROR', 500); }
});
