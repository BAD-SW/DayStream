import { Router, Request, Response } from 'express';
import { parseColumnFilters } from '../utils/column-filters';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext, recordScope, isCustomerLogin, ownCustomerIds } from '../auth/tenant-context';
import { adminPool } from '../db/pool';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as checkoutService from '../services/checkout.service';
import { msg, isMessage, messageHas } from '../i18n';

export const checkoutRouter = Router();

checkoutRouter.use(authenticate);
checkoutRouter.use(tenantContext);

// An order is addressed by its id alone on most of these routes: the order must belong to a
// business the caller can reach. (Any signed-in user of any organisation could read an order
// and add lines to it.)
checkoutRouter.param('id', recordScope(async (id) => {
  const { rows } = await adminPool.query('SELECT business_id FROM fin_orders WHERE id = $1', [id]);
  return rows[0]?.business_id;
}, 'Order'));

// Checkout is a staff tool. A customer login may only open its own order (the receipt).
checkoutRouter.use(async (req: Request, res: Response, next) => {
  if (!isCustomerLogin(req)) { next(); return; }
  try {
    const m = req.method === 'GET' ? req.path.match(/^\/orders\/([0-9a-f-]{36})$/i) : null;
    if (m) {
      const own = await ownCustomerIds(req);
      const { rows } = await adminPool.query('SELECT customer_id FROM fin_orders WHERE id = $1', [m[1]]);
      if (rows[0]?.customer_id && own.includes(rows[0].customer_id)) { next(); return; }
      error(res, msg('errors:checkout.orderNotFound'), 'NOT_FOUND', 404);
      return;
    }
    error(res, msg('errors:checkout.insufficientPermissions'), 'FORBIDDEN', 403);
  } catch (err: any) { console.error('Checkout scope failed', err?.message || err); error(res, msg('errors:checkout.failed'), 'INTERNAL_ERROR', 500); }
});

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
  } catch (err: any) { console.error('Failed to create order', err?.message || err); error(res, msg('errors:checkout.failedToCreateOrder'), 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/checkout/orders/from-booking — Create order pre-populated from a booking
checkoutRouter.post('/orders/from-booking', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.body.business_id || req.query.business_id as string;
    const bookingId = req.body.booking_id;
    if (!businessId || !bookingId) { error(res, msg('errors:checkout.businessIdAndBookingIdRequired'), 'VALIDATION_ERROR', 400); return; }

    const order = await checkoutService.createOrderFromBooking(bookingId, businessId, authReq.user.sub);
    success(res, order, undefined, 201);
  } catch (err: any) {
    if (err?.code === 'ALREADY_CHECKED_OUT') { error(res, err.message, 'ALREADY_CHECKED_OUT', 409); return; }
    if (messageHas(err.message, 'not found')) { error(res, err.message, 'NOT_FOUND', 404); }
    else { error(res, msg('errors:checkout.failedToCreateOrderFromBooking'), 'INTERNAL_ERROR', 500); }
  }
});

// GET /api/v1/checkout/orders — List orders
// GET /api/v1/checkout/orders/column-values?column= — the values of one column, for its filter list.
checkoutRouter.get('/orders/column-values', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    success(res, await checkoutService.getOrderColumnValues(businessId, String(req.query.column || ''), parseColumnFilters(req.query.cf), req.query.product as string));
  } catch (err: any) { console.error('Failed to list column values', err?.message || err); error(res, msg('errors:checkout.failedToListColumnValues'), 'INTERNAL_ERROR', 500); }
});

checkoutRouter.get('/orders', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const result = await checkoutService.getOrders(businessId, {
      status: req.query.status as string,
      customerId: req.query.customer_id as string,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
      orderNumber: req.query.order_number as string,
      product: req.query.product as string,
      columns: parseColumnFilters(req.query.cf),
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.orders, result.meta);
  } catch (err: any) { console.error('Failed to list orders', err?.message || err); error(res, msg('errors:checkout.failedToListOrders'), 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/checkout/orders/:id — Get single order with items
checkoutRouter.get('/orders/:id', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const order = await checkoutService.getOrder(req.params.id);
    if (!order) { error(res, msg('errors:checkout.orderNotFound'), 'NOT_FOUND', 404); return; }
    success(res, order);
  } catch (err: any) { console.error('Failed to get order', err?.message || err); error(res, msg('errors:checkout.failedToGetOrder'), 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Order Items
// ============================================================

const addItemSchema = Joi.object({
  item_type: Joi.string().valid('service', 'product', 'membership', 'package', 'gift_card').required(),
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
  // Gift-card line only: who the card is for.
  gift_recipient_name: Joi.string().max(200).allow('', null),
  gift_recipient_email: Joi.string().email({ tlds: false }).max(255).allow('', null),
  // Gift-card line only: the expiry date to set on the card (YYYY-MM-DD). Omit to
  // use the business default; send null for no expiry.
  gift_expiry: Joi.string().isoDate().allow(null),
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
      giftRecipientName: req.body.gift_recipient_name || null,
      giftRecipientEmail: req.body.gift_recipient_email || null,
      // Only forward when the client sent the field, so the service can tell
      // "use the business default" (undefined) from "no expiry" (null).
      ...(Object.prototype.hasOwnProperty.call(req.body, 'gift_expiry')
        ? { giftExpiry: req.body.gift_expiry ? String(req.body.gift_expiry).slice(0, 10) : null }
        : {}),
    });
    // Return full order with updated totals; stock_limited says a quantity was limited to what is on hand.
    const order = await checkoutService.getOrder(req.params.id);
    success(res, { ...order, stock_limited: (item as any)?.stock_limited ?? null }, undefined, 201);
  } catch (err: any) {
    if (err?.name === 'StockError') { error(res, err.message, err.code || 'OUT_OF_STOCK', 409); return; }
    if ((isMessage(err.message, 'errors:checkout.orderNotFoundOrNotOpen', 'errors:checkout.orderIsNotOpen', 'errors:customerEvents.thisEventIsNotOpenFor', 'errors:eventRegistration.eventNotFoundOrNotOpen', 'errors:payroll.payPeriodNotFoundOrNot', 'errors:walkinPayment.orderIsNotOpen') || err.message.includes('not open'))) { error(res, err.message, 'CONFLICT', 409); }
    else { console.error('Failed to add item', err?.message || err); error(res, msg('errors:checkout.failedToAddItem'), 'INTERNAL_ERROR', 500); }
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
    const updated = await checkoutService.updateItem(req.params.itemId, req.params.id, {
      quantity: req.body.quantity,
      unitPrice: req.body.unit_price,
      discountAmount: req.body.discount_amount,
      taxAmount: req.body.tax_amount,
      creditedTo: req.body.credited_to,
      notes: req.body.notes,
    });
    const order = await checkoutService.getOrder(req.params.id);
    success(res, { ...order, stock_limited: (updated as any)?.stock_limited ?? null });
  } catch (err: any) {
    if ((isMessage(err.message, 'errors:checkout.orderNotFoundOrNotOpen', 'errors:checkout.orderIsNotOpen', 'errors:customerEvents.thisEventIsNotOpenFor', 'errors:eventRegistration.eventNotFoundOrNotOpen', 'errors:payroll.payPeriodNotFoundOrNot', 'errors:walkinPayment.orderIsNotOpen') || err.message.includes('not open')) || messageHas(err.message, 'not found')) { error(res, err.message, 'CONFLICT', 409); }
    else { console.error('Failed to update item', err?.message || err); error(res, msg('errors:checkout.failedToUpdateItem'), 'INTERNAL_ERROR', 500); }
  }
});

// DELETE /api/v1/checkout/orders/:id/items/:itemId — Remove item
checkoutRouter.delete('/orders/:id/items/:itemId', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    await checkoutService.removeItem(req.params.itemId, req.params.id);
    const order = await checkoutService.getOrder(req.params.id);
    success(res, order);
  } catch (err: any) {
    if (err?.code === 'BOOKING_SERVICE') { error(res, err.message, 'BOOKING_SERVICE', 409); return; }
    if ((isMessage(err.message, 'errors:checkout.orderNotFoundOrNotOpen', 'errors:checkout.orderIsNotOpen', 'errors:customerEvents.thisEventIsNotOpenFor', 'errors:eventRegistration.eventNotFoundOrNotOpen', 'errors:payroll.payPeriodNotFoundOrNot', 'errors:walkinPayment.orderIsNotOpen') || err.message.includes('not open')) || messageHas(err.message, 'not found')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, msg('errors:checkout.failedToRemoveItem'), 'INTERNAL_ERROR', 500); }
  }
});

// ============================================================
// Order Actions
// ============================================================

const completeSchema = Joi.object({
  payment_method: Joi.string().valid(
    'cash', 'card', 'bank_draw', 'bank_transfer', 'transfer', 'check', 'gift_card', 'google_pay', 'apple_pay', 'other',
  ).default('cash'),
  payment_reference: Joi.string().max(100).allow('', null),
  // The customer's stored card or bank account, for card and direct-debit payments.
  payment_method_id: Joi.string().uuid().allow(null),
  gift_card_code: Joi.string().max(40).allow('', null),
  check_number: Joi.string().max(60).allow('', null),
  // Walk-in card payment: the client-confirmed one-time PaymentIntent id + optional name.
  one_time_charge_ref: Joi.string().max(255).allow('', null),
  walk_in_name: Joi.string().max(120).allow('', null),
});

// PUT /api/v1/checkout/orders/:id/promo — Apply promo code
checkoutRouter.put('/orders/:id/promo', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const code = req.body.promo_code;
    if (!code) { error(res, msg('errors:checkout.promoCodeRequired'), 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.applyPromoCode(req.params.id, businessId, code);
    success(res, order);
  } catch (err: any) {
    if (/^(Code |You have |Minimum purchase)/.test(err.message) || (isMessage(err.message, 'errors:invalid_credentials', 'errors:middleware.invalidToken', 'errors:widgetCors.invalidOrMissingBusinessId', 'errors:clock.invalidEmailOrPin', 'errors:paymentPlatform.invalidWebhookSignature', 'errors:users.invalidPaginationParams', 'errors:auth.invalidCredentials', 'errors:auth.invalidOrExpiredRefreshToken', 'errors:integrationOauth.invalidOrExpiredOauthState', 'errors:merchandiseImages.invalidFormatAcceptedJpegPngWebp', 'errors:mockAdapter.invalidWebhookSignature', 'errors:voucher.invalidDiscountType') || err.message.includes('Invalid')) || (isMessage(err.message, 'errors:token_expired', 'errors:middleware.tokenExpired', 'errors:auth.thisResetLinkIsInvalidOr', 'errors:auth.invalidOrExpiredRefreshToken', 'errors:checkout.promotionHasExpired', 'errors:customerPayment.giftCardHasExpired', 'errors:customerProfile.thisLinkHasExpiredOrIs', 'errors:eventWaitlist.waitlistEntryNotFoundNotOffered', 'errors:integrationOauth.invalidOrExpiredOauthState', 'errors:package.packageHasExpired', 'errors:widgetBooking.slotHoldExpiredOrDoesNot') || err.message.includes('expired')) || (isMessage(err.message, 'errors:checkout.promotionHasNotStartedYet') || err.message.includes('not started')) || (isMessage(err.message, 'errors:booking.bookingsCanBeMadeAtMost', 'errors:checkout.promotionHasReachedItsMaximumRedemptions') || err.message.includes('maximum')) || (isMessage(err.message, 'errors:checkout.priceOverridePromotionsCannotBeApplied') || err.message.includes('cannot be applied')) || (isMessage(err.message, 'errors:checkout.promotionCodeDoesNotApplyTo') || err.message.includes('does not apply'))) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else if (messageHas(err.message, 'not found') || (isMessage(err.message, 'errors:checkout.orderNotFoundOrNotOpen', 'errors:checkout.orderIsNotOpen', 'errors:customerEvents.thisEventIsNotOpenFor', 'errors:eventRegistration.eventNotFoundOrNotOpen', 'errors:payroll.payPeriodNotFoundOrNot', 'errors:walkinPayment.orderIsNotOpen') || err.message.includes('not open'))) {
      error(res, err.message, 'CONFLICT', 409);
    } else { error(res, msg('errors:checkout.failedToApplyPromoCode'), 'INTERNAL_ERROR', 500); }
  }
});

// DELETE /api/v1/checkout/orders/:id/promo — Remove promo code
checkoutRouter.delete('/orders/:id/promo', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.removePromoCode(req.params.id, businessId);
    success(res, order);
  } catch (err: any) {
    if (messageHas(err.message, 'not found') || (isMessage(err.message, 'errors:checkout.orderNotFoundOrNotOpen', 'errors:checkout.orderIsNotOpen', 'errors:customerEvents.thisEventIsNotOpenFor', 'errors:eventRegistration.eventNotFoundOrNotOpen', 'errors:payroll.payPeriodNotFoundOrNot', 'errors:walkinPayment.orderIsNotOpen') || err.message.includes('not open'))) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, msg('errors:checkout.failedToRemovePromoCode'), 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/checkout/orders/:id/complete — Complete order (process payment)
checkoutRouter.put('/orders/:id/credited-to', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.updateOrderCreditedTo(req.params.id, businessId, req.body.credited_to || null);
    success(res, order);
  } catch (err: any) {
    if (messageHas(err.message, 'not found') || (isMessage(err.message, 'errors:checkout.orderNotFoundOrNotOpen', 'errors:checkout.orderIsNotOpen', 'errors:customerEvents.thisEventIsNotOpenFor', 'errors:eventRegistration.eventNotFoundOrNotOpen', 'errors:payroll.payPeriodNotFoundOrNot', 'errors:walkinPayment.orderIsNotOpen') || err.message.includes('not open'))) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, msg('errors:checkout.failedToUpdateCredit'), 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/checkout/orders/:id/customer — Set customer on order
checkoutRouter.put('/orders/:id/customer', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.updateOrderCustomer(req.params.id, businessId, req.body.customer_id || null);
    success(res, order);
  } catch (err: any) {
    if (messageHas(err.message, 'not found') || (isMessage(err.message, 'errors:checkout.orderNotFoundOrNotOpen', 'errors:checkout.orderIsNotOpen', 'errors:customerEvents.thisEventIsNotOpenFor', 'errors:eventRegistration.eventNotFoundOrNotOpen', 'errors:payroll.payPeriodNotFoundOrNot', 'errors:walkinPayment.orderIsNotOpen') || err.message.includes('not open'))) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, msg('errors:checkout.failedToUpdateCustomer'), 'INTERNAL_ERROR', 500); }
  }
});

const refundOrderSchema = Joi.object({
  reason: Joi.string().min(1).max(500).required(),
  lines: Joi.array().items(Joi.object({
    order_item_id: Joi.string().uuid().required(),
    quantity: Joi.number().integer().min(1).required(),
    // a product line: back into stock (default) or written off (spec 51, gap 7)
    restock: Joi.boolean().default(true),
  })).min(0).default([]),
  // part or all of the order's tip, refunded as its own line (spec 51, gap 14)
  tip_cents: Joi.number().integer().min(0).default(0),
});

// POST /api/v1/checkout/orders/:id/refund — partial / line-item refund of an order.
checkoutRouter.post('/orders/:id/refund', requirePermission('bookings:*'), validate(refundOrderSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const { refundOrderLines } = await import('../services/order-refund.service');
    const result = await refundOrderLines({
      businessId,
      tenantId: authReq.tenantId,
      orderId: req.params.id,
      lines: req.body.lines.map((l: any) => ({ orderItemId: l.order_item_id, quantity: l.quantity, restock: l.restock !== false })),
      reason: req.body.reason,
      processedBy: authReq.user.sub,
      tipCents: req.body.tip_cents || 0,
    });
    success(res, result);
  } catch (err: any) {
    const codes: Record<string, number> = {
      REASON_REQUIRED: 400, NO_LINES: 400, ORDER_NOT_FOUND: 404, ORDER_NOT_REFUNDABLE: 409,
      LINE_NOT_FOUND: 404, INVALID_QUANTITY: 400, NOTHING_TO_REFUND: 400, NO_CONNECTION: 409,
      ITEM_NOT_REFUNDABLE: 409, INVALID_TIP: 400,
    };
    if (err?.code && codes[err.code]) { error(res, err.message, err.code, codes[err.code]); return; }
    console.error('Failed to refund order', err?.message || err);
    error(res, msg('errors:checkout.failedToRefundOrder'), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/checkout/orders/:id/one-time-charge — begin a walk-in (customerless)
// one-time card charge: creates the PaymentIntent the browser confirms.
checkoutRouter.post('/orders/:id/one-time-charge', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    // The card is charged in the browser before completion, so check stock first (spec 51, gap 7).
    const { checkOrderFits } = await import('../services/inventory.service');
    await checkOrderFits(req.params.id);
    const { beginOneTimeOrderCharge } = await import('../services/walkin-payment.service');
    const session = await beginOneTimeOrderCharge(businessId, req.params.id);
    success(res, session);
  } catch (err: any) {
    const codes: Record<string, number> = {
      ORDER_NOT_FOUND: 404, ORDER_NOT_OPEN: 409, INVALID_AMOUNT: 400, NO_CONNECTION: 409, OUT_OF_STOCK: 409, NOT_ENOUGH_STOCK: 409,
    };
    if (err?.code && codes[err.code]) { error(res, err.message, err.code, codes[err.code]); return; }
    console.error('Failed to begin one-time charge', err?.message || err);
    error(res, msg('errors:checkout.failedToBeginOneTimeCharge'), 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/checkout/orders/:id/complete — Complete order (process payment)
checkoutRouter.put('/orders/:id/complete', requirePermission('bookings:*'), validate(completeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }

    const order = await checkoutService.completeOrder(req.params.id, businessId, {
      paymentMethod: req.body.payment_method || 'cash',
      paymentReference: req.body.payment_reference,
      paymentMethodId: req.body.payment_method_id || null,
      giftCardCode: req.body.gift_card_code || null,
      checkNumber: req.body.check_number || null,
      oneTimeChargeRef: req.body.one_time_charge_ref || null,
      walkInName: req.body.walk_in_name || null,
      checkedOutBy: authReq.user.sub,
    });
    success(res, order);
  } catch (err: any) {
    // A refused payment: the order stays open and the answer says why.
    const PAYMENT_STATUS: Record<string, number> = {
      PAYMENT_DECLINED: 402, CUSTOMER_REQUIRED: 400, INVALID_AMOUNT: 400, INVALID_METHOD: 400, METHOD_REQUIRED: 400,
      CODE_REQUIRED: 400, NO_CONNECTION: 409, METHOD_UNAVAILABLE: 409, GIFT_CARD_NOT_FOUND: 404,
      GIFT_CARD_INACTIVE: 409, GIFT_CARD_EXPIRED: 409, GIFT_CARD_CURRENCY: 409, GIFT_CARD_INSUFFICIENT: 409,
      AMOUNT_MISMATCH: 400, TIP_CARD_ONLY: 400,
    };
    if (err?.code && PAYMENT_STATUS[err.code]) { error(res, err.message, err.code, PAYMENT_STATUS[err.code]); return; }
    // A tracked product no longer in stock (sold elsewhere since it was added): nothing was charged.
    if (err?.code === 'OUT_OF_STOCK' || err?.code === 'NOT_ENOUGH_STOCK') { error(res, err.message, err.code, 409); return; }
    if ((isMessage(err.message, 'errors:checkout.orderNotFoundOrNotOpen', 'errors:checkout.orderIsNotOpen', 'errors:customerEvents.thisEventIsNotOpenFor', 'errors:eventRegistration.eventNotFoundOrNotOpen', 'errors:payroll.payPeriodNotFoundOrNot', 'errors:walkinPayment.orderIsNotOpen') || err.message.includes('not open')) || messageHas(err.message, 'empty') || isMessage(err.message, 'errors:checkout.orderNotFound', 'errors:inventory.orderNotFound', 'errors:orderJournal.orderNotFound', 'errors:tips.orderNotFound', 'errors:walkinPayment.orderNotFound')) { error(res, err.message, 'CONFLICT', 409); }
    else { console.error('Failed to complete order', err?.message || err); error(res, msg('errors:checkout.failedToCompleteOrder'), 'INTERNAL_ERROR', 500); }
  }
});

// --- Tips (spec 51, gap 14) ---

const tipSettingsSchema = Joi.object({
  enabled: Joi.boolean().required(),
  // the tip slider: where it starts and its highest percentage (owner, 23 Nov 2026)
  default_percent: Joi.number().integer().min(0).max(100).required(),
  max_percent: Joi.number().integer().min(1).max(100).required(), // the default is kept within it
  on_manual: Joi.boolean().required(),
  split: Joi.string().valid('value', 'even').required(),
  base: Joi.string().valid('before_tax', 'after_tax').default('before_tax'),
});
const tipSettingsOut = (s: { enabled: boolean; defaultPercent: number; maxPercent: number; onManual: boolean; split: string; base: string }) =>
  ({ enabled: s.enabled, default_percent: s.defaultPercent, max_percent: s.maxPercent, on_manual: s.onManual, split: s.split, base: s.base });

// GET /api/v1/checkout/tip-settings?business_id=
checkoutRouter.get('/tip-settings', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const { getTipSettings } = await import('../services/tips.service');
    success(res, tipSettingsOut(await getTipSettings(businessId)));
  } catch (err: any) { console.error('Failed to load tip settings', err?.message || err); error(res, msg('errors:checkout.failedToLoadTipSettings'), 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/checkout/tip-settings?business_id=
checkoutRouter.put('/tip-settings', requirePermission('settings:*'), validate(tipSettingsSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const { setTipSettings } = await import('../services/tips.service');
    const b = req.body;
    success(res, tipSettingsOut(await setTipSettings(businessId, (req as AuthenticatedRequest).user.sub,
      { enabled: b.enabled, defaultPercent: b.default_percent, maxPercent: b.max_percent, onManual: b.on_manual, split: b.split, base: b.base })));
  } catch (err: any) { console.error('Failed to save tip settings', err?.message || err); error(res, msg('errors:checkout.failedToSaveTipSettings'), 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/checkout/orders/:id/tip?business_id= — the tip, who gets it, and the staff who can
checkoutRouter.get('/orders/:id/tip', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query('SELECT tip_amount FROM fin_orders WHERE id = $1 AND business_id = $2', [req.params.id, businessId]);
    if (!rows[0]) { error(res, msg('errors:checkout.orderNotFound'), 'NOT_FOUND', 404); return; }
    const { sharesFor } = await import('../services/tips.service');
    const out = await sharesFor(req.params.id);
    success(res, { tip_cents: rows[0].tip_amount, by_hand: out.byHand, shares: out.shares, staff: out.staff });
  } catch (err: any) { console.error('Failed to load the tip', err?.message || err); error(res, msg('errors:checkout.failedToLoadTheTip'), 'INTERNAL_ERROR', 500); }
});

const orderTipSchema = Joi.object({
  tip_cents: Joi.number().integer().min(0).max(100000000).required(),
  // a suggested percentage: the tip is worked out from it and follows the order until payment
  percent: Joi.number().min(0).max(100).allow(null),
  split: Joi.array().items(Joi.object({
    user_id: Joi.string().uuid().required(),
    amount_cents: Joi.number().integer().min(0).required(),
  })).allow(null),
});

// PUT /api/v1/checkout/orders/:id/tip?business_id= — set or clear the tip on an open order
checkoutRouter.put('/orders/:id/tip', requirePermission('bookings:*'), validate(orderTipSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const { setOrderTip } = await import('../services/tips.service');
    await setOrderTip({ businessId, orderId: req.params.id, tipCents: req.body.tip_cents, percent: req.body.percent ?? null, split: req.body.split ?? null });
    success(res, await checkoutService.getOrder(req.params.id));
  } catch (err: any) {
    if (err?.name === 'TipError') { error(res, err.message, err.code, err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400); return; }
    console.error('Failed to set the tip', err?.message || err); error(res, msg('errors:checkout.failedToSetTheTip'), 'INTERNAL_ERROR', 500);
  }
});

// --- Paying a line with a membership or package (spec 51, gap 19) ---

const lineOfOrder = async (orderId: string, itemId: string, businessId: string) => {
  const { rows } = await adminPool.query(
    `SELECT oi.id, o.status FROM fin_order_items oi JOIN fin_orders o ON o.id = oi.order_id
      WHERE oi.id = $1 AND o.id = $2 AND o.business_id = $3`, [itemId, orderId, businessId]);
  return rows[0] as { id: string; status: string } | undefined;
};

// GET /api/v1/checkout/orders/:id/items/:itemId/benefits?business_id= — the customer's memberships
// and packages for this line, each covering it or not, and the one paying it now
checkoutRouter.get('/orders/:id/items/:itemId/benefits', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    if (!(await lineOfOrder(req.params.id, req.params.itemId, businessId))) { error(res, msg('errors:checkout.lineNotFound'), 'NOT_FOUND', 404); return; }
    const { lineOptions } = await import('../services/benefits.service');
    success(res, (await lineOptions(req.params.itemId)) || { options: [], use: null });
  } catch (err: any) { console.error('Failed to load memberships and packages', err?.message || err); error(res, msg('errors:checkout.failedToLoadMembershipsAndPackages'), 'INTERNAL_ERROR', 500); }
});

const lineBenefitSchema = Joi.object({
  benefit: Joi.object({
    kind: Joi.string().valid('membership', 'package').required(),
    source_id: Joi.string().uuid().required(),
    item_id: Joi.string().uuid().required(),
  }).allow(null).required(),
});

// PUT /api/v1/checkout/orders/:id/items/:itemId/benefit?business_id= — pay the line with a
// membership or package, or normally again (null)
checkoutRouter.put('/orders/:id/items/:itemId/benefit', requirePermission('bookings:*'), validate(lineBenefitSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const line = await lineOfOrder(req.params.id, req.params.itemId, businessId);
    if (!line) { error(res, msg('errors:checkout.lineNotFound'), 'NOT_FOUND', 404); return; }
    if (line.status !== 'open') { error(res, msg('errors:checkout.theOrderIsAlreadyPaid'), 'CONFLICT', 409); return; }
    const { setLineBenefit } = await import('../services/benefits.service');
    await setLineBenefit(req.params.itemId, req.body.benefit, (req as AuthenticatedRequest).user.sub);
    success(res, await checkoutService.getOrder(req.params.id));
  } catch (err: any) {
    if (err?.name === 'BenefitError') { error(res, err.message, err.code, err.code === 'NOT_FOUND' ? 404 : err.code === 'NOT_COVERED' ? 409 : 400); return; }
    console.error('Failed to set the membership or package', err?.message || err); error(res, msg('errors:checkout.failedToSetTheMembershipOr'), 'INTERNAL_ERROR', 500);
  }
});

// --- Tip pool: tips on orders with no staff member on them (spec 51, gap 14) ---

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const tipPoolSchema = Joi.object({
  mode: Joi.string().valid('hand', 'hours', 'even').required(),
  start: Joi.string().pattern(DATE).allow(null).default(null),
  end: Joi.string().pattern(DATE).required(),
  amounts: Joi.array().items(Joi.object({
    user_id: Joi.string().uuid().required(),
    amount_cents: Joi.number().integer().min(0).required(),
  })).default([]),
});

const tipErrorStatus = (code: string) => (code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 400);

// GET /api/v1/checkout/tip-pool?business_id= — what is waiting to be shared, and the staff
checkoutRouter.get('/tip-pool', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const { poolSummary, poolStaff } = await import('../services/tips.service');
    success(res, { ...(await poolSummary(businessId)), staff: await poolStaff(businessId) });
  } catch (err: any) { console.error('Failed to load the tip pool', err?.message || err); error(res, msg('errors:checkout.failedToLoadTheTipPool'), 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/checkout/tip-pool/plan?business_id= — how the pool would be shared (nothing changes)
checkoutRouter.post('/tip-pool/plan', requirePermission('settings:*'), validate(tipPoolSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const { planPool } = await import('../services/tips.service');
    const b = req.body;
    const plan = await planPool({ businessId, start: b.start, end: b.end, mode: b.mode, amounts: b.amounts });
    success(res, { total_cents: plan.total_cents, left_cents: plan.left_cents, unassigned_cents: plan.unassigned_cents, days_without_staff: plan.days_without_staff, staff: plan.staff });
  } catch (err: any) {
    if (err?.name === 'TipError') { error(res, err.message, err.code, tipErrorStatus(err.code)); return; }
    console.error('Failed to plan the tip pool', err?.message || err); error(res, msg('errors:checkout.failedToPlanTheTipPool'), 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/checkout/tip-pool/share?business_id= — share the pool out as planned
checkoutRouter.post('/tip-pool/share', requirePermission('settings:*'), validate(tipPoolSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const { sharePool } = await import('../services/tips.service');
    const b = req.body;
    success(res, await sharePool({ businessId, start: b.start, end: b.end, mode: b.mode, amounts: b.amounts, userId: (req as AuthenticatedRequest).user.sub }));
  } catch (err: any) {
    if (err?.name === 'TipError') { error(res, err.message, err.code, tipErrorStatus(err.code)); return; }
    console.error('Failed to share the tip pool', err?.message || err); error(res, msg('errors:checkout.failedToShareTheTipPool'), 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/checkout/orders/:id/location — where the sale happens (its stock comes from there; spec 51, gap 7)
checkoutRouter.put('/orders/:id/location', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    const locationId = req.body?.location_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    if (!/^[0-9a-f-]{36}$/i.test(locationId || '')) { error(res, msg('errors:checkout.chooseALocationOfThisBusiness'), 'VALIDATION_ERROR', 400); return; }
    const { rows: loc } = await adminPool.query('SELECT 1 FROM sys_locations WHERE id = $1 AND business_id = $2', [locationId, businessId]);
    if (!loc[0]) { error(res, msg('errors:checkout.chooseALocationOfThisBusiness'), 'VALIDATION_ERROR', 400); return; }
    const { rowCount } = await adminPool.query(
      "UPDATE fin_orders SET location_id = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3 AND status = 'open'", [locationId, req.params.id, businessId]);
    if (!rowCount) { error(res, msg('errors:checkout.orderNotFoundOrNotOpen'), 'CONFLICT', 409); return; }
    success(res, await checkoutService.getOrder(req.params.id));
  } catch (err: any) { console.error('Failed to set order location', err?.message || err); error(res, msg('errors:checkout.failedToSetTheLocation'), 'INTERNAL_ERROR', 500); }
});
// PUT /api/v1/checkout/orders/:id/void — Void an open order
checkoutRouter.put('/orders/:id/void', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, msg('errors:checkout.businessIdRequired'), 'VALIDATION_ERROR', 400); return; }
    const order = await checkoutService.voidOrder(req.params.id, businessId);
    success(res, order);
  } catch (err: any) {
    if (messageHas(err.message, 'not found') || (isMessage(err.message, 'errors:paymentPlatform.invoiceNotFoundOrCannotBe', 'errors:checkout.orderNotFoundOrCannotBe') || err.message.includes('cannot be voided'))) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, msg('errors:checkout.failedToVoidOrder'), 'INTERNAL_ERROR', 500); }
  }
});
