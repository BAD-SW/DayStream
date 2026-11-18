import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { StockError } from '../services/inventory.service';
import * as po from '../services/purchase-orders.service';

/**
 * Purchase orders (spec 51, gap 7; design 7.7), in Accounting next to Vendors and Bills. Every
 * route is for one business (business_id); the vendor, location and products must belong to it.
 */
export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(authenticate);
purchaseOrdersRouter.use(tenantContext);

const UUID_RE = /^[0-9a-f-]{36}$/i;
const bizOf = (req: Request) => String(req.query.business_id || req.body?.business_id || '');
const userOf = (req: Request) => (req as AuthenticatedRequest).user.sub;

async function ownsBusiness(req: Request, businessId: string): Promise<boolean> {
  if (!UUID_RE.test(businessId || '')) return false;
  const { rows } = await adminPool.query('SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [businessId, (req as AuthenticatedRequest).tenantId]);
  return rows.length > 0;
}
async function belongs(table: 'fin_vendors' | 'sys_locations', businessId: string, id: string): Promise<boolean> {
  if (!UUID_RE.test(id || '')) return false;
  const { rows } = await adminPool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND business_id = $2`, [id, businessId]);
  return rows.length > 0;
}
function fail(res: Response, err: unknown, what: string) {
  if (err instanceof StockError) { error(res, err.message, err.code, err.code === 'NOT_TRACKED' || err.code === 'INVALID' ? 400 : 409); return; }
  console.error(`Failed to ${what}`, (err as Error).message);
  error(res, `Failed to ${what}`, 'INTERNAL_ERROR', 500);
}

const lineSchema = Joi.object({
  merchandise_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().allow(null),
  qty_ordered: Joi.number().integer().min(1).max(1000000).required(),
  unit_cost_cents: Joi.number().integer().min(0).max(100000000).required(),
});
const poSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  vendor_id: Joi.string().uuid().required(),
  location_id: Joi.string().uuid().required(),
  expected_on: Joi.string().isoDate().allow(null, ''),
  note: Joi.string().max(1000).allow('', null),
  lines: Joi.array().min(1).max(500).items(lineSchema).required(),
});
const linesOf = (b: { lines: Array<{ merchandise_id: string; variant_id?: string | null; qty_ordered: number; unit_cost_cents: number }> }) =>
  b.lines.map((l) => ({ merchandiseId: l.merchandise_id, variantId: l.variant_id || null, qtyOrdered: l.qty_ordered, unitCostCents: l.unit_cost_cents }));

async function checkVendorAndLocation(res: Response, businessId: string, vendorId: string, locationId: string): Promise<boolean> {
  if (!(await belongs('fin_vendors', businessId, vendorId))) { error(res, "Choose one of this business's vendors.", 'VALIDATION_ERROR', 400); return false; }
  if (!(await belongs('sys_locations', businessId, locationId))) { error(res, 'Choose a location of this business.', 'VALIDATION_ERROR', 400); return false; }
  return true;
}

// GET /v1/purchase-orders?business_id=
purchaseOrdersRouter.get('/', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = bizOf(req);
    if (!(await ownsBusiness(req, businessId))) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    success(res, await po.listPos(businessId));
  } catch (err) { fail(res, err, 'load purchase orders'); }
});

// GET /v1/purchase-orders/:id?business_id=
purchaseOrdersRouter.get('/:id', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = bizOf(req);
    if (!(await ownsBusiness(req, businessId))) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const found = UUID_RE.test(req.params.id) ? await po.getPo(businessId, req.params.id) : null;
    if (!found) { error(res, 'Purchase order not found', 'NOT_FOUND', 404); return; }
    success(res, found);
  } catch (err) { fail(res, err, 'load the purchase order'); }
});

// POST /v1/purchase-orders — a new draft
purchaseOrdersRouter.post('/', requirePermission('settings:*'), validate(poSchema), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!(await ownsBusiness(req, b.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    if (!(await checkVendorAndLocation(res, b.business_id, b.vendor_id, b.location_id))) return;
    success(res, await po.createPo({
      businessId: b.business_id, vendorId: b.vendor_id, locationId: b.location_id, expectedOn: b.expected_on || null, note: b.note || null,
      userId: userOf(req), lines: linesOf(b),
    }), undefined, 201);
  } catch (err) { fail(res, err, 'create the purchase order'); }
});

// PUT /v1/purchase-orders/:id — change a draft
purchaseOrdersRouter.put('/:id', requirePermission('settings:*'), validate(poSchema), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!(await ownsBusiness(req, b.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    if (!UUID_RE.test(req.params.id)) { error(res, 'Purchase order not found', 'NOT_FOUND', 404); return; }
    if (!(await checkVendorAndLocation(res, b.business_id, b.vendor_id, b.location_id))) return;
    await po.updatePo({
      businessId: b.business_id, poId: req.params.id, vendorId: b.vendor_id, locationId: b.location_id,
      expectedOn: b.expected_on || null, note: b.note || null, lines: linesOf(b),
    });
    success(res, await po.getPo(b.business_id, req.params.id));
  } catch (err) { fail(res, err, 'save the purchase order'); }
});

const sendSchema = Joi.object({ business_id: Joi.string().uuid().required(), email: Joi.boolean().default(true) });

// POST /v1/purchase-orders/:id/send — email it to the vendor, or only mark it as sent (email: false)
purchaseOrdersRouter.post('/:id/send', requirePermission('settings:*'), validate(sendSchema), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!(await ownsBusiness(req, b.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    if (!UUID_RE.test(req.params.id)) { error(res, 'Purchase order not found', 'NOT_FOUND', 404); return; }
    success(res, await po.sendPo(b.business_id, req.params.id, { email: b.email }));
  } catch (err) { fail(res, err, 'send the purchase order'); }
});

const receiveSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  note: Joi.string().max(500).allow('', null),
  lines: Joi.array().min(1).max(500).items(Joi.object({
    line_id: Joi.string().uuid().required(),
    qty: Joi.number().integer().min(0).max(1000000).required(),
    unit_cost_cents: Joi.number().integer().min(0).max(100000000).allow(null),
  })).required(),
});

// POST /v1/purchase-orders/:id/receive — what arrived; adds stock at the location
purchaseOrdersRouter.post('/:id/receive', requirePermission('settings:*'), validate(receiveSchema), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!(await ownsBusiness(req, b.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    if (!UUID_RE.test(req.params.id)) { error(res, 'Purchase order not found', 'NOT_FOUND', 404); return; }
    success(res, await po.receivePo({
      businessId: b.business_id, poId: req.params.id, userId: userOf(req), note: b.note || null,
      lines: b.lines.map((l: { line_id: string; qty: number; unit_cost_cents?: number | null }) => ({ lineId: l.line_id, qty: l.qty, unitCostCents: l.unit_cost_cents ?? null })),
    }));
  } catch (err) { fail(res, err, 'receive the purchase order'); }
});

const billSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  invoice_number: Joi.string().max(100).allow('', null),
  due_date: Joi.string().isoDate().allow('', null),
});

// POST /v1/purchase-orders/:id/bill — a vendor bill for what was received and not yet billed
purchaseOrdersRouter.post('/:id/bill', requirePermission('settings:*'), validate(billSchema), async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (!(await ownsBusiness(req, b.business_id))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    if (!UUID_RE.test(req.params.id)) { error(res, 'Purchase order not found', 'NOT_FOUND', 404); return; }
    success(res, await po.billPo({ businessId: b.business_id, poId: req.params.id, userId: userOf(req), invoiceNumber: b.invoice_number || null, dueDate: b.due_date || null }), undefined, 201);
  } catch (err) { fail(res, err, 'create the bill'); }
});

// POST /v1/purchase-orders/:id/close?business_id= — cancel (nothing received) or close short (partly received)
purchaseOrdersRouter.post('/:id/close', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = bizOf(req);
    if (!(await ownsBusiness(req, businessId))) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    if (!UUID_RE.test(req.params.id)) { error(res, 'Purchase order not found', 'NOT_FOUND', 404); return; }
    success(res, await po.closePo(businessId, req.params.id));
  } catch (err) { fail(res, err, 'close the purchase order'); }
});
