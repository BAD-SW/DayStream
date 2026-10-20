import { emitEvent } from '../services/integration-webhooks.service';
import { createActivity } from '../services/customer-activity.service';
import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as availabilityService from '../services/availability.service';

/** A booking refused by a business rule (a plain message for the user), as opposed to a failure. */
function isBookingRefusal(err: any): boolean {
  return err instanceof Error && !(err as any).severity && !/^(TypeError|ReferenceError|RangeError|SyntaxError)$/.test(err.name)
    && ((err as any).code === undefined || (err as any).code === 'BOOKING_RULE');
}

export const bookingsRouter = Router();

bookingsRouter.use(authenticate);
bookingsRouter.use(tenantContext);

function isCustomerRole(req: Request): boolean {
  return ((req as AuthenticatedRequest).user.role || '').trim().toLowerCase() === 'customer';
}

/**
 * Customer-role users hold bookings:read but may only see their own bookings.
 * Returns undefined for any other role (no restriction), the caller's customer id
 * in the business when they have a customer record there, or null when they have none.
 * A customer login is matched to its customer record by email.
 */
async function ownCustomerScope(req: Request, businessId: string): Promise<string | null | undefined> {
  if (!isCustomerRole(req)) return undefined;
  const authReq = req as AuthenticatedRequest;
  const { rows } = await adminPool.query(
    `SELECT c.id FROM cus_customers c
       JOIN usr_users u ON LOWER(u.email) = LOWER(c.email)
      WHERE u.id = $1 AND c.business_id = $2
      ORDER BY c.created_at ASC LIMIT 1`,
    [authReq.user.sub, businessId],
  );
  return rows[0]?.id ?? null;
}

/** Whole-business read views (calendar, recurring series) reject customer-role callers. */
function rejectCustomerRole(req: Request, res: Response): boolean {
  if (!isCustomerRole(req)) return false;
  error(res, 'Insufficient permissions', 'FORBIDDEN', 403);
  return true;
}

// ============================================================
// Availability
// ============================================================

// GET /api/v1/bookings/availability — Get available slots
bookingsRouter.get('/availability', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const serviceId = req.query.service_id as string;
    const businessId = req.query.business_id as string;
    const dateFrom = req.query.date_from as string;
    const dateTo = req.query.date_to as string;

    if (!serviceId || !businessId || !dateFrom || !dateTo) {
      error(res, 'service_id, business_id, date_from, and date_to are required', 'VALIDATION_ERROR', 400);
      return;
    }

    const slots = await availabilityService.getAvailableSlots({
      serviceId,
      businessId,
      dateFrom,
      dateTo,
      staffId: req.query.staff_id as string,
      locationId: req.query.location_id as string,
      variantId: req.query.variant_id as string,
    });

    success(res, slots, { count: slots.length });
  } catch (err: any) {
    console.error('Failed to calculate availability', err?.message || err);
    error(res, 'Failed to calculate availability', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/bookings/availability/combinations — Rich multi-filter data
bookingsRouter.get('/availability/combinations', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const serviceId = req.query.service_id as string;
    const businessId = req.query.business_id as string;
    const dateFrom = req.query.date_from as string;
    const dateTo = req.query.date_to as string;

    if (!serviceId || !businessId || !dateFrom || !dateTo) {
      error(res, 'service_id, business_id, date_from, and date_to are required', 'VALIDATION_ERROR', 400);
      return;
    }

    const result = await availabilityService.getAvailabilityCombinations({
      serviceId,
      businessId,
      dateFrom,
      dateTo,
      staffId: req.query.staff_id as string,
      locationId: req.query.location_id as string,
      variantId: req.query.variant_id as string,
    });

    success(res, result);
  } catch (err: any) {
    console.error('Failed to calculate availability combinations', err?.message || err);
    error(res, 'Failed to calculate availability combinations', 'INTERNAL_ERROR', 500);
  }
});

/** Whether every active location for a business is closed on a given date (override, else regular hours). */
export async function isDayClosedForBusiness(businessId: string, dateStr: string): Promise<boolean> {
  const { rows: locs } = await adminPool.query(
    "SELECT id FROM sys_locations WHERE business_id = $1 AND status = 'active'",
    [businessId],
  );
  if (locs.length === 0) return false; // no locations configured — don't block on closure

  const dayOfWeek = new Date(dateStr + 'T12:00:00Z').getUTCDay();

  for (const loc of locs) {
    const { rows: overrides } = await adminPool.query(
      'SELECT is_closed FROM sys_location_hour_overrides WHERE location_id = $1 AND override_date = $2',
      [loc.id, dateStr],
    );
    if (overrides.length > 0) {
      if (!overrides[0].is_closed) return false; // at least one location open via override
      continue;
    }
    const { rows: hours } = await adminPool.query(
      'SELECT is_closed FROM sys_location_hours WHERE location_id = $1 AND day_of_week = $2',
      [loc.id, dayOfWeek],
    );
    if (hours.length === 0 || !hours[0].is_closed) return false; // at least one location open
  }
  return true; // every location closed
}

/**
 * Decide a day's availability status from its slot list. A slot's `capacity_remaining` of
 * `undefined` means the slot carries no resource-capacity constraint (unlimited), so it must
 * default to `Infinity`, not `1` — defaulting to `1` would wrongly mark unconstrained days
 * unavailable for any participantCount > 1.
 */
export function computeDayStatus(
  slots: Array<{ capacity_remaining?: number }>,
  participantCount: number,
  isClosed: boolean,
): 'available' | 'unavailable' | 'closed' {
  if (slots.length === 0) return isClosed ? 'closed' : 'unavailable';
  const hasCapacity = slots.some((slot) => (slot.capacity_remaining ?? Infinity) >= participantCount);
  return hasCapacity ? 'available' : 'unavailable';
}

export function getDaysInMonth(month: string): string[] {
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

// GET /api/v1/bookings/availability/days — Per-day availability status for a month (feature 32)
bookingsRouter.get('/availability/days', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const serviceId = req.query.service_id as string;
    const variantId = req.query.variant_id as string;
    const businessId = req.query.business_id as string;
    const month = req.query.month as string;

    if (!serviceId || !variantId || !businessId || !month) {
      error(res, 'service_id, variant_id, business_id, and month are required', 'VALIDATION_ERROR', 400);
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      error(res, 'month must be in YYYY-MM format', 'VALIDATION_ERROR', 400);
      return;
    }

    const participantCountRaw = req.query.participant_count as string | undefined;
    const participantCount = participantCountRaw ? parseInt(participantCountRaw, 10) : 1;

    const days = getDaysInMonth(month);
    const result: Record<string, 'available' | 'unavailable' | 'closed'> = {};
    let timezone = 'UTC';

    for (const day of days) {
      const availability = await availabilityService.getAvailabilityCombinations({
        serviceId, businessId, variantId, dateFrom: day, dateTo: day,
      });
      timezone = availability.timezone;

      const isClosed = availability.slots.length === 0 ? await isDayClosedForBusiness(businessId, day) : false;
      result[day] = computeDayStatus(availability.slots, participantCount, isClosed);
    }

    success(res, { timezone, days: result });
  } catch (err: any) {
    console.error('Failed to load day availability', err?.message || err);
    error(res, 'Failed to load day availability', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/bookings/calendar — (registered before /:id)
import * as calendarServiceForward from '../services/booking-calendar.service';
import * as notificationsServiceForward from '../services/booking-notifications.service';

bookingsRouter.get('/calendar', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (rejectCustomerRole(req, res)) return;
    const view = (req.query.view as string) || 'day';
    if (!['day', 'week', 'month'].includes(view)) { error(res, 'view must be day, week, or month', 'VALIDATION_ERROR', 400); return; }
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const serviceIds = (req.query.service_id as string | undefined)?.split(',').filter(Boolean);
    const result = await calendarServiceForward.getCalendar({
      businessId, view: view as 'day' | 'week' | 'month', date,
      staffId: req.query.staff_id as string, resourceId: req.query.resource_id as string,
      serviceIds, status: req.query.status as string,
    });
    success(res, result);
  } catch (err: any) {
    console.error('Failed to load calendar', err?.message || err);
    error(res, 'Failed to load calendar', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/bookings/filters — (registered before /:id)
// What the bookings list needs to render for ANY business user: the business time zone
// (times are shown in business-local time) and the staff / service names for its filters.
// The full staff, services and business endpoints need staff:read / services:read /
// settings:*, which front-line staff do not hold; this exposes names only.
import * as staffServiceForward from '../services/staff.service';
import * as locationHoursServiceForward from '../services/location-hours.service';

bookingsRouter.get('/filters', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (rejectCustomerRole(req, res)) return;
    const authReq = req as AuthenticatedRequest;
    const biz = await adminPool.query(
      'SELECT timezone, currency FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [businessId, authReq.tenantId],
    );
    if (!biz.rows[0]) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }
    const [staff, services, primaryLocation] = await Promise.all([
      staffServiceForward.getStaffList(authReq.tenantId, { status: 'active', businessId, page: 1, limit: 200 }),
      adminPool.query(`SELECT id, name, status FROM svc_services WHERE business_id = $1 AND status <> 'archived' ORDER BY name`, [businessId]),
      adminPool.query(`SELECT id FROM sys_locations WHERE business_id = $1 ORDER BY is_primary DESC, display_order, name LIMIT 1`, [businessId]),
    ]);
    // Opening hours of the primary location size the calendar's time axis. Served here because
    // the locations endpoints need settings:read, which staff roles do not have.
    const locationHours = primaryLocation.rows[0]
      ? await locationHoursServiceForward.getLocationHours(primaryLocation.rows[0].id)
      : [];
    success(res, {
      timezone: biz.rows[0].timezone || 'UTC',
      currency: biz.rows[0].currency || null,
      staff: (staff.staff as any[]).map((s) => ({ user_id: s.user_id, first_name: s.first_name, last_name: s.last_name })),
      services: services.rows,
      location_hours: locationHours,
    });
  } catch (err: any) {
    console.error('Failed to load booking filters', err?.message || err);
    error(res, 'Failed to load booking filters', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/bookings/rules — (registered before /:id)
import * as rulesServiceForward from '../services/booking-rules.service';

bookingsRouter.get('/rules', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    const serviceId = req.query.service_id as string;
    if (!businessId || !serviceId) { error(res, 'business_id and service_id required', 'VALIDATION_ERROR', 400); return; }
    const rules = await rulesServiceForward.getBookingRulesSummary(serviceId, businessId);
    if (!rules) { error(res, 'Service not found', 'NOT_FOUND', 404); return; }
    success(res, rules);
  } catch (err: any) {
    console.error('Failed to get rules', err?.message || err);
    error(res, 'Failed to get rules', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/bookings/recurring/:seriesId — (registered before /:id to avoid conflict)
// Actual handler defined below with other recurring routes, but route registered here for ordering
import * as recurringServiceForward from '../services/recurring-bookings.service';
bookingsRouter.get('/recurring/:seriesId', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    if (rejectCustomerRole(req, res)) return;
    const series = await recurringServiceForward.getSeriesById(req.params.seriesId, businessId);
    if (!series) { error(res, 'Series not found', 'NOT_FOUND', 404); return; }
    success(res, series);
  } catch (err: any) {
    console.error('Failed to get series', err?.message || err);
    error(res, 'Failed to get series', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// Booking CRUD
// ============================================================

import * as bookingService from '../services/booking.service';

const createBookingSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().allow(null, ''),
  walk_in_name: Joi.string().max(100).allow('', null),
  service_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().required(),
  staff_id: Joi.string().uuid().allow(null),
  resource_id: Joi.string().uuid().allow(null),
  start_time: Joi.string().isoDate().required(),
  notes: Joi.string().max(500).allow('', null),
  override_rules: Joi.boolean().default(false),
  participant_count: Joi.number().integer().min(1).default(1),
});

// POST /api/v1/bookings — Create booking
bookingsRouter.post('/', requirePermission('bookings:*'), validate(createBookingSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const booking = await bookingService.createBooking({
      businessId: req.body.business_id,
      customerId: req.body.customer_id || undefined,
      walkInName: req.body.walk_in_name,
      serviceId: req.body.service_id,
      variantId: req.body.variant_id,
      staffId: req.body.staff_id,
      resourceId: req.body.resource_id,
      startTime: req.body.start_time,
      notes: req.body.notes,
      createdBy: authReq.user.sub,
      tenantId: authReq.tenantId,
      overrideRules: req.body.override_rules,
      participantCount: req.body.participant_count,
    });

    emitEvent(authReq.tenantId, 'booking.created', {
      id: booking.id, business_id: booking.business_id, booking_reference: booking.booking_reference, customer_id: booking.customer_id,
      service_id: booking.service_id, staff_id: booking.staff_id, start_time: booking.start_time, end_time: booking.end_time, status: booking.status,
    });
    success(res, booking, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('not found')) {
      error(res, err.message, 'NOT_FOUND', 404);
    } else if (err.message.includes('conflict') || err.message.includes('capacity') || err.message.includes('advance booking') || err.message.includes('No staff')) {
      error(res, err.message, 'CONFLICT', 409);
    } else if (err instanceof Error && !(err as any).severity && !/^(TypeError|ReferenceError|RangeError|SyntaxError)$/.test(err.name) && ((err as any).code === undefined || (err as any).code === 'BOOKING_RULE')) {
      // Closed that day, outside opening hours, provider not available, daily limit reached,
      // resource under maintenance, service paused... The person booking needs the reason;
      // they used to get "Failed to create booking".
      error(res, err.message, 'BOOKING_NOT_ALLOWED', 409);
    } else {
      console.error('Booking creation error:', err);
      error(res, 'Failed to create booking', 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/bookings — List bookings
bookingsRouter.get('/', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const ownCustomerId = await ownCustomerScope(req, businessId);
    if (ownCustomerId === null) {
      success(res, [], { page, limit, total: 0, totalPages: 0 });
      return;
    }

    const result = await bookingService.getBookings({
      businessId,
      dateFrom: req.query.date_from as string,
      dateTo: req.query.date_to as string,
      status: req.query.status as string,
      customerId: ownCustomerId ?? (req.query.customer_id as string),
      customerSearch: ownCustomerId ? undefined : (req.query.customer_search as string),
      staffId: req.query.staff_id as string,
      serviceId: req.query.service_id as string,
      page,
      limit,
    });

    success(res, result.bookings, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  } catch (err: any) {
    console.error('Failed to list bookings', err?.message || err);
    error(res, 'Failed to list bookings', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/bookings/:id — Get booking detail
bookingsRouter.get('/:id', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const booking = await bookingService.getBookingById(req.params.id, businessId);
    if (!booking) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }
    const ownCustomerId = await ownCustomerScope(req, businessId);
    if (ownCustomerId !== undefined && (ownCustomerId === null || booking.customer_id !== ownCustomerId)) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }

    success(res, booking);
  } catch (err: any) {
    console.error('Failed to get booking', err?.message || err);
    error(res, 'Failed to get booking', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// Booking Lifecycle (Status Transitions)
// ============================================================

import * as lifecycleService from '../services/booking-lifecycle.service';

const cancelSchema = Joi.object({
  reason: Joi.string().max(500).allow('', null),
});

const rescheduleSchema = Joi.object({
  start_time: Joi.string().isoDate().required(),
  staff_id: Joi.string().uuid().allow(null),
});

// PUT /api/v1/bookings/:id/confirm
bookingsRouter.put('/:id/confirm', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await lifecycleService.confirmBooking(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result.success) {
      const status = result.error === 'Booking not found' ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'INVALID_TRANSITION', status);
      return;
    }
    success(res, result.booking);
  } catch (err: any) {
    console.error('Failed to confirm booking', err?.message || err);
    error(res, 'Failed to confirm booking', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/bookings/:id/cancel
bookingsRouter.put('/:id/cancel', requirePermission('bookings:*'), validate(cancelSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await lifecycleService.cancelBooking(req.params.id, businessId, authReq.user.sub, authReq.tenantId, req.body.reason);
    if (!result.success) {
      const status = result.error === 'Booking not found' ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'INVALID_TRANSITION', status);
      return;
    }
    emitEvent(authReq.tenantId, 'booking.cancelled', { id: req.params.id, business_id: businessId, reason: req.body.reason || null });
    success(res, { ...result.booking, cancellation_fee: result.cancellation_fee });
  } catch (err: any) {
    console.error('Failed to cancel booking', err?.message || err);
    error(res, 'Failed to cancel booking', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/bookings/:id/check-in
bookingsRouter.put('/:id/check-in', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await lifecycleService.checkInBooking(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result.success) {
      const status = result.error === 'Booking not found' ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'INVALID_TRANSITION', status);
      return;
    }
    success(res, result.booking);
  } catch (err: any) {
    console.error('Check-in error:', err);
    error(res, 'Failed to check in', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/bookings/:id/complete
bookingsRouter.put('/:id/complete', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await lifecycleService.completeBooking(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result.success) {
      const status = result.error === 'Booking not found' ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'INVALID_TRANSITION', status);
      return;
    }
    success(res, result.booking);
  } catch (err: any) {
    console.error('Failed to complete booking', err?.message || err);
    error(res, 'Failed to complete booking', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/bookings/:id/reset
bookingsRouter.put('/:id/reset', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await lifecycleService.resetBooking(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result.success) {
      const status = result.error === 'Booking not found' ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'INVALID_TRANSITION', status);
      return;
    }
    success(res, result.booking);
  } catch (err: any) {
    console.error('Failed to reset booking', err?.message || err);
    error(res, 'Failed to reset booking', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/bookings/:id/no-show
bookingsRouter.put('/:id/no-show', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await lifecycleService.noShowBooking(req.params.id, businessId, authReq.user.sub, authReq.tenantId);
    if (!result.success) {
      const status = result.error === 'Booking not found' ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'INVALID_TRANSITION', status);
      return;
    }
    success(res, { ...result.booking, no_show_fee: result.no_show_fee ?? 0 });
  } catch (err: any) {
    console.error('Failed to mark no-show', err?.message || err);
    error(res, 'Failed to mark no-show', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/bookings/:id/reschedule
bookingsRouter.put('/:id/reschedule', requirePermission('bookings:*'), validate(rescheduleSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await lifecycleService.rescheduleBooking(
      req.params.id, businessId, req.body.start_time, req.body.staff_id,
      authReq.user.sub, authReq.tenantId,
    );

    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 400;
      error(res, result.error!, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', status);
      return;
    }
    success(res, result.booking);
  } catch (err: any) {
    console.error('Failed to reschedule booking', err?.message || err);
    error(res, 'Failed to reschedule booking', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/bookings/:id — Full booking update (change service, variant, staff, time, notes)
const updateBookingSchema = Joi.object({
  service_id: Joi.string().uuid(),
  variant_id: Joi.string().uuid(),
  staff_id: Joi.string().uuid().allow(null),
  start_time: Joi.string().isoDate(),
  notes: Joi.string().allow('', null),
  customer_id: Joi.string().uuid().allow(null),
  walk_in_name: Joi.string().allow('', null),
  participant_count: Joi.number().integer().min(1),
  override_rules: Joi.boolean(),
});

bookingsRouter.put('/:id', requirePermission('bookings:*'), validate(updateBookingSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const existing = await bookingService.getBookingById(req.params.id, businessId);
    if (!existing) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }

    // Build update fields
    const updates: Record<string, any> = {};
    if (req.body.service_id !== undefined) updates.service_id = req.body.service_id;
    if (req.body.variant_id !== undefined) updates.variant_id = req.body.variant_id;
    if (req.body.staff_id !== undefined) updates.staff_id = req.body.staff_id;
    if (req.body.customer_id !== undefined) updates.customer_id = req.body.customer_id;
    if (req.body.walk_in_name !== undefined) updates.walk_in_name = req.body.walk_in_name || null;
    if (req.body.participant_count !== undefined) updates.participant_count = req.body.participant_count;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;

    if (Object.keys(updates).length === 0 && !req.body.start_time) {
      success(res, existing);
      return;
    }

    // A change of time, provider, service, variant, customer or headcount is checked exactly
    // like a new booking (opening hours, provider availability, conflicts, resources, capacity)
    // and the end time and price follow the variant. The edit screen used to write these
    // straight to the record, so it could double-book and kept the old length and price.
    const same = (k: string) => (k === 'start_time'
      ? new Date(req.body.start_time).getTime() === new Date(existing.start_time).getTime()
      : String(req.body[k] ?? '') === String((existing as any)[k] ?? ''));
    const slotChange = ['service_id', 'variant_id', 'staff_id', 'start_time', 'participant_count', 'customer_id']
      .some((k) => req.body[k] !== undefined && req.body[k] !== '' && !same(k));
    if (slotChange && !['pending', 'confirmed'].includes(existing.status)) {
      error(res, `A booking that is ${existing.status} cannot be moved or changed`, 'INVALID_TRANSITION', 400);
      return;
    }

    const saved = await bookingService.withBookingLock(businessId, async () => {
      if (slotChange) {
        const offeringChanged = (req.body.service_id !== undefined && !same('service_id')) || (req.body.variant_id !== undefined && !same('variant_id'));
        const plan = await bookingService.planBookingChange({
          businessId, tenantId: authReq.tenantId, createdBy: authReq.user.sub,
          customerId: (updates.customer_id !== undefined ? updates.customer_id : existing.customer_id) || undefined,
          walkInName: updates.walk_in_name ?? existing.walk_in_name ?? undefined,
          serviceId: updates.service_id || existing.service_id,
          variantId: updates.variant_id || existing.variant_id,
          staffId: (updates.staff_id !== undefined ? updates.staff_id : existing.staff_id) || undefined,
          resourceId: (req.body.service_id !== undefined && !same('service_id')) ? undefined : (existing.resource_id || undefined),
          startTime: new Date(req.body.start_time || existing.start_time).toISOString(),
          participantCount: updates.participant_count ?? existing.participant_count ?? 1,
          overrideRules: req.body.override_rules === true,
          excludeBookingId: existing.id,
        });
        updates.start_time = plan.start_time;
        updates.end_time = plan.end_time;
        if (plan.staff_id) updates.staff_id = plan.staff_id;
        if (plan.resource_id) updates.resource_id = plan.resource_id;
        if (offeringChanged) { updates.price = plan.price; updates.booking_type = plan.booking_type; }
      }

    // Build SQL update
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }
    fields.push('updated_at = NOW()');
    values.push(req.params.id, businessId);

    const { rows } = await adminPool.query(
      `UPDATE apt_bookings SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
      values,
    );
      return rows[0] || null;
    });

    if (!saved) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }
    if (slotChange && saved.customer_id && new Date(saved.start_time).getTime() !== new Date(existing.start_time).getTime()) {
      await createActivity({
        customerId: saved.customer_id, businessId, activityType: 'booking',
        description: `Booking ${saved.booking_reference} moved`,
        metadata: { booking_id: saved.id, old_start: existing.start_time, new_start: saved.start_time },
        createdBy: authReq.user.sub,
      }).catch(() => undefined);

      // Appointment reschedule email — this edit path moves the time without going
      // through rescheduleBooking, so fire the notice here too (old → new time).
      // Hydrate for service/staff names; skip when no customer email. Non-blocking.
      bookingService.getBookingById(saved.id, businessId)
        .then((full) => {
          if (full?.customer_email) return notificationsServiceForward.queueBookingReschedule(full, full.customer_email, existing.start_time);
        })
        .catch(() => undefined);
    }
    success(res, saved);
  } catch (err: any) {
    if (isBookingRefusal(err)) { error(res, err.message, /conflict/i.test(err.message) ? 'CONFLICT' : 'BOOKING_NOT_ALLOWED', 409); return; }
    console.error('Failed to update booking', err?.message || err);
    error(res, 'Failed to update booking', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/bookings/:id/ical — Download iCal file
bookingsRouter.get('/:id/ical', requirePermission('bookings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const booking = await bookingService.getBookingById(req.params.id, businessId);
    if (!booking) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }
    const ownCustomerId = await ownCustomerScope(req, businessId);
    if (ownCustomerId !== undefined && (ownCustomerId === null || booking.customer_id !== ownCustomerId)) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }

    const ical =notificationsServiceForward.generateICal({
      booking_reference: booking.booking_reference,
      service_name: booking.service_name,
      start_time: booking.start_time,
      end_time: booking.end_time,
      staff_name: booking.staff_first_name ? `${booking.staff_first_name} ${booking.staff_last_name}` : undefined,
    });

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="${booking.booking_reference}.ics"`);
    res.send(ical);
  } catch (err: any) {
    console.error('Failed to generate iCal', err?.message || err);
    error(res, 'Failed to generate iCal', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// Slot Holds
// ============================================================

import * as holdService from '../services/slot-hold.service';

const createHoldSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  service_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().required(),
  staff_id: Joi.string().uuid().allow(null),
  resource_id: Joi.string().uuid().allow(null),
  start_time: Joi.string().isoDate().required(),
  end_time: Joi.string().isoDate().required(),
});

// POST /api/v1/bookings/hold — Hold a slot
bookingsRouter.post('/hold', requirePermission('bookings:*'), validate(createHoldSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const hold = await holdService.createHold({
      businessId: req.body.business_id,
      serviceId: req.body.service_id,
      variantId: req.body.variant_id,
      staffId: req.body.staff_id,
      resourceId: req.body.resource_id,
      startTime: req.body.start_time,
      endTime: req.body.end_time,
      heldBy: authReq.user.sub,
    });
    success(res, hold, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('already being held') || err.message.includes('conflict')) {
      error(res, err.message, 'CONFLICT', 409);
    } else {
      error(res, 'Failed to hold slot', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/bookings/hold/:id — Release a held slot
bookingsRouter.delete('/hold/:id', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const released = await holdService.releaseHold(req.params.id, authReq.user.sub);
    if (!released) { error(res, 'Hold not found', 'NOT_FOUND', 404); return; }
    success(res, { released: true });
  } catch (err: any) {
    console.error('Failed to release hold', err?.message || err);
    error(res, 'Failed to release hold', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Waitlist
// ============================================================

import * as waitlistService from '../services/waitlist.service';

const joinWaitlistSchema = Joi.object({
  customer_id: Joi.string().uuid().required(),
  slot_start_time: Joi.string().isoDate().required(),
  slot_end_time: Joi.string().isoDate().required(),
});

// POST /api/v1/bookings/:id/waitlist — Join waitlist (id = service_id here)
bookingsRouter.post('/:id/waitlist', requirePermission('bookings:*'), validate(joinWaitlistSchema), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    // Both the session's service and the person must belong to this business.
    const { rows: ownRows } = await adminPool.query(
      `SELECT (SELECT COUNT(*) FROM svc_services WHERE id = $1 AND business_id = $3)::int AS svc,
              (SELECT COUNT(*) FROM cus_customers WHERE id = $2 AND business_id = $3)::int AS cust`,
      [req.params.id, req.body.customer_id, businessId],
    );
    if (!ownRows[0].svc) { error(res, 'Service not found', 'NOT_FOUND', 404); return; }
    if (!ownRows[0].cust) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }

    const entry = await waitlistService.joinWaitlist(
      businessId, req.params.id, req.body.customer_id,
      req.body.slot_start_time, req.body.slot_end_time,
    );
    success(res, entry, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('Already on') || err.message.includes('full')) {
      error(res, err.message, 'CONFLICT', 409);
    } else {
      console.error('Failed to join waitlist', err?.message || err);
      error(res, 'Failed to join waitlist', 'INTERNAL_ERROR', 500);
    }
  }
});

// DELETE /api/v1/bookings/:id/waitlist — Leave waitlist
bookingsRouter.delete('/:id/waitlist', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const customerId = req.query.customer_id as string;
    const slotStartTime = req.query.slot_start_time as string;
    if (!customerId || !slotStartTime) {
      error(res, 'customer_id and slot_start_time required', 'VALIDATION_ERROR', 400);
      return;
    }

    const removed = await waitlistService.leaveWaitlist(req.params.id, slotStartTime, customerId, req.query.business_id as string | undefined);
    if (!removed) { error(res, 'Waitlist entry not found', 'NOT_FOUND', 404); return; }
    success(res, { removed: true });
  } catch (err: any) {
    console.error('Failed to leave waitlist', err?.message || err);
    error(res, 'Failed to leave waitlist', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/bookings/waitlist/:entryId/confirm — Confirm waitlist promotion
bookingsRouter.put('/waitlist/:entryId/confirm', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Resolve customer from user
    const customerId = req.query.customer_id as string;
    if (!customerId) { error(res, 'customer_id required', 'VALIDATION_ERROR', 400); return; }

    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await waitlistService.confirmPromotion(req.params.entryId, customerId, { businessId, tenantId: authReq.tenantId, userId: authReq.user.sub });
    if (!result.confirmed) {
      error(res, result.error!, 'VALIDATION_ERROR', 400);
      return;
    }
    success(res, { confirmed: true, booking: result.booking });
  } catch (err: any) {
    console.error('Failed to confirm waitlist', err?.message || err);
    error(res, 'Failed to confirm waitlist', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// Recurring Bookings
// ============================================================

import * as recurringService from '../services/recurring-bookings.service';

const createRecurringSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  customer_id: Joi.string().uuid().required(),
  service_id: Joi.string().uuid().required(),
  variant_id: Joi.string().uuid().required(),
  staff_id: Joi.string().uuid().allow(null),
  recurrence_pattern: Joi.string().valid('weekly', 'biweekly', 'monthly').required(),
  day_of_week: Joi.number().integer().min(0).max(6).allow(null),
  day_of_month: Joi.number().integer().min(1).max(31).allow(null),
  start_time: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  end_type: Joi.string().valid('ongoing', 'count', 'date').default('ongoing'),
  end_count: Joi.number().integer().min(1).allow(null),
  end_date: Joi.string().isoDate().allow(null),
});

// POST /api/v1/bookings/recurring — Create recurring series
bookingsRouter.post('/recurring', requirePermission('bookings:*'), validate(createRecurringSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await recurringService.createRecurringSeries({
      businessId: req.body.business_id,
      customerId: req.body.customer_id,
      serviceId: req.body.service_id,
      variantId: req.body.variant_id,
      staffId: req.body.staff_id,
      recurrencePattern: req.body.recurrence_pattern,
      dayOfWeek: req.body.day_of_week,
      dayOfMonth: req.body.day_of_month,
      startTime: req.body.start_time,
      endType: req.body.end_type,
      endCount: req.body.end_count,
      endDate: req.body.end_date,
      createdBy: authReq.user.sub,
      tenantId: authReq.tenantId,
    });

    success(res, result, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('required')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to create recurring series', 'INTERNAL_ERROR', 500);
    }
  }
});

// (GET /api/v1/bookings/recurring/:seriesId registered above, before /:id)

// PUT /api/v1/bookings/recurring/:seriesId/cancel — Cancel future occurrences
bookingsRouter.put('/recurring/:seriesId/cancel', requirePermission('bookings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await recurringService.cancelSeries(req.params.seriesId, businessId, authReq.user.sub, authReq.tenantId);
    success(res, result);
  } catch (err: any) {
    console.error('Failed to cancel series', err?.message || err);
    error(res, 'Failed to cancel series', 'INTERNAL_ERROR', 500);
  }
});


// (Calendar and Rules routes registered above, before /:id)
// (iCal route uses /:id/ical which is fine since it's a sub-path)
