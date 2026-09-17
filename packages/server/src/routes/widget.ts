import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { validate } from '../middleware/validate';
import { widgetCors, widgetMutationLimiter, requireValidBusinessId, enforceAllowedOrigin } from '../middleware/widget-cors';
import { success, error } from '../utils/response';
import * as widgetService from '../services/widget-booking.service';
import { WidgetError } from '../services/widget-booking.service';

export const widgetRouter = Router();

widgetRouter.use(widgetCors);

// Requirements 12.2 / 12.5 — every route below gets both checks explicitly, not via a
// blanket router.use(): Express only populates req.params for a route AFTER matching
// it, so a :business_id path param isn't visible to generic pre-route middleware —
// only to middleware listed on the specific route that declares it. (Confirmed the hard
// way: an earlier router.use() version 400'd every single request, including valid
// ones, because req.params.business_id was always empty at that point.)
const businessIdChecks = [requireValidBusinessId, enforceAllowedOrigin];

function handleWidgetError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof WidgetError) {
    error(res, err.message, err.status === 404 ? 'NOT_FOUND' : err.status === 403 ? 'FORBIDDEN' : err.status === 409 ? 'CONFLICT' : err.status === 401 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR', err.status);
    return;
  }
  console.error('Widget route error:', err);
  error(res, fallback, 'INTERNAL_ERROR', 500);
}

// ── Public: business, products, availability ────────────────────────────────

widgetRouter.get('/business/:business_id', ...businessIdChecks, async (req: Request, res: Response) => {
  try {
    const info = await widgetService.getBusinessInfo(req.params.business_id);
    success(res, info);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to load business');
  }
});

widgetRouter.get('/business/:business_id/products', ...businessIdChecks, async (req: Request, res: Response) => {
  try {
    const products = await widgetService.getProducts(req.params.business_id);
    success(res, products);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to load products');
  }
});

widgetRouter.get('/business/:business_id/products/:product_id', ...businessIdChecks, async (req: Request, res: Response) => {
  try {
    const product = await widgetService.getProductDetail(req.params.business_id, req.params.product_id);
    success(res, product);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to load product');
  }
});

widgetRouter.get('/availability', ...businessIdChecks, async (req: Request, res: Response) => {
  try {
    const { business_id, service_id, variant_id, month } = req.query as Record<string, string>;
    if (!business_id || !service_id || !variant_id || !month) {
      error(res, 'business_id, service_id, variant_id, and month are required', 'VALIDATION_ERROR', 400);
      return;
    }
    const result = await widgetService.getAvailabilityDays(business_id, service_id, variant_id, month);
    success(res, result);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to load availability');
  }
});

widgetRouter.get('/availability/slots', ...businessIdChecks, async (req: Request, res: Response) => {
  try {
    const { business_id, service_id, variant_id, date_from, date_to } = req.query as Record<string, string>;
    if (!business_id || !service_id || !variant_id || !date_from || !date_to) {
      error(res, 'business_id, service_id, variant_id, date_from, and date_to are required', 'VALIDATION_ERROR', 400);
      return;
    }
    const slots = await widgetService.getAvailabilitySlots(business_id, service_id, variant_id, date_from, date_to);
    success(res, slots);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to load slots');
  }
});

// ── Authenticated: hold, customer, booking, pay ──────────────────────────────
// A widget-specific mutation rate limit applies to all four below (Requirement 12.3).

widgetRouter.use(['/availability/hold', '/customer', '/booking'], widgetMutationLimiter);

const holdSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  service_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().required(),
  start_time: Joi.string().isoDate().required(),
});

widgetRouter.post('/availability/hold', ...businessIdChecks, authenticate, validate(holdSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const hold = await widgetService.holdSlot({
      businessId: req.body.business_id,
      serviceId: req.body.service_id,
      variantId: req.body.variant_id,
      startTime: req.body.start_time,
      userId: authReq.user.sub,
    });
    success(res, { hold_id: hold.id, expires_at: hold.expires_at }, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('already being held')) { error(res, err.message, 'CONFLICT', 409); return; }
    handleWidgetError(res, err, 'Failed to hold slot');
  }
});

const customerSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  phone: Joi.string().max(50).allow('', null),
});

widgetRouter.post('/customer', ...businessIdChecks, authenticate, validate(customerSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await widgetService.findOrCreateCustomer(req.body.business_id, authReq.user as any, req.body.phone || undefined);
    success(res, result.customer, undefined, result.isNew ? 201 : 200);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to resolve customer');
  }
});

const bookingSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().required(),
  service_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().required(),
  start_time: Joi.string().isoDate().required(),
  staff_id: Joi.string().uuid().allow(null),
  notes: Joi.string().allow('', null),
  hold_id: Joi.string().uuid().allow(null),
});

widgetRouter.post('/booking', ...businessIdChecks, authenticate, validate(bookingSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const booking = await widgetService.createWidgetBooking({
      businessId: req.body.business_id,
      customerId: req.body.customer_id,
      serviceId: req.body.service_id,
      variantId: req.body.variant_id,
      startTime: req.body.start_time,
      staffId: req.body.staff_id || undefined,
      notes: req.body.notes || undefined,
      holdId: req.body.hold_id || undefined,
    }, authReq.user as any);
    success(res, {
      booking_reference: booking.booking_reference,
      service_name: booking.service_name,
      start_time: booking.start_time,
      staff_name: booking.staff_first_name ? `${booking.staff_first_name} ${booking.staff_last_name}` : null,
      status: booking.status,
      id: booking.id,
    }, undefined, 201);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to create booking');
  }
});

const paySchema = Joi.object({
  business_id: Joi.string().uuid().required(),
});

widgetRouter.post('/booking/:booking_id/pay', ...businessIdChecks, authenticate, widgetMutationLimiter, validate(paySchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await widgetService.payForBooking(req.params.booking_id, req.body.business_id, authReq.user as any);
    success(res, result);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to process payment');
  }
});

// ── Phase 5 — package purchase / membership enrollment ───────────────────────

const packagePurchaseSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().required(),
  package_id: Joi.string().uuid().required(),
});

widgetRouter.use(['/package-purchase', '/membership-enrollment'], widgetMutationLimiter);

widgetRouter.post('/package-purchase', ...businessIdChecks, authenticate, validate(packagePurchaseSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await widgetService.purchaseWidgetPackage({
      businessId: req.body.business_id,
      customerId: req.body.customer_id,
      packageId: req.body.package_id,
    }, authReq.user as any);
    success(res, result, undefined, 201);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to purchase package');
  }
});

widgetRouter.post('/package-purchase/:purchase_id/pay', ...businessIdChecks, authenticate, validate(paySchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await widgetService.payForPackagePurchase(req.params.purchase_id, req.body.business_id, authReq.user as any);
    success(res, result);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to process payment');
  }
});

const membershipEnrollmentSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().required(),
  plan_id: Joi.string().uuid().required(),
  start_date: Joi.string().isoDate().required(),
});

widgetRouter.post('/membership-enrollment', ...businessIdChecks, authenticate, validate(membershipEnrollmentSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await widgetService.enrollWidgetMembership({
      businessId: req.body.business_id,
      customerId: req.body.customer_id,
      planId: req.body.plan_id,
      startDate: req.body.start_date,
    }, authReq.user as any);
    success(res, result, undefined, 201);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to enroll in membership');
  }
});

widgetRouter.post('/membership-enrollment/:enrollment_id/pay', ...businessIdChecks, authenticate, validate(paySchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await widgetService.payForMembershipEnrollment(req.params.enrollment_id, req.body.business_id, authReq.user as any);
    success(res, result);
  } catch (err) {
    handleWidgetError(res, err, 'Failed to process payment');
  }
});
