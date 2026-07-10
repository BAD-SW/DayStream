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
    const plans = await plansService.getPlans(businessId, req.query.include_archived === 'true');
    success(res, plans);
  } catch (err: any) { error(res, 'Failed to list plans', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/memberships/plans
membershipsRouter.post('/plans', requirePermission('services:*'), validate(createPlanSchema), async (req: Request, res: Response) => {
  try {
    const plan = await plansService.createPlan({
      businessId: req.body.business_id, name: req.body.name, description: req.body.description,
      planType: req.body.plan_type, billingCycle: req.body.billing_cycle, price: req.body.price,
      creditsPerCycle: req.body.credits_per_cycle, creditValidityDays: req.body.credit_validity_days,
      rolloverPolicy: req.body.rollover_policy, maxRolloverCredits: req.body.max_rollover_credits,
      totalSessions: req.body.total_sessions, expirationDays: req.body.expiration_days,
      isIntroOnly: req.body.is_intro_only, maxFrequencyPerDay: req.body.max_frequency_per_day,
      trialDays: req.body.trial_days, maxPauseDaysPerYear: req.body.max_pause_days_per_year,
      maxPausesPerYear: req.body.max_pauses_per_year, maxAdditionalMembers: req.body.max_additional_members,
      sharedCredits: req.body.shared_credits, displayOrder: req.body.display_order,
    });
    success(res, plan, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('must have') || err.message.includes('require')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else { error(res, 'Failed to create plan', 'INTERNAL_ERROR', 500); }
  }
});

// GET /api/v1/memberships/plans/:id
membershipsRouter.get('/plans/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const plan = await plansService.getPlanById(req.params.id, businessId);
    if (!plan) { error(res, 'Plan not found', 'NOT_FOUND', 404); return; }
    success(res, plan);
  } catch (err: any) { error(res, 'Failed to get plan', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/plans/:id
membershipsRouter.put('/plans/:id', requirePermission('services:*'), validate(updatePlanSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const plan = await plansService.updatePlan(req.params.id, businessId, req.body);
    if (!plan) { error(res, 'Plan not found', 'NOT_FOUND', 404); return; }
    success(res, plan);
  } catch (err: any) { error(res, 'Failed to update plan', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/plans/:id/archive
membershipsRouter.put('/plans/:id/archive', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const archived = await plansService.archivePlan(req.params.id, businessId);
    if (!archived) { error(res, 'Plan not found', 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) { error(res, 'Failed to archive plan', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Memberships
// ============================================================

const createMembershipSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().required(),
  plan_id: Joi.string().uuid().required(),
  staff_initiated: Joi.boolean().default(false),
});

const cancelMembershipSchema = Joi.object({
  reason: Joi.string().max(500).allow('', null),
});

// POST /api/v1/memberships — Purchase/activate
membershipsRouter.post('/', requirePermission('services:*'), validate(createMembershipSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const membership = await membershipService.createMembership({
      businessId: req.body.business_id,
      customerId: req.body.customer_id,
      planId: req.body.plan_id,
      createdBy: authReq.user.sub,
      tenantId: authReq.tenantId,
      staffInitiated: req.body.staff_initiated,
    });
    success(res, membership, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('not active')) {
      error(res, err.message, 'NOT_FOUND', 404);
    } else if (err.message.includes('already') || err.message.includes('Intro')) {
      error(res, err.message, 'CONFLICT', 409);
    } else { error(res, 'Failed to create membership', 'INTERNAL_ERROR', 500); }
  }
});

// GET /api/v1/memberships
membershipsRouter.get('/', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await membershipService.getMemberships(businessId, {
      status: req.query.status as string,
      customerId: req.query.customer_id as string,
      planId: req.query.plan_id as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.memberships, { page: result.page, limit: result.limit, total: result.total, totalPages: Math.ceil(result.total / result.limit) });
  } catch (err: any) { error(res, 'Failed to list memberships', 'INTERNAL_ERROR', 500); }
});

// Reporting routes (registered before /:id to avoid conflict)
import * as reportsServiceFwd from '../services/membership-reports.service';

membershipsRouter.get('/reports/summary', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const report = await reportsServiceFwd.getSummaryReport({ businessId, planId: req.query.plan_id as string });
    success(res, report);
  } catch (err: any) { error(res, 'Failed to generate report', 'INTERNAL_ERROR', 500); }
});

membershipsRouter.get('/reports/churn', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const report = await reportsServiceFwd.getChurnReport({ businessId, dateFrom: req.query.date_from as string, dateTo: req.query.date_to as string });
    success(res, report);
  } catch (err: any) { error(res, 'Failed to generate report', 'INTERNAL_ERROR', 500); }
});

membershipsRouter.get('/reports/credits', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const report = await reportsServiceFwd.getCreditReport({ businessId, dateFrom: req.query.date_from as string, dateTo: req.query.date_to as string });
    success(res, report);
  } catch (err: any) { error(res, 'Failed to generate report', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/memberships/:id
membershipsRouter.get('/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const membership = await membershipService.getMembershipById(req.params.id, businessId);
    if (!membership) { error(res, 'Membership not found', 'NOT_FOUND', 404); return; }
    success(res, membership);
  } catch (err: any) { error(res, 'Failed to get membership', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/:id/cancel
membershipsRouter.put('/:id/cancel', requirePermission('services:*'), validate(cancelMembershipSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await membershipService.cancelMembership(req.params.id, businessId, authReq.user.sub, authReq.tenantId, req.body.reason);
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'INVALID_TRANSITION', status);
      return;
    }
    success(res, { cancelled: true });
  } catch (err: any) { error(res, 'Failed to cancel membership', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Credits
// ============================================================

import * as creditsService from '../services/membership-credits.service';

const deductCreditsSchema = Joi.object({
  amount: Joi.number().integer().min(1).required(),
  booking_id: Joi.string().uuid().allow(null),
  description: Joi.string().max(200).allow('', null),
});

const restoreCreditsSchema = Joi.object({
  amount: Joi.number().integer().min(1).required(),
  booking_id: Joi.string().uuid().allow(null),
  description: Joi.string().max(200).allow('', null),
});

const adjustCreditsSchema = Joi.object({
  amount: Joi.number().integer().required(), // positive or negative
  description: Joi.string().min(1).max(200).required(),
});

// GET /api/v1/memberships/:id/credits
membershipsRouter.get('/:id/credits', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const info = await creditsService.getCreditInfo(req.params.id);
    if (!info) { error(res, 'Membership not found', 'NOT_FOUND', 404); return; }
    success(res, info);
  } catch (err: any) { error(res, 'Failed to get credits', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/memberships/:id/credits/deduct
membershipsRouter.post('/:id/credits/deduct', requirePermission('services:*'), validate(deductCreditsSchema), async (req: Request, res: Response) => {
  try {
    const result = await creditsService.deductCredits(req.params.id, req.body.amount, req.body.booking_id, req.body.description);
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'INSUFFICIENT_CREDITS', status);
      return;
    }
    success(res, { balance_after: result.balance_after });
  } catch (err: any) { error(res, 'Failed to deduct credits', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/memberships/:id/credits/restore
membershipsRouter.post('/:id/credits/restore', requirePermission('services:*'), validate(restoreCreditsSchema), async (req: Request, res: Response) => {
  try {
    const result = await creditsService.restoreCredits(req.params.id, req.body.amount, req.body.booking_id, req.body.description);
    if (!result.success) { error(res, result.error!, 'NOT_FOUND', 404); return; }
    success(res, { balance_after: result.balance_after });
  } catch (err: any) { error(res, 'Failed to restore credits', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/memberships/:id/credits/adjust
membershipsRouter.post('/:id/credits/adjust', requirePermission('services:*'), validate(adjustCreditsSchema), async (req: Request, res: Response) => {
  try {
    const result = await creditsService.adjustCredits(req.params.id, req.body.amount, req.body.description);
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', status);
      return;
    }
    success(res, { balance_after: result.balance_after });
  } catch (err: any) { error(res, 'Failed to adjust credits', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Freeze / Pause
// ============================================================

import * as freezeService from '../services/membership-freeze.service';

const pauseSchema = Joi.object({
  pause_days: Joi.number().integer().min(1).max(180).required(),
  admin_override: Joi.boolean().default(false),
});

// PUT /api/v1/memberships/:id/pause
membershipsRouter.put('/:id/pause', requirePermission('services:*'), validate(pauseSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await freezeService.pauseMembership(
      req.params.id, businessId, req.body.pause_days,
      authReq.user.sub, authReq.tenantId, req.body.admin_override,
    );
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', status);
      return;
    }
    success(res, result.membership);
  } catch (err: any) { error(res, 'Failed to pause membership', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/:id/resume
membershipsRouter.put('/:id/resume', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await freezeService.resumeMembership(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', status);
      return;
    }
    success(res, result.membership);
  } catch (err: any) { error(res, 'Failed to resume membership', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Upgrade / Downgrade
// ============================================================

import * as upgradeService from '../services/membership-upgrade.service';

const planChangeSchema = Joi.object({
  plan_id: Joi.string().uuid().required(),
});

// PUT /api/v1/memberships/:id/upgrade
membershipsRouter.put('/:id/upgrade', requirePermission('services:*'), validate(planChangeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await upgradeService.upgradeMembership(req.params.id, businessId, req.body.plan_id, authReq.user.sub, authReq.tenantId);
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', status);
      return;
    }
    success(res, { membership: result.membership, proration_amount: result.proration_amount });
  } catch (err: any) { error(res, 'Failed to upgrade', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/memberships/:id/downgrade
membershipsRouter.put('/:id/downgrade', requirePermission('services:*'), validate(planChangeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await upgradeService.downgradeMembership(req.params.id, businessId, req.body.plan_id, authReq.user.sub, authReq.tenantId);
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', status);
      return;
    }
    success(res, { membership: result.membership, proration_amount: result.proration_amount });
  } catch (err: any) { error(res, 'Failed to downgrade', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Family Memberships
// ============================================================

import * as familyService from '../services/membership-family.service';

const addMemberSchema = Joi.object({
  customer_id: Joi.string().uuid().required(),
});

// POST /api/v1/memberships/:id/members — Add family member
membershipsRouter.post('/:id/members', requirePermission('services:*'), validate(addMemberSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await familyService.addFamilyMember(req.params.id, businessId, req.body.customer_id, authReq.user.sub);
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', status);
      return;
    }
    success(res, result.membership, undefined, 201);
  } catch (err: any) { error(res, 'Failed to add family member', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/memberships/:id/members/:customerId — Remove family member
membershipsRouter.delete('/:id/members/:customerId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const removed = await familyService.removeFamilyMember(req.params.id, businessId, req.params.customerId);
    if (!removed) { error(res, 'Family member not found', 'NOT_FOUND', 404); return; }
    success(res, { removed: true });
  } catch (err: any) { error(res, 'Failed to remove family member', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/memberships/:id/members — List family members
membershipsRouter.get('/:id/members', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const members = await familyService.getFamilyMembers(req.params.id);
    success(res, members);
  } catch (err: any) { error(res, 'Failed to list family members', 'INTERNAL_ERROR', 500); }
});


// (Reporting routes registered above, before /:id)
