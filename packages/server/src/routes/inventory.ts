import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as inventory from '../services/inventory.service';
import { msg } from '../i18n';

/**
 * Retail inventory (spec 51, gap 7). Every route is for one business (business_id), and the
 * product, variant and location must belong to it.
 */
export const inventoryRouter = Router();
inventoryRouter.use(authenticate);
inventoryRouter.use(tenantContext);

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function ownsBusiness(req: Request, businessId: string): Promise<boolean> {
  if (!UUID_RE.test(businessId || '')) return false;
  const { rows } = await adminPool.query('SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [businessId, (req as AuthenticatedRequest).tenantId]);
  return rows.length > 0;
}
async function productOf(businessId: string, id: string) {
  if (!UUID_RE.test(id || '')) return null;
  const { rows } = await adminPool.query('SELECT id, track_stock FROM prd_merchandise WHERE id = $1 AND business_id = $2', [id, businessId]);
  return rows[0] || null;
}
async function locationOf(businessId: string, id: string) {
  if (!UUID_RE.test(id || '')) return false;
  const { rows } = await adminPool.query('SELECT 1 FROM sys_locations WHERE id = $1 AND business_id = $2', [id, businessId]);
  return rows.length > 0;
}
async function variantOf(productId: string, id: string | null) {
  if (!id) {
    const { rows } = await adminPool.query("SELECT 1 FROM prd_merchandise_variants WHERE merchandise_id = $1 AND status <> 'inactive' LIMIT 1", [productId]);
    return rows.length === 0; // no variant given: only for a product without variants
  }
  if (!UUID_RE.test(id)) return false;
  const { rows } = await adminPool.query('SELECT 1 FROM prd_merchandise_variants WHERE id = $1 AND merchandise_id = $2', [id, productId]);
  return rows.length > 0;
}
const bizOf = (req: Request) => String(req.query.business_id || req.body?.business_id || '');

// GET /v1/inventory/products/:id/stock?business_id= — on hand per location (and variant)
inventoryRouter.get('/products/:id/stock', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = bizOf(req);
    if (!(await ownsBusiness(req, businessId))) { error(res, msg('errors:inventory.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const p = await productOf(businessId, req.params.id);
    if (!p) { error(res, msg('errors:inventory.productNotFound'), 'NOT_FOUND', 404); return; }
    success(res, { track_stock: p.track_stock, lines: await inventory.productStock(p.id, businessId) });
  } catch (err) { console.error('Failed to load stock', (err as Error).message); error(res, msg('errors:inventory.failedToLoadStock'), 'INTERNAL_ERROR', 500); }
});

// GET /v1/inventory/products/:id/history?business_id= — stock changes, newest first
inventoryRouter.get('/products/:id/history', requirePermission('services:read'), async (req: Request, res: Response) => {
  try {
    const businessId = bizOf(req);
    if (!(await ownsBusiness(req, businessId))) { error(res, msg('errors:inventory.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const p = await productOf(businessId, req.params.id);
    if (!p) { error(res, msg('errors:inventory.productNotFound'), 'NOT_FOUND', 404); return; }
    success(res, await inventory.history(p.id, businessId, Number(req.query.limit) || 100));
  } catch (err) { console.error('Failed to load stock history', (err as Error).message); error(res, msg('errors:inventory.failedToLoadStockHistory'), 'INTERNAL_ERROR', 500); }
});

const changeSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  location_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().allow(null),
  mode: Joi.string().valid('set', 'add', 'remove').required(),
  qty: Joi.number().integer().min(0).max(1000000).required(),
  reason: Joi.string().valid('damaged', 'lost', 'used_in_service', 'found', 'correction'),
  unit_cost_cents: Joi.number().integer().min(0).allow(null),
  note: Joi.string().max(500).allow('', null),
});

// POST /v1/inventory/products/:id/stock — set a counted quantity (opening stock, a count) or add / remove with a reason
inventoryRouter.post('/products/:id/stock', requirePermission('services:*'), validate(changeSchema), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!(await ownsBusiness(req, b.business_id))) { error(res, msg('errors:inventory.businessNotFound'), 'NOT_FOUND', 404); return; }
    const p = await productOf(b.business_id, req.params.id);
    if (!p) { error(res, msg('errors:inventory.productNotFound'), 'NOT_FOUND', 404); return; }
    if (!(await locationOf(b.business_id, b.location_id))) { error(res, msg('errors:inventory.chooseALocationOfThisBusiness'), 'VALIDATION_ERROR', 400); return; }
    if (!(await variantOf(p.id, b.variant_id || null))) { error(res, msg('errors:inventory.chooseOneOfTheProductS'), 'VALIDATION_ERROR', 400); return; }
    const out = await inventory.changeStock({
      businessId: b.business_id, locationId: b.location_id, merchandiseId: p.id, variantId: b.variant_id || null,
      mode: b.mode, qty: b.qty, reason: b.reason, unitCostCents: b.unit_cost_cents ?? null, note: b.note || null,
      userId: (req as AuthenticatedRequest).user.sub,
    });
    success(res, { on_hand: out.onHand, avg_cost_cents: out.avgCostCents });
  } catch (err) {
    if (err instanceof inventory.StockError) { error(res, err.message, err.code, err.code === 'NOT_TRACKED' || err.code === 'INVALID' ? 400 : 409); return; }
    console.error('Failed to change stock', (err as Error).message); error(res, msg('errors:inventory.failedToChangeStock'), 'INTERNAL_ERROR', 500);
  }
});

const reorderSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  location_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().allow(null),
  reorder_level: Joi.number().integer().min(0).allow(null).required(),
  reorder_qty: Joi.number().integer().min(1).allow(null).required(),
});

// PUT /v1/inventory/products/:id/reorder — reorder level and quantity at one location
inventoryRouter.put('/products/:id/reorder', requirePermission('services:*'), validate(reorderSchema), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!(await ownsBusiness(req, b.business_id))) { error(res, msg('errors:inventory.businessNotFound'), 'NOT_FOUND', 404); return; }
    const p = await productOf(b.business_id, req.params.id);
    if (!p) { error(res, msg('errors:inventory.productNotFound'), 'NOT_FOUND', 404); return; }
    if (!(await locationOf(b.business_id, b.location_id))) { error(res, msg('errors:inventory.chooseALocationOfThisBusiness'), 'VALIDATION_ERROR', 400); return; }
    if (!(await variantOf(p.id, b.variant_id || null))) { error(res, msg('errors:inventory.chooseOneOfTheProductS'), 'VALIDATION_ERROR', 400); return; }
    await inventory.setReorder({ businessId: b.business_id, locationId: b.location_id, merchandiseId: p.id, variantId: b.variant_id || null, reorderLevel: b.reorder_level, reorderQty: b.reorder_qty });
    success(res, { saved: true });
  } catch (err) { console.error('Failed to save reorder level', (err as Error).message); error(res, msg('errors:inventory.failedToSaveReorderLevel'), 'INTERNAL_ERROR', 500); }
});

// GET /v1/inventory/locations/:locationId/stock?business_id= — on hand of every tracked item there (Checkout)
inventoryRouter.get('/locations/:locationId/stock', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = bizOf(req);
    if (!(await ownsBusiness(req, businessId))) { error(res, msg('errors:inventory.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    if (!(await locationOf(businessId, req.params.locationId))) { error(res, msg('errors:inventory.locationNotFound'), 'NOT_FOUND', 404); return; }
    const { rows: tracked } = await adminPool.query('SELECT id FROM prd_merchandise WHERE business_id = $1 AND track_stock = true', [businessId]);
    success(res, { tracked_ids: tracked.map((r: any) => r.id), stock: await inventory.stockAtLocation(businessId, req.params.locationId) });
  } catch (err) { console.error('Failed to load stock', (err as Error).message); error(res, msg('errors:inventory.failedToLoadStock'), 'INTERNAL_ERROR', 500); }
});

const stockErrorStatus = (e: inventory.StockError) => (e.code === 'NOT_TRACKED' || e.code === 'INVALID' ? 400 : 409);

const transferSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  from_location_id: Joi.string().uuid().required(),
  to_location_id: Joi.string().uuid().required(),
  note: Joi.string().max(500).allow('', null),
  lines: Joi.array().min(1).max(500).items(Joi.object({
    merchandise_id: Joi.string().uuid().required(),
    variant_id: Joi.string().uuid().allow(null),
    qty: Joi.number().integer().min(1).max(1000000).required(),
  })).required(),
});

// POST /v1/inventory/transfers — move stock from one location to another
inventoryRouter.post('/transfers', requirePermission('services:*'), validate(transferSchema), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!(await ownsBusiness(req, b.business_id))) { error(res, msg('errors:inventory.businessNotFound'), 'NOT_FOUND', 404); return; }
    if (!(await locationOf(b.business_id, b.from_location_id)) || !(await locationOf(b.business_id, b.to_location_id))) {
      error(res, msg('errors:inventory.chooseLocationsOfThisBusiness'), 'VALIDATION_ERROR', 400); return;
    }
    const out = await inventory.transfer({
      businessId: b.business_id, fromLocationId: b.from_location_id, toLocationId: b.to_location_id, note: b.note || null,
      userId: (req as AuthenticatedRequest).user.sub,
      lines: b.lines.map((l: { merchandise_id: string; variant_id?: string | null; qty: number }) => ({ merchandiseId: l.merchandise_id, variantId: l.variant_id || null, qty: l.qty })),
    });
    success(res, out, undefined, 201);
  } catch (err) {
    if (err instanceof inventory.StockError) { error(res, err.message, err.code, stockErrorStatus(err)); return; }
    console.error('Failed to move stock', (err as Error).message); error(res, msg('errors:inventory.failedToMoveStock'), 'INTERNAL_ERROR', 500);
  }
});
