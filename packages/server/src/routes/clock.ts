import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as clockService from '../services/clock.service';
import { adminPool } from '../db/pool';

export const clockRouter = Router();

clockRouter.use(authenticate);
clockRouter.use(tenantContext);

const EVENT_TYPES = ['clock_in', 'break_start', 'break_end', 'clock_out'];

/** Resolve a business's timezone (defaults to UTC), for local-day bucketing. */
async function businessTimezone(businessId: string): Promise<string> {
  const { rows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]);
  return rows[0]?.timezone || 'UTC';
}

// ============================================================
// Shared clock screen — PIN-authenticated punches
// ============================================================

const punchSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  email: Joi.string().email().required(),
  pin: Joi.string().pattern(/^\d{4}$/).required(),
  event_type: Joi.string().valid(...EVENT_TYPES).required(),
});

// POST /api/v1/clock/punch — record a live punch (email + PIN).
// Reachable by any authenticated business user (shared screen); the PIN is the
// per-employee authorization for the punch itself.
clockRouter.post('/punch', validate(punchSchema), async (req: Request, res: Response) => {
  try {
    const { business_id, email, pin, event_type } = req.body;
    let staff;
    try {
      staff = await clockService.verifyClockPin(business_id, email, pin);
    } catch (e: any) {
      if (e.code === 'LOCKED') { error(res, e.message, 'LOCKED', 429); return; }
      throw e;
    }
    if (!staff) { error(res, 'Invalid email or PIN', 'INVALID_CREDENTIALS', 401); return; }

    try {
      const result = await clockService.punch(business_id, staff.tenant_id, staff.user_id, event_type, staff.staff_ref);
      success(res, {
        event: result.event,
        state: result.state,
        staff: { first_name: staff.first_name, last_name: staff.last_name },
      });
    } catch (e: any) {
      if (e.code === 'INVALID_TRANSITION') { error(res, e.message, 'INVALID_TRANSITION', 409); return; }
      throw e;
    }
  } catch (err: any) { error(res, 'Failed to record punch', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/clock/state — current state for a staff member (email + PIN),
// so the shared screen can show only the valid actions after identifying them.
const stateSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  email: Joi.string().email().required(),
  pin: Joi.string().pattern(/^\d{4}$/).required(),
});

clockRouter.post('/state', validate(stateSchema), async (req: Request, res: Response) => {
  try {
    const { business_id, email, pin } = req.body;
    let staff;
    try {
      staff = await clockService.verifyClockPin(business_id, email, pin);
    } catch (e: any) {
      if (e.code === 'LOCKED') { error(res, e.message, 'LOCKED', 429); return; }
      throw e;
    }
    if (!staff) { error(res, 'Invalid email or PIN', 'INVALID_CREDENTIALS', 401); return; }

    const state = await clockService.getCurrentState(staff.user_id, business_id);
    success(res, { ...state, staff: { first_name: staff.first_name, last_name: staff.last_name } });
  } catch (err: any) { error(res, 'Failed to get state', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// PIN management (manager/owner)
// ============================================================

const setPinSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  pin: Joi.string().pattern(/^\d{4}$/).required(),
});

// PUT /api/v1/clock/staff/:staffProfileId/pin — set/reset a staff member's PIN.
clockRouter.put('/staff/:staffProfileId/pin', requirePermission('staff:read'), validate(setPinSchema), async (req: Request, res: Response) => {
  try {
    const ok = await clockService.setClockPin(req.params.staffProfileId, req.body.business_id, req.body.pin);
    if (!ok) { error(res, 'Staff member not found', 'NOT_FOUND', 404); return; }
    success(res, { saved: true });
  } catch (e: any) {
    if (e.message.includes('4 digits')) { error(res, e.message, 'VALIDATION_ERROR', 400); return; }
    error(res, 'Failed to set PIN', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Self-service PIN (any authenticated staff — acts only on their own profile)
// ============================================================

// GET /api/v1/clock/my-pin — whether the caller has a staff profile + PIN set.
clockRouter.get('/my-pin', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const status = await clockService.getOwnClockPinStatus(authReq.user.sub);
    success(res, status);
  } catch (err: any) { error(res, 'Failed to get PIN status', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/clock/my-pin — the caller sets/changes their OWN PIN. The target
// is derived from the authenticated user, never from client input.
const myPinSchema = Joi.object({ pin: Joi.string().pattern(/^\d{4}$/).required() });
clockRouter.put('/my-pin', validate(myPinSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const ok = await clockService.setOwnClockPin(authReq.user.sub, req.body.pin);
    if (!ok) { error(res, 'No staff profile is linked to your account', 'NOT_FOUND', 404); return; }
    success(res, { saved: true });
  } catch (e: any) {
    if (e.message.includes('4 digits')) { error(res, e.message, 'VALIDATION_ERROR', 400); return; }
    error(res, 'Failed to set PIN', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/clock/my-events — the caller's OWN punches for a date range.
// Read-only; no staff:read gate. The user and business are derived from the
// authenticated user, so this can only ever return the caller's own records.
clockRouter.get('/my-events', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start as string;
    const end = req.query.end as string;
    if (!start || !end) { error(res, 'start, end required', 'VALIDATION_ERROR', 400); return; }
    const events = await clockService.listOwnEvents(authReq.user.sub, start, end);
    success(res, events);
  } catch (err: any) { error(res, 'Failed to list events', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/clock/my-hours — the caller's OWN computed daily hours (net of
// breaks) for a date range. Read-only; self-scoped like /my-events.
clockRouter.get('/my-hours', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start as string;
    const end = req.query.end as string;
    if (!start || !end) { error(res, 'start, end required', 'VALIDATION_ERROR', 400); return; }
    const days = await clockService.computeOwnDailyHours(authReq.user.sub, start, end);
    success(res, days);
  } catch (err: any) { error(res, 'Failed to compute hours', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Manager views + corrections (manager/owner — staff:read)
// ============================================================

// GET /api/v1/clock/events — list a staff member's events for a date range.
clockRouter.get('/events', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    const userId = req.query.user_id as string;
    const start = req.query.start as string;
    const end = req.query.end as string;
    if (!businessId || !userId || !start || !end) {
      error(res, 'business_id, user_id, start, end required', 'VALIDATION_ERROR', 400); return;
    }
    const events = await clockService.listEvents(businessId, userId, start, end);
    success(res, events);
  } catch (err: any) { error(res, 'Failed to list events', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/clock/hours — computed daily hours (net of breaks) for a staff member.
clockRouter.get('/hours', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    const userId = req.query.user_id as string;
    const start = req.query.start as string;
    const end = req.query.end as string;
    if (!businessId || !userId || !start || !end) {
      error(res, 'business_id, user_id, start, end required', 'VALIDATION_ERROR', 400); return;
    }
    const tz = await businessTimezone(businessId);
    const days = await clockService.computeDailyHours(businessId, userId, start, end, tz);
    success(res, days);
  } catch (err: any) { error(res, 'Failed to compute hours', 'INTERNAL_ERROR', 500); }
});

const manualEventSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  user_id: Joi.string().uuid().required(),
  event_type: Joi.string().valid(...EVENT_TYPES).required(),
  event_at: Joi.string().isoDate().required(),
  note: Joi.string().max(500).allow('', null),
});

// POST /api/v1/clock/events — manager creates a manual (correction) event.
clockRouter.post('/events', requirePermission('staff:read'), validate(manualEventSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const event = await clockService.createManualEvent({
      businessId: req.body.business_id,
      tenantId: authReq.tenantId,
      userId: req.body.user_id,
      eventType: req.body.event_type,
      eventAt: req.body.event_at,
      note: req.body.note,
      createdBy: authReq.user.sub,
    });
    success(res, event, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create event', 'INTERNAL_ERROR', 500); }
});

const updateEventSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  event_type: Joi.string().valid(...EVENT_TYPES),
  event_at: Joi.string().isoDate(),
  note: Joi.string().max(500).allow('', null),
}).min(2); // business_id + at least one field

// PUT /api/v1/clock/events/:id — manager edits a manual event.
clockRouter.put('/events/:id', requirePermission('staff:read'), validate(updateEventSchema), async (req: Request, res: Response) => {
  try {
    const updated = await clockService.updateManualEvent(req.params.id, req.body.business_id, {
      eventType: req.body.event_type,
      eventAt: req.body.event_at,
      note: req.body.note,
    });
    if (!updated) { error(res, 'Event not found or not editable (only manual corrections can be edited)', 'NOT_FOUND', 404); return; }
    success(res, updated);
  } catch (err: any) { error(res, 'Failed to update event', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/clock/events/:id — manager deletes an event.
clockRouter.delete('/events/:id', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const ok = await clockService.deleteEvent(req.params.id, businessId);
    if (!ok) { error(res, 'Event not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete event', 'INTERNAL_ERROR', 500); }
});
