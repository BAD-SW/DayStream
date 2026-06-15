import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as categoriesService from '../services/service-categories.service';

export const servicesRouter = Router();

servicesRouter.use(authenticate);
servicesRouter.use(tenantContext);

// ============================================================
// Service Categories
// ============================================================

const createCategorySchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).allow('', null),
  icon: Joi.string().max(50).allow('', null),
  parent_id: Joi.string().uuid().allow(null),
  display_order: Joi.number().integer().min(0).default(0),
  business_id: Joi.string().uuid().required(),
});

const updateCategorySchema = Joi.object({
  name: Joi.string().min(1).max(100),
  description: Joi.string().max(500).allow('', null),
  icon: Joi.string().max(50).allow('', null),
  parent_id: Joi.string().uuid().allow(null),
  display_order: Joi.number().integer().min(0),
  status: Joi.string().valid('active', 'archived'),
}).min(1);

// GET /api/v1/services/categories — List categories with service counts
servicesRouter.get('/categories', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const categories = await categoriesService.getCategories(businessId);
    success(res, categories);
  } catch (err: any) {
    error(res, 'Failed to list categories', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/services/categories — Create category
servicesRouter.post('/categories', requirePermission('services:*'), validate(createCategorySchema), async (req: Request, res: Response) => {
  try {
    const category = await categoriesService.createCategory({
      businessId: req.body.business_id,
      name: req.body.name,
      description: req.body.description,
      icon: req.body.icon,
      parentId: req.body.parent_id,
      displayOrder: req.body.display_order,
    });
    success(res, category, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('duplicate key') || err.message.includes('unique') || err.message.includes('already exists')) {
      error(res, 'A category with this name already exists', 'DUPLICATE_NAME', 409);
    } else if (err.message.includes('not found') || err.message.includes('depth')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to create category', 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/services/categories/:id — Update category
servicesRouter.put('/categories/:id', requirePermission('services:*'), validate(updateCategorySchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const category = await categoriesService.updateCategory(req.params.id, businessId, {
      name: req.body.name,
      description: req.body.description,
      icon: req.body.icon,
      parentId: req.body.parent_id,
      displayOrder: req.body.display_order,
      status: req.body.status,
    });

    if (!category) { error(res, 'Category not found', 'NOT_FOUND', 404); return; }
    success(res, category);
  } catch (err: any) {
    if (err.message.includes('duplicate key') || err.message.includes('unique')) {
      error(res, 'A category with this name already exists', 'DUPLICATE_NAME', 409);
    } else if (err.message.includes('not found') || err.message.includes('depth') || err.message.includes('own parent')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to update category', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/services/categories/:id — Archive category
servicesRouter.delete('/categories/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const archived = await categoriesService.archiveCategory(req.params.id, businessId);
    if (!archived) { error(res, 'Category not found', 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) {
    error(res, 'Failed to archive category', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// Cancellation Policies (routes registered here to avoid /:id conflict)
// ============================================================

import * as policiesService from '../services/cancellation-policies.service';

const createPolicySchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(100).required(),
  is_default: Joi.boolean().default(false),
  free_cancellation_hours: Joi.number().integer().min(0).default(24),
  late_cancel_fee_type: Joi.string().valid('percentage', 'fixed').default('percentage'),
  late_cancel_fee_value: Joi.number().integer().min(0).default(50),
  noshow_fee_type: Joi.string().valid('percentage', 'fixed').default('percentage'),
  noshow_fee_value: Joi.number().integer().min(0).default(100),
});

const updatePolicySchema = Joi.object({
  name: Joi.string().min(1).max(100),
  is_default: Joi.boolean(),
  free_cancellation_hours: Joi.number().integer().min(0),
  late_cancel_fee_type: Joi.string().valid('percentage', 'fixed'),
  late_cancel_fee_value: Joi.number().integer().min(0),
  noshow_fee_type: Joi.string().valid('percentage', 'fixed'),
  noshow_fee_value: Joi.number().integer().min(0),
}).min(1);

// GET /api/v1/services/cancellation-policies
servicesRouter.get('/cancellation-policies', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const policies = await policiesService.getPolicies(businessId);
    success(res, policies);
  } catch (err: any) {
    error(res, 'Failed to list policies', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/services/cancellation-policies
servicesRouter.post('/cancellation-policies', requirePermission('services:*'), validate(createPolicySchema), async (req: Request, res: Response) => {
  try {
    const policy = await policiesService.createPolicy({
      businessId: req.body.business_id,
      name: req.body.name,
      isDefault: req.body.is_default,
      freeCancellationHours: req.body.free_cancellation_hours,
      lateCancelFeeType: req.body.late_cancel_fee_type,
      lateCancelFeeValue: req.body.late_cancel_fee_value,
      noshowFeeType: req.body.noshow_fee_type,
      noshowFeeValue: req.body.noshow_fee_value,
    });
    success(res, policy, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create policy', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/services/cancellation-policies/:id
servicesRouter.put('/cancellation-policies/:id', requirePermission('services:*'), validate(updatePolicySchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const policy = await policiesService.updatePolicy(req.params.id, businessId, {
      name: req.body.name,
      isDefault: req.body.is_default,
      freeCancellationHours: req.body.free_cancellation_hours,
      lateCancelFeeType: req.body.late_cancel_fee_type,
      lateCancelFeeValue: req.body.late_cancel_fee_value,
      noshowFeeType: req.body.noshow_fee_type,
      noshowFeeValue: req.body.noshow_fee_value,
    });

    if (!policy) { error(res, 'Policy not found', 'NOT_FOUND', 404); return; }
    success(res, policy);
  } catch (err: any) {
    error(res, 'Failed to update policy', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/services/cancellation-policies/:id
servicesRouter.delete('/cancellation-policies/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const deleted = await policiesService.deletePolicy(req.params.id, businessId);
    if (!deleted) { error(res, 'Policy not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete policy', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Service Templates (registered before /:id to avoid conflict)
// ============================================================

import * as templatesService from '../services/service-templates.service';

const applyTemplateSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  business_type: Joi.string().min(1).max(50).required(),
});

// GET /api/v1/services/templates — List templates
servicesRouter.get('/templates', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessType = req.query.business_type as string;
    const templates = await templatesService.getTemplates(businessType || undefined);
    const businessTypes = await templatesService.getBusinessTypes();
    success(res, { templates, business_types: businessTypes });
  } catch (err: any) {
    error(res, 'Failed to list templates', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/services/templates/apply — Apply template
servicesRouter.post('/templates/apply', requirePermission('services:*'), validate(applyTemplateSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await templatesService.applyTemplate(
      req.body.business_id,
      req.body.business_type,
      authReq.user.sub,
    );
    success(res, result);
  } catch (err: any) {
    if (err.message.includes('No templates')) {
      error(res, err.message, 'NOT_FOUND', 404);
    } else {
      error(res, 'Failed to apply template', 'INTERNAL_ERROR', 500);
    }
  }
});

// ============================================================
// Tax Categories (registered before /:id to avoid conflict)
// ============================================================

import * as taxService from '../services/tax-categories.service';

const createTaxCategorySchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(50).required(),
  rate: Joi.number().integer().min(0).max(10000).required(), // basis points
  is_default: Joi.boolean().default(false),
});

const updateTaxCategorySchema = Joi.object({
  name: Joi.string().min(1).max(50),
  rate: Joi.number().integer().min(0).max(10000),
  is_default: Joi.boolean(),
}).min(1);

// GET /api/v1/services/tax-categories
servicesRouter.get('/tax-categories', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const categories = await taxService.getTaxCategories(businessId);
    success(res, categories);
  } catch (err: any) {
    error(res, 'Failed to list tax categories', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/services/tax-categories
servicesRouter.post('/tax-categories', requirePermission('services:*'), validate(createTaxCategorySchema), async (req: Request, res: Response) => {
  try {
    const category = await taxService.createTaxCategory({
      businessId: req.body.business_id,
      name: req.body.name,
      rate: req.body.rate,
      isDefault: req.body.is_default,
    });
    success(res, category, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('duplicate key') || err.message.includes('unique')) {
      error(res, 'A tax category with this name already exists', 'DUPLICATE_NAME', 409);
    } else {
      error(res, 'Failed to create tax category', 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/services/tax-categories/:id
servicesRouter.put('/tax-categories/:id', requirePermission('services:*'), validate(updateTaxCategorySchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const category = await taxService.updateTaxCategory(req.params.id, businessId, {
      name: req.body.name,
      rate: req.body.rate,
      isDefault: req.body.is_default,
    });

    if (!category) { error(res, 'Tax category not found', 'NOT_FOUND', 404); return; }
    success(res, category);
  } catch (err: any) {
    error(res, 'Failed to update tax category', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Service CRUD
// ============================================================

import * as serviceService from '../services/service.service';

const createServiceSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  category_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(5000).allow('', null),
  short_description: Joi.string().max(500).allow('', null),
  booking_type: Joi.string().valid('individual', 'shared', 'group', 'resource').default('individual'),
  default_duration: Joi.number().integer().min(5).max(480).default(60),
  buffer_before: Joi.number().integer().min(0).max(120).default(0),
  buffer_after: Joi.number().integer().min(0).max(120).default(0),
  max_capacity: Joi.number().integer().min(1).max(500).default(1),
  min_advance_booking_hours: Joi.number().integer().min(0).default(2),
  max_advance_booking_days: Joi.number().integer().min(1).max(365).default(30),
  online_booking_enabled: Joi.boolean().default(true),
  preparation_notes: Joi.string().max(2000).allow('', null),
  display_order: Joi.number().integer().min(0).default(0),
  tax_category_id: Joi.string().uuid().allow(null),
  cancellation_policy_id: Joi.string().uuid().allow(null),
});

const updateServiceSchema = Joi.object({
  category_id: Joi.string().uuid(),
  name: Joi.string().min(1).max(200),
  description: Joi.string().max(5000).allow('', null),
  short_description: Joi.string().max(500).allow('', null),
  booking_type: Joi.string().valid('individual', 'shared', 'group', 'resource'),
  default_duration: Joi.number().integer().min(5).max(480),
  buffer_before: Joi.number().integer().min(0).max(120),
  buffer_after: Joi.number().integer().min(0).max(120),
  max_capacity: Joi.number().integer().min(1).max(500),
  min_advance_booking_hours: Joi.number().integer().min(0),
  max_advance_booking_days: Joi.number().integer().min(1).max(365),
  online_booking_enabled: Joi.boolean(),
  preparation_notes: Joi.string().max(2000).allow('', null),
  display_order: Joi.number().integer().min(0),
  tax_category_id: Joi.string().uuid().allow(null),
  cancellation_policy_id: Joi.string().uuid().allow(null),
}).min(1);

// POST /api/v1/services — Create service
servicesRouter.post('/', requirePermission('services:*'), validate(createServiceSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const service = await serviceService.createService({
      businessId: req.body.business_id,
      categoryId: req.body.category_id,
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.short_description,
      bookingType: req.body.booking_type,
      defaultDuration: req.body.default_duration,
      bufferBefore: req.body.buffer_before,
      bufferAfter: req.body.buffer_after,
      maxCapacity: req.body.max_capacity,
      minAdvanceBookingHours: req.body.min_advance_booking_hours,
      maxAdvanceBookingDays: req.body.max_advance_booking_days,
      onlineBookingEnabled: req.body.online_booking_enabled,
      preparationNotes: req.body.preparation_notes,
      displayOrder: req.body.display_order,
      taxCategoryId: req.body.tax_category_id,
      cancellationPolicyId: req.body.cancellation_policy_id,
      createdBy: authReq.user.sub,
      tenantId: authReq.tenantId,
    });
    success(res, service, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('already exists')) {
      error(res, err.message, 'DUPLICATE_NAME', 409);
    } else if (err.message.includes('not found')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to create service', 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/services — List services
servicesRouter.get('/', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await serviceService.getServices(businessId, {
      categoryId: req.query.category_id as string,
      status: req.query.status as string,
      bookingType: req.query.booking_type as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
      sort: req.query.sort as string,
      order: req.query.order as 'asc' | 'desc',
    });

    success(res, result.services, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    error(res, 'Failed to list services', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/services/:id — Get service detail
servicesRouter.get('/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const service = await serviceService.getServiceById(req.params.id, businessId);
    if (!service) { error(res, 'Service not found', 'NOT_FOUND', 404); return; }
    success(res, service);
  } catch (err: any) {
    error(res, 'Failed to get service', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/services/:id — Update service
servicesRouter.put('/:id', requirePermission('services:*'), validate(updateServiceSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const service = await serviceService.updateService(req.params.id, businessId, req.body, authReq.user.sub, authReq.tenantId);
    if (!service) { error(res, 'Service not found', 'NOT_FOUND', 404); return; }
    success(res, service);
  } catch (err: any) {
    if (err.message.includes('capacity')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to update service', 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/services/:id/archive — Archive service
servicesRouter.put('/:id/archive', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const archived = await serviceService.archiveService(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!archived) { error(res, 'Service not found', 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) {
    error(res, 'Failed to archive service', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/services/:id/restore — Restore archived service
servicesRouter.put('/:id/restore', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const restored = await serviceService.restoreService(req.params.id, businessId);
    if (!restored) { error(res, 'Service not found or not archived', 'NOT_FOUND', 404); return; }
    success(res, { restored: true });
  } catch (err: any) {
    error(res, 'Failed to restore service', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/services/:id/pause — Pause service
servicesRouter.put('/:id/pause', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const paused = await serviceService.pauseService(req.params.id, businessId);
    if (!paused) { error(res, 'Service not found or not active', 'NOT_FOUND', 404); return; }
    success(res, { paused: true });
  } catch (err: any) {
    error(res, 'Failed to pause service', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/services/:id/activate — Activate service
servicesRouter.put('/:id/activate', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const activated = await serviceService.activateService(req.params.id, businessId);
    if (!activated) { error(res, 'Service not found or already active', 'NOT_FOUND', 404); return; }
    success(res, { activated: true });
  } catch (err: any) {
    if (err.message.includes('variant')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to activate service', 'INTERNAL_ERROR', 500);
    }
  }
});


// ============================================================
// Service Variants
// ============================================================

import * as variantsService from '../services/service-variants.service';

const createVariantSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  duration: Joi.number().integer().min(1).max(480).required(),
  price: Joi.number().integer().min(0).required(),
  pricing_model: Joi.string().valid('per_session', 'subscription').default('per_session'),
  billing_interval: Joi.string().valid('weekly', 'biweekly', 'monthly', 'quarterly', 'annually').allow(null),
  included_sessions: Joi.number().integer().min(1).allow(null),
  sessions_rollover: Joi.boolean().default(false),
  capacity_override: Joi.number().integer().min(1).allow(null),
  display_order: Joi.number().integer().min(0).default(0),
});

const updateVariantSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  duration: Joi.number().integer().min(1).max(480),
  price: Joi.number().integer().min(0),
  pricing_model: Joi.string().valid('per_session', 'subscription'),
  billing_interval: Joi.string().valid('weekly', 'biweekly', 'monthly', 'quarterly', 'annually').allow(null),
  included_sessions: Joi.number().integer().min(1).allow(null),
  sessions_rollover: Joi.boolean(),
  capacity_override: Joi.number().integer().min(1).allow(null),
  display_order: Joi.number().integer().min(0),
  status: Joi.string().valid('active', 'inactive'),
}).min(1);

// GET /api/v1/services/:id/variants — List variants
servicesRouter.get('/:id/variants', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const variants = await variantsService.getVariants(req.params.id);
    success(res, variants);
  } catch (err: any) {
    error(res, 'Failed to list variants', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/services/:id/variants — Create variant
servicesRouter.post('/:id/variants', requirePermission('services:*'), validate(createVariantSchema), async (req: Request, res: Response) => {
  try {
    const variant = await variantsService.createVariant({
      serviceId: req.params.id,
      name: req.body.name,
      duration: req.body.duration,
      price: req.body.price,
      pricingModel: req.body.pricing_model,
      billingInterval: req.body.billing_interval,
      includedSessions: req.body.included_sessions,
      sessionsRollover: req.body.sessions_rollover,
      capacityOverride: req.body.capacity_override,
      displayOrder: req.body.display_order,
    });
    success(res, variant, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('billing interval')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to create variant', 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/services/:id/variants/:variantId — Update variant
servicesRouter.put('/:id/variants/:variantId', requirePermission('services:*'), validate(updateVariantSchema), async (req: Request, res: Response) => {
  try {
    const variant = await variantsService.updateVariant(req.params.variantId, req.params.id, {
      name: req.body.name,
      duration: req.body.duration,
      price: req.body.price,
      pricingModel: req.body.pricing_model,
      billingInterval: req.body.billing_interval,
      includedSessions: req.body.included_sessions,
      sessionsRollover: req.body.sessions_rollover,
      capacityOverride: req.body.capacity_override,
      displayOrder: req.body.display_order,
      status: req.body.status,
    });

    if (!variant) { error(res, 'Variant not found', 'NOT_FOUND', 404); return; }
    success(res, variant);
  } catch (err: any) {
    if (err.message.includes('billing interval')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to update variant', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/services/:id/variants/:variantId — Delete variant
servicesRouter.delete('/:id/variants/:variantId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const result = await variantsService.deleteVariant(req.params.variantId, req.params.id);
    if (!result.deleted) {
      if (result.error) {
        error(res, result.error, 'VALIDATION_ERROR', 400);
      } else {
        error(res, 'Variant not found', 'NOT_FOUND', 404);
      }
      return;
    }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete variant', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// Service Images
// ============================================================

import multer from 'multer';
import * as imagesService from '../services/service-images.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const updateImageSchema = Joi.object({
  alt_text: Joi.string().max(500).allow('', null),
  display_order: Joi.number().integer().min(0),
  is_primary: Joi.boolean(),
}).min(1);

// GET /api/v1/services/:id/images — List images
servicesRouter.get('/:id/images', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const images = await imagesService.getImages(req.params.id);
    success(res, images);
  } catch (err: any) {
    error(res, 'Failed to list images', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/services/:id/images — Upload image
servicesRouter.post('/:id/images', requirePermission('services:*'), upload.single('image'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    if (!req.file) { error(res, 'No image file provided', 'VALIDATION_ERROR', 400); return; }

    const image = await imagesService.uploadImage(
      req.params.id,
      businessId,
      authReq.tenantId,
      req.file,
      req.body.alt_text,
    );

    success(res, image, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('Maximum') || err.message.includes('Invalid') || err.message.includes('too large') || err.message.includes('too small') || err.message.includes('dimensions')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to upload image', 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/services/:id/images/:imageId — Update image metadata
servicesRouter.put('/:id/images/:imageId', requirePermission('services:*'), validate(updateImageSchema), async (req: Request, res: Response) => {
  try {
    const image = await imagesService.updateImage(req.params.imageId, req.params.id, req.body);
    if (!image) { error(res, 'Image not found', 'NOT_FOUND', 404); return; }
    success(res, image);
  } catch (err: any) {
    error(res, 'Failed to update image', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/services/:id/images/:imageId — Delete image
servicesRouter.delete('/:id/images/:imageId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await imagesService.deleteImage(req.params.imageId, req.params.id);
    if (!deleted) { error(res, 'Image not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete image', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// Staff Assignment
// ============================================================

import * as staffService from '../services/service-staff.service';

const assignStaffSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().allow(null),
  is_primary: Joi.boolean().default(false),
});

// GET /api/v1/services/:id/staff — List assigned staff
servicesRouter.get('/:id/staff', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const staff = await staffService.getStaff(req.params.id);
    success(res, staff);
  } catch (err: any) {
    error(res, 'Failed to list staff', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/services/:id/staff — Assign staff
servicesRouter.post('/:id/staff', requirePermission('services:*'), validate(assignStaffSchema), async (req: Request, res: Response) => {
  try {
    const assignment = await staffService.assignStaff({
      serviceId: req.params.id,
      userId: req.body.user_id,
      variantId: req.body.variant_id,
      isPrimary: req.body.is_primary,
    });
    success(res, assignment, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('already assigned')) {
      error(res, err.message, 'DUPLICATE', 409);
    } else {
      error(res, 'Failed to assign staff', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/services/:id/staff/:userId — Remove staff assignment
servicesRouter.delete('/:id/staff/:userId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const variantId = req.query.variant_id as string | undefined;
    const removed = await staffService.removeStaff(req.params.id, req.params.userId, variantId || null);
    if (!removed) { error(res, 'Assignment not found', 'NOT_FOUND', 404); return; }
    success(res, { removed: true });
  } catch (err: any) {
    error(res, 'Failed to remove staff', 'INTERNAL_ERROR', 500);
  }
});


// (Cancellation Policies routes registered above, before /:id)

// ============================================================
// Availability Rules
// ============================================================

import * as availabilityService from '../services/service-availability.service';

const createAvailabilitySchema = Joi.object({
  rule_type: Joi.string().valid('recurring', 'seasonal', 'block').required(),
  days_of_week: Joi.array().items(Joi.number().integer().min(0).max(6)).allow(null),
  start_time: Joi.string().pattern(/^\d{2}:\d{2}$/).allow(null),
  end_time: Joi.string().pattern(/^\d{2}:\d{2}$/).allow(null),
  effective_from: Joi.string().isoDate().allow(null),
  effective_to: Joi.string().isoDate().allow(null),
  blocked_dates: Joi.array().items(Joi.string().isoDate()).allow(null),
  description: Joi.string().max(200).allow('', null),
});

// GET /api/v1/services/:id/availability
servicesRouter.get('/:id/availability', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const rules = await availabilityService.getRules(req.params.id);
    success(res, rules);
  } catch (err: any) {
    error(res, 'Failed to list availability rules', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/services/:id/availability
servicesRouter.post('/:id/availability', requirePermission('services:*'), validate(createAvailabilitySchema), async (req: Request, res: Response) => {
  try {
    const rule = await availabilityService.createRule({
      serviceId: req.params.id,
      ruleType: req.body.rule_type,
      daysOfWeek: req.body.days_of_week,
      startTime: req.body.start_time,
      endTime: req.body.end_time,
      effectiveFrom: req.body.effective_from,
      effectiveTo: req.body.effective_to,
      blockedDates: req.body.blocked_dates,
      description: req.body.description,
    });
    success(res, rule, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('require')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to create rule', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/services/:id/availability/:ruleId
servicesRouter.delete('/:id/availability/:ruleId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await availabilityService.deleteRule(req.params.ruleId, req.params.id);
    if (!deleted) { error(res, 'Rule not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete rule', 'INTERNAL_ERROR', 500);
  }
});


// (Templates routes registered in pre-/:id section above)
