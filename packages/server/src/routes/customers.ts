import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as customerService from '../services/customer.service';

export const customersRouter = Router();

// All customer routes require auth + tenant context + customers permission
customersRouter.use(authenticate);
customersRouter.use(tenantContext);

// --- Validation schemas ---

const createCustomerSchema = Joi.object({
  email: Joi.string().email({ tlds: false }).required(),
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required(),
  phone: Joi.string().max(50).allow('', null),
  date_of_birth: Joi.string().isoDate().allow(null),
  gender: Joi.string().max(20).allow('', null),
  preferred_language: Joi.string().max(5).default('en'),
  country: Joi.string().max(100).allow('', null),
  business_id: Joi.string().uuid().required(),
});

const updateCustomerSchema = Joi.object({
  email: Joi.string().email({ tlds: false }),
  first_name: Joi.string().min(1).max(100),
  last_name: Joi.string().min(1).max(100),
  phone: Joi.string().max(50).allow('', null),
  date_of_birth: Joi.string().isoDate().allow(null),
  gender: Joi.string().max(20).allow('', null),
  preferred_language: Joi.string().max(5),
  country: Joi.string().max(100).allow('', null),
  avatar_url: Joi.string().uri().allow('', null),
}).min(1);

// --- Routes ---

// POST /api/v1/customers — Create customer
customersRouter.post('/', requirePermission('customers:*'), validate(createCustomerSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await customerService.createCustomer({
      businessId: req.body.business_id,
      tenantId: authReq.tenantId,
      email: req.body.email,
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      phone: req.body.phone,
      dateOfBirth: req.body.date_of_birth,
      gender: req.body.gender,
      preferredLanguage: req.body.preferred_language,
      country: req.body.country,
      createdBy: authReq.user.sub,
    });

    if (result.duplicate) {
      res.status(409).json({
        error: 'A customer with this email already exists in this business',
        code: 'DUPLICATE_EMAIL',
        details: { existing_id: result.existingId },
      });
      return;
    }

    success(res, result.customer, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create customer', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers — List/search customers
customersRouter.get('/', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const result = await customerService.getCustomers(businessId, {
      search: req.query.search as string,
      lifecycle_stage: req.query.lifecycle_stage as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
      sort: req.query.sort as string,
      order: req.query.order as 'asc' | 'desc',
    });

    success(res, result.customers, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    error(res, 'Failed to list customers', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/:id — Get customer detail
customersRouter.get('/:id', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const customer = await customerService.getCustomerById(req.params.id, businessId);
    if (!customer) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, customer);
  } catch (err: any) {
    error(res, 'Failed to get customer', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/:id — Update customer
customersRouter.put('/:id', requirePermission('customers:*'), validate(updateCustomerSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const customer = await customerService.updateCustomer(req.params.id, businessId, req.body, authReq.user.sub);
    if (!customer) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, customer);
  } catch (err: any) {
    error(res, 'Failed to update customer', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/:id/archive — Archive customer
customersRouter.put('/:id/archive', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const result = await customerService.archiveCustomer(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, result);
  } catch (err: any) {
    error(res, 'Failed to archive customer', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/:id/anonymize — GDPR anonymization
customersRouter.post('/:id/anonymize', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) {
      error(res, 'business_id query parameter is required', 'VALIDATION_ERROR', 400);
      return;
    }

    const result = await customerService.anonymizeCustomer(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result) {
      error(res, 'Customer not found', 'NOT_FOUND', 404);
      return;
    }

    success(res, result);
  } catch (err: any) {
    error(res, 'Failed to anonymize customer', 'INTERNAL_ERROR', 500);
  }
});

// --- Notes ---
import * as notesService from '../services/customer-notes.service';

const createNoteSchema = Joi.object({
  category: Joi.string().min(1).max(50).required(),
  content: Joi.string().min(1).required(),
  is_sensitive: Joi.boolean().default(false),
});

const createCategorySchema = Joi.object({
  name: Joi.string().min(1).max(50).required(),
  is_sensitive: Joi.boolean().default(false),
  customer_visible: Joi.boolean().default(false),
});

// POST /api/v1/customers/:id/notes — Add note
customersRouter.post('/:id/notes', requirePermission('customers:*'), validate(createNoteSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const note = await notesService.createNote({
      customerId: req.params.id,
      businessId,
      tenantId: authReq.tenantId,
      category: req.body.category,
      content: req.body.content,
      isSensitive: req.body.is_sensitive,
      createdBy: authReq.user.sub,
    });

    success(res, note, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('does not exist')) {
      error(res, err.message, 'INVALID_CATEGORY', 400);
    } else {
      error(res, 'Failed to create note', 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/customers/:id/notes — List notes
customersRouter.get('/:id/notes', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const notes = await notesService.getNotes(
      req.params.id, businessId, authReq.tenantId, authReq.user.sub, authReq.user.role,
    );

    success(res, notes);
  } catch (err: any) {
    error(res, 'Failed to get notes', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/customers/note-categories — List categories for business
customersRouter.get('/note-categories/list', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const categories = await notesService.getCategories(businessId);
    success(res, categories);
  } catch (err: any) {
    error(res, 'Failed to get categories', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/note-categories — Create category
customersRouter.post('/note-categories', requirePermission('settings:*'), validate(createCategorySchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const category = await notesService.createCategory(
      businessId, req.body.name, req.body.is_sensitive, req.body.customer_visible,
    );

    success(res, category, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create category', 'INTERNAL_ERROR', 500);
  }
});

// --- Tags ---
import * as tagsService from '../services/customer-tags.service';

const createTagSchema = Joi.object({
  name: Joi.string().min(1).max(50).required(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#8A8A8A'),
});

const updateTagSchema = Joi.object({
  name: Joi.string().min(1).max(50),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),
}).min(1);

const assignTagSchema = Joi.object({
  tag_id: Joi.string().uuid().required(),
});

// GET /api/v1/customers/tags — List business tags
customersRouter.get('/tags/list', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const tags = await tagsService.getTags(businessId);
    success(res, tags);
  } catch (err: any) {
    error(res, 'Failed to get tags', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/tags — Create tag
customersRouter.post('/tags', requirePermission('customers:*'), validate(createTagSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const tag = await tagsService.createTag(businessId, req.body.name, req.body.color);
    success(res, tag, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create tag', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/customers/tags/:tagId — Update tag
customersRouter.put('/tags/:tagId', requirePermission('customers:*'), validate(updateTagSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const tag = await tagsService.updateTag(req.params.tagId, businessId, req.body);
    if (!tag) { error(res, 'Tag not found', 'NOT_FOUND', 404); return; }
    success(res, tag);
  } catch (err: any) {
    error(res, 'Failed to update tag', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/customers/tags/:tagId — Delete tag
customersRouter.delete('/tags/:tagId', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const deleted = await tagsService.deleteTag(req.params.tagId, businessId);
    if (!deleted) { error(res, 'Tag not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete tag', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/customers/:id/tags — Assign tag to customer
customersRouter.post('/:id/tags', requirePermission('customers:*'), validate(assignTagSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await tagsService.assignTag(req.params.id, req.body.tag_id, authReq.user.sub);

    // Log in timeline
    const businessId = req.query.business_id as string;
    if (businessId) {
      await adminPool.query(
        `INSERT INTO customer_activities (customer_id, business_id, activity_type, description, metadata, created_by)
         VALUES ($1, $2, 'profile_change', 'Tag assigned', $3, $4)`,
        [req.params.id, businessId, JSON.stringify({ tag_id: req.body.tag_id }), authReq.user.sub],
      );
    }

    success(res, { assigned: true }, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to assign tag', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/customers/:id/tags/:tagId — Remove tag from customer
customersRouter.delete('/:id/tags/:tagId', requirePermission('customers:*'), async (req: Request, res: Response) => {
  try {
    await tagsService.removeTag(req.params.id, req.params.tagId);
    success(res, { removed: true });
  } catch (err: any) {
    error(res, 'Failed to remove tag', 'INTERNAL_ERROR', 500);
  }
});

// --- Activity Timeline ---
import * as activityService from '../services/customer-activity.service';

// GET /api/v1/customers/:id/activities — Get timeline
customersRouter.get('/:id/activities', requirePermission('customers:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await activityService.getActivities({
      customerId: req.params.id,
      businessId,
      activityType: req.query.activity_type as string,
      startDate: req.query.start_date as string,
      endDate: req.query.end_date as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });

    success(res, result.activities, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    error(res, 'Failed to get activities', 'INTERNAL_ERROR', 500);
  }
});
