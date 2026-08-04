import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as typesService from '../services/resource-types.service';
import * as resourceService from '../services/resource.service';
import * as scheduleService from '../services/resource-schedule.service';
import * as availService from '../services/resource-availability.service';
import * as bookingsService from '../services/resource-bookings.service';
import * as requirementsService from '../services/resource-requirements.service';
import * as maintenanceService from '../services/resource-maintenance.service';
import * as depsService from '../services/resource-dependencies.service';
import * as calendarService from '../services/resource-calendar.service';
import * as utilizationService from '../services/resource-utilization.service';
import { storage } from '../services/storage.service';

export const resourcesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

resourcesRouter.use(authenticate);
resourcesRouter.use(tenantContext);

// ============================================================
// Resource Types (before /:id to avoid conflict)
// ============================================================

resourcesRouter.get('/types', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const types = await typesService.getResourceTypes(authReq.tenantId, businessId);
    success(res, types);
  } catch (err: any) { error(res, 'Failed to list resource types', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/types', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string || req.body.business_id;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const type = await typesService.createResourceType(authReq.tenantId, businessId, {
      name: req.body.name, category: req.body.category, description: req.body.description,
    });
    success(res, type, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('duplicate') || err.message?.includes('unique')) {
      error(res, 'A type with this name already exists', 'DUPLICATE_NAME', 409);
    } else { error(res, 'Failed to create type', 'INTERNAL_ERROR', 500); }
  }
});

resourcesRouter.put('/types/:id', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const type = await typesService.updateResourceType(req.params.id, authReq.tenantId, req.body);
    if (!type) { error(res, 'Type not found', 'NOT_FOUND', 404); return; }
    success(res, type);
  } catch (err: any) { error(res, 'Failed to update type', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.delete('/types/:id', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const deleted = await typesService.deleteResourceType(req.params.id, authReq.tenantId);
    if (!deleted) { error(res, 'Type not found or is system type', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    if (err.message?.includes('existing resources')) { error(res, err.message, 'VALIDATION_ERROR', 400); }
    else { error(res, 'Failed to delete type', 'INTERNAL_ERROR', 500); }
  }
});

// ============================================================
// Service-Resource Requirements (before /:id)
// ============================================================

resourcesRouter.get('/service-requirements/:serviceId', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const reqs = await requirementsService.getServiceRequirements(req.params.serviceId);
    success(res, reqs);
  } catch (err: any) { error(res, 'Failed to list requirements', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/service-requirements', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const requirement = await requirementsService.createRequirement({
      serviceId: req.body.service_id, variantId: req.body.variant_id,
      resourceId: req.body.resource_id, resourceTypeId: req.body.resource_type_id,
      requirementType: req.body.requirement_type, bufferMinutes: req.body.buffer_minutes,
    });
    success(res, requirement, undefined, 201);
  } catch (err: any) { error(res, err.message || 'Failed to create requirement', 'VALIDATION_ERROR', 400); }
});

resourcesRouter.put('/service-requirements/:id', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const req2 = await requirementsService.updateRequirement(req.params.id, req.body);
    if (!req2) { error(res, 'Requirement not found', 'NOT_FOUND', 404); return; }
    success(res, req2);
  } catch (err: any) { error(res, 'Failed to update requirement', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.delete('/service-requirements/:id', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await requirementsService.deleteRequirement(req.params.id);
    if (!deleted) { error(res, 'Requirement not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete requirement', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Find Available Resource (before /:id)
// ============================================================

resourcesRouter.post('/find-available', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const result = await availService.findAvailableResource(
      req.body.service_id, req.body.variant_id || null,
      req.body.start_time, req.body.end_time, req.body.location_id);
    if (result.error) { error(res, result.error, 'CONFLICT', 409); return; }
    success(res, result.resources);
  } catch (err: any) { error(res, 'Failed to find resources', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Calendar Timeline (before /:id)
// ============================================================

resourcesRouter.get('/calendar/timeline', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    if (!startDate || !endDate) { error(res, 'start_date and end_date required', 'VALIDATION_ERROR', 400); return; }

    const data = await calendarService.getResourceTimeline(authReq.tenantId, startDate, endDate, {
      resourceTypeId: req.query.resource_type_id as string,
      locationId: req.query.location_id as string,
    });
    success(res, data);
  } catch (err: any) { error(res, 'Failed to get timeline', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Utilization (before /:id)
// ============================================================

resourcesRouter.get('/utilization', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const endDate = req.query.end_date as string || new Date().toISOString().split('T')[0];

    const data = await utilizationService.getUtilizationSummary(authReq.tenantId, startDate, endDate, {
      resourceTypeId: req.query.resource_type_id as string,
      locationId: req.query.location_id as string,
    });
    success(res, data);
  } catch (err: any) { error(res, 'Failed to get utilization', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Resource CRUD
// ============================================================

const createResourceSchema = Joi.object({
  resource_type_id: Joi.string().uuid().allow('', null),
  category: Joi.string().valid('room', 'equipment', 'facility').allow('', null),
  location_id: Joi.string().uuid().allow(null),
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(2000).allow('', null),
  capacity: Joi.number().integer().min(1).max(500).default(1),
  buffer_minutes: Joi.number().integer().min(0).max(120).default(0),
  is_24_7: Joi.boolean().default(false),
  display_order: Joi.number().integer().min(0).default(0),
  custom_attributes: Joi.object().default({}),
});

resourcesRouter.get('/', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const result = await resourceService.getResources(authReq.tenantId, {
      businessId,
      resourceTypeId: req.query.resource_type_id as string,
      locationId: req.query.location_id as string,
      status: req.query.status as string,
      category: req.query.category as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
    });
    success(res, result.resources, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) { error(res, 'Failed to list resources', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/', requirePermission('resources:*'), validate(createResourceSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string || req.body.business_id;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const resource = await resourceService.createResource({
      tenantId: authReq.tenantId, businessId,
      resourceTypeId: req.body.resource_type_id || null,
      category: req.body.category || null,
      locationId: req.body.location_id, name: req.body.name, description: req.body.description,
      capacity: req.body.capacity, bufferMinutes: req.body.buffer_minutes,
      is247: req.body.is_24_7, displayOrder: req.body.display_order,
      customAttributes: req.body.custom_attributes, createdBy: authReq.user.sub,
    });
    success(res, resource, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create resource', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.get('/:id', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const resource = await resourceService.getResourceById(req.params.id, businessId);
    if (!resource) { error(res, 'Resource not found', 'NOT_FOUND', 404); return; }
    success(res, resource);
  } catch (err: any) { error(res, 'Failed to get resource', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.put('/:id', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const resource = await resourceService.updateResource(req.params.id, businessId, req.body, authReq.user.sub);
    if (!resource) { error(res, 'Resource not found', 'NOT_FOUND', 404); return; }
    success(res, resource);
  } catch (err: any) { error(res, 'Failed to update resource', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.put('/:id/deactivate', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const resource = await resourceService.deactivateResource(req.params.id, businessId, authReq.user.sub);
    if (!resource) { error(res, 'Resource not found or already inactive', 'NOT_FOUND', 404); return; }
    success(res, resource);
  } catch (err: any) { error(res, 'Failed to deactivate', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/:id/photo', requirePermission('resources:*'), upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    if (!req.file) { error(res, 'No photo provided', 'VALIDATION_ERROR', 400); return; }
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const relativePath = `resources/${authReq.tenantId}/${req.params.id}.${ext}`;
    await storage.save(relativePath, req.file.buffer);
    const resource = await resourceService.updateResource(req.params.id, businessId, { photo_path: relativePath }, authReq.user.sub);
    success(res, resource);
  } catch (err: any) { error(res, 'Failed to upload photo', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Schedules
// ============================================================

resourcesRouter.get('/:id/schedule', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const schedules = await scheduleService.getSchedules(req.params.id);
    success(res, schedules);
  } catch (err: any) { error(res, 'Failed to get schedules', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/:id/schedule', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const schedule = await scheduleService.createSchedule(req.params.id, {
      name: req.body.name, effectiveFrom: req.body.effective_from,
      effectiveTo: req.body.effective_to,
      slots: (req.body.slots || []).map((s: any) => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time })),
    });
    success(res, schedule, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('overlaps')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to create schedule', 'INTERNAL_ERROR', 500); }
  }
});

resourcesRouter.put('/:id/schedule/:sid', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const schedule = await scheduleService.updateSchedule(req.params.sid, req.params.id, {
      name: req.body.name, effectiveFrom: req.body.effective_from, effectiveTo: req.body.effective_to,
      slots: req.body.slots?.map((s: any) => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time })),
    });
    if (!schedule) { error(res, 'Schedule not found', 'NOT_FOUND', 404); return; }
    success(res, schedule);
  } catch (err: any) {
    if (err.message.includes('overlaps')) { error(res, err.message, 'CONFLICT', 409); }
    else { error(res, 'Failed to update schedule', 'INTERNAL_ERROR', 500); }
  }
});

resourcesRouter.delete('/:id/schedule/:sid', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await scheduleService.deleteSchedule(req.params.sid, req.params.id);
    if (!deleted) { error(res, 'Schedule not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete schedule', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.get('/:id/schedule/blocks', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const blocks = await scheduleService.getScheduleBlocks(req.params.id, req.query.start_date as string, req.query.end_date as string);
    success(res, blocks);
  } catch (err: any) { error(res, 'Failed to get blocks', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/:id/schedule/blocks', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const block = await scheduleService.addScheduleBlock(req.params.id, {
      blockDate: req.body.block_date, startTime: req.body.start_time, endTime: req.body.end_time, reason: req.body.reason,
    });
    success(res, block, undefined, 201);
  } catch (err: any) { error(res, 'Failed to add block', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.delete('/:id/schedule/blocks/:bid', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await scheduleService.deleteScheduleBlock(req.params.bid, req.params.id);
    if (!deleted) { error(res, 'Block not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete block', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Availability
// ============================================================

resourcesRouter.get('/:id/availability', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    if (!startDate || !endDate) { error(res, 'start_date and end_date required', 'VALIDATION_ERROR', 400); return; }
    const avail = await availService.getResourceAvailabilityRange(req.params.id, startDate, endDate);
    success(res, avail);
  } catch (err: any) { error(res, 'Failed to get availability', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Bookings
// ============================================================

resourcesRouter.get('/:id/bookings', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const startDate = req.query.start_date as string || new Date().toISOString().split('T')[0];
    const endDate = req.query.end_date as string || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const bookings = await bookingsService.getResourceBookings(req.params.id, startDate, endDate);
    success(res, bookings);
  } catch (err: any) { error(res, 'Failed to list bookings', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/:id/bookings', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const booking = await bookingsService.createResourceBooking({
      resourceId: req.params.id, bookingId: req.body.booking_id,
      startTime: req.body.start_time, endTime: req.body.end_time,
      bookingType: req.body.booking_type || 'manual', notes: req.body.notes,
    });
    success(res, booking, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('capacity') || err.message?.includes('retry')) {
      error(res, err.message, 'CONFLICT', 409);
    } else { error(res, 'Failed to create booking', 'INTERNAL_ERROR', 500); }
  }
});

resourcesRouter.delete('/:id/bookings/:bid', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const cancelled = await bookingsService.cancelResourceBooking(req.params.bid, req.params.id);
    if (!cancelled) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }
    success(res, cancelled);
  } catch (err: any) { error(res, 'Failed to cancel booking', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Maintenance
// ============================================================

resourcesRouter.get('/:id/maintenance', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const schedules = await maintenanceService.getMaintenanceSchedules(req.params.id);
    success(res, schedules);
  } catch (err: any) { error(res, 'Failed to list maintenance', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/:id/maintenance', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const maint = await maintenanceService.createMaintenance(req.params.id, {
      maintenanceType: req.body.maintenance_type, dayOfWeek: req.body.day_of_week,
      startTime: req.body.start_time, endTime: req.body.end_time,
      specificDate: req.body.specific_date, description: req.body.description,
    });
    success(res, maint, undefined, 201);
  } catch (err: any) { error(res, 'Failed to create maintenance', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.delete('/:id/maintenance/:mid', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await maintenanceService.deleteMaintenance(req.params.mid, req.params.id);
    if (!deleted) { error(res, 'Maintenance not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete maintenance', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Dependencies
// ============================================================

resourcesRouter.get('/:id/dependencies', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const deps = await depsService.getDependencies(req.params.id);
    success(res, deps);
  } catch (err: any) { error(res, 'Failed to list dependencies', 'INTERNAL_ERROR', 500); }
});

resourcesRouter.post('/:id/dependencies', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const dep = await depsService.addDependency(req.params.id, {
      dependsOnId: req.body.depends_on_id, offsetMinutes: req.body.offset_minutes, durationMinutes: req.body.duration_minutes,
    });
    success(res, dep, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('Circular') || err.message?.includes('itself')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else { error(res, 'Failed to add dependency', 'INTERNAL_ERROR', 500); }
  }
});

resourcesRouter.delete('/:id/dependencies/:did', requirePermission('resources:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await depsService.removeDependency(req.params.did, req.params.id);
    if (!deleted) { error(res, 'Dependency not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to remove dependency', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Calendar
// ============================================================

resourcesRouter.get('/:id/calendar', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    if (!startDate || !endDate) { error(res, 'start_date and end_date required', 'VALIDATION_ERROR', 400); return; }
    const calendar = await calendarService.getResourceCalendar(req.params.id, startDate, endDate);
    success(res, calendar);
  } catch (err: any) { error(res, 'Failed to get calendar', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Utilization (per-resource)
// ============================================================

resourcesRouter.get('/:id/utilization', requirePermission('resources:read'), async (req: Request, res: Response) => {
  try {
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const endDate = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await utilizationService.getResourceUtilization(req.params.id, startDate, endDate);
    success(res, data);
  } catch (err: any) { error(res, 'Failed to get utilization', 'INTERNAL_ERROR', 500); }
});
