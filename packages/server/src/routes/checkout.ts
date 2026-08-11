import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as checkoutService from '../services/checkout.service';

export const checkoutRouter = Router();

checkoutRouter.use(authenticate);
checkoutRouter.use(tenantContext);

// ============================================================
// Orders
// ============================================================

const createOrderSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().allow(null),
  booking_id: Joi.string().uuid().allow(null),
  credited_to: Joi.string().uuid().allow(null),
  notes: Joi.string().max(500).allow('', null),
});

// POST /api/v1/checkout/orders — Create a new order (empty cart)
checkoutRouter.post('/orders', requirePermission('bookings:*'), validate(createOrderSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const order = await checkoutService.createOrder({
      businessId: req.body.business_id,
      customerId: req.body.customer_id,
      bookingId: req.body.booking_id,
      checkedOutBy: authReq.user.sub,
      notes: req.body.notes,
    });
    success(res, order, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create order', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/checkout/orders/from-booking — Create order pre-populated from a booking
checkoutRouter.post('/orders/from-booking', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.body.business_id || req.query.business_id as string;
    const bookingId = req.body.booking_id;
    if (!businessId || !bookingId) { error(res, 'business_id and booking_id required', 'VALIDATION_ERROR', 400); return; }

    const order = await checkoutService.createOrderFromBooking(bookingId, businessId, authReq.user.sub);
    success(res, order, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('not found')) { error(res, err.message, 'NOT_FOUND', 404); }
    else { error(res, 'Failed to create order from booking', 'INTERNAL_ERROR', 500); }
  }
});

// GET /api/v1/checkout/orders — List orders
checkoutRouter.get('/orders', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await checkoutService.getOrders(businessId, {
      status: req.query.status as string,
      customerId: req.query.customer_id as string,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.orders, result.meta);
  } catch (err: any) { error(res, 'Failed to list orders', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/checkout/orders/:id — Get single order with items
checkoutRouter.get('/orders/:id', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const order = await checkoutService.getOrder(req.params.id);
    if (!order) { error(res, 'Order not found', 'NOT_FOUND', 404); return; }
    success(res, order);
  } catch (err: any) { error(res, 'Failed to get order', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Order Items
// ============================================================

const addItemSchema = Joi.object({
  item_type: Joi.string().valid('service', 'product', 'membership', 'package').required(),
  item_id: Joi.string().uuid().allow(null),
  item_name: Joi.string().min(1).max(200).required(),
  variant_id: Joi.string().uuid().allow(null),
  variant_name: Joi.string().max(100).allow('', null),
  quantity: Joi.number().integer().min(1).default(1),
  unit_price: Joi.number().integer().min(0).required(),
  discount_amount: Joi.number().integer().min(0).default(0),
  tax_amount: Joi.number().integer().min(0).allow(null),
  credited_to: Joi.string().uuid().allow(null),
  booking_id: Joi.string().uuid().allow(null),
  notes: Joi.string().max(200).allow('', null),
});

// POST /api/v1/checkout/orders/:id/items — Add item to order
checkoutRouter.post('/orders/:id/items', requirePermission('bookings:*'), validate(addItemSchema), async (req: Request, res: Response) => {
  try {
    const item = await checkoutService.addItem(req.params.id, {
      itemType: req.body.item_type,
      itemId: req.body.item_id,
      itemName: req.body.item_name,
      variantId: req.body.variant_id,
      variantName: req.body.variant_name,
      quantity: req.body.quantity,
      unitPrice: req.body.unit_price,
      discountAmount: req.body.discount_amount,
      taxAmount: req.body.tax_amount !== undefined && req.body.tax_amount !== null ? req.body.tax_amount : undefined,
      creditedTo: req.body.credited_to,
      bookingId: req.body.booking_id,
      notes: req.body.notes,
    });
    // Return full order with updated totals
    const order = await checkoutService.getOrder(req.params.id);
    success(res, order, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('not open')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to add item', 'INTERNAL_ERROR', 500); }
  }
});

const updateItemSchema = Joi.object({
  quantity: Joi.number().integer().min(1),
  unit_price: Joi.number().integer().min(0),
  discount_amount: Joi.number().integer().min(0),
  tax_amount: Joi.number().integer().min(0),
  credited_to: Joi.string().uuid().allow(null),
  notes: Joi.string().max(200).allow('', null),
}).min(1);

// PUT /api/v1/checkout/orders/:id/items/:itemId — Update item
checkoutRouter.put('/orders/:id/items/:itemId', requirePermission('bookings:*'), validate(updateItemSchema), async (req: Request, res: Response) => {
  try {
    await checkoutService.updateItem(req.params.itemId, req.params.id, {
      quantity: req.body.quantity,
      unitPrice: req.body.unit_price,
      discountAmount: req.body.discount_amount,
      taxAmount: req.body.tax_amount,
      creditedTo: req.body.credited_to,
      notes: req.body.notes,
    });
    const order = await checkoutService.getOrder(req.params.id);
    success(res, order);
  } catch (err: any) {
    if (err.message.includes('not open') || err.message.includes('not found')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to update item', 'INTERNAL_ERROR', 500); }
  }
});

// DELETE /api/v1/checkout/orders/:id/items/:itemId — Remove item
checkoutRouter.delete('/orders/:id/items/:itemId', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    await checkoutService.removeItem(req.params.itemId, req.params.id);
    const order = await checkoutService.getOrder(req.params.id);
    success(res, order);
  } catch (err: any) {
    if (err.message.includes('not open') || err.message.includes('not found')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to remove item', 'INTERNAL_ERROR', 500); }
  }
});

// ============================================================
// Order Actions
// ============================================================

const completeSchema = Joi.object({
  payment_method: Joi.string().valid('cash', 'card', 'transfer', 'other').default('cash'),
  payment_reference: Joi.string().max(100).allow('', null),
});

// PUT /api/v1/checkout/orders/:id/promo — Apply promo code
checkoutRouter.put('/orders/:id/promo', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const code = req.body.promo_code;
    if (!code) { error(res, 'promo_code required', 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.applyPromoCode(req.params.id, businessId, code);
    success(res, order);
  } catch (err: any) {
    if (err.message.includes('Invalid') || err.message.includes('expired') || err.message.includes('not started') || err.message.includes('maximum') || err.message.includes('cannot be applied') || err.message.includes('does not apply')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else if (err.message.includes('not found') || err.message.includes('not open')) {
      error(res, err.message, 'CONFLICT', 409);
    } else { error(res, 'Failed to apply promo code', 'INTERNAL_ERROR', 500); }
  }
});

// DELETE /api/v1/checkout/orders/:id/promo — Remove promo code
checkoutRouter.delete('/orders/:id/promo', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.removePromoCode(req.params.id, businessId);
    success(res, order);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('not open')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to remove promo code', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/checkout/orders/:id/complete — Complete order (process payment)
checkoutRouter.put('/orders/:id/credited-to', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.updateOrderCreditedTo(req.params.id, businessId, req.body.credited_to || null);
    success(res, order);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('not open')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to update credit', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/checkout/orders/:id/customer — Set customer on order
checkoutRouter.put('/orders/:id/customer', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.updateOrderCustomer(req.params.id, businessId, req.body.customer_id || null);
    success(res, order);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('not open')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to update customer', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/checkout/orders/:id/complete — Complete order (process payment)
checkoutRouter.put('/orders/:id/complete', requirePermission('bookings:*'), validate(completeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const order = await checkoutService.completeOrder(req.params.id, businessId, {
      paymentMethod: req.body.payment_method || 'cash',
      paymentReference: req.body.payment_reference,
      checkedOutBy: authReq.user.sub,
    });
    success(res, order);
  } catch (err: any) {
    if (err.message.includes('not open') || err.message.includes('empty')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to complete order', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/checkout/orders/:id/void — Void an open order
checkoutRouter.put('/orders/:id/void', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.voidOrder(req.params.id, businessId);
    success(res, order);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('cannot be voided')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to void order', 'INTERNAL_ERROR', 500); }
  }
});
