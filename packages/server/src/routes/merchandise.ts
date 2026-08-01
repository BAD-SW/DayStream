import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as merchandiseService from '../services/merchandise.service';
import * as merchandiseImages from '../services/merchandise-images.service';

export const merchandiseRouter = Router();

merchandiseRouter.use(authenticate);
merchandiseRouter.use(tenantContext);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Validation schemas
const createMerchandiseSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  category_id: Joi.string().uuid().allow(null),
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(5000).allow('', null),
  short_description: Joi.string().max(500).allow('', null),
  sku: Joi.string().max(50).allow('', null),
  price: Joi.number().integer().min(0).required(),
  image_url: Joi.string().uri().allow('', null),
  display_order: Joi.number().integer().min(0).default(0),
  tax_category_id: Joi.string().uuid().allow(null),
  is_taxable: Joi.boolean().default(false),
});

const updateMerchandiseSchema = Joi.object({
  category_id: Joi.string().uuid().allow(null, ''),
  name: Joi.string().min(1).max(200),
  description: Joi.string().max(5000).allow('', null),
  short_description: Joi.string().max(500).allow('', null),
  sku: Joi.string().max(50).allow('', null),
  price: Joi.number().integer().min(0),
  status: Joi.string().valid('active', 'inactive', 'archived'),
  image_url: Joi.string().uri().allow('', null),
  display_order: Joi.number().integer().min(0),
  tax_category_id: Joi.string().uuid().allow(null, ''),
  is_taxable: Joi.boolean(),
}).min(1);

// GET /api/v1/merchandise — List merchandise
merchandiseRouter.get('/', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await merchandiseService.getMerchandise({
      businessId,
      categoryId: req.query.category_id as string,
      status: req.query.status as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });

    success(res, result.items, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    error(res, 'Failed to list merchandise', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/merchandise — Create merchandise
merchandiseRouter.post('/', requirePermission('services:*'), validate(createMerchandiseSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const item = await merchandiseService.createMerchandise({
      businessId: req.body.business_id,
      categoryId: req.body.category_id,
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.short_description,
      sku: req.body.sku,
      price: req.body.price,
      imageUrl: req.body.image_url,
      displayOrder: req.body.display_order,
      taxCategoryId: req.body.tax_category_id,
      isTaxable: req.body.is_taxable,
      createdBy: authReq.user.sub,
    });
    success(res, item, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.message?.includes('unique')) {
      error(res, 'A product with this SKU already exists', 'DUPLICATE_SKU', 409);
    } else {
      error(res, 'Failed to create merchandise', 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/merchandise/:id — Get merchandise detail
merchandiseRouter.get('/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const item = await merchandiseService.getMerchandiseById(req.params.id, businessId);
    if (!item) { error(res, 'Product not found', 'NOT_FOUND', 404); return; }
    success(res, item);
  } catch (err: any) {
    error(res, 'Failed to get merchandise', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id — Update merchandise
merchandiseRouter.put('/:id', requirePermission('services:*'), validate(updateMerchandiseSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const item = await merchandiseService.updateMerchandise(req.params.id, businessId, req.body);
    if (!item) { error(res, 'Product not found', 'NOT_FOUND', 404); return; }
    success(res, item);
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.message?.includes('unique')) {
      error(res, 'A product with this SKU already exists', 'DUPLICATE_SKU', 409);
    } else {
      error(res, 'Failed to update merchandise', 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/merchandise/:id/archive — Archive merchandise
merchandiseRouter.put('/:id/archive', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const archived = await merchandiseService.archiveMerchandise(req.params.id, businessId);
    if (!archived) { error(res, 'Product not found', 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) {
    error(res, 'Failed to archive merchandise', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id/pause — Pause merchandise
merchandiseRouter.put('/:id/pause', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const paused = await merchandiseService.pauseMerchandise(req.params.id, businessId);
    if (!paused) { error(res, 'Product not found or not active', 'NOT_FOUND', 404); return; }
    success(res, { paused: true });
  } catch (err: any) {
    error(res, 'Failed to pause merchandise', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id/activate — Activate merchandise
merchandiseRouter.put('/:id/activate', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const activated = await merchandiseService.activateMerchandise(req.params.id, businessId);
    if (!activated) { error(res, 'Product not found or already active', 'NOT_FOUND', 404); return; }
    success(res, { activated: true });
  } catch (err: any) {
    error(res, 'Failed to activate merchandise', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id/restore — Restore archived merchandise
merchandiseRouter.put('/:id/restore', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const restored = await merchandiseService.restoreMerchandise(req.params.id, businessId);
    if (!restored) { error(res, 'Product not found or not archived', 'NOT_FOUND', 404); return; }
    success(res, { restored: true });
  } catch (err: any) {
    error(res, 'Failed to restore merchandise', 'INTERNAL_ERROR', 500);
  }
});

// --- Merchandise Variants ---

const createVariantSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  sku: Joi.string().max(50).allow('', null),
  price: Joi.number().integer().min(0).required(),
  display_order: Joi.number().integer().min(0).default(0),
});

const updateVariantSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  sku: Joi.string().max(50).allow('', null),
  price: Joi.number().integer().min(0),
  status: Joi.string().valid('active', 'inactive'),
  display_order: Joi.number().integer().min(0),
}).min(1);

// GET /api/v1/merchandise/:id/variants
merchandiseRouter.get('/:id/variants', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const variants = await merchandiseService.getVariants(req.params.id);
    success(res, variants);
  } catch (err: any) {
    error(res, 'Failed to get variants', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/merchandise/:id/variants
merchandiseRouter.post('/:id/variants', requirePermission('services:*'), validate(createVariantSchema), async (req: Request, res: Response) => {
  try {
    const variant = await merchandiseService.createVariant(req.params.id, {
      name: req.body.name,
      sku: req.body.sku,
      price: req.body.price,
      displayOrder: req.body.display_order,
    });
    success(res, variant, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create variant', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id/variants/:variantId
merchandiseRouter.put('/:id/variants/:variantId', requirePermission('services:*'), validate(updateVariantSchema), async (req: Request, res: Response) => {
  try {
    const variant = await merchandiseService.updateVariant(req.params.variantId, {
      name: req.body.name,
      sku: req.body.sku,
      price: req.body.price,
      status: req.body.status,
      displayOrder: req.body.display_order,
    });
    if (!variant) { error(res, 'Variant not found', 'NOT_FOUND', 404); return; }
    success(res, variant);
  } catch (err: any) {
    error(res, 'Failed to update variant', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/merchandise/:id/variants/:variantId
merchandiseRouter.delete('/:id/variants/:variantId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await merchandiseService.deleteVariant(req.params.variantId);
    if (!deleted) { error(res, 'Variant not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete variant', 'INTERNAL_ERROR', 500);
  }
});


// --- Product Image ---

// POST /api/v1/merchandise/:id/image — Upload/replace product image
merchandiseRouter.post('/:id/image', requirePermission('services:*'), imageUpload.single('image'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!req.file) { error(res, 'No image file provided', 'VALIDATION_ERROR', 400); return; }

    const imagePath = await merchandiseImages.uploadImage(req.params.id, businessId, req.file);
    const urls = merchandiseImages.getImageUrls(imagePath);
    success(res, { image_url: imagePath, urls }, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('Invalid') || err.message.includes('too large')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to upload image', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/merchandise/:id/image — Delete product image
merchandiseRouter.delete('/:id/image', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const deleted = await merchandiseImages.deleteImage(req.params.id, businessId);
    if (!deleted) { error(res, 'No image to delete', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete image', 'INTERNAL_ERROR', 500);
  }
});
