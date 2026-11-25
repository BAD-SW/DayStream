import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext, recordScopeIn } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as merchandiseService from '../services/merchandise.service';
import * as merchandiseImages from '../services/merchandise-images.service';
import { msg, isMessage, messageHas } from '../i18n';

export const merchandiseRouter = Router();

// Records on these routes are addressed by id alone: each must belong to a business the caller
// can reach, or it does not exist for them. (They were readable, and some changeable, from any
// other organisation.)
merchandiseRouter.param('id', recordScopeIn(['prd_merchandise'], 'Product'));

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
  // retail inventory (spec 51, gap 7)
  track_stock: Joi.boolean(),
  cost_cents: Joi.number().integer().min(0).allow(null),
  barcode: Joi.string().max(64).allow('', null),
  supplier_id: Joi.string().uuid().allow(null, ''),
}).min(1);

// GET /api/v1/merchandise — List merchandise
merchandiseRouter.get('/', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

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
    console.error('Failed to list merchandise', err?.message || err);
    error(res, msg('errors:merchandise.failedToListMerchandise'), 'INTERNAL_ERROR', 500);
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
    if (err.message?.includes('duplicate key') || messageHas(err.message, 'unique')) {
      error(res, msg('errors:merchandise.aProductWithThisSkuAlready'), 'DUPLICATE_SKU', 409);
    } else {
      error(res, msg('errors:merchandise.failedToCreateMerchandise'), 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/merchandise/:id — Get merchandise detail
merchandiseRouter.get('/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

    const item = await merchandiseService.getMerchandiseById(req.params.id, businessId);
    if (!item) { error(res, msg('errors:merchandise.productNotFound'), 'NOT_FOUND', 404); return; }
    success(res, item);
  } catch (err: any) {
    console.error('Failed to get merchandise', err?.message || err);
    error(res, msg('errors:merchandise.failedToGetMerchandise'), 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id — Update merchandise
merchandiseRouter.put('/:id', requirePermission('services:*'), validate(updateMerchandiseSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

    // A supplier must be one of this business's vendors; an empty value clears it.
    const body = { ...req.body };
    if (body.supplier_id === '') body.supplier_id = null;
    if (body.barcode === '') body.barcode = null;
    if (body.supplier_id) {
      const { adminPool } = await import('../db/pool');
      const { rows } = await adminPool.query('SELECT 1 FROM fin_vendors WHERE id = $1 AND business_id = $2', [body.supplier_id, businessId]);
      if (!rows[0]) { error(res, msg('errors:merchandise.chooseOneOfThisBusinessS'), 'VALIDATION_ERROR', 400); return; }
    }
    const item = await merchandiseService.updateMerchandise(req.params.id, businessId, body);
    if (!item) { error(res, msg('errors:merchandise.productNotFound'), 'NOT_FOUND', 404); return; }
    success(res, item);
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || messageHas(err.message, 'unique')) {
      error(res, msg('errors:merchandise.aProductWithThisSkuAlready'), 'DUPLICATE_SKU', 409);
    } else {
      error(res, msg('errors:merchandise.failedToUpdateMerchandise'), 'INTERNAL_ERROR', 500);
    }
  }
});

// PUT /api/v1/merchandise/:id/archive — Archive merchandise
merchandiseRouter.put('/:id/archive', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

    const archived = await merchandiseService.archiveMerchandise(req.params.id, businessId);
    if (!archived) { error(res, msg('errors:merchandise.productNotFound'), 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) {
    console.error('Failed to archive merchandise', err?.message || err);
    error(res, msg('errors:merchandise.failedToArchiveMerchandise'), 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id/pause — Pause merchandise
merchandiseRouter.put('/:id/pause', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

    const paused = await merchandiseService.pauseMerchandise(req.params.id, businessId);
    if (!paused) { error(res, msg('errors:merchandise.productNotFoundOrNotActive'), 'NOT_FOUND', 404); return; }
    success(res, { paused: true });
  } catch (err: any) {
    console.error('Failed to pause merchandise', err?.message || err);
    error(res, msg('errors:merchandise.failedToPauseMerchandise'), 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id/activate — Activate merchandise
merchandiseRouter.put('/:id/activate', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

    const activated = await merchandiseService.activateMerchandise(req.params.id, businessId);
    if (!activated) { error(res, msg('errors:merchandise.productNotFoundOrAlreadyActive'), 'NOT_FOUND', 404); return; }
    success(res, { activated: true });
  } catch (err: any) {
    console.error('Failed to activate merchandise', err?.message || err);
    error(res, msg('errors:merchandise.failedToActivateMerchandise'), 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/merchandise/:id/restore — Restore archived merchandise
merchandiseRouter.put('/:id/restore', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

    const restored = await merchandiseService.restoreMerchandise(req.params.id, businessId);
    if (!restored) { error(res, msg('errors:merchandise.productNotFoundOrNotArchived'), 'NOT_FOUND', 404); return; }
    success(res, { restored: true });
  } catch (err: any) {
    console.error('Failed to restore merchandise', err?.message || err);
    error(res, msg('errors:merchandise.failedToRestoreMerchandise'), 'INTERNAL_ERROR', 500);
  }
});

// --- Merchandise Variants ---

const createVariantSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  sku: Joi.string().max(50).allow('', null),
  price: Joi.number().integer().min(0).required(),
  display_order: Joi.number().integer().min(0).default(0),
  cost_cents: Joi.number().integer().min(0).allow(null),
  barcode: Joi.string().max(64).allow('', null),
});

const updateVariantSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  sku: Joi.string().max(50).allow('', null),
  price: Joi.number().integer().min(0),
  status: Joi.string().valid('active', 'inactive'),
  display_order: Joi.number().integer().min(0),
  cost_cents: Joi.number().integer().min(0).allow(null),
  barcode: Joi.string().max(64).allow('', null),
}).min(1);

// GET /api/v1/merchandise/:id/variants
merchandiseRouter.get('/:id/variants', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const variants = await merchandiseService.getVariants(req.params.id);
    success(res, variants);
  } catch (err: any) {
    console.error('Failed to get variants', err?.message || err);
    error(res, msg('errors:merchandise.failedToGetVariants'), 'INTERNAL_ERROR', 500);
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
      costCents: req.body.cost_cents,
      barcode: req.body.barcode,
    });
    success(res, variant, undefined, 201);
  } catch (err: any) {
    console.error('Failed to create variant', err?.message || err);
    error(res, msg('errors:merchandise.failedToCreateVariant'), 'INTERNAL_ERROR', 500);
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
      costCents: req.body.cost_cents,
      barcode: req.body.barcode,
    });
    if (!variant) { error(res, msg('errors:merchandise.variantNotFound'), 'NOT_FOUND', 404); return; }
    success(res, variant);
  } catch (err: any) {
    console.error('Failed to update variant', err?.message || err);
    error(res, msg('errors:merchandise.failedToUpdateVariant'), 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/merchandise/:id/variants/:variantId
merchandiseRouter.delete('/:id/variants/:variantId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await merchandiseService.deleteVariant(req.params.variantId);
    if (!deleted) { error(res, msg('errors:merchandise.variantNotFound'), 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    console.error('Failed to delete variant', err?.message || err);
    error(res, msg('errors:merchandise.failedToDeleteVariant'), 'INTERNAL_ERROR', 500);
  }
});


// --- Product Image ---

// POST /api/v1/merchandise/:id/image — Upload/replace product image
merchandiseRouter.post('/:id/image', requirePermission('services:*'), imageUpload.single('image'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    if (!req.file) { error(res, msg('errors:merchandise.noImageFileProvided'), 'VALIDATION_ERROR', 400); return; }

    const imagePath = await merchandiseImages.uploadImage(req.params.id, businessId, req.file);
    const urls = merchandiseImages.getImageUrls(imagePath);
    success(res, { image_url: imagePath, urls }, undefined, 201);
  } catch (err: any) {
    if ((isMessage(err.message, 'errors:invalid_credentials', 'errors:middleware.invalidToken', 'errors:widgetCors.invalidOrMissingBusinessId', 'errors:clock.invalidEmailOrPin', 'errors:paymentPlatform.invalidWebhookSignature', 'errors:users.invalidPaginationParams', 'errors:auth.invalidCredentials', 'errors:auth.invalidOrExpiredRefreshToken', 'errors:integrationOauth.invalidOrExpiredOauthState', 'errors:merchandiseImages.invalidFormatAcceptedJpegPngWebp', 'errors:mockAdapter.invalidWebhookSignature', 'errors:voucher.invalidDiscountType') || err.message.includes('Invalid')) || (isMessage(err.message, 'errors:customerProfile.theFileIsTooLarge', 'errors:merchandiseImages.fileTooLargeMaximum5mb') || err.message.includes('too large'))) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, msg('errors:merchandise.failedToUploadImage'), 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/merchandise/:id/image — Delete product image
merchandiseRouter.delete('/:id/image', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:merchandise.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

    const deleted = await merchandiseImages.deleteImage(req.params.id, businessId);
    if (!deleted) { error(res, msg('errors:merchandise.noImageToDelete'), 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    console.error('Failed to delete image', err?.message || err);
    error(res, msg('errors:merchandise.failedToDeleteImage'), 'INTERNAL_ERROR', 500);
  }
});
