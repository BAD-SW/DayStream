import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
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
    success(res, result.events, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) { error(res, 'Failed to load calendar', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/calendar/:slug', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) { error(res, 'tenant_id required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await (await import('../db/pool')).adminPool.query(
      `SELECT e.*, et.name AS event_type_name FROM evt_events e
       LEFT JOIN evt_types et ON et.id = e.event_type_id
       WHERE e.slug = $1 AND e.tenant_id = $2 AND e.status = 'published'`, [req.params.slug, tenantId]);
    if (rows.length === 0) { error(res, 'Event not found', 'NOT_FOUND', 404); return; }
    // Load tiers
    const tiers = await ticketsService.getTiers(rows[0].id);
    success(res, { ...rows[0], tiers });
  } catch (err: any) { error(res, 'Failed to load event', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Authenticated routes
// ============================================================

eventsRouter.use(authenticate);
eventsRouter.use(tenantContext);

// ============================================================
// Event Types (before /:id)
// ============================================================

eventsRouter.get('/types', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const types = await eventTypesService.getEventTypes(authReq.tenantId);
    success(res, types);
  } catch (err: any) { error(res, 'Failed to list event types', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { error(res, 'Failed to update type', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Recurring Events (before /:id)
// ============================================================

eventsRouter.get('/recurring', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const templates = await recurringService.getTemplates(authReq.tenantId);
    success(res, templates);
  } catch (err: any) { error(res, 'Failed to list templates', 'INTERNAL_ERROR', 500); }
});

eventsRouter.post('/recurring', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const template = await recurringService.createTemplate({ ...req.body, tenantId: authReq.tenantId, createdBy: authReq.user.sub });
    success(res, template, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create template', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/recurring/:id', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const template = await recurringService.updateTemplate(req.params.id, authReq.tenantId, req.body);
    if (!template) { error(res, 'Template not found', 'NOT_FOUND', 404); return; }
    success(res, template);
  } catch (err: any) { error(res, 'Failed to update template', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { error(res, 'Failed to list series', 'INTERNAL_ERROR', 500); }
});

eventsRouter.post('/series', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const s = await seriesService.createSeries(authReq.tenantId, req.body);
    success(res, s, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create series', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/series/:id', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const s = await seriesService.getSeriesById(req.params.id, authReq.tenantId);
    if (!s) { error(res, 'Series not found', 'NOT_FOUND', 404); return; }
    success(res, s);
  } catch (err: any) { error(res, 'Failed to get series', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/series/:id', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const s = await seriesService.updateSeries(req.params.id, authReq.tenantId, req.body);
    if (!s) { error(res, 'Series not found', 'NOT_FOUND', 404); return; }
    success(res, s);
  } catch (err: any) { error(res, 'Failed to update series', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { error(res, 'Failed to get summary', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Registration management (before /:id to avoid conflict)
// ============================================================

eventsRouter.put('/registrations/:rid/cancel', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const reg = await registrationService.cancelRegistration(req.params.rid, authReq.tenantId);
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
eventsRouter.put('/waitlist/:wid/confirm', async (req: Request, res: Response) => {
  try {
    const entry = await waitlistService.confirmWaitlistSpot(req.params.wid);
    success(res, entry);
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
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.events, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) { error(res, 'Failed to list events', 'INTERNAL_ERROR', 500); }
});

eventsRouter.post('/', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.createEvent({
      tenantId: authReq.tenantId, eventTypeId: req.body.event_type_id,
      title: req.body.title, description: req.body.description,
      startTime: req.body.start_time, endTime: req.body.end_time,
      locationId: req.body.location_id, locationName: req.body.location_name,
      capacity: req.body.capacity, minAttendees: req.body.min_attendees,
      tags: req.body.tags, customFields: req.body.custom_fields,
      cancellationPolicy: req.body.cancellation_policy,
      coverImagePath: req.body.cover_image_path, createdBy: authReq.user.sub,
    });
    success(res, event, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create event', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/:id', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.getEventById(req.params.id, authReq.tenantId);
    if (!event) { error(res, 'Event not found', 'NOT_FOUND', 404); return; }
    success(res, event);
  } catch (err: any) { error(res, 'Failed to get event', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/:id', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.updateEvent(req.params.id, authReq.tenantId, req.body, authReq.user.sub);
    if (!event) { error(res, 'Event not found', 'NOT_FOUND', 404); return; }
    success(res, event);
  } catch (err: any) { error(res, 'Failed to update event', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/:id/publish', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.publishEvent(req.params.id, authReq.tenantId);
    success(res, event);
  } catch (err: any) { error(res, err.message || 'Failed to publish', 'VALIDATION_ERROR', 400); }
});

eventsRouter.put('/:id/cancel', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.cancelEvent(req.params.id, authReq.tenantId, authReq.user.sub);
    success(res, event);
  } catch (err: any) { error(res, err.message || 'Failed to cancel', 'VALIDATION_ERROR', 400); }
});

eventsRouter.put('/:id/complete', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await eventService.completeEvent(req.params.id, authReq.tenantId);
    success(res, event);
  } catch (err: any) { error(res, err.message || 'Failed to complete', 'VALIDATION_ERROR', 400); }
});

// Facilitators
eventsRouter.post('/:id/facilitators', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const f = await eventService.addFacilitator(req.params.id, req.body.staff_id, req.body.role || 'facilitator');
    success(res, f, undefined, 201);
  } catch (err: any) { error(res, 'Failed to add facilitator', 'INTERNAL_ERROR', 500); }
});

eventsRouter.delete('/:id/facilitators/:fid', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await eventService.removeFacilitator(req.params.fid, req.params.id);
    if (!deleted) { error(res, 'Facilitator not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to remove facilitator', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Ticket Tiers
// ============================================================

eventsRouter.get('/:id/tickets', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const tiers = await ticketsService.getTiers(req.params.id);
    success(res, tiers);
  } catch (err: any) { error(res, 'Failed to list tiers', 'INTERNAL_ERROR', 500); }
});

eventsRouter.post('/:id/tickets', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const tier = await ticketsService.createTier(req.params.id, {
      name: req.body.name, description: req.body.description,
      price: req.body.price, quantityAvailable: req.body.quantity_available,
      availabilityStart: req.body.availability_start, availabilityEnd: req.body.availability_end,
      eligibilityType: req.body.eligibility_type, eligibilityConfig: req.body.eligibility_config,
      displayOrder: req.body.display_order,
    });
    success(res, tier, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create tier', 'INTERNAL_ERROR', 500); }
});

eventsRouter.put('/:id/tickets/:tid', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const tier = await ticketsService.updateTier(req.params.tid, req.params.id, req.body);
    if (!tier) { error(res, 'Tier not found', 'NOT_FOUND', 404); return; }
    success(res, tier);
  } catch (err: any) { error(res, 'Failed to update tier', 'INTERNAL_ERROR', 500); }
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
    const reg = await registrationService.registerForEvent(req.params.id, {
      customerId: req.body.customer_id, ticketTierId: req.body.ticket_tier_id,
      attendeeInfo: req.body.attendee_info, groupSize: req.body.group_size,
    });
    success(res, reg, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('capacity') || err.message?.includes('sold out')) error(res, err.message, 'CONFLICT', 409);
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
  } catch (err: any) { error(res, 'Failed to list registrations', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Waitlist
// ============================================================

eventsRouter.get('/:id/waitlist', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const waitlist = await waitlistService.getWaitlist(req.params.id);
    success(res, waitlist);
  } catch (err: any) { error(res, 'Failed to get waitlist', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { error(res, 'Failed to get attendees', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/:id/attendees/export', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const data = await reportsService.exportAttendeeList(req.params.id);
    success(res, data);
  } catch (err: any) { error(res, 'Failed to export', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Communications
// ============================================================

eventsRouter.post('/:id/communications', requirePermission('events:*'), async (req: Request, res: Response) => {
  try {
    const record = await commsService.sendAdHoc(req.params.id, req.body.subject, req.body.content);
    success(res, record, undefined, 201);
  } catch (err: any) { error(res, 'Failed to send', 'INTERNAL_ERROR', 500); }
});

eventsRouter.get('/:id/communications', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const history = await commsService.getCommunicationHistory(req.params.id);
    success(res, history);
  } catch (err: any) { error(res, 'Failed to get history', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Reports (per-event)
// ============================================================

eventsRouter.get('/:id/reports', requirePermission('events:read'), async (req: Request, res: Response) => {
  try {
    const report = await reportsService.getEventReport(req.params.id);
    success(res, report);
  } catch (err: any) { error(res, 'Failed to get report', 'INTERNAL_ERROR', 500); }
});
