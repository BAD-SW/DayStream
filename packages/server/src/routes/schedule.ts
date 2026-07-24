import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import * as scheduleService from '../services/staff-schedule.service';
import * as locationHoursService from '../services/location-hours.service';

export const scheduleRouter = Router();

scheduleRouter.use(authenticate);
scheduleRouter.use(tenantContext);

// GET /api/v1/schedule — Get schedule entries for a date range
scheduleRouter.get('/', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const dateFrom = req.query.date_from as string;
    const dateTo = req.query.date_to as string;
    if (!dateFrom || !dateTo) { error(res, 'date_from and date_to required', 'VALIDATION_ERROR', 400); return; }

    const entries = await scheduleService.getScheduleEntries(businessId, dateFrom, dateTo, req.query.staff_id as string);
    success(res, entries);
  } catch (err: any) { error(res, 'Failed to get schedule', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/schedule/staff — Get all active staff for the schedule view
scheduleRouter.get('/staff', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    const staff = await scheduleService.getScheduleStaff(businessId);
    success(res, staff);
  } catch (err: any) { error(res, 'Failed to get staff', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/schedule/business-hours — Get location hours for the schedule backdrop
scheduleRouter.get('/business-hours', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const locationId = req.query.location_id as string;
    if (!locationId) { error(res, 'location_id required', 'VALIDATION_ERROR', 400); return; }
    const hours = await locationHoursService.getLocationHours(locationId);
    success(res, hours);
  } catch (err: any) { error(res, 'Failed to get business hours', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/schedule — Create a schedule entry
scheduleRouter.post('/', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string || req.body.business_id;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }
    if (!req.body.staff_id || !req.body.schedule_date || !req.body.start_time || !req.body.end_time) {
      error(res, 'staff_id, schedule_date, start_time, and end_time required', 'VALIDATION_ERROR', 400);
      return;
    }

    const entry = await scheduleService.createScheduleEntry({
      businessId,
      staffId: req.body.staff_id,
      scheduleDate: req.body.schedule_date,
      startTime: req.body.start_time,
      endTime: req.body.end_time,
      locationId: req.body.location_id,
      entryType: req.body.entry_type,
      notes: req.body.notes,
    });
    success(res, entry, undefined, 201);
  } catch (err: any) {
    if (err.code === '23505') { error(res, 'A shift already exists for this staff member at this time', 'CONFLICT', 409); }
    else { error(res, 'Failed to create schedule entry', 'INTERNAL_ERROR', 500); }
  }
});

// PUT /api/v1/schedule/:id — Update a schedule entry
scheduleRouter.put('/:id', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const entry = await scheduleService.updateScheduleEntry(req.params.id, businessId, {
      scheduleDate: req.body.schedule_date,
      startTime: req.body.start_time,
      endTime: req.body.end_time,
      locationId: req.body.location_id,
      entryType: req.body.entry_type,
      notes: req.body.notes,
    });
    if (!entry) { error(res, 'Entry not found', 'NOT_FOUND', 404); return; }
    success(res, entry);
  } catch (err: any) { error(res, 'Failed to update schedule entry', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/schedule/:id — Delete a schedule entry
scheduleRouter.delete('/:id', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const deleted = await scheduleService.deleteScheduleEntry(req.params.id, businessId);
    if (!deleted) { error(res, 'Entry not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete schedule entry', 'INTERNAL_ERROR', 500); }
});
