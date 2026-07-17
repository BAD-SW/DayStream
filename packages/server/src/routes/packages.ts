import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import * as packageService from '../services/package.service';

export const packagesRouter = Router();

packagesRouter.use(authenticate);
packagesRouter.use(tenantContext);

// GET /api/v1/packages
packagesRouter.get('/', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await packageService.getPackages({
      businessId,
      status: req.query.status as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.packages, { total: result.total, page: result.page, limit: result.limit });
  } catch (err: any) { error(res, 'Failed to list packages', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/packages
packagesRouter.post('/', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const pkg = await packageService.createPackage({
      businessId: req.body.business_id,
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.short_description,
      price: req.body.price,
      expirationType: req.body.expiration_type,
      expirationDays: req.body.expiration_days,
      displayOrder: req.body.display_order,
      isTaxable: req.body.is_taxable,
      taxCategoryId: req.body.tax_category_id,
    });
    success(res, pkg, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create package', 'INTERNAL_ERROR', 500); }
});

// --- Package Purchases (registered before /:id to avoid route conflict) ---

// GET /api/v1/packages/purchases/customer/:customerId
packagesRouter.get('/purchases/customer/:customerId', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const purchases = await packageService.getCustomerPurchases(req.params.customerId, businessId);
    success(res, purchases);
  } catch (err: any) { error(res, 'Failed to get purchases', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/packages/purchases/:purchaseId/status
packagesRouter.get('/purchases/:purchaseId/status', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const status = await packageService.getPurchaseStatus(req.params.purchaseId);
    success(res, status);
  } catch (err: any) { error(res, 'Failed to get purchase status', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/packages/purchases/:purchaseId/balance/:itemId
packagesRouter.get('/purchases/:purchaseId/balance/:itemId', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const balance = await packageService.getRemainingBalance(req.params.purchaseId, req.params.itemId);
    success(res, balance);
  } catch (err: any) { error(res, 'Failed to get balance', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/packages/purchases/:purchaseId/redeem
packagesRouter.post('/purchases/:purchaseId/redeem', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    if (!req.body.package_item_id) { error(res, 'package_item_id required', 'VALIDATION_ERROR', 400); return; }

    const redemption = await packageService.redeemPackageItem({
      purchaseId: req.params.purchaseId,
      packageItemId: req.body.package_item_id,
      quantityRedeemed: req.body.quantity_redeemed,
      minutesRedeemed: req.body.minutes_redeemed,
      bookingId: req.body.booking_id,
      notes: req.body.notes,
    });
    success(res, redemption, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('Insufficient') || err.message.includes('expired') || err.message.includes('not found') || err.message.includes('inactive')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else { error(res, 'Failed to redeem', 'INTERNAL_ERROR', 500); }
  }
});

// GET /api/v1/packages/:id
packagesRouter.get('/:id', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const pkg = await packageService.getPackageById(req.params.id, businessId);
    if (!pkg) { error(res, 'Package not found', 'NOT_FOUND', 404); return; }
    success(res, pkg);
  } catch (err: any) { error(res, 'Failed to get package', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/packages/:id
packagesRouter.put('/:id', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const pkg = await packageService.updatePackage(req.params.id, businessId, req.body);
    if (!pkg) { error(res, 'Package not found', 'NOT_FOUND', 404); return; }
    success(res, pkg);
  } catch (err: any) { error(res, 'Failed to update package', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/packages/:id/archive
packagesRouter.put('/:id/archive', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const archived = await packageService.archivePackage(req.params.id, businessId);
    if (!archived) { error(res, 'Package not found', 'NOT_FOUND', 404); return; }
    success(res, { archived: true });
  } catch (err: any) { error(res, 'Failed to archive package', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/packages/:id/activate
packagesRouter.put('/:id/activate', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const activated = await packageService.activatePackage(req.params.id, businessId);
    if (!activated) { error(res, 'Package not found', 'NOT_FOUND', 404); return; }
    success(res, { activated: true });
  } catch (err: any) { error(res, 'Failed to activate package', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/packages/:id/pause
packagesRouter.put('/:id/pause', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const paused = await packageService.pausePackage(req.params.id, businessId);
    if (!paused) { error(res, 'Package not found', 'NOT_FOUND', 404); return; }
    success(res, { paused: true });
  } catch (err: any) { error(res, 'Failed to pause package', 'INTERNAL_ERROR', 500); }
});

// --- Package Items ---

// GET /api/v1/packages/:id/items
packagesRouter.get('/:id/items', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const items = await packageService.getPackageItems(req.params.id);
    success(res, items);
  } catch (err: any) { error(res, 'Failed to get package items', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/packages/:id/items
packagesRouter.post('/:id/items', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const item = await packageService.addPackageItem({
      packageId: req.params.id,
      itemType: req.body.item_type,
      serviceId: req.body.service_id,
      merchandiseId: req.body.merchandise_id,
      variantId: req.body.variant_id,
      quantity: req.body.quantity,
      redemptionType: req.body.redemption_type,
    });
    success(res, item, undefined, 201);
  } catch (err: any) { error(res, 'Failed to add item', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/packages/:id/items/:itemId
packagesRouter.put('/:id/items/:itemId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const updated = await packageService.updatePackageItem(req.params.itemId, {
      quantity: req.body.quantity,
      variantId: req.body.variant_id,
      redemptionType: req.body.redemption_type,
    });
    if (!updated) { error(res, 'Item not found', 'NOT_FOUND', 404); return; }
    success(res, updated);
  } catch (err: any) { error(res, 'Failed to update item', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/packages/:id/items/:itemId
packagesRouter.delete('/:id/items/:itemId', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await packageService.removePackageItem(req.params.itemId);
    if (!deleted) { error(res, 'Item not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to remove item', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/packages/:id/purchase — Purchase a package for a customer
packagesRouter.post('/:id/purchase', requirePermission('services:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string || req.body.business_id;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!req.body.customer_id) { error(res, 'customer_id required', 'VALIDATION_ERROR', 400); return; }

    const purchase = await packageService.purchasePackage({
      packageId: req.params.id,
      businessId,
      customerId: req.body.customer_id,
    });
    success(res, purchase, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('not available')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else { error(res, 'Failed to purchase package', 'INTERNAL_ERROR', 500); }
  }
});
