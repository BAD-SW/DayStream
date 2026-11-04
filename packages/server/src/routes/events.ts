import { createActivity } from '../services/customer-activity.service';
import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext, callerScope, ownCustomerIds } from '../auth/tenant-context';
import { adminPool } from '../db/pool';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as eventTypesService from '../services/event-types.service';
import * as eventService from '../services/event.service';
import * as recurringService from '../services/recurring-events.service';
import * as seriesService from '../services/event-series.service';
import * as ticketsService from '../services/event-tickets.service';
import * as registrationService from '../services/event-registration.service';
import * as waitlistService from '../services/event-waitlist.service';
import * as checkinService from '../services/event-checkin.service';
import * as commsService from '../services/event-communications.service';
import * as reportsService from '../services/event-reports.service';
import * as customerEvents from '../services/customer-events.service';

export const eventsRouter = Router();

// ============================================================
// Public Calendar (no auth required)
// ============================================================

eventsRouter.get('/calendar', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) { error(res, 'tenant_id required', 'VALIDATION_ERROR', 400); return; }
    const result = await eventService.getEvents(tenantId, {
      status: 'published',
      startDate: req.query.start_date as string || new Date().toISOString(),
      eventTypeId: req.query.event_type_id as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    const visible = result.events.map((e: any) => ({
      id: e.id, slug: e.slug, title: e.title, description: e.description, start_time: e.start_time, end_time: e.end_time,
      location_name: e.location_name, capacity: e.capacity, tags: e.tags, event_type_id: e.event_type_id, status: e.status,
    }));
    success(res, visible, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) { console.error('Failed to load calendar', err?.message || err); error(res, 'Failed to load calendar', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/calendar/:slug', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) { error(res, 'tenant_id required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await (await import('../db/pool')).adminPool.query(
      `SELECT e.*, et.name AS event_type_name FROM evt_events e
       LEFT JOIN evt_types et ON et.id = e.event_type_id
       WHERE e.slug = $1 AND e.tenant_id = $2 AND e.status = 'published' AND e.deleted_at IS NULL`, [req.params.slug, tenantId]);
    if (rows.length === 0) { error(res, 'Event not found', 'NOT_FOUND', 404); return; }
    // Load tiers
    const tiers = await ticketsService.getTiers(rows[0].id);
    success(res, { ...rows[0], tiers });
  } catch (err: any) { console.error('Failed to load event', err?.message || err); error(res, 'Failed to load event', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Authenticated routes
// ============================================================

eventsRouter.use(authenticate);
eventsRouter.use(tenantContext);

// Events belong to an organisation. Every record addressed by id on these routes must be one of
// the caller's organisation, or it does not exist for them. (Registrations, attendees and
// tickets of any organisation's event could be read and changed by its id.)
const UUID = /^[0-9a-f-]{36}$/i;
function inOwnTenant(sql: string, what: string) {
  return (req: Request, res: Response, next: NextFunction, id: string): void => {
    (async () => {
      const authReq = req as AuthenticatedRequest;
      const { rows } = UUID.test(id || '') ? await adminPool.query(sql, [id]) : { rows: [] as any[] };
      const scope = await callerScope(authReq.user.sub);
      if (!rows[0] || (scope?.level !== 'system' && rows[0].tenant_id !== authReq.tenantId)) {
        res.status(404).json({ error: `${what} not found`, code: 'NOT_FOUND' });
        return;
      }
      next();
    })().catch(next);
  };
}
eventsRouter.param('id', inOwnTenant(
  `SELECT tenant_id FROM evt_events WHERE id = $1 UNION ALL SELECT tenant_id FROM evt_recurring_templates WHERE id = $1
   UNION ALL SELECT tenant_id FROM evt_series WHERE id = $1 UNION ALL SELECT tenant_id FROM evt_types WHERE id = $1`, 'Event'));
eventsRouter.param('rid', inOwnTenant('SELECT e.tenant_id FROM evt_registrations r JOIN evt_events e ON e.id = r.event_id WHERE r.id = $1', 'Registration'));
eventsRouter.param('wid', inOwnTenant('SELECT e.tenant_id FROM evt_waitlist w JOIN evt_events e ON e.id = w.event_id WHERE w.id = $1', 'Waitlist entry'));

const canManageEvents = (req: Request): boolean =>
  ((req as AuthenticatedRequest).user.permissions || []).some((p: string) => p === 'events:*' || p === '*:*');

function customerEventError(res: Response, err: any, fallback: string): void {
  if (err instanceof customerEvents.CustomerEventError) { error(res, err.message, err.code, err.status); return; }
  console.error(fallback, err?.message || err);
  error(res, err?.message || fallback, 'INTERNAL_ERROR', 500);
}

// ============================================================
// Events for customers (THE-20): the organisation's events, their own registrations,
// paying online, cancelling within the hosting business's limits. A customer has no
// events permission; what they may see and do is decided by their own customer records.
// ============================================================

eventsRouter.get('/customer/events', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await customerEvents.listForCustomer(authReq.tenantId, await ownCustomerIds(req)));
  } catch (err: any) { customerEventError(res, err, 'Failed to load events'); }
});

eventsRouter.get('/customer/my-events', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await customerEvents.myEvents(authReq.tenantId, await ownCustomerIds(req)));
  } catch (err: any) { customerEventError(res, err, 'Failed to load your events'); }
});

eventsRouter.get('/customer/events/:id', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await customerEvents.eventForCustomer(authReq.tenantId, req.params.id, await ownCustomerIds(req)));
  } catch (err: any) { customerEventError(res, err, 'Failed to load event'); }
});

/** The registration is one of the caller's own (or the caller manages events). */
async function ownRegistration(req: Request, rid: string) {
  const { rows } = await adminPool.query('SELECT id, customer_id, event_id, order_id, status FROM evt_registrations WHERE id = $1', [rid]);
  const own = await ownCustomerIds(req);
  if (!rows[0] || (!canManageEvents(req) && !own.includes(rows[0].customer_id))) return null;
  return rows[0];
}

// Finish an online payment: the card was confirmed in the browser; the server verifies it at
// the provider, completes the order and confirms the place.
eventsRouter.post('/customer/registrations/:rid/pay', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const reg = await ownRegistration(req, req.params.rid);
    if (!reg) { error(res, 'Registration not found', 'NOT_FOUND', 404); return; }
    const ref = req.body.provider_reference as string;
    if (!ref) { error(res, 'provider_reference required', 'VALIDATION_ERROR', 400); return; }
    if (!reg.order_id) { error(res, 'This registration has no online payment', 'CONFLICT', 409); return; }
    const { rows: o } = await adminPool.query('SELECT business_id, status FROM fin_orders WHERE id = $1', [reg.order_id]);
    const checkout = await import('../services/checkout.service');
    // A place released while the card was being confirmed: the order is open again so the
    // money taken is recorded, then the place is given back if one is free, or refunded.
    const released = reg.status === 'cancelled';
    if (o[0]?.status === 'voided' && released) await adminPool.query(`UPDATE fin_orders SET status = 'open' WHERE id = $1`, [reg.order_id]);
    if (o[0]?.status !== 'completed') {
      try {
        await checkout.completeOrder(reg.order_id, o[0].business_id, { paymentMethod: 'card', oneTimeChargeRef: ref, checkedOutBy: authReq.user.sub });
      } catch (e: any) { error(res, e.message || 'The payment was not completed', e.code || 'PAYMENT_DECLINED', 402); return; }
    }
    if (released) {
      const { rows: ev } = await adminPool.query(
        `SELECT e.capacity, (SELECT COALESCE(SUM(r.group_size), 0)::int FROM evt_registrations r WHERE r.event_id = e.id AND ${customerEvents.HOLDS_PLACE}) AS taken,
                (SELECT group_size FROM evt_registrations WHERE id = $2) AS size
           FROM evt_events e WHERE e.id = $1`, [reg.event_id, reg.id]);
      if (ev[0] && ev[0].taken + ev[0].size <= ev[0].capacity) {
        await adminPool.query(`UPDATE evt_registrations SET status = 'confirmed', cancelled_at = NULL, hold_expires_at = NULL WHERE id = $1`, [reg.id]);
      } else {
        await adminPool.query(`UPDATE evt_registrations SET status = 'pending' WHERE id = $1`, [reg.id]);
        const out = await customerEvents.cancelOwnRegistration({ registrationId: reg.id, tenantId: authReq.tenantId, userId: authReq.user.sub, byCustomer: false });
        error(res, 'The place was released before the payment finished and the event is now full; the payment was refunded', 'PLACE_RELEASED', 409);
        void out; return;
      }
    }
    const paidReg = await customerEvents.markRegistrationPaid(reg.id);
    await customerEvents.queueEventEmail(reg.id, 'confirmed');
    success(res, paidReg);
  } catch (err: any) { customerEventError(res, err, 'Failed to finish the payment'); }
});

eventsRouter.put('/customer/registrations/:rid/cancel', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const reg = await ownRegistration(req, req.params.rid);
    if (!reg) { error(res, 'Registration not found', 'NOT_FOUND', 404); return; }
    const out = await customerEvents.cancelOwnRegistration({ registrationId: reg.id, tenantId: authReq.tenantId, userId: authReq.user.sub, byCustomer: true });
    const { rows: info } = await adminPool.query('SELECT c.business_id, e.title FROM cus_customers c, evt_events e WHERE c.id = $1 AND e.id = $2', [reg.customer_id, reg.event_id]);
    if (info[0]) {
      await createActivity({
        customerId: reg.customer_id, businessId: info[0].business_id, activityType: 'event',
        description: `Cancelled the registration for the event: ${info[0].title}`,
        metadata: { event_id: reg.event_id, registration_id: reg.id }, createdBy: authReq.user.sub,
      }).catch(() => undefined);
    }
    success(res, out);
  } catch (err: any) { customerEventError(res, err, 'Failed to cancel'); }
});

eventsRouter.delete('/customer/waitlist/:wid', async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query('SELECT customer_id FROM evt_waitlist WHERE id = $1', [req.params.wid]);
    const own = await ownCustomerIds(req);
    if (!rows[0] || (!canManageEvents(req) && !own.includes(rows[0].customer_id))) { error(res, 'Waitlist entry not found', 'NOT_FOUND', 404); return; }
    const { rows: done } = await adminPool.query(
      `UPDATE evt_waitlist SET status = 'cancelled' WHERE id = $1 AND status IN ('waiting', 'notified') RETURNING *`, [req.params.wid]);
    if (!done[0]) { error(res, 'You are no longer on this waitlist', 'CONFLICT', 409); return; }
    success(res, done[0]);
  } catch (err: any) { customerEventError(res, err, 'Failed to leave the waitlist'); }
});

// Reception takes the payment of a place held for payment at reception: the ticket's order
// is opened in the hosting business and paid through checkout, which confirms the place.
eventsRouter.post('/registrations/:rid/checkout', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await adminPool.query('SELECT status, ticket_tier_id FROM evt_registrations WHERE id = $1', [req.params.rid]);
    if (rows[0]?.status !== 'pending') { error(res, 'Only a place waiting for payment can be paid', 'CONFLICT', 409); return; }
    const { orderId, hostId } = await customerEvents.createTicketOrder(req.params.rid, authReq.user.sub);
    success(res, { order_id: orderId, business_id: hostId });
  } catch (err: any) { customerEventError(res, err, 'Failed to open the payment'); }
});

// ============================================================
// Event Types (before /:id)
// ============================================================

eventsRouter.get('/types', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const types = await eventTypesService.getEventTypes(authReq.tenantId);
    success(res, types);
  } catch (err: any) { console.error('Failed to list event types', err?.message || err); error(res, 'Failed to list event types', 'INTERNAL_ERROR', 500); }
});

eventsRouter.post('/types', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const type = await eventTypesService.createEventType(authReq.tenantId, req.body);
    success(res, type, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('duplicate') || err.message?.includes('unique')) error(res, 'Type already exists', 'DUPLICATE', 409);
    else error(res, 'Failed to create type', 'INTERNAL_ERROR', 500);
  }
});

eventsRouter.put('/types/:id', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const type = await eventTypesService.updateEventType(req.params.id, authReq.tenantId, req.body);
    if (!type) { error(res, 'Type not found', 'NOT_FOUND', 404); return; }
    success(res, type);
  } catch (err: any) { console.error('Failed to update type', err?.message || err); error(res, 'Failed to update type', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Recurring Events (before /:id)
// ============================================================

eventsRouter.get('/recurring', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const templates = await recurringService.getTemplates(authReq.tenantId);
    success(res, templates);
  } catch (err: any) { console.error('Failed to list templates', err?.message || err); error(res, 'Failed to list templates', 'INTERNAL_ERROR', 500); }
});

eventsRouter.post('/recurring', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const template = await recurringService.createTemplate({ ...req.body, tenantId: authReq.tenantId, createdBy: authReq.user.sub });
    success(res, template, undefined, 201);
  } catch (err: any) { console.error('Failed to create template', err?.message || err); error(res, 'Failed to create template', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/recurring/:id', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const template = await recurringService.updateTemplate(req.params.id, authReq.tenantId, req.body);
    if (!template) { error(res, 'Template not found', 'NOT_FOUND', 404); return; }
    success(res, template);
  } catch (err: any) { console.error('Failed to update template', err?.message || err); error(res, 'Failed to update template', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/recurring/:id/cancel', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const template = await recurringService.cancelTemplate(req.params.id, authReq.tenantId);
    success(res, template);
  } catch (err: any) { error(res, err.message || 'Failed to cancel', 'NOT_FOUND', 404); }
});

eventsRouter.post('/recurring/:id/generate', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const instances = await recurringService.generateInstances(req.params.id, authReq.tenantId);
    success(res, instances, undefined, 201);
  } catch (err: any) { error(res, err.message || 'Failed to generate', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Event Series (before /:id)
// ============================================================

eventsRouter.get('/series', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const series = await seriesService.getSeries(authReq.tenantId);
    success(res, series);
  } catch (err: any) { console.error('Failed to list series', err?.message || err); error(res, 'Failed to list series', 'INTERNAL_ERROR', 500); }
});

eventsRouter.post('/series', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const s = await seriesService.createSeries(authReq.tenantId, req.body);
    success(res, s, undefined, 201);
  } catch (err: any) { console.error('Failed to create series', err?.message || err); error(res, 'Failed to create series', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/series/:id', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const s = await seriesService.getSeriesById(req.params.id, authReq.tenantId);
    if (!s) { error(res, 'Series not found', 'NOT_FOUND', 404); return; }
    success(res, s);
  } catch (err: any) { console.error('Failed to get series', err?.message || err); error(res, 'Failed to get series', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/series/:id', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const s = await seriesService.updateSeries(req.params.id, authReq.tenantId, req.body);
    if (!s) { error(res, 'Series not found', 'NOT_FOUND', 404); return; }
    success(res, s);
  } catch (err: any) { console.error('Failed to update series', err?.message || err); error(res, 'Failed to update series', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Reports (before /:id)
// ============================================================

eventsRouter.get('/reports/summary', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = req.query.end_date as string || new Date().toISOString();
    const summary = await reportsService.getEventsSummary(authReq.tenantId, startDate, endDate);
    success(res, summary);
  } catch (err: any) { console.error('Failed to get summary', err?.message || err); error(res, 'Failed to get summary', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Registration management (before /:id to avoid conflict)
// ============================================================

eventsRouter.put('/registrations/:rid/cancel', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const reg = await registrationService.cancelRegistration(req.params.rid, authReq.tenantId);
    await customerEvents.queueEventEmail(reg.id, 'cancelled');
    success(res, reg);
  } catch (err: any) { error(res, err.message || 'Failed to cancel', 'NOT_FOUND', 404); }
});

eventsRouter.put('/registrations/:rid/transfer', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const reg = await registrationService.transferRegistration(req.params.rid, req.body.customer_id, authReq.tenantId);
    success(res, reg);
  } catch (err: any) { error(res, err.message || 'Failed to transfer', 'NOT_FOUND', 404); }
});

eventsRouter.put('/registrations/:rid/check-in', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const reg = await checkinService.checkInManual(req.params.rid);
    success(res, reg);
  } catch (err: any) { error(res, err.message || 'Failed to check in', 'NOT_FOUND', 404); }
});

// Waitlist confirm
// A paid ticket is held as "pending" until it is paid; staff confirm it when the money is in.
eventsRouter.put('/registrations/:rid/confirm', requirePermission('events:*'), async (req: Request, res: Response) => {
  try { success(res, await registrationService.confirmRegistration(req.params.rid)); }
  catch (err: any) { error(res, err.message || 'Failed to confirm', 'CONFLICT', 409); }
});

eventsRouter.put('/waitlist/:wid/confirm', async (req: Request, res: Response) => {
  try {
    const { rows: w } = await adminPool.query('SELECT event_id, customer_id, ticket_tier_id FROM evt_waitlist WHERE id = $1', [req.params.wid]);
    const own = await ownCustomerIds(req);
    if (!canManageEvents(req) && !own.includes(w[0]?.customer_id)) { error(res, 'Insufficient permissions', 'FORBIDDEN', 403); return; }
    const entry = await waitlistService.confirmWaitlistSpot(req.params.wid);
    // Taking the place means being registered (confirming used to change the entry only).
    const registration = await registrationService.registerForEvent(w[0].event_id, { customerId: w[0].customer_id, ticketTierId: w[0].ticket_tier_id || undefined, groupSize: 1 } as any);
    await customerEvents.queueEventEmail(registration.id, registration.status === 'confirmed' ? 'confirmed' : 'reserved');
    success(res, { ...entry, registration });
  } catch (err: any) { error(res, err.message || 'Failed to confirm', 'NOT_FOUND', 404); }
});

// ============================================================
// Event CRUD
// ============================================================

eventsRouter.get('/', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await eventService.getEvents(authReq.tenantId, {
      eventTypeId: req.query.event_type_id as string,
      status: req.query.status as string,
      startDate: req.query.start_date as string,
      endDate: req.query.end_date as string,
      search: req.query.search as string,
      deleted: req.query.deleted === 'true',
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.events, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) { console.error('Failed to list events', err?.message || err); error(res, 'Failed to list events', 'INTERNAL_ERROR', 500); }
});

// An event's tax category must be one of a business of the organisation (THE-20).
async function taxCategoryProblem(req: Request): Promise<string | null> {
  const id = req.body.tax_category_id;
  if (id === undefined || id === null || id === '') return null;
  const { rows } = UUID.test(id) ? await adminPool.query(
    `SELECT 1 FROM svc_tax_categories tc JOIN sys_businesses b ON b.id = tc.business_id WHERE tc.id = $1 AND b.tenant_id = $2`,
    [id, (req as AuthenticatedRequest).tenantId]) : { rows: [] as any[] };
  return rows.length ? null : 'Tax category not found';
}

eventsRouter.post('/', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Every event has a type (evt_events.event_type_id is required).
    if (!req.body.event_type_id || !UUID.test(String(req.body.event_type_id))) { error(res, 'Choose an event type', 'VALIDATION_ERROR', 400); return; }
    const taxProblem = await taxCategoryProblem(req);
    if (taxProblem) { error(res, taxProblem, 'VALIDATION_ERROR', 400); return; }
    const event = await eventService.createEvent({
      tenantId: authReq.tenantId, eventTypeId: req.body.event_type_id,
      title: req.body.title, description: req.body.description,
      startTime: req.body.start_time, endTime: req.body.end_time,
      locationId: req.body.location_id, locationName: req.body.location_name,
      capacity: req.body.capacity, minAttendees: req.body.min_attendees,
      tags: req.body.tags, customFields: req.body.custom_fields,
      cancellationPolicy: req.body.cancellation_policy,
      coverImagePath: req.body.cover_image_path, createdBy: authReq.user.sub,
      taxCategoryId: req.body.tax_category_id || null,
    });
    success(res, event, undefined, 201);
  } catch (err: any) { console.error('Failed to create event', err?.message || err); error(res, 'Failed to create event', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/:id', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.getEventById(req.params.id, authReq.tenantId);
    if (!event) { error(res, 'Event not found', 'NOT_FOUND', 404); return; }
    success(res, event);
  } catch (err: any) { console.error('Failed to get event', err?.message || err); error(res, 'Failed to get event', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/:id', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const taxProblem = await taxCategoryProblem(req);
    if (taxProblem) { error(res, taxProblem, 'VALIDATION_ERROR', 400); return; }
    const updates = req.body.tax_category_id === '' ? { ...req.body, tax_category_id: null } : req.body;
    const event = await eventService.updateEvent(req.params.id, authReq.tenantId, updates, authReq.user.sub);
    if (!event) { error(res, 'Event not found', 'NOT_FOUND', 404); return; }
    success(res, event);
  } catch (err: any) { console.error('Failed to update event', err?.message || err); error(res, 'Failed to update event', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/:id/publish', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.publishEvent(req.params.id, authReq.tenantId);
    success(res, event);
  } catch (err: any) { error(res, err.message || 'Failed to publish', 'VALIDATION_ERROR', 400); }
});

eventsRouter.get('/:id/cancel-preview', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await eventService.cancelPreview(req.params.id, authReq.tenantId));
  } catch (err: any) { error(res, err.message || 'Failed to load', 'NOT_FOUND', 404); }
});

eventsRouter.put('/:id/cancel', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.cancelEvent(req.params.id, authReq.tenantId, authReq.user.sub);
    success(res, event);
  } catch (err: any) { error(res, err.message || 'Failed to cancel', 'VALIDATION_ERROR', 400); }
});

// Delete = archive, restorable; refused while the event has registrations or a waiting list.
eventsRouter.delete('/:id', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await eventService.archiveEvent(req.params.id, authReq.tenantId, authReq.user.sub));
  } catch (err: any) {
    if (err instanceof eventService.EventArchiveError) { error(res, err.message, err.code, err.status); return; }
    console.error('Failed to delete event', err?.message || err); error(res, 'Failed to delete event', 'INTERNAL_ERROR', 500);
  }
});

eventsRouter.put('/:id/restore', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await eventService.restoreEvent(req.params.id, authReq.tenantId, authReq.user.sub));
  } catch (err: any) {
    if (err instanceof eventService.EventArchiveError) { error(res, err.message, err.code, err.status); return; }
    console.error('Failed to restore event', err?.message || err); error(res, 'Failed to restore event', 'INTERNAL_ERROR', 500);
  }
});

eventsRouter.put('/:id/complete', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.completeEvent(req.params.id, authReq.tenantId);
    success(res, event);
  } catch (err: any) { error(res, err.message || 'Failed to complete', 'VALIDATION_ERROR', 400); }
});

// Facilitators
eventsRouter.get('/:id/facilitators', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.getEventById(req.params.id, authReq.tenantId);
    if (!event) { error(res, 'Event not found', 'NOT_FOUND', 404); return; }
    success(res, await eventService.getFacilitators(req.params.id));
  } catch (err: any) { console.error('Failed to list facilitators', err?.message || err); error(res, 'Failed to list facilitators', 'INTERNAL_ERROR', 500); }
});

eventsRouter.post('/:id/facilitators', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const f = await eventService.addFacilitator(req.params.id, req.body.staff_id, req.body.role || 'facilitator');
    success(res, f, undefined, 201);
  } catch (err: any) {
    if (err?.status === 400) { error(res, err.message, 'VALIDATION_ERROR', 400); return; }
    console.error('Failed to add facilitator', err?.message || err); error(res, 'Failed to add facilitator', 'INTERNAL_ERROR', 500);
  }
});

eventsRouter.delete('/:id/facilitators/:fid', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await eventService.removeFacilitator(req.params.fid, req.params.id);
    if (!deleted) { error(res, 'Facilitator not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { console.error('Failed to remove facilitator', err?.message || err); error(res, 'Failed to remove facilitator', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Ticket Tiers
// ============================================================

eventsRouter.get('/:id/tickets', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const tiers = await ticketsService.getTiers(req.params.id);
    success(res, tiers);
  } catch (err: any) { console.error('Failed to list tiers', err?.message || err); error(res, 'Failed to list tiers', 'INTERNAL_ERROR', 500); }
});

const ELIGIBILITY = ['all', 'members_only', 'first_time', 'custom'];

eventsRouter.post('/:id/tickets', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    if (req.body.eligibility_type !== undefined && !ELIGIBILITY.includes(req.body.eligibility_type)) {
      error(res, `eligibility_type must be one of ${ELIGIBILITY.join(', ')}`, 'VALIDATION_ERROR', 400); return;
    }
    const tier = await ticketsService.createTier(req.params.id, {
      name: req.body.name, description: req.body.description,
      price: req.body.price, quantityAvailable: req.body.quantity_available,
      availabilityStart: req.body.availability_start, availabilityEnd: req.body.availability_end,
      eligibilityType: req.body.eligibility_type, eligibilityConfig: req.body.eligibility_config,
      displayOrder: req.body.display_order,
    });
    success(res, tier, undefined, 201);
  } catch (err: any) { console.error('Failed to create tier', err?.message || err); error(res, 'Failed to create tier', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/:id/tickets/:tid', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const tier = await ticketsService.updateTier(req.params.tid, req.params.id, req.body);
    if (!tier) { error(res, 'Tier not found', 'NOT_FOUND', 404); return; }
    success(res, tier);
  } catch (err: any) { console.error('Failed to update tier', err?.message || err); error(res, 'Failed to update tier', 'INTERNAL_ERROR', 500); }
});

eventsRouter.delete('/:id/tickets/:tid', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await ticketsService.deleteTier(req.params.tid, req.params.id);
    if (!deleted) { error(res, 'Tier not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    if (err.message?.includes('registrations')) error(res, err.message, 'VALIDATION_ERROR', 400);
    else error(res, 'Failed to delete tier', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Registration
// ============================================================

eventsRouter.post('/:id/register', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // A customer registers themself; staff who manage events register anyone of the organisation.
    const own = await ownCustomerIds(req);
    const customerId = req.body.customer_id as string;
    if (!canManageEvents(req) && !own.includes(customerId)) { error(res, 'You can register yourself only', 'FORBIDDEN', 403); return; }
    const { rows: person } = UUID.test(customerId || '') ? await adminPool.query(
      `SELECT 1 FROM cus_customers c JOIN sys_businesses b ON b.id = c.business_id WHERE c.id = $1 AND b.tenant_id = $2 AND c.status = 'active'`,
      [customerId, authReq.tenantId]) : { rows: [] as any[] };
    if (person.length === 0) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    const groupSize = req.body.group_size === undefined ? 1 : req.body.group_size;
    if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 20) { error(res, 'group_size must be between 1 and 20', 'VALIDATION_ERROR', 400); return; }
    const payAt = req.body.pay_at === undefined ? 'reception' : req.body.pay_at;
    if (!['online', 'reception'].includes(payAt)) { error(res, "pay_at must be 'online' or 'reception'", 'VALIDATION_ERROR', 400); return; }
    const byCustomer = !canManageEvents(req);
    try {
      await customerEvents.assertNotAlreadyRegistered(req.params.id, customerId);
      // A customer may choose only a ticket that is on sale and that they are eligible for
      // (members-only tickets need an active membership at the hosting business).
      let tier: any = null;
      if (byCustomer) tier = await customerEvents.assertCustomerMayRegister(req.params.id, req.body.ticket_tier_id, own);
      else if (req.body.ticket_tier_id) {
        const { rows: t } = await adminPool.query('SELECT price FROM evt_ticket_tiers WHERE id = $1 AND event_id = $2', [req.body.ticket_tier_id, req.params.id]);
        tier = t[0] || null;
      }
      const paid = !!tier && tier.price > 0;
      const hostId = paid ? await customerEvents.hostBusinessId(req.params.id) : null;
      if (paid && payAt === 'online' && !(await customerEvents.canPayOnline(hostId))) {
        error(res, 'Paying online is not available for this event; choose to pay at reception', 'VALIDATION_ERROR', 400); return;
      }
      // A paid ticket is sold by the hosting business, to the person's record there.
      const registrant = paid && hostId ? await customerEvents.hostCustomerId(hostId, customerId, authReq.user.sub) : customerId;
      const reg = await registrationService.registerForEvent(req.params.id, {
        customerId: registrant, ticketTierId: req.body.ticket_tier_id,
        attendeeInfo: req.body.attendee_info, groupSize, payAt,
      });
      let payment: any = null;
      if (paid && payAt === 'online') {
        try {
          const { orderId } = await customerEvents.createTicketOrder(reg.id, authReq.user.sub);
          const { beginOneTimeOrderCharge } = await import('../services/walkin-payment.service');
          const session = await beginOneTimeOrderCharge(hostId!, orderId);
          payment = {
            order_id: orderId, provider_reference: session.providerReference, client_secret: session.clientSecret,
            publishable_key: session.publishableKey, amount: session.amountCents, currency: session.currency,
          };
        } catch (e: any) {
          await customerEvents.cancelOwnRegistration({ registrationId: reg.id, tenantId: authReq.tenantId, userId: authReq.user.sub, byCustomer: false }).catch(() => undefined);
          throw new customerEvents.CustomerEventError(e?.message || 'The online payment could not be started', 502, 'PAYMENT_UNAVAILABLE');
        }
      }
      // On the person's timeline, like a booking.
      const { rows: info } = await adminPool.query(
        'SELECT c.business_id, e.title FROM cus_customers c, evt_events e WHERE c.id = $1 AND e.id = $2', [customerId, req.params.id]);
      if (info[0]) {
        await createActivity({
          customerId, businessId: info[0].business_id, activityType: 'event',
          description: `Registered for the event: ${info[0].title}`,
          metadata: { event_id: req.params.id, registration_id: reg.id }, createdBy: authReq.user.sub,
        }).catch(() => undefined);
      }
      if (reg.status === 'confirmed') await customerEvents.queueEventEmail(reg.id, 'confirmed');
      else if (payAt === 'reception') await customerEvents.queueEventEmail(reg.id, 'reserved');
      success(res, { ...reg, payment }, undefined, 201);
    } catch (err: any) {
      // Full: the person goes on the waitlist instead of being turned away.
      if (!err.message?.includes('at capacity')) throw err;
      const entry = await waitlistService.addToWaitlist(req.params.id, customerId, req.body.ticket_tier_id);
      success(res, { waitlisted: true, ...entry }, undefined, 202);
    }
  } catch (err: any) {
    if (err instanceof customerEvents.CustomerEventError) error(res, err.message, err.code, err.status);
    else if (err.message?.includes('capacity') || err.message?.includes('sold out')) error(res, err.message, 'CONFLICT', 409);
    else error(res, err.message || 'Failed to register', 'VALIDATION_ERROR', 400);
  }
});

eventsRouter.get('/:id/registrations', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const result = await registrationService.getRegistrations(req.params.id, {
      status: req.query.status as string, customerId: req.query.customer_id as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    });
    success(res, result.registrations, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) { console.error('Failed to list registrations', err?.message || err); error(res, 'Failed to list registrations', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Waitlist
// ============================================================

eventsRouter.get('/:id/waitlist', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const waitlist = await waitlistService.getWaitlist(req.params.id);
    success(res, waitlist);
  } catch (err: any) { console.error('Failed to get waitlist', err?.message || err); error(res, 'Failed to get waitlist', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Check-In
// ============================================================

eventsRouter.post('/:id/check-in/qr', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const reg = await checkinService.checkInByReference(req.body.reference_number);
    success(res, reg);
  } catch (err: any) { error(res, err.message || 'Check-in failed', 'NOT_FOUND', 404); }
});

eventsRouter.get('/:id/attendees', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const attendees = await checkinService.getAttendees(req.params.id);
    success(res, attendees);
  } catch (err: any) { console.error('Failed to get attendees', err?.message || err); error(res, 'Failed to get attendees', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/:id/attendees/export', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const data = await reportsService.exportAttendeeList(req.params.id);
    success(res, data);
  } catch (err: any) { console.error('Failed to export', err?.message || err); error(res, 'Failed to export', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Communications
// ============================================================

eventsRouter.post('/:id/communications', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const record = await commsService.sendAdHoc(req.params.id, req.body.subject, req.body.content);
    success(res, record, undefined, 201);
  } catch (err: any) { console.error('Failed to send', err?.message || err); error(res, 'Failed to send', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/:id/communications', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const history = await commsService.getCommunicationHistory(req.params.id);
    success(res, history);
  } catch (err: any) { console.error('Failed to get history', err?.message || err); error(res, 'Failed to get history', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Reports (per-event)
// ============================================================

eventsRouter.get('/:id/reports', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const report = await reportsService.getEventReport(req.params.id);
    success(res, report);
  } catch (err: any) { console.error('Failed to get report', err?.message || err); error(res, 'Failed to get report', 'INTERNAL_ERROR', 500); }
});
